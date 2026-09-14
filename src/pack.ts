/**
 * 东方红魔乡 新典版（TH06NC）PKGL 归档**回装**
 * ============================================================================
 *
 * 解包只是把 `.dat` 里的条目还原成文件；改完素材之后要「装回去」还差三件事，
 * 本模块全部覆盖：
 *
 *   1. 重新编码 —— 明文 → （可选 zstd 压缩）→ 用条目密钥 XOR 加密
 *   2. 重新布局 —— 数据区 16 字节对齐、索引区紧随 8 字节头
 *   3. 重新加密索引 —— 索引区密钥来自归档文件名（CRC32 → SplitMix64）
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 从原归档反推出的硬性约定（7 个归档 / 1783 条记录全部吻合）
 * ────────────────────────────────────────────────────────────────────────────
 *   [0x00] 8 字节   "PKGL" + u32 索引区字节数
 *   [0x08] 索引区   逐条记录，整体按 16 字节周期 XOR（密钥 ← 归档名 CRC32）
 *   补齐到 16 的整数倍（实测填充为 0x00）
 *   数据区        每条数据的 offset 均为 16 的倍数；条目之间补齐到 16
 *   文件末尾      补齐到 16 的整数倍（实测 7 个归档都以 1 字节 0x00 收尾）
 *
 *   压缩与否由 flags bit0 决定：bit0=1 → zstd；bit0=0 → 明文直接存。
 *   原归档里就有 375 条 raw（th06MD.dat 整个归档都是 raw），所以**不压缩也合法**，
 *   压缩只是体积优化 —— 这让本工具在没有任何 zstd 库的环境下依然可用。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 两种写法
 * ────────────────────────────────────────────────────────────────────────────
 *   rebuild（默认）整包重排：未改动的条目按原样字节搬运（不解压、不重压），
 *                  改动的条目重新编码，最后按原顺序紧凑排列。
 *                  布局与官方打包器一致；**若一条都没改，输出与原文件逐字节相同**
 *                  （可当成回归验证）。
 *   inplace        追加式：整体复制原文件，改动条目塞得下就就地覆盖，塞不下就追加到
 *                  文件末尾（新偏移写进索引）。文件里会留下旧数据的残渣，体积可能增大，
 *                  但除了改动条目以外一个字节都不动，最保险。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 工具管不了的部分
 * ────────────────────────────────────────────────────────────────────────────
 *   回装只保证「格式合法、引擎读得到」。素材内容是否还是引擎能吃的东西，取决于
 *   你怎么改：DDS 的尺寸/格式/贴图层数、ANM/ECL/MSG 的内部偏移表等。
 *   本模块对 .dds 会比对头信息并给出警告（见 `ddsSignature`）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_ALIGN,
  MAGIC,
  PkgArchive,
  RECORD_HEADER_SIZE,
  alignUp,
  encryptEntry,
  encryptIndex,
  safeRelative,
  serializeIndex,
  type PkgEntry,
} from './pkg.ts';

/** 整体拷贝时的分块大小（避免把整包读进内存） */
const COPY_CHUNK = 4 * 1024 * 1024;

// ---------------------------------------------------------------- 压缩器

/** zstd 压缩器（可缺省；缺省时条目一律存 raw，引擎同样能读） */
export interface Compressor {
  /** 供日志展示，例如 `@bokuweb/zstd-wasm L3` */
  name: string;
  compress(data: Buffer): Buffer;
}

/**
 * 依次尝试三种 zstd 来源：
 *   ① Node 内置 `zlib.zstdCompressSync`（Node ≥ 22.15 / 23.8）
 *   ② 可选依赖 `@bokuweb/zstd-wasm`（源码方式 `npm i` 后可用）
 *   ③ 都没有 → 返回 null，调用方回退到 raw
 *
 * **默认级别 19 是实测出来的**：拿原归档里已有的 1408 条 zstd 数据做对照，
 * 用 19 级重新压缩后与原条目的字节流**完全一致**（例如 th06ST 的 ecldata1/2/3/4/5/6
 * 六条逐字节相同；22 级则在部分条目上偏小），所以官方打包器用的就是 19 级。
 * 用同样的级别重新压制，产出风格与官方包一致。
 */
export async function loadCompressor(level = 19): Promise<Compressor | null> {
  // ① Node 内置 zlib
  try {
    const zlib = (await import('node:zlib')) as unknown as {
      zstdCompressSync?: (b: Buffer, o?: unknown) => Buffer;
      constants?: Record<string, number>;
    };
    if (typeof zlib.zstdCompressSync === 'function') {
      const cLevel = zlib.constants?.ZSTD_c_compressionLevel;
      const options = cLevel === undefined ? undefined : { params: { [cLevel]: level } };
      const compress = zlib.zstdCompressSync;
      compress(Buffer.from('probe'), options); // 确认个别构建不是「有函数但不可用」
      return { name: `node:zlib zstd L${level}`, compress: (d) => compress(d, options) };
    }
  } catch {
    /* 落到下一个来源 */
  }

  // ② 可选 WASM（用变量做说明符，避免打包器静态解析）
  try {
    const specifier = '@bokuweb/zstd-wasm';
    const mod = (await import(specifier)) as unknown as {
      init(): Promise<void>;
      compress(data: Uint8Array, level: number): Uint8Array;
    };
    await mod.init();
    mod.compress(Buffer.from('probe'), level);
    return { name: `@bokuweb/zstd-wasm L${level}`, compress: (d) => Buffer.from(mod.compress(d, level)) };
  } catch {
    /* 无压缩器 */
  }

  return null;
}

// ---------------------------------------------------------------- 单条编码

/** 一条重新编码后的数据 */
export interface EncodedEntry {
  /** 已加密，可直接落盘 */
  stored: Buffer;
  /** bit0=1 表示 stored 是 zstd 流 */
  flags: number;
  seed: number;
  /** 解压后大小 */
  originalSize: number;
  /** 磁盘大小 */
  storedSize: number;
}

/** 生成条目密钥种子（原程序为每条独立随机 32 位） */
export function randomSeed(): number {
  return crypto.randomBytes(4).readUInt32LE(0);
}

/**
 * 把明文编码成可落盘的条目：压缩（有压缩器且确实变小才用）→ XOR 加密。
 *
 * 压缩无收益时保持 raw —— 与官方打包器行为一致（小文件 / 已压缩数据存 raw）。
 */
export function encodeEntry(plain: Buffer, opts: { seed: number; compressor?: Compressor | null }): EncodedEntry {
  let payload = plain;
  let flags = 0;
  if (opts.compressor && plain.length > 0) {
    try {
      const packed = opts.compressor.compress(plain);
      if (packed.length < plain.length) {
        payload = packed;
        flags = 1;
      }
    } catch {
      /* 压缩失败退回 raw，不因此中断回装 */
    }
  }
  const stored = encryptEntry(payload, opts.seed);
  return { stored, flags, seed: opts.seed, originalSize: plain.length, storedSize: stored.length };
}

// ---------------------------------------------------------------- 修改目录扫描

export interface ScanResult {
  /** 实际使用的条目根目录 */
  root: string;
  /** 归档内名字 → 磁盘文件路径（含内容未变的，交给回装阶段比对后忽略） */
  replacements: Map<string, string>;
  /** 目录里存在、但归档里没有对应条目的文件（多半是名字写错或放错归档） */
  unknown: string[];
}

function walkFiles(root: string, dir = '', out: string[] = []): string[] {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    const rel = dir ? `${dir}/${name}` : name;
    const full = path.join(root, rel);
    if (fs.statSync(full).isDirectory()) walkFiles(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * 扫描「改动后的条目目录」。
 *
 * `modDir` 可以是下面任一种（自动识别）：
 *   · 解包输出的根目录，即 `<stem>/条目…`（例如 `./unpacked/th06CM/eff00.dds`）
 *   · 直接就是条目目录本身（例如 `./unpacked/th06CM`）
 */
export function scanModDir(modDir: string, entries: readonly PkgEntry[], archiveStem: string): ScanResult {
  const nested = path.join(modDir, archiveStem);
  const root = fs.existsSync(nested) && fs.statSync(nested).isDirectory() ? nested : modDir;

  const replacements = new Map<string, string>();
  const matched = new Set<string>();
  for (const entry of entries) {
    const rel = safeRelative(entry.name);
    if (!rel || matched.has(rel)) continue;
    const full = path.join(root, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      replacements.set(entry.name, full);
      matched.add(rel);
    }
  }

  const unknown = walkFiles(root).filter((rel) => !matched.has(rel));
  return { root, replacements, unknown };
}

// ---------------------------------------------------------------- DDS 守卫

/** DXGI 格式 → 每 4×4 块字节数（BC 家族） */
const DXGI_BLOCK: Record<number, number> = {
  70: 8, 71: 8, 72: 8, // BC1
  74: 16, 75: 16, 76: 16, // BC2
  77: 16, 78: 16, // BC3
  79: 8, 80: 8, 81: 8, // BC4
  82: 16, 83: 16, 84: 16, // BC5
  94: 16, 95: 16, 96: 16, // BC6H
  97: 16, 98: 16, 99: 16, // BC7
};

/** DXGI 格式 → 每像素字节数（未压缩的常见几种） */
const DXGI_PIXEL: Record<number, number> = {
  2: 16, // R32G32B32A32_FLOAT
  10: 8, // R16G16B16A16_FLOAT
  11: 8, // R16G16B16A16_UNORM
  28: 4, // R8G8B8A8_UNORM
  29: 4, // R8G8B8A8_UNORM_SRGB
  87: 4, // B8G8R8A8_UNORM
  91: 4, // B8G8R8A8_UNORM_SRGB
  61: 1, // R8_UNORM
};

/**
 * 提取 DDS 的「形状指纹」。回装后能不能跑，多半卡在这里：
 * 改尺寸 / 改压缩格式 / 改贴图层数，引擎仍按原参数分配和上传，容易直接崩。
 */
export function ddsSignature(buf: Buffer): string | null {
  if (buf.length < 128 || buf.toString('latin1', 0, 4) !== 'DDS ') return null;
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const mips = buf.readUInt32LE(28);
  const fourCC = buf.toString('latin1', 84, 88);
  const rgbBits = buf.readUInt32LE(88);
  const format = fourCC === 'DX10' && buf.length >= 148 ? `DX10#${buf.readUInt32LE(128)}` : fourCC.trim() || `${rgbBits}bpp`;
  return `${width}×${height} ${format} mips=${mips}`;
}

/**
 * 按 DDS 自身的头信息算出「这个文件应该有多少字节」（含头）。
 *
 * 覆盖 BC 全家族（游戏里 1225 张贴图都是 BC7 / DX10#98）+ 常见未压缩格式；
 * 认不出来就返回 null（跳过检查，不误报）。
 */
export function ddsExpectedBytes(buf: Buffer): number | null {
  if (buf.length < 128 || buf.toString('latin1', 0, 4) !== 'DDS ') return null;
  const width = buf.readUInt32LE(16);
  const height = buf.readUInt32LE(12);
  const mipCount = Math.max(1, buf.readUInt32LE(28));
  const fourCC = buf.toString('latin1', 84, 88);
  const rgbBits = buf.readUInt32LE(88);

  let block: number | null = null; // 每 4×4 块字节数
  let bpp: number | null = null; // 每像素字节数
  let headerSize = 128;
  let arraySize = 1;

  if (fourCC === 'DX10') {
    if (buf.length < 148) return null;
    headerSize = 148;
    const dxgi = buf.readUInt32LE(128);
    arraySize = Math.max(1, buf.readUInt32LE(132)); // 立方体贴图 = 6
    block = DXGI_BLOCK[dxgi] ?? null;
    bpp = DXGI_PIXEL[dxgi] ?? null;
    if (block === null && bpp === null) return null;
  } else if (fourCC.startsWith('DXT') || fourCC === 'ATI1' || fourCC === 'ATI2' || fourCC === 'BC4U' || fourCC === 'BC5U') {
    block = fourCC === 'DXT1' || fourCC === 'ATI1' || fourCC === 'BC4U' ? 8 : 16;
  } else if (fourCC.charCodeAt(0) === 0) {
    // 未压缩：DDS_PIXELFORMAT 里的 RGBBitCount 是**位**/像素
    if (rgbBits === 0 || rgbBits % 8 !== 0) return null;
    bpp = rgbBits / 8;
  } else {
    return null;
  }

  let pixels = 0;
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  for (let level = 0; level < mipCount; level++) {
    pixels += block !== null ? Math.ceil(w / 4) * Math.ceil(h / 4) * block : w * h * bpp!;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return headerSize + pixels * arraySize;
}

// ---------------------------------------------------------------- 回装

export type PackMode = 'rebuild' | 'inplace';

export interface PackOptions {
  /** 原归档 `.dat` */
  archivePath: string;
  /** 输出 `.dat` */
  outPath: string;
  /** 归档内条目名 → 修改后的文件；未列出的条目原样保留 */
  replacements?: ReadonlyMap<string, string>;
  /**
   * 索引密钥所用的归档名（默认 = 原归档文件名）。
   *
   * 游戏是按**文件名**解密索引的，所以产物最终叫什么名字，索引就得用那个名字的密钥。
   * 正常用法是产物仍叫 `<stem>.dat`，此时无需关心；只有做分析/改名时才需要显式指定。
   */
  archiveName?: string;
  /** 默认 rebuild */
  mode?: PackMode;
  /** zstd 压缩器；null / 省略 = 一律存 raw */
  compressor?: Compressor | null;
  /** 复用原条目的密钥种子（默认给改动条目生成新种子） */
  keepSeed?: boolean;
  /** 允许覆盖已存在的输出文件 */
  overwrite?: boolean;
  /** 只算不写：返回会做哪些改动，不落盘 */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface EntryChange {
  name: string;
  oldOriginalSize: number;
  newOriginalSize: number;
  oldStoredSize: number;
  newStoredSize: number;
  /** 新数据是否经 zstd 压缩 */
  compressed: boolean;
  oldOffset: number;
  newOffset: number;
  /** 数据在文件里的位置是否变了 */
  moved: boolean;
}

export interface PackResult {
  outPath: string;
  archiveName: string;
  mode: PackMode;
  totalEntries: number;
  changes: EntryChange[];
  warnings: string[];
  indexLength: number;
  dataStart: number;
  fileSize: number;
  /** 一条都没改：输出是原文件的逐字节副本 */
  unchanged: boolean;
  /** 是否真的写了文件（--dry-run 时为 false） */
  wrote: boolean;
  compression: string | null;
}

interface Plan {
  entry: PkgEntry;
  /** null = 原样搬运原文件里的字节 */
  stored: Buffer | null;
  flags: number;
  seed: number;
  originalSize: number;
  storedSize: number;
  /** 数据在新文件里的偏移 */
  newOffset: number;
  changed: boolean;
}

/** 把 [from, from+len) 从 srcFd 拷到 dstFd 的 to 处（分块，避免整包进内存） */
function copyRange(srcFd: number, dstFd: number, from: number, to: number, len: number): void {
  if (len <= 0) return;
  const buf = Buffer.allocUnsafe(Math.min(COPY_CHUNK, len));
  let done = 0;
  while (done < len) {
    const n = Math.min(buf.length, len - done);
    fs.readSync(srcFd, buf, 0, n, from + done);
    fs.writeSync(dstFd, buf, 0, n, to + done);
    done += n;
  }
}

/** 显式写零，保证填充区不依赖文件系统对稀疏区的实现 */
function writeZeros(fd: number, at: number, len: number): void {
  if (len <= 0) return;
  const zeros = Buffer.alloc(Math.min(len, 64 * 1024));
  let done = 0;
  while (done < len) {
    const n = Math.min(zeros.length, len - done);
    fs.writeSync(fd, zeros, 0, n, at + done);
    done += n;
  }
}

/**
 * 把「改过的条目目录」重新封回 `.dat`。
 *
 * 只替换 `replacements` 里列出的条目，且**内容与原条目完全相同的不算改动**
 * （所以「解包后原样回装」能产出字节级一致的文件）。
 */
export function packArchive(opts: PackOptions): PackResult {
  const mode = opts.mode ?? 'rebuild';
  const log = opts.log ?? ((): void => {});
  const sources = opts.replacements ?? new Map<string, string>();
  // 索引密钥的来源名：默认沿用原归档名（改名的产物照样能用原名解密）
  const keyName = opts.archiveName ?? path.basename(opts.archivePath, path.extname(opts.archivePath));

  if (!fs.existsSync(opts.archivePath)) throw new Error(`原归档不存在：${opts.archivePath}`);
  if (path.resolve(opts.outPath) === path.resolve(opts.archivePath)) {
    throw new Error('输出不能直接覆盖原归档（用 -o 指定新文件，或先备份原包）');
  }
  if (!opts.dryRun) {
    if (fs.existsSync(opts.outPath) && !opts.overwrite) {
      throw new Error(`输出已存在：${opts.outPath}（加 --force 覆盖）`);
    }
    fs.mkdirSync(path.dirname(path.resolve(opts.outPath)), { recursive: true });
  }

  const archive = PkgArchive.open(opts.archivePath);
  const warnings: string[] = [];
  try {
    // ---- 第一步：判定真正被改动的条目（只解码有对应文件的条目，省时间） ----
    const plans: Plan[] = archive.entries.map((entry) => ({
      entry,
      stored: null,
      flags: entry.flags,
      seed: entry.seed,
      originalSize: entry.originalSize,
      storedSize: entry.storedSize,
      newOffset: entry.offset,
      changed: false,
    }));

    for (const plan of plans) {
      const file = sources.get(plan.entry.name);
      if (!file) continue;

      let plain: Buffer;
      try {
        plain = fs.readFileSync(file);
      } catch (err) {
        warnings.push(`${plan.entry.name}：读取失败（${(err as Error).message}），已忽略`);
        continue;
      }

      const current = archive.read(plan.entry);
      if (current.equals(plain)) continue; // 内容一致 → 不算改动

      const enc = encodeEntry(plain, {
        seed: opts.keepSeed ? plan.entry.seed : randomSeed(),
        compressor: opts.compressor ?? null,
      });
      plan.stored = enc.stored;
      plan.flags = enc.flags;
      plan.seed = enc.seed;
      plan.originalSize = enc.originalSize;
      plan.storedSize = enc.storedSize;
      plan.changed = true;

      if (plan.entry.name.toLowerCase().endsWith('.dds')) {
        const before = ddsSignature(current);
        const after = ddsSignature(plain);
        if (before && after && before !== after) {
          warnings.push(`${plan.entry.name}：贴图形状变了 ${before} → ${after}（引擎可能按原形状分配，改形状易崩）`);
        }
        const expected = ddsExpectedBytes(plain);
        if (expected !== null && plain.length < expected) {
          warnings.push(
            `${plan.entry.name}：DDS 头声明需要 ${expected} 字节，实际只有 ${plain.length}（贴图数据不完整，进游戏大概率崩）`,
          );
        } else if (expected !== null && plain.length > expected) {
          warnings.push(`${plan.entry.name}：DDS 数据比头部声明多 ${plain.length - expected} 字节（一般无害，但说明写入时没截干净）`);
        }
      }
    }

    const changed = plans.filter((p) => p.changed);

    // ---- 一条都没改：字节级复制，保证与原包一致 ----
    if (changed.length === 0) {
      log('  没有任何条目发生变化 → 输出原归档的逐字节副本');
      const size = fs.statSync(opts.archivePath).size;
      if (!opts.dryRun) {
        const srcFd = fs.openSync(opts.archivePath, 'r');
        const dst = fs.openSync(opts.outPath, 'w');
        try {
          copyRange(srcFd, dst, 0, 0, size);
          fs.ftruncateSync(dst, size);
        } finally {
          fs.closeSync(srcFd);
          fs.closeSync(dst);
        }
      }
      return {
        outPath: opts.outPath,
        archiveName: keyName,
        mode,
        totalEntries: plans.length,
        changes: [],
        warnings,
        indexLength: 0,
        dataStart: 0,
        fileSize: size,
        unchanged: true,
        wrote: !opts.dryRun,
        compression: opts.compressor?.name ?? null,
      };
    }

    // ---- 第二步：布局（先算偏移，再一次性写盘） ----
    const indexLength = plans.reduce((sum, p) => sum + RECORD_HEADER_SIZE + Buffer.byteLength(p.entry.name, 'latin1'), 0);
    const originalSize = fs.statSync(opts.archivePath).size;
    let dataStart: number;
    let fileSize: number;

    if (mode === 'inplace') {
      // 索引长度不变（条目名未变）⇒ 索引区与数据区起点原位不动
      dataStart = alignUp(8 + indexLength);
      fileSize = originalSize;
      let cursor = originalSize;
      let appended = 0;
      for (const p of plans) {
        if (!p.changed) continue; // 未改动：留在原位，一个字节都不搬
        p.newOffset = p.storedSize > p.entry.storedSize ? alignUp(cursor) : p.entry.offset;
        cursor = Math.max(cursor, p.newOffset + p.storedSize);
        if (p.newOffset !== p.entry.offset) appended++;
      }
      fileSize = cursor;
      if (appended > 0) {
        warnings.push(
          `${appended} 条改动放不下原位置、已追加到文件末尾：数据区不再按偏移递增排列。` +
            '官方归档都是递增排列的，若进游戏异常请改用默认的 rebuild 模式（不加 --inplace）。',
        );
      }
    } else {
      let cursor = alignUp(8 + indexLength);
      dataStart = cursor;
      for (const p of plans) {
        p.newOffset = alignUp(cursor);
        cursor = p.newOffset + p.storedSize;
      }
      fileSize = alignUp(cursor);
    }

    const changes: EntryChange[] = changed.map((p) => ({
      name: p.entry.name,
      oldOriginalSize: p.entry.originalSize,
      newOriginalSize: p.originalSize,
      oldStoredSize: p.entry.storedSize,
      newStoredSize: p.storedSize,
      compressed: (p.flags & 1) !== 0,
      oldOffset: p.entry.offset,
      newOffset: p.newOffset,
      moved: p.newOffset !== p.entry.offset,
    }));

    // ---- 第三步：写盘 ----
    const outEntries: PkgEntry[] = plans.map((p) => ({
      flags: p.flags,
      seed: p.seed,
      originalSize: p.originalSize,
      storedSize: p.storedSize,
      offset: p.newOffset,
      name: p.entry.name,
    }));

    if (opts.dryRun) {
      return {
        outPath: opts.outPath,
        archiveName: keyName,
        mode,
        totalEntries: plans.length,
        changes,
        warnings,
        indexLength,
        dataStart,
        fileSize,
        unchanged: false,
        wrote: false,
        compression: opts.compressor?.name ?? null,
      };
    }

    const header = Buffer.alloc(8);
    header.write(MAGIC, 0, 4, 'latin1');
    header.writeUInt32LE(indexLength, 4);
    const indexCipher = encryptIndex(serializeIndex(outEntries), keyName);

    const srcFd = fs.openSync(opts.archivePath, 'r');
    const dst = fs.openSync(opts.outPath, 'w');
    try {
      if (mode === 'inplace') {
        copyRange(srcFd, dst, 0, 0, originalSize); // 原文件全量打底
        let cursor = originalSize;
        for (const p of plans) {
          if (!p.changed) continue;
          writeZeros(dst, cursor, p.newOffset - cursor); // 追加前的对齐填充
          fs.writeSync(dst, p.stored!, 0, p.storedSize, p.newOffset);
          cursor = Math.max(cursor, p.newOffset + p.storedSize);
        }
      } else {
        writeZeros(dst, 8 + indexLength, dataStart - (8 + indexLength)); // 索引 → 数据区
        let pos = dataStart;
        for (const p of plans) {
          writeZeros(dst, pos, p.newOffset - pos); // 条目间对齐填充
          if (p.stored) fs.writeSync(dst, p.stored, 0, p.storedSize, p.newOffset);
          else copyRange(srcFd, dst, p.entry.offset, p.newOffset, p.storedSize);
          pos = p.newOffset + p.storedSize;
        }
        writeZeros(dst, pos, fileSize - pos); // 尾部补齐
      }

      // 索引区恒在 [8, 8+indexLength)：名字没变 ⇒ 长度没变 ⇒ 就地重写
      fs.writeSync(dst, header, 0, 8, 0);
      fs.writeSync(dst, indexCipher, 0, indexCipher.length, 8);
      fs.ftruncateSync(dst, Math.max(fileSize, 8 + indexLength));
    } finally {
      fs.closeSync(srcFd);
      fs.closeSync(dst);
    }

    return {
      outPath: opts.outPath,
      archiveName: keyName,
      mode,
      totalEntries: plans.length,
      changes,
      warnings,
      indexLength,
      dataStart,
      fileSize,
      unchanged: false,
      wrote: true,
      compression: opts.compressor?.name ?? null,
    };
  } finally {
    archive.close();
  }
}

// ---------------------------------------------------------------- 校验

export interface VerifyIssue {
  name: string;
  problem: string;
}

export interface VerifyReport {
  entries: number;
  decoded: number;
  bytes: number;
  issues: VerifyIssue[];
  /** 与期望文件逐字节比较过的条目数 */
  compared: number;
}

/**
 * 重新打开产物逐条校验：结构（对齐 / 越界 / 重叠）、每条的解码与大小，以及与
 * 期望文件的逐字节比对。用的是与游戏同一套解码逻辑。
 *
 * `archiveName` 是产物将来会被放回成的归档名（索引密钥来源）。产物若还没改成
 * `<stem>.dat`，必须传，否则索引解不开。
 *
 * 注意：这只证明「归档自洽、数据可还原」。素材本身是否被引擎接受，仍需进游戏实测。
 */
export function verifyArchive(outPath: string, expect?: ReadonlyMap<string, Buffer>, archiveName?: string): VerifyReport {
  const report: VerifyReport = { entries: 0, decoded: 0, bytes: 0, issues: [], compared: 0 };
  const size = fs.statSync(outPath).size;
  const archive = PkgArchive.open(outPath, archiveName ?? outPath);
  try {
    report.entries = archive.entries.length;

    const ranges: Array<[number, number, string]> = [];
    for (const e of archive.entries) {
      if (e.offset % DATA_ALIGN !== 0) {
        report.issues.push({ name: e.name, problem: `偏移 ${e.offset} 未按 ${DATA_ALIGN} 字节对齐` });
      }
      if (e.offset + e.storedSize > size) {
        report.issues.push({ name: e.name, problem: `数据越界（${e.offset}+${e.storedSize} > ${size}）` });
      }
      if ((e.flags & 1) === 0 && e.storedSize !== e.originalSize) {
        report.issues.push({ name: e.name, problem: `raw 条目大小不一致（${e.storedSize} ≠ ${e.originalSize}）` });
      }
      ranges.push([e.offset, e.offset + e.storedSize, e.name]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) {
        report.issues.push({ name: ranges[i][2], problem: `数据区与 ${ranges[i - 1][2]} 重叠` });
      }
    }

    for (const e of archive.entries) {
      let plain: Buffer;
      try {
        plain = archive.read(e);
      } catch (err) {
        report.issues.push({ name: e.name, problem: `解码失败：${(err as Error).message}` });
        continue;
      }
      report.decoded++;
      report.bytes += plain.length;
      if (plain.length !== e.originalSize) {
        report.issues.push({ name: e.name, problem: `解压后大小 ${plain.length} ≠ 索引声明 ${e.originalSize}` });
      }
      const want = expect?.get(e.name);
      if (want) {
        report.compared++;
        if (!plain.equals(want)) report.issues.push({ name: e.name, problem: '内容与期望文件不一致' });
      }
    }
  } finally {
    archive.close();
  }
  return report;
}
