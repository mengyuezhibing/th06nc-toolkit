/**
 * 在本机自动找 TH06NC 的资源目录。
 *
 * 识别标志：某个目录里能找到 `th06CM.dat`（7 个归档之一，游戏目录必有）。
 * 扫描深度 ≤ 3 层、目录数有预算上限，避免在大目录里卡住。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface GameInstall {
  /** 放 `.dat` 的目录 */
  dataDir: string;
  /** 旁边有没有 th06nc.exe（确认是游戏本体，而不只是一堆归档） */
  hasExe: boolean;
  /** 找到的归档名（按名字排序） */
  archives: string[];
}

const MARKER = 'th06CM.dat';
const ARCHIVES = ['th06CM.dat', 'th06ED.dat', 'th06FN.dat', 'th06IN.dat', 'th06MD.dat', 'th06ST.dat', 'th06TL.dat'];
const MAX_DEPTH = 3;
const DIR_BUDGET = 6000;

/** 检查某个目录是不是资源目录 */
export function inspectDataDir(dir: string): GameInstall | null {
  const archives = ARCHIVES.filter((a) => fs.existsSync(path.join(dir, a)));
  if (archives.length === 0) return null;
  const parent = path.dirname(dir);
  const hasExe =
    fs.existsSync(path.join(parent, 'th06nc.exe')) || fs.existsSync(path.join(dir, 'th06nc.exe'));
  return { dataDir: dir, hasExe, archives };
}

/** 本机常见的游戏安装位置（各平台都试一下，不存在就跳过） */
function candidateRoots(): string[] {
  const home = os.homedir();
  const cwd = process.cwd();
  const upward: string[] = [];
  for (let p = cwd, i = 0; i < 3 && p !== path.dirname(p); i++) {
    upward.push(p);
    p = path.dirname(p);
  }
  return [
    ...upward,
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Library', 'Application Support', 'Steam', 'steamapps', 'common'),
    path.join(home, '.steam', 'steam', 'steamapps', 'common'),
    path.join(home, '.local', 'share', 'Steam', 'steamapps', 'common'),
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'D:\\Steam\\steamapps\\common',
    'D:\\Games',
  ];
}

function scan(root: string, budget: { left: number }, hits: Map<string, GameInstall>): void {
  if (!fs.existsSync(root)) return;
  const queue: Array<[string, number]> = [[root, 0]];
  const seen = new Set<string>([root]);
  while (queue.length > 0 && budget.left > 0) {
    const [dir, depth] = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    budget.left--;

    const hit = inspectDataDir(dir);
    if (hit) {
      hits.set(hit.dataDir, hit);
      continue; // 找到资源目录就不再往下钻
    }
    if (depth >= MAX_DEPTH) continue;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (seen.has(full)) continue;
      seen.add(full);
      queue.push([full, depth + 1]);
    }
  }
}

/** 自动探测本机的游戏资源目录，返回去重后的结果（有游戏本体的排前面） */
export function findGameInstalls(): GameInstall[] {
  const hits = new Map<string, GameInstall>();
  const budget = { left: DIR_BUDGET };
  for (const root of candidateRoots()) {
    scan(root, budget, hits);
    if (budget.left <= 0) break;
  }
  return [...hits.values()].sort((a, b) => Number(b.hasExe) - Number(a.hasExe) || a.dataDir.localeCompare(b.dataDir));
}
