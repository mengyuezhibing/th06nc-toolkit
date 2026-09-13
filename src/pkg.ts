/**
 * 东方红魔乡 新典版（TH06NC）「PKGL」归档格式
 * ============================================================================
 *
 * 该格式没有任何公开文档，以下内容全部来自对 th06nc.exe 的反汇编与密文分析。
 * 反汇编定位到的关键位置：
 *   0x140059cb0  密钥派生 + 周期 XOR 解密例程
 *   0x140059e20  归档名 CRC32 计算（取最后一个路径分隔符之后、最后一个点之前）
 *   0x14005a09b  "PKGL" 魔数校验
 *   0x14005a178  索引区解密调用点
 *   0x14005a511  数据区解密调用点
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 文件布局
 * ────────────────────────────────────────────────────────────────────────────
 *   [8 字节]   "PKGL" | u32 索引区字节数
 *   [索引区]   逐条记录，按 16 字节周期 XOR 加密
 *   [数据区]   各条目数据，偏移与大小由索引给出（同样按 16 字节周期 XOR）
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 索引记录
 * ────────────────────────────────────────────────────────────────────────────
 *   u16   flags        bit0 = 数据是否经 zstd 压缩
 *   u32   seed         该条目数据的密钥种子
 *   u64   originalSize 解压后大小
 *   u64   storedSize   磁盘占用大小
 *   u64   offset       数据在文件中的偏移
 *   u16   nameLength
 *   char  name[nameLength]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 加密
 * ────────────────────────────────────────────────────────────────────────────
 *   索引区与数据区共用同一个 XOR 例程，区别只在种子来源：
 *     索引区种子 = CRC32(归档名去掉路径与扩展名)      "th06MD" → 0x6c9807ba
 *     数据区种子 = 记录里的 seed 字段
 *
 *   密钥由种子经 SplitMix64 派生：
 *     s   = ((seed × 0x9e3779b1) + 1) XOR (seed << 32)
 *     key = SplitMix64(s) ‖ SplitMix64(s + 0x9e3779b97f4a7c15)     // 各 8 字节小端
 *   解密即 buf[i] ^= key[i % 16]。
 *
 *   这个设计意味着：知道归档文件名就能解密索引，而每个条目的数据密钥
 *   又独立存放在（已加密的）索引里 —— 没有文件名就没有起点。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 校验
 * ────────────────────────────────────────────────────────────────────────────
 *   7 个归档 / 1783 个条目全部解出，解压后大小与索引声明逐字节吻合。
 */

import fs from 'node:fs';
import path from 'node:path';
import { decompress as zstdDecompress } from 'fzstd';

/** 归档魔数 */
export const MAGIC = 'PKGL';

const GAMMA = 0x9e3779b97f4a7c15n;
const MIX1 = 0xbf58476d1ce4e5b9n;
const MIX2 = 0x94d049bb133111ebn;
const MASK64 = (1n << 64n) - 1n;
const SEED_MUL = 0x9e3779b1n;

// ---------------------------------------------------------------- CRC32

/** 标准 CRC-32（IEEE 802.3，反射多项式 0xEDB88320） */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(input: Buffer | Uint8Array | string): number {
  const data = typeof input === 'string' ? Buffer.from(input, 'latin1') : input;
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 密钥

function splitMix(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * MIX1) & MASK64;
  z = ((z ^ (z >> 27n)) * MIX2) & MASK64;
  return z ^ (z >> 31n);
}

/**
 * 由 32 位种子派生 16 字节 XOR 密钥。
 *
 * 对应反汇编：`seed * 0x9e3779b1 + 1`，与 `seed << 32` 异或得到
 * SplitMix64 初始状态，随后连续取两个输出拼成密钥。
 */
export function deriveKey(seed32: number): Buffer {
  const seed = BigInt(seed32 >>> 0);
  let s = (((seed * SEED_MUL) & MASK64) + 1n) & MASK64;
  s ^= (seed << 32n) & MASK64;

  const key = Buffer.allocUnsafe(16);
  key.writeBigUInt64LE(splitMix((s + GAMMA) & MASK64), 0);
  key.writeBigUInt64LE(splitMix((s + 2n * GAMMA) & MASK64), 8);
  return key;
}

/**
 * 归档名的密钥种子。
 *
 * 与原程序 0x140059e20 一致：先找最后一个 `\` 或 `/`，再找最后一个 `.`，
 * 只对中间那段算 CRC32（`data\th06CM.dat` → `th06CM`）。
 */
export function archiveSeed(nameOrPath: string): number {
  const base = nameOrPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return crc32(dot > 0 ? base.slice(0, dot) : base);
}

/** 周期性 XOR，原地修改并返回 */
export function xorDecrypt(buf: Buffer, key: Buffer): Buffer {
  for (let i = 0; i < buf.length; i++) buf[i] ^= key[i & 15];
  return buf;
}

/** 解密整块数据。密钥按种子派生并缓存，避免逐条重复计算 */
const keyCache = new Map<number, Buffer>();
function keyOf(seed: number): Buffer {
  let k = keyCache.get(seed);
  if (!k) {
    k = deriveKey(seed);
    keyCache.set(seed, k);
  }
  return k;
}

// ---------------------------------------------------------------- 索引

export interface PkgEntry {
  /** 标志位，bit0 表示数据经 zstd 压缩 */
  flags: number;
  /** 数据区密钥种子 */
  seed: number;
  /** 解压后的原始大小 */
  originalSize: number;
  /** 磁盘上的存储大小 */
  storedSize: number;
  /** 数据在归档中的偏移 */
  offset: number;
  name: string;
}

const RECORD_HEADER_SIZE = 32;

/** 解析已解密的索引区 */
export function parseIndex(indexBuf: Buffer): PkgEntry[] {
  const entries: PkgEntry[] = [];
  let off = 0;

  while (off + RECORD_HEADER_SIZE <= indexBuf.length) {
    const flags = indexBuf.readUInt16LE(off);
    const seed = indexBuf.readUInt32LE(off + 2);
    const originalSize = Number(indexBuf.readBigUInt64LE(off + 6));
    const storedSize = Number(indexBuf.readBigUInt64LE(off + 14));
    const offset = Number(indexBuf.readBigUInt64LE(off + 22));
    const nameLength = indexBuf.readUInt16LE(off + 30);

    if (nameLength === 0 || off + RECORD_HEADER_SIZE + nameLength > indexBuf.length) {
      throw new Error(`索引记录损坏：偏移 ${off} 处名字长度为 ${nameLength}`);
    }
    entries.push({
      flags,
      seed,
      originalSize,
      storedSize,
      offset,
      name: indexBuf.toString('latin1', off + RECORD_HEADER_SIZE, off + RECORD_HEADER_SIZE + nameLength),
    });
    off += RECORD_HEADER_SIZE + nameLength;
  }
  return entries;
}

// ---------------------------------------------------------------- 条目解码

/** 解密并（按需）zstd 解压单条数据 */
export function decodeEntry(stored: Buffer, seed: number, compressed = true): Buffer {
  const plain = xorDecrypt(stored, keyOf(seed));
  if (!compressed) return plain;
  const out = zstdDecompress(new Uint8Array(plain));
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

// ---------------------------------------------------------------- 归档

/** 已打开的 PKGL 归档。索引常驻内存，条目数据按需读取 */
export class PkgArchive {
  readonly filePath: string;
  readonly entries: PkgEntry[];
  readonly size: number;
  private readonly fd: number;

  private constructor(filePath: string, fd: number, size: number, entries: PkgEntry[]) {
    this.filePath = filePath;
    this.fd = fd;
    this.size = size;
    this.entries = entries;
  }

  static open(filePath: string): PkgArchive {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < 8) throw new Error(`${path.basename(filePath)} 过小，不是 PKGL 归档`);

      const header = Buffer.alloc(8);
      fs.readSync(fd, header, 0, 8, 0);
      const magic = header.toString('latin1', 0, 4);
      if (magic !== MAGIC) {
        throw new Error(`${path.basename(filePath)} 不是 PKGL 归档（魔数为 ${JSON.stringify(magic)}）`);
      }

      const indexLength = header.readUInt32LE(4);
      if (indexLength === 0 || 8 + indexLength > size) {
        throw new Error(`索引长度 ${indexLength} 超出文件范围（文件共 ${size} 字节）`);
      }

      const indexBuf = Buffer.alloc(indexLength);
      fs.readSync(fd, indexBuf, 0, indexLength, 8);
      // 索引区种子来自归档文件名 —— 文件里没有任何地方存放它
      xorDecrypt(indexBuf, keyOf(archiveSeed(filePath)));

      return new PkgArchive(filePath, fd, size, parseIndex(indexBuf));
    } catch (err) {
      fs.closeSync(fd);
      throw err;
    }
  }

  /** 读出并解码一个条目。`noDecompress` 时压缩条目返回解密后的 zstd 字节流 */
  read(entry: PkgEntry, noDecompress = false): Buffer {
    if (entry.offset + entry.storedSize > this.size) {
      throw new Error(`条目 ${entry.name} 的数据超出文件范围`);
    }
    const stored = Buffer.alloc(entry.storedSize);
    if (entry.storedSize > 0) {
      fs.readSync(this.fd, stored, 0, entry.storedSize, entry.offset);
    }
    return decodeEntry(stored, entry.seed, (entry.flags & 1) !== 0 && !noDecompress);
  }

  /** 按名字取出一个条目 */
  readByName(name: string): Buffer | null {
    const entry = this.entries.find((e) => e.name === name);
    return entry ? this.read(entry) : null;
  }

  close(): void {
    fs.closeSync(this.fd);
  }

  /** 打开 → 回调 → 必定关闭 */
  static with<T>(filePath: string, fn: (archive: PkgArchive) => T): T {
    const archive = PkgArchive.open(filePath);
    try {
      return fn(archive);
    } finally {
      archive.close();
    }
  }
}
