#!/usr/bin/env node
/**
 * 东方红魔乡 新典版（TH06NC）PKGL 归档解包工具
 *
 * 用法：
 *   th06nc-unpack <归档.dat | 含 .dat 的目录> [选项]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PkgArchive, type PkgEntry } from './pkg.ts';

const USAGE = `东方红魔乡 新典版（TH06NC）PKGL 归档解包工具

用法
  th06nc-unpack <归档.dat | 含 .dat 的目录> [选项]

选项
  -o, --out <目录>       导出目录（默认 ./unpacked）
  -l, --list             只列出条目，不导出
      --json             配合 --list，输出 JSON
  -f, --filter <正则>    只处理名字匹配的条目（不区分大小写）
  -v, --verify           校验解压后大小与索引声明是否一致
      --keep-zstd        不做事先解压，仅解密（用于排查）
  -h, --help             显示本帮助

示例
  th06nc-unpack "th06nc/data"                       解全部归档
  th06nc-unpack "th06nc/data/th06ST.dat" -l         列目录
  th06nc-unpack "th06ST.dat" -f '\\.ecl$' -o ./ecl   只导 ECL 脚本

说明
  归档名决定索引密钥，因此**不要重命名 .dat 文件**，否则会解密失败
  （th06CM.dat 必须叫 th06CM.dat）。`;

interface Options {
  input: string;
  out: string;
  list: boolean;
  json: boolean;
  filter: RegExp | null;
  verify: boolean;
  decompress: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    input: '',
    out: './unpacked',
    list: false,
    json: false,
    filter: null,
    verify: false,
    decompress: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '-l' || a === '--list') opts.list = true;
    else if (a === '--json') opts.json = true;
    else if (a === '-f' || a === '--filter') opts.filter = new RegExp(argv[++i], 'i');
    else if (a === '-v' || a === '--verify') opts.verify = true;
    else if (a === '--keep-zstd') opts.decompress = false;
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

/**
 * 归档内的名字理论上可直接作相对路径，但仍要挡掉目录穿越
 * （`../`、绝对路径、盘符），避免异常归档写到输出目录之外。
 */
function safeRelative(name: string): string | null {
  const norm = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm) return null;
  const parts = norm.split('/').filter((p) => p && p !== '.');
  if (parts.length === 0) return null;
  if (parts.some((p) => p === '..')) return null;
  if (/^[a-zA-Z]:/.test(parts[0])) return null;
  return parts.join('/');
}

function collectArchives(input: string): string[] {
  const st = fs.statSync(input);
  if (st.isFile()) return [input];
  if (!st.isDirectory()) throw new Error(`${input} 既不是文件也不是目录`);
  return fs
    .readdirSync(input)
    .filter((f) => f.toLowerCase().endsWith('.dat'))
    .sort()
    .map((f) => path.join(input, f));
}

function listEntries(archivePath: string, entries: PkgEntry[], opts: Options): void {
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          archive: path.basename(archivePath),
          entries: entries.map((e) => ({
            name: e.name,
            flags: e.flags,
            seed: e.seed,
            originalSize: e.originalSize,
            storedSize: e.storedSize,
            offset: e.offset,
            compressed: (e.flags & 1) !== 0,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`\n  ${path.basename(archivePath)}  —  ${entries.length} 条目`);
  for (const e of entries) {
    const tag = e.flags & 1 ? 'zstd' : 'raw ';
    const ratio = e.originalSize > 0 ? `${Math.round((e.storedSize / e.originalSize) * 100)}%` : '—';
    console.log(
      `    ${tag}  ${human(e.originalSize).padStart(10)} → ${human(e.storedSize).padStart(10)}` +
        `  ${ratio.padStart(4)}  ${e.name}`,
    );
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const archives = collectArchives(opts.input);
  if (archives.length === 0) {
    console.error('  未找到任何 .dat 归档');
    process.exit(1);
  }

  if (!opts.list) {
    console.log(`  输入  ${path.resolve(opts.input)}`);
    console.log(`  输出  ${path.resolve(opts.out)}`);
    console.log(`  归档  ${archives.length} 个`);
  }

  const started = Date.now();
  const totals = { files: 0, bytes: 0, failed: 0 };

  for (const archivePath of archives) {
    let archive: PkgArchive;
    try {
      archive = PkgArchive.open(archivePath);
    } catch (err) {
      totals.failed++;
      console.error(`\n  ✗ ${path.basename(archivePath)}: ${(err as Error).message}`);
      continue;
    }

    try {
      const matched = opts.filter ? archive.entries.filter((e) => opts.filter!.test(e.name)) : archive.entries;

      if (opts.list) {
        listEntries(archivePath, matched, opts);
        continue;
      }

      const stem = path.basename(archivePath, path.extname(archivePath));
      console.log(`\n  ${path.basename(archivePath)}  —  ${archive.entries.length} 条目`);
      for (const entry of matched) {
        const rel = safeRelative(entry.name);
        if (!rel) {
          console.warn(`    ! 跳过可疑名字：${entry.name}`);
          totals.failed++;
          continue;
        }
        try {
          const data = archive.read(entry, !opts.decompress);
          if (opts.verify && opts.decompress && data.length !== entry.originalSize) {
            throw new Error(`大小不符：得到 ${data.length}，索引声明 ${entry.originalSize}`);
          }
          const dest = path.join(opts.out, stem, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, data);
          totals.files++;
          totals.bytes += data.length;
        } catch (err) {
          totals.failed++;
          console.error(`    ! ${entry.name}: ${(err as Error).message}`);
        }
      }
      console.log(`    已导出 → ${path.join(opts.out, stem)}`);
    } finally {
      archive.close();
    }
  }

  if (!opts.list) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n  完成：${totals.files} 个文件，${human(totals.bytes)}，用时 ${secs}s`);
    if (totals.failed > 0) {
      console.log(`  失败 ${totals.failed} 个`);
      process.exitCode = 1;
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`  ✗ ${(err as Error).message}`);
  process.exit(1);
}
