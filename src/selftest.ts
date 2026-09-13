/**
 * 已知答案自检
 *
 * 这组测试向量不依赖任何游戏文件，任何人都能独立复现 ——
 * 它就是「逆向结论正确」的证据本身：
 *
 *   归档名  →  CRC32  →  种子  →  SplitMix64  →  16 字节密钥
 *
 * 其中 th06MD 的密钥是从密文里用频率分析**实测**出来的，
 * 而程序推导出的结果与它逐字节一致，两者互为印证。
 *
 * 运行：npm run selftest
 */
import { crc32, archiveSeed, deriveKey, xorDecrypt } from './pkg.ts';

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

console.log(`\n  通过 ${passed} 项，失败 ${failed} 项\n`);
process.exitCode = failed === 0 ? 0 : 1;
