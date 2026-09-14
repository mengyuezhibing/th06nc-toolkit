#!/usr/bin/env node
/**
 * 东方红魔乡 新典版（TH06NC）PKGL 归档 解包 / 回装工具 —— 统一入口
 *
 *   th06nc-unpack                         打开交互式向导（选解包还是回装）
 *   th06nc-unpack [unpack] <归档|目录>     脚本式解包
 *   th06nc-unpack pack     <归档|目录>     脚本式回装
 */
import { runInteractive } from './interactive.ts';
import { runPackCli } from './pack-cli.ts';
import { runUnpackCli } from './unpack-cli.ts';

const argv = process.argv.slice(2);
const first = argv[0];

function fail(err: Error): never {
  console.error(`  ✗ ${err.message}`);
  process.exit(1);
}

const startInteractive = (): void => {
  process.on('SIGINT', () => {
    console.log('\n  已退出');
    process.exit(130);
  });
  runInteractive().catch(fail);
};

if (first === 'pack' || first === 'repack') {
  // 回装：`th06nc-unpack pack …`（与 th06nc-pack 完全等价）
  runPackCli(argv.slice(1)).catch(fail);
} else if (first === '-i' || first === '--interactive') {
  startInteractive();
} else if (argv.length === 0) {
  // 不带参数：终端里打开 → 交互式向导；被脚本 / 管道调用 → 打印帮助
  if (process.stdin.isTTY) startInteractive();
  else {
    console.error('用法：th06nc-unpack [unpack|pack] <归档.dat | 目录> [选项]，或不带参数进入交互式向导');
    process.exit(1);
  }
} else {
  try {
    runUnpackCli(first === 'unpack' ? argv.slice(1) : argv);
  } catch (err) {
    fail(err as Error);
  }
}
