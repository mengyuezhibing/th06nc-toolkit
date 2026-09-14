/**
 * 交互式向导：不带参数打开工具时启用。
 *
 *   找游戏 → 选「解包 / 回装」→ 选目录（可改）→ 开跑
 *
 * 内部不重新实现任何逻辑，只是帮你把命令行参数拼好，再调用与脚本用法
 * 完全相同的 `runUnpackCli` / `runPackCli` —— 两条入口永远行为一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ask, choose, closePrompt, confirm } from './prompt.ts';
import { findGameInstalls, inspectDataDir } from './discover.ts';
import { runPackCli } from './pack-cli.ts';
import { runUnpackCli } from './unpack-cli.ts';

const BANNER = `
  ─────────────────────────────────────────────
   东方红魔乡 新典版 · 归档解包 / 回装工具
   1783 个资源原样导出 · 改完素材封回 .dat
  ─────────────────────────────────────────────`;

function listArchives(dataDir: string): string[] {
  return fs
    .readdirSync(dataDir)
    .filter((f) => f.toLowerCase().endsWith('.dat'))
    .sort()
    .map((f) => path.join(dataDir, f));
}

async function pickDataDir(): Promise<string | null> {
  console.log('  正在找本机的游戏资源目录（th06CM.dat …）…');
  const installs = findGameInstalls();
  const options = installs.map((i) => ({
    label: i.dataDir,
    hint: `${i.hasExe ? '游戏本体 ✓，' : ''}${i.archives.length} 个归档`,
    value: i.dataDir,
  }));
  options.push({ label: '手动输入路径', hint: '任意含 .dat 归档的目录', value: '' });

  const picked = await choose('找到这些资源目录，用哪个？', options);
  if (picked !== '') return picked;

  for (;;) {
    const input = await ask('请输入资源目录路径');
    if (!input) return null;
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      console.log('    目录不存在，再试一次');
      continue;
    }
    const found = inspectDataDir(resolved);
    if (!found) {
      console.log(`    ${resolved} 里没有 th06CM.dat —— 请指向游戏的 data 目录（或解包输出的上层）`);
      continue;
    }
    return found.dataDir;
  }
}

/** 解包流程 */
async function unpackFlow(dataDir: string): Promise<void> {
  const archives = listArchives(dataDir);
  const scope = await choose<string>('解哪些归档？', [
    { label: '全部（推荐，一次全部导出，约十几秒）', hint: `${archives.length} 个归档`, value: dataDir },
    { label: '挑一个', value: '' },
  ]);

  let input = scope;
  if (scope === '') {
    input = await choose('解哪个归档？', archives.map((a) => ({ label: path.basename(a), value: a })));
  }

  const out = await ask('解出来的文件放到哪个目录', './unpacked');
  console.log('');
  const ok = runUnpackCli([input, '-o', out, '--verify']);
  if (ok) console.log(`\n  ✔ 解包完成 → ${path.resolve(out)}`);
  else console.log('\n  ✗ 解包未全部成功（见上面的错误）');
}

/** 回装流程 */
async function packFlow(dataDir: string): Promise<void> {
  // 找解包输出：优先当前目录的 ./unpacked，其次是游戏目录里的 <归档名>/ 子目录
  const unpackedRoot = path.resolve('unpacked');
  const archives = listArchives(dataDir);
  const stems = archives
    .map((a) => path.basename(a, path.extname(a)))
    .filter((s) => fs.existsSync(path.join(unpackedRoot, s)));

  let from: string;
  if (stems.length > 0) {
    from = unpackedRoot;
    console.log(`  找到解包输出：${from}（含 ${stems.length} 个归档的改动目录）`);
  } else {
    from = await ask('改过的素材放在哪个目录（解包输出的目录）', './unpacked');
    if (!fs.existsSync(path.resolve(from))) {
      console.log('    （目录还不存在 —— 回装时只有匹配得上的文件会被替换，其余保持原样）');
    }
  }

  const scope = await choose<string>('封装哪些归档？', [
    { label: '全部', hint: `${archives.length} 个归档一起装`, value: dataDir },
    { label: '挑一个', value: '' },
  ]);

  let input = scope;
  let outFile = '';
  if (scope === '') {
    input = await choose('封装哪个归档？', archives.map((a) => ({ label: path.basename(a), value: a })));
    const stem = path.basename(input, path.extname(input));
    outFile = await ask('封装结果写到哪个文件', path.join(path.dirname(input), 'repacked', `${stem}.dat`));
  } else {
    outFile = await ask('封装结果放到哪个目录（每个归档一个 <归档名>.dat）', path.join(dataDir, 'repacked'));
  }

  console.log('');
  const argv = [input, '--from', from, '--verify'];
  if (outFile) argv.push(scope === '' ? '-o' : '--out-dir', outFile);
  let ok = await runPackCli(argv);
  if (!ok && (await confirm('要覆盖已存在的输出（--force）再试一次吗？', false))) {
    ok = await runPackCli([...argv, '--force']);
  }
  if (ok) console.log(`\n  ✔ 回装完成（记得把产物按原名覆盖回 ${dataDir}）`);
  else console.log('\n  ✗ 回装未完成（见上面的错误）');
}

/** 交互入口：不带参数打开工具时调用 */
export async function runInteractive(): Promise<void> {
  console.log(BANNER);
  for (;;) {
    const action = await choose('要做什么？', [
      { label: '解包：把 .dat 里的资源导出成文件', value: 'unpack' },
      { label: '回装：把改过的素材封回 .dat', value: 'pack' },
      { label: '看看归档里有什么（不导出）', value: 'list' },
      { label: '退出', value: 'exit' },
    ]);
    if (action === 'exit') break;

    const dataDir = await pickDataDir();
    if (!dataDir) continue;

    if (action === 'unpack') await unpackFlow(dataDir);
    else if (action === 'pack') await packFlow(dataDir);
    else {
      const archives = listArchives(dataDir);
      const which = await choose('看哪个归档？', [
        { label: '全部', value: dataDir },
        ...archives.map((a) => ({ label: path.basename(a), value: a })),
      ]);
      console.log('');
      runUnpackCli([which, '--list']);
    }
  }
  closePrompt();
  console.log('\n  再见\n');
}
