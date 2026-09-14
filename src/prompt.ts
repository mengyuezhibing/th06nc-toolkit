/**
 * 终端交互的小助手：提问 / 单选 / 确认。
 *
 * 只在「不带参数打开工具」时启用；带参数的命令行 / 脚本用法完全不受影响。
 *
 * 实现说明：自己接管 `line` 事件并排队 —— `rl.question()` 在管道输入下会把
 * 「提问前就到达」的行直接丢掉，脚本化喂入会失败；排队后两种场景行为一致。
 */
import { createInterface, type Interface } from 'node:readline';

let rl: Interface | null = null;
/** 还没有提问者认领的输入行 */
const buffered: string[] = [];
/** 正在等一行输入的提问者 */
let waiter: ((line: string) => void) | null = null;

function line(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (raw) => {
      const text = raw.trim();
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(text);
      } else {
        buffered.push(text);
      }
    });
    rl.on('close', () => {
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve('');
      }
    });
  }
  return rl;
}

function write(text: string): void {
  process.stdout.write(text);
}

/** 读一行输入（先吃缓冲队列，没有再等） */
async function readLine(): Promise<string> {
  const buffered0 = buffered.shift();
  if (buffered0 !== undefined) return buffered0;
  return new Promise<string>((resolve) => {
    waiter = resolve;
  });
}

/** 结束交互（不调用的话进程不会退出） */
export function closePrompt(): void {
  rl?.close();
  rl = null;
}

/** 自由输入；直接回车返回默认值 */
export async function ask(question: string, defaultValue = ''): Promise<string> {
  line();
  const hint = defaultValue ? `（回车 = ${defaultValue}）` : '';
  write(`  ${question}${hint}: `);
  const answer = await readLine();
  return answer || defaultValue;
}

export interface Option<T> {
  label: string;
  hint?: string;
  value: T;
}

/** 单选：打印编号选项，回车选第 1 项 */
export async function choose<T>(title: string, options: Array<Option<T>>): Promise<T> {
  line();
  console.log(`\n  ${title}`);
  options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}${o.hint ? `  —— ${o.hint}` : ''}`));
  write(`  选 1-${options.length}（回车 = 1）: `);
  for (;;) {
    const raw = await readLine();
    if (raw === '') return options[0].value;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    write('    输入无效，请重选: ');
  }
}

/** 是 / 否 */
export async function confirm(question: string, defaultValue = true): Promise<boolean> {
  line();
  const hint = defaultValue ? '(Y/n)' : '(y/N)';
  write(`  ${question} ${hint}: `);
  for (;;) {
    const raw = (await readLine()).toLowerCase();
    if (raw === '') return defaultValue;
    if (raw === 'y' || raw === 'yes') return true;
    if (raw === 'n' || raw === 'no') return false;
    write('    请输入 y 或 n: ');
  }
}
