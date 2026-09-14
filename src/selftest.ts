/**
 * 已知答案自检
 *
 * 三组测试向量都不依赖任何游戏文件，任何人都能独立复现 ——
 * 它们就是「逆向结论正确」的证据本身：
 *
 *   A. 密钥   归档名 → CRC32 → 种子 → SplitMix64 → 16 字节密钥
 *             其中 th06MD 的密钥是从密文里用频率分析**实测**出来的，
 *             而程序按公式推导出的结果与它逐字节一致，两者互为印证。
 *   B. 布局   用仓库自带的 manifest.json（7 个归档 / 1783 条真实记录）
 *             反查回装时必须复现的排布规则：16 字节对齐、索引区长度、
 *             数据区起点、文件末尾补齐。
 *   C. 回装   现场造一个 PKGL 归档，跑完整的「改一条 → 回装 → 解回」往返，
 *             确认未改动条目一个字节都没动、改动条目能原样解出。
 *
 * 运行：npm run selftest
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PkgArchive,
  RECORD_HEADER_SIZE,
  alignUp,
  archiveSeed,
  crc32,
  deriveKey,
  encryptIndex,
  serializeIndex,
  xorDecrypt,
  type PkgEntry,
} from './pkg.ts';
import {
  ddsExpectedBytes,
  ddsSignature,
  encodeEntry,
  loadCompressor,
  packArchive,
  verifyArchive,
} from './pack.ts';

interface Vector {
  archive: string;
  seed: number;
  key: string;
}

/** 7 个归档的密钥向量（种子 = CRC32(归档名去掉扩展名)） */
const ARCHIVE_VECTORS: Vector[] = [
  { archive: 'th06CM', seed: 0x8bc79290, key: '5f85c08c9091e01840e9cd14be536c4c' },
  { archive: 'th06ED', seed: 0xa4418db2, key: '2b7c4754094f8242bed1e7746b27bf06' },
  { archive: 'th06FN', seed: 0x6fb9376f, key: '55d2a7d022913a9246a79b09ad50cac9' },
  { archive: 'th06IN', seed: 0xe8212ba0, key: '4339ad27bb6d12b6d29b2fe08178f78b' },
  { archive: 'th06MD', seed: 0x6c9807ba, key: '0a61809291532b492d528896036b933f' },
  { archive: 'th06ST', seed: 0xa56e2801, key: '4f7cf19ca84b554b5afc59b4ded70b63' },
  { archive: 'th06TL', seed: 0xf9432690, key: '35486ae729d1313753daf048a2f163b5' },
];

/** 条目级向量：种子来自索引记录的 seed 字段 */
const ENTRY_VECTORS = [
  { name: 'musiccmt.txt', seed: 0x720dc49d, key: '1ef02168319bab37feaf08458bef6118' },
];

/** 归档级 CRC32 向量 */
const SEED_VECTORS: Array<[string, number]> = ARCHIVE_VECTORS.map(
  (v) => [v.archive, v.seed] as [string, number],
);

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  const mark = ok ? '✓' : '✗';
  const detail = ok ? '' : `   期望 ${expected}  实际 ${actual}`;
  console.log(`  ${mark} ${label}${detail}`);
}

// ---------------------------------------------------------------- A. 密钥

console.log('\n  ── CRC32 ──');
for (const [name, expected] of SEED_VECTORS) {
  check(`crc32("${name}")`, archiveSeed(name), expected);
}
// 标准向量，确认实现的是货真价实的 CRC-32/IEEE
check('crc32("123456789")', crc32('123456789'), 0xcbf43926);

console.log('\n  ── 归档密钥（种子 → SplitMix64 → 16 字节密钥）──');
for (const v of ARCHIVE_VECTORS) {
  const seed = archiveSeed(v.archive);
  check(`${v.archive.padEnd(7)} 种子`, seed, v.seed);
  check(`${v.archive.padEnd(7)} 密钥`, deriveKey(seed).toString('hex'), v.key);
}

console.log('\n  ── 条目密钥（种子取自索引记录）──');
for (const v of ENTRY_VECTORS) {
  check(`${v.name.padEnd(16)} 密钥`, deriveKey(v.seed).toString('hex'), v.key);
}

console.log('\n  ── 周期 XOR 往返 ──');
{
  const key = deriveKey(0x6c9807ba);
  const original = Buffer.from('PKGL test payload 0123456789abcdef', 'latin1');
  const round = xorDecrypt(xorDecrypt(Buffer.from(original), key), key);
  check('加解密可逆', round.equals(original), true);
  check('周期为 16', key.length, 16);
}

// ---------------------------------------------------------------- B. 布局规则

interface ManifestEntry {
  name: string;
  compressed: boolean;
  seed: string;
  originalSize: number;
  storedSize: number;
  offset: number;
}
interface ManifestArchive {
  file: string;
  fileSize: number;
  indexEntries: number;
  entries: ManifestEntry[];
}

console.log('\n  ── 回装布局规则（依据 manifest.json 的 1783 条真实记录）──');
{
  const manifestPath = new URL('../manifest.json', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { archives: ManifestArchive[] };

  let aligned = 0;
  let contiguous = 0;
  let rawOk = 0;
  let startOk = 0;
  let tailOk = 0;
  let counted = 0;

  for (const a of manifest.archives) {
    const entries = [...a.entries].sort((p, q) => p.offset - q.offset);
    const indexLength = entries.reduce((s, e) => s + RECORD_HEADER_SIZE + e.name.length, 0);

    if (entries.every((e) => e.offset % 16 === 0)) aligned++;
    if (alignUp(8 + indexLength) === entries[0].offset) startOk++;

    let ok = true;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].offset !== alignUp(entries[i - 1].offset + entries[i - 1].storedSize)) ok = false;
    }
    if (ok) contiguous++;

    if (entries.filter((e) => !e.compressed).every((e) => e.storedSize === e.originalSize)) rawOk++;

    const last = entries[entries.length - 1];
    if (a.fileSize === alignUp(last.offset + last.storedSize)) tailOk++;

    counted += entries.length;
    check(`${a.file.padEnd(11)} ${String(a.entries.length).padStart(3)} 条`, a.entries.length, a.indexEntries);
  }

  check('全部条目偏移 16 字节对齐', aligned, manifest.archives.length);
  check('索引区长度 → 数据区起点（8+索引 后补齐到 16）', startOk, manifest.archives.length);
  check('条目之间补齐到 16 后首尾相接', contiguous, manifest.archives.length);
  check('raw 条目 storedSize == originalSize', rawOk, manifest.archives.length);
  check('文件长度 = 末尾补齐到 16', tailOk, manifest.archives.length);
  check('记录总数', counted, 1783);
}

// ---------------------------------------------------------------- C. DDS 守卫

console.log('\n  ── DDS 尺寸守卫（改完贴图能不能被引擎吃掉）──');
{
  // 真实条目 eff01_4k.dds：1152×1152、BC7（DX10#98）、单层 → 索引声明 1327252 字节
  const bc7 = Buffer.alloc(148 + 1327104);
  bc7.write('DDS ', 0, 4, 'latin1');
  bc7.writeUInt32LE(124, 4);
  bc7.writeUInt32LE(1152, 12);
  bc7.writeUInt32LE(1152, 16);
  bc7.writeUInt32LE(1, 28);
  bc7.write('DX10', 84, 4, 'latin1');
  bc7.writeUInt32LE(98, 128);
  bc7.writeUInt32LE(1, 132);
  check('BC7 1152×1152 单层 = 1327252 B（与真实条目一致）', ddsExpectedBytes(bc7), 1327252);
  check('形状指纹', ddsSignature(bc7), '1152×1152 DX10#98 mips=1');
  const truncated = bc7.subarray(0, bc7.length - 16);
  check('截断 16 字节 → 守卫能发现', (ddsExpectedBytes(truncated) ?? 0) > truncated.length, true);

  // 单层 256×256 BC1（DXT1）：每块 8 字节
  const bc1 = Buffer.alloc(128 + 64 * 64 * 8);
  bc1.write('DDS ', 0, 4, 'latin1');
  bc1.writeUInt32LE(256, 12);
  bc1.writeUInt32LE(256, 16);
  bc1.writeUInt32LE(1, 28);
  bc1.write('DXT1', 84, 4, 'latin1');
  check('DXT1 256×256 = 32960 B', ddsExpectedBytes(bc1), 128 + 64 * 64 * 8);

  // 未压缩 B8G8R8A8，带 2 级 mip
  const rgba = Buffer.alloc(128 + 64 * 64 * 4 + 32 * 32 * 4);
  rgba.write('DDS ', 0, 4, 'latin1');
  rgba.writeUInt32LE(64, 12);
  rgba.writeUInt32LE(64, 16);
  rgba.writeUInt32LE(2, 28);
  rgba.writeUInt32LE(32, 88);
  check('B8G8R8A8 64×64 mips=2 = 20608 B', ddsExpectedBytes(rgba), 128 + 64 * 64 * 4 + 32 * 32 * 4);

  check('非 DDS → 不检查', ddsExpectedBytes(Buffer.from('PNG')), null);
}

// ---------------------------------------------------------------- D. 回装往返

/** 现场造一个 PKGL 归档：用于跑「改一条 → 回装 → 解回」的完整往返 */
function buildSyntheticArchive(filePath: string, keyName: string, payloads: Array<{ name: string; data: Buffer }>, compressor: Awaited<ReturnType<typeof loadCompressor>>): void {
  const encoded = payloads.map((p) => ({ name: p.name, ...encodeEntry(p.data, { seed: (crc32(p.name) ^ 0x5a5a5a5a) >>> 0, compressor }) }));
  const indexLength = encoded.reduce((s, e) => s + RECORD_HEADER_SIZE + Buffer.byteLength(e.name, 'latin1'), 0);
  const dataStart = alignUp(8 + indexLength);

  let cursor = dataStart;
  const entries: PkgEntry[] = encoded.map((e) => {
    const offset = alignUp(cursor);
    cursor = offset + e.storedSize;
    return { flags: e.flags, seed: e.seed, originalSize: e.originalSize, storedSize: e.storedSize, offset, name: e.name };
  });
  const fileSize = alignUp(cursor);

  const header = Buffer.alloc(8);
  header.write('PKGL', 0, 4, 'latin1');
  header.writeUInt32LE(indexLength, 4);
  const parts: Buffer[] = [header, encryptIndex(serializeIndex(entries), keyName)];
  let pos = 8 + indexLength;
  for (let i = 0; i < encoded.length; i++) {
    parts.push(Buffer.alloc(entries[i].offset - pos));
    parts.push(encoded[i].stored); // encodeEntry 已用该条目的种子加密过
    pos = entries[i].offset + entries[i].storedSize;
  }
  parts.push(Buffer.alloc(fileSize - pos));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat(parts));
}

async function repackTests(): Promise<void> {
  console.log('\n  ── 回装往返（现场构造 PKGL 归档）──');

  const compressor = await loadCompressor(19);
  console.log(`  · 压缩器 ${compressor ? compressor.name : '无（raw 存储）'}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th06nc-selftest-'));
  try {
    const keyName = 'th06MD';
    const payloads = [
      { name: 'a.bin', data: Buffer.alloc(300, 0x41) }, // 可压缩
      { name: 'b.txt', data: Buffer.from('原始内容 original\n'.repeat(20), 'latin1') },
      { name: 'c.pos', data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) },
      { name: 'd.ecl', data: Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) & 0xff)) },
    ];
    const archivePath = path.join(tmp, 'src', `${keyName}.dat`);
    buildSyntheticArchive(archivePath, keyName, payloads, compressor);

    // 结构：能打开、条目名对得上
    const probe = PkgArchive.open(archivePath, keyName);
    check('构造的归档可打开', probe.entries.length, payloads.length);
    check('条目名一致', probe.entries.map((e) => e.name).join(','), payloads.map((p) => p.name).join(','));
    check('每条都能解码', probe.entries.every((e) => probe.read(e).length === e.originalSize), true);
    probe.close();

    // ① 一条都不改 → 必须是原文件的逐字节副本
    const samePath = path.join(tmp, 'out-same', `${keyName}.dat`);
    const r1 = packArchive({ archivePath, outPath: samePath, compressor, archiveName: keyName });
    check('① 未改动回装 = 逐字节副本', r1.unchanged && fs.readFileSync(archivePath).equals(fs.readFileSync(samePath)), true);

    // ② 改两条（一条变长、一条变短）→ 重排 + 重新编码
    const modRoot = path.join(tmp, 'mod', keyName);
    fs.mkdirSync(modRoot, { recursive: true });
    const newB = Buffer.from('改写后的内容 rewritten\n'.repeat(40), 'latin1');
    const newC = Buffer.from([9, 9, 9]);
    fs.writeFileSync(path.join(modRoot, 'b.txt'), newB);
    fs.writeFileSync(path.join(modRoot, 'c.pos'), newC);

    for (const mode of ['rebuild', 'inplace'] as const) {
      const outPath = path.join(tmp, `out-${mode}`, `${keyName}.dat`);
      const result = packArchive({
        archivePath,
        outPath,
        mode,
        compressor,
        archiveName: keyName,
        replacements: new Map([
          ['b.txt', path.join(modRoot, 'b.txt')],
          ['c.pos', path.join(modRoot, 'c.pos')],
        ]),
      });
      check(`${mode} 识别改动数`, result.changes.length, 2);
      check(
        `${mode} 产物可控（每 16 字节对齐）`,
        result.changes.every((c) => c.newOffset % 16 === 0),
        true,
      );

      const report = verifyArchive(outPath, new Map([['b.txt', newB], ['c.pos', newC]]), keyName);
      check(`${mode} 全部条目可解码`, report.decoded, payloads.length);
      check(`${mode} 校验问题数`, report.issues.length, 0);
      check(`${mode} 比对改动条数`, report.compared, 2);

      // 未改动条目的解码内容必须与原包一致
      const before = PkgArchive.open(archivePath, keyName);
      const after = PkgArchive.open(outPath, keyName);
      const untouched = ['a.bin', 'd.ecl'];
      const ok = untouched.every(
        (n) => before.readByName(n)!.equals(after.readByName(n)!),
      );
      check(`${mode} 未改动条目内容不变`, ok, true);
      before.close();
      after.close();
    }

    // ③ 改名产物：索引密钥仍按原名，显式指定 keyName 也能解开
    const renamed = path.join(tmp, 'renamed-staging', 'something-else.dat');
    packArchive({ archivePath, outPath: renamed, compressor, archiveName: keyName });
    const renamedOk = PkgArchive.with(renamed, (a) => a.entries.length === payloads.length, keyName);
    check('③ 改名的产物用原名密钥仍可解', renamedOk, true);

    // ④ 没有压缩器时（Release 的 .cjs 在无依赖环境下就是这样）必须能 raw 回装
    const rawPath = path.join(tmp, 'out-raw', `${keyName}.dat`);
    const rawResult = packArchive({
      archivePath,
      outPath: rawPath,
      compressor: null,
      archiveName: keyName,
      replacements: new Map([['b.txt', path.join(modRoot, 'b.txt')]]),
    });
    check('④ 无压缩器 → 改动条目按 raw 存储', rawResult.changes.every((c) => !c.compressed), true);
    check(
      '④ 无压缩器 → 产物仍可解码且内容正确',
      verifyArchive(rawPath, new Map([['b.txt', newB]]), keyName).issues.length,
      0,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 汇总

repackTests()
  .catch((err: Error) => {
    failed++;
    console.log(`  ✗ 回装往返测试异常：${err.message}`);
  })
  .finally(() => {
    console.log(`\n  通过 ${passed} 项，失败 ${failed} 项\n`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
