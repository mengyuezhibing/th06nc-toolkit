#!/usr/bin/env node
/**
 * 东方红魔乡 新典版（TH06NC）PKGL 归档回装工具
 *
 * 把解包后改过的素材重新封回 .dat，让游戏能直接跑。
 *
 * 用法：
 *   th06nc-pack <原归档.dat | 含 .dat 的目录> [选项]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PkgArchive } from './pkg.ts';
import { loadCompressor, packArchive, scanModDir, verifyArchive, type PackResult } from './pack.ts';

const USAGE = `东方红魔乡 新典版（TH06NC）PKGL 归档回装工具

用法
  th06nc-pack <原归档.dat | 含 .dat 的目录> [选项]

选项
      --from <目录>     改动后的条目目录（不给就找 <归档目录>/<归档名>/、./unpacked/<归档名>/）
  -o, --out <文件>      输出归档（默认 <原归档>.repacked.dat）
      --inplace         追加式：除改动条目外一个字节都不动（最保险）
      --raw             不做 zstd 压缩（体积变大，但零依赖）
      --zstd-level <n>  zstd 压缩级别，默认 19（实测与官方打包器一致）
      --keep-seed       复用原条目的密钥种子（默认给改动条目生成新种子）
      --force           允许覆盖已存在的输出
  -n, --dry-run         只报告会替换哪些条目，不写文件
  -v, --verify          写完后重开产物，逐条解码并比对改动内容
  -l, --list            只列出归档条目后退出
  -h, --help            显示本帮助

示例
  th06nc-pack "th06nc/data/th06CM.dat" --from ./unpacked -v
  th06nc-pack "th06nc/data/th06CM.dat" --from ./unpacked --inplace --raw
  th06nc-pack "th06nc/data" --from ./unpacked -v      # 7 个归档一起装

说明
  只会替换「与原条目内容不同」的文件；未改动的条目原样保留（连压缩字节都不重写）。
  因此把解包目录原样回装，产物与原 .dat 逐字节相同 —— 可用来确认流程无损。
  改 DDS 时尽量保持尺寸与压缩格式不变：引擎按原形状分配显存，改形状容易崩。`;

interface Options {
  input: string;
  from: string;
  out: string;
  mode: 'rebuild' | 'inplace';
  compress: boolean;
  zstdLevel: number;
  keepSeed: boolean;
  force: boolean;
  dryRun: boolean;
  verify: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    input: '',
    from: '',
    out: '',
    mode: 'rebuild',
    compress: true,
    zstdLevel: 19,
    keepSeed: false,
    force: false,
    dryRun: false,
    verify: false,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') opts.from = argv[++i];
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '--inplace') opts.mode = 'inplace';
    else if (a === '--raw') opts.compress = false;
    else if (a === '--zstd-level') opts.zstdLevel = Number(argv[++i]);
    else if (a === '--keep-seed') opts.keepSeed = true;
    else if (a === '--force') opts.force = true;
    else if (a === '-n' || a === '--dry-run') opts.dryRun = true;
    else if (a === '-v' || a === '--verify') opts.verify = true;
    else if (a === '-l' || a === '--list') opts.list = true;
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith('-')) throw new Error(`未知选项：${a}`);
    else if (!opts.input) opts.input = a;
    else throw new Error(`多余的参数：${a}`);
  }
  if (!opts.input) {
    console.error(USAGE);
    process.exit(1);
  }
  return opts;
}

function human(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function collectArchives(input: string): string[] {
  const st = fs.statSync(input);
  if (st.isFile()) return [input];
  if (!st.isDirectory()) throw new Error(`${input} 既不是文件也不是目录`);
  const found = fs
    .readdirSync(input)
    .filter((f) => f.toLowerCase().endsWith('.dat'))
    .sort()
    .map((f) => path.join(input, f));
  if (found.length === 0) throw new Error(`${input} 下没有 .dat 归档`);
  return found;
}

/**
 * 没给 `--from` 时按顺序找一个像「解包输出」的目录：
 *   ① 归档旁边      `<归档目录>/<归档名>/`
 *   ② 当前目录      `./unpacked/<归档名>/`（解包工具的默认输出位置）
 *   ③ 当前目录      `./<归档名>/`
 *   ④ 兜底          归档所在目录本身
 */
function resolveFromDir(archivePath: string, stem: string, explicit: string): { dir: string; auto: boolean } {
  if (explicit) return { dir: explicit, auto: false };
  const candidates = [
    path.join(path.dirname(archivePath), stem),
    path.join(process.cwd(), 'unpacked', stem),
    path.join(process.cwd(), stem),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return { dir: c, auto: true };
  }
  return { dir: path.dirname(archivePath), auto: true };
}

function listEntries(archivePath: string): void {
  const archive = PkgArchive.open(archivePath);
  try {
    console.log(`\n  ${path.basename(archivePath)}  —  ${archive.entries.length} 条目`);
    for (const e of archive.entries) {
      const tag = e.flags & 1 ? 'zstd' : 'raw ';
      const align = e.offset % 16 === 0 ? '' : '  ⚠ 偏移未对齐';
      console.log(
        `    ${tag}  ${human(e.originalSize).padStart(10)} → ${human(e.storedSize).padStart(10)}` +
          `  @ ${String(e.offset).padStart(10)}  ${e.name}${align}`,
      );
    }
  } finally {
    archive.close();
  }
}

function report(result: PackResult): void {
  console.log(`\n  ${result.archiveName}  —  ${result.totalEntries} 条目，改动 ${result.changes.length} 个`);
  if (result.compression) console.log(`  压缩器  ${result.compression}`);

  if (result.changes.length > 0) {
    for (const c of result.changes) {
      const ratio = (n: number, total: number): string => (total > 0 ? ` (${((n / total) * 100).toFixed(1)}%)` : '');
      const kind = c.compressed ? 'zstd' : 'raw ';
      console.log(
        `    ${c.name}\n` +
          `      ${kind}  ${human(c.oldOriginalSize)} → ${human(c.newOriginalSize)}` +
          `  存储 ${human(c.oldStoredSize)} → ${human(c.newStoredSize)}${ratio(c.newStoredSize, c.newOriginalSize)}` +
          `  @ ${c.oldOffset} → ${c.newOffset}${c.moved ? '（已挪位）' : ''}`,
      );
    }
  }
  for (const w of result.warnings) console.log(`    ⚠ ${w}`);

  if (result.unchanged) {
    console.log(`  输出  ${result.outPath}  （无改动，逐字节副本，${human(result.fileSize)}）`);
  } else {
    console.log(
      `  布局  索引 ${human(result.indexLength)}，数据区 @ ${result.dataStart}，文件 ${human(result.fileSize)}`,
    );
    console.log(`  输出  ${result.outPath}`);
  }
}

async function packOne(archivePath: string, opts: Options): Promise<boolean> {
  const stem = path.basename(archivePath, path.extname(archivePath));
  // 默认输出到同目录的 repacked/ 子目录，并**保持文件名不变** ——
  // 索引密钥由文件名派生，改名就等于游戏解不开索引。
  const outPath = opts.out || path.join(path.dirname(archivePath), 'repacked', `${stem}.dat`);
  const source = resolveFromDir(archivePath, stem, opts.from);
  const fromDir = source.dir;

  if (opts.list) {
    listEntries(archivePath);
    return true;
  }

  console.log(`\n  ── ${path.basename(archivePath)} ──`);
  console.log(`  原包  ${path.resolve(archivePath)}`);
  console.log(`  修改  ${path.resolve(fromDir)}`);

  const archive = PkgArchive.open(archivePath);
  let scan;
  let entryCount = 0;
  try {
    entryCount = archive.entries.length;
    scan = scanModDir(fromDir, archive.entries, stem);
  } finally {
    archive.close();
  }

  if (source.auto) console.log(`        （未指定 --from，自动选用 ${scan.root}）`);
  console.log(`  匹配  ${scan.replacements.size} / ${entryCount} 个同名文件`);
  if (scan.replacements.size === 0) {
    console.log('  ⚠ 一个条目都没匹配上：确认 --from 指向的是解包输出目录');
    console.log(`    （解包结果的结构是 <归档名>/<条目名>，例如 unpacked/${stem}/ 里应有该归档的文件）`);
  }
  for (const u of scan.unknown.slice(0, 10)) console.log(`    ⚠ 目录里有、归档里没有：${u}`);
  if (scan.unknown.length > 10) console.log(`    ⚠ 另有 ${scan.unknown.length - 10} 个未匹配文件`);

  const compressor = opts.compress ? await loadCompressor(opts.zstdLevel) : null;
  if (opts.compress && !compressor) {
    console.log('  ⚠ 未找到可用的 zstd 实现（Node ≥ 22.15 内置，或 npm i @bokuweb/zstd-wasm）→ 改为 raw 存储');
  }

  const outStem = path.basename(outPath, path.extname(outPath));
  if (outStem !== stem) {
    console.log(`  ⚠ 输出文件名 ${path.basename(outPath)} 与原归档名不同：`);
    console.log(`    索引密钥已按原名 ${stem} 生成，游戏按**文件名**解密索引，`);
    console.log(`    所以最终必须放回成 ${stem}.dat 才能跑（否则索引解不开）。`);
  }

  const result = packArchive({
    archivePath,
    outPath,
    replacements: scan.replacements,
    mode: opts.mode,
    compressor,
    keepSeed: opts.keepSeed,
    overwrite: opts.force,
    dryRun: opts.dryRun,
    archiveName: stem,
    log: (line) => console.log(line),
  });
  report(result);

  if (opts.dryRun) {
    console.log('  （--dry-run：未写入任何文件）');
    return true;
  }

  console.log(`  回装  把 ${path.basename(outPath)} 覆盖回 ${path.join(path.dirname(archivePath), path.basename(archivePath))}`);

  if (opts.verify) {
    const expect = new Map<string, Buffer>();
    for (const c of result.changes) {
      const file = scan.replacements.get(c.name);
      if (file) expect.set(c.name, fs.readFileSync(file));
    }
    const v = verifyArchive(outPath, expect, stem);
    console.log(
      `  校验  ${v.entries} 条目，解码 ${v.decoded} 条 / ${human(v.bytes)}，比对改动 ${v.compared} 条，问题 ${v.issues.length} 项`,
    );
    for (const issue of v.issues.slice(0, 20)) console.log(`    ✗ ${issue.name}: ${issue.problem}`);
    if (v.issues.length > 20) console.log(`    ✗ 另有 ${v.issues.length - 20} 项`);
    if (v.issues.length > 0) return false;
  }
  return true;
}

/**
 * 回装 CLI 主入口。导出为函数，方便被解包工具当成 `pack` 子命令复用
 * （`th06nc-unpack pack <归档> …`，见 `cli.ts`）。
 */
export async function runPackCli(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const archives = collectArchives(opts.input);
  if (archives.length > 1 && opts.out) throw new Error('一次处理多个归档时不能指定 -o');

  let ok = true;
  for (const a of archives) {
    try {
      if (!(await packOne(a, opts))) ok = false;
    } catch (err) {
      ok = false;
      console.error(`\n  ✗ ${path.basename(a)}：${(err as Error).message}`);
    }
  }
  if (!ok) process.exitCode = 1;
}

// 输出被 `| head` 之类提前关闭时不要抛 EPIPE
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

/** 直接以本文件为入口运行时才自动执行；被 cli.ts 引入时交给它调度 */
const entry = process.argv[1] ?? '';
if (/(?:^|[\\/])(?:pack-cli\.(?:ts|js)|pack\.(?:cjs|mjs|js))$/.test(entry)) {
  runPackCli(process.argv.slice(2)).catch((err: Error) => {
    console.error(`  ✗ ${err.message}`);
    process.exit(1);
  });
}
