# 东方新典解包工具 · th06nc-unpack

《东方红魔乡 新典版》（Touhou Koumakyou **New Classic**）资源归档解包工具。

游戏把 896 MB 资源打进 7 个 `.dat` 归档，并加了一层**自定义混淆加密**。
本项目完整还原了该格式，可把全部 **1783 个文件 / 6.66 GB** 原样导出。

```
th06CM.dat  合辑贴图      th06ST.dat  关卡脚本(ECL)
th06ED.dat  结局演出      th06TL.dat  标题与界面
th06FN.dat  字体与多语言  th06MD.dat  音乐数据
th06IN.dat  初始化资源
```

---

## 获取

### 方式一：免安装（推荐）

到 [Releases](https://github.com/mengyuezhibing/th06nc-unpack/releases) 下载对应平台的文件：

| 文件 | 适合 |
|---|---|
| `th06nc-unpack-windows-x64.exe` | Windows，直接命令行运行 |
| `th06nc-unpack-macos-arm64` / `-x64` | macOS（Apple 芯片 / Intel） |
| `th06nc-unpack-linux-x64` / `-arm64` | Linux |
| `th06nc-unpack.cjs` | **任何装了 Node ≥18 的机器**，29 KB 单文件 |

`.cjs` 版是通用兜底：所有依赖已内置，`node th06nc-unpack.cjs <归档>` 即可，无需 `npm install`。

> 原生可执行由 GitHub Actions 在 Node 22 上构建。若某平台构建失败，
> Release 里就没有那个文件 —— 用 `.cjs` 兜底即可，功能完全一样。

### 方式二：源码运行

```bash
git clone https://github.com/mengyuezhibing/th06nc-unpack.git
cd th06nc-unpack && npm install
```

## 快速开始

```bash
npm install

# 解开整个目录
npm run unpack -- "path/to/th06nc/data" --out ./unpacked --verify

# 先看看里面有什么
npm run unpack -- "path/to/th06nc/data/th06ST.dat" --list

# 只要 ECL 脚本
npm run unpack -- "path/to/th06ST.dat" --filter '\.ecl$' -o ./ecl
```

免安装版把 `npm run unpack --` 换成直接运行可执行文件即可，参数一致：

```bash
./th06nc-unpack-macos-arm64 "path/to/th06nc/data" -o ./unpacked --verify
node th06nc-unpack.cjs "path/to/th06nc/data" -o ./unpacked --verify
```

全局使用（源码方式）：

```bash
npm run build
npm link
th06nc-unpack "path/to/th06nc/data" -o ./unpacked
```

输出示例：

```
  输入  /path/to/th06nc/data
  输出  /path/to/unpacked
  归档  7 个

  th06CM.dat  —  311 条目
    已导出 → /path/to/unpacked/th06CM
  ...
  完成：1783 个文件，6.66 GB，用时 21.6s
```

---

## 解出的内容

| 类型 | 数量 | 说明 |
|---|---|---|
| `.dds` | 1225 | DirectDraw Surface 贴图，含 `_4k` 高清版本（最大 4096×8192） |
| `.txt` / `.json` | 332 | 多语言文本（含 `de` `en` `es-419` `fr` `it` `pt-BR` 等） |
| `.anm` | 125 | 动画与精灵定义，thtk 重编译格式（贴图外置引用） |
| `.pos` | 36 | BGM 播放位置数据 |
| `.wav` | 28 | 音效 |
| `.ecl` | 7 | 关卡弹幕脚本（**可被 thtk 系工具直接读取**） |
| `.std` / `.end` / `.dat` | 28 | 关卡与结局数据 |

---

## 归档格式（逆向还原）

> 该格式没有任何公开文档，以下内容来自对 `th06nc.exe` 的反汇编与密文分析。

### 文件布局

```
[8 字节]   "PKGL" | u32 索引区字节数
[索引区]   逐条记录，按 16 字节周期 XOR 加密
[数据区]   各条目数据，偏移与大小由索引给出
```

### 索引记录

```
u16   flags         bit0 = 数据是否经 zstd 压缩
u32   seed          该条目数据的密钥种子
u64   originalSize  解压后大小
u64   storedSize    磁盘占用大小
u64   offset        数据在文件中的偏移
u16   nameLength
char  name[nameLength]
```

记录之间无对齐填充，首尾相接。

### 加密

索引区与数据区共用同一个周期 XOR 例程，**区别只在种子来源**：

```
索引区种子 = CRC32(归档名去掉路径与扩展名)      "th06MD" → 0x6c9807ba
数据区种子 = 记录里的 seed 字段
```

密钥由种子经 **SplitMix64** 派生：

```python
s   = ((seed × 0x9e3779b1) + 1) ^ (seed << 32)
key = SplitMix64(s) ‖ SplitMix64(s + 0x9e3779b97f4a7c15)   # 各 8 字节小端
解密  buf[i] ^= key[i % 16]
```

其中 `SplitMix64` 即标准的 `z ^= z >> 30; z *= 0xbf58476d1ce4e5b9;
z ^= z >> 27; z *= 0x94d049bb133111eb; z ^= z >> 31`。

### 数据压缩

`flags` 的 bit0 置位时，**先 XOR 解密、再做 zstd 解压**（顺序不能颠倒）。
`storedSize` 是压缩后大小，`originalSize` 是解压后大小。

> **注意**：归档名参与密钥派生，所以**不要重命名 `.dat` 文件**。
> `th06CM.dat` 一旦改名，索引就无法解密。

### 反汇编定位

| 地址 | 作用 |
|---|---|
| `0x140059cb0` | 密钥派生 + 周期 XOR 例程 |
| `0x140059e20` | 归档名 CRC32 计算 |
| `0x14005a09b` | `"PKGL"` 魔数校验 |
| `0x14005a178` | 索引区解密调用点 |
| `0x14005a511` | 数据区解密调用点 |

密钥派生那段的原貌：

```asm
0x140059cc7  mov   edx, r8d              ; edx = 种子
0x140059cca  mov   ecx, 0x9e3779b1
0x140059ccf  imul  rdx, rcx              ; × 0x9e3779b1
0x140059cc7  inc   rdx                   ; + 1
0x140059cc0  shl   rax, 0x20             ; 种子 << 32
0x140059cf4  xor   rdx, rax              ; 异或 → SplitMix64 初始状态
0x140059cd3  movabs rbx, 0x9e3779b97f4a7c15   ; gamma
0x140059cdd  movabs rdi, 0xbf58476d1ce4e5b9   ; 混合常量 1
0x140059cea  movabs r11, 0x94d049bb133111eb   ; 混合常量 2
0x140059dfa  xor   byte ptr [r10 + rax], cl   ; buf[i] ^= key[i % 16]
```

---

## 验证证据

### 1. 已知答案自检（不需要游戏文件）

```bash
npm run selftest
```

`deriveKey` 的 7 组密钥是从**密文**里用频率分析实测出来的，而程序按公式推导出的结果与它逐字节一致 —— 两者互为印证：

```
── CRC32 ──
  ✓ crc32("th06MD")    ✓ crc32("123456789") = 0xcbf43926

── 归档密钥（种子 → SplitMix64 → 16 字节密钥）──
  ✓ th06CM  种子 0x8bc79290   密钥 5f85c08c9091e01840e9cd14be536c4c
  ✓ th06ED  种子 0xa4418db2   密钥 2b7c4754094f8242bed1e7746b27bf06
  ✓ th06FN  种子 0x6fb9376f   密钥 55d2a7d022913a9246a79b09ad50cac9
  ✓ th06IN  种子 0xe8212ba0   密钥 4339ad27bb6d12b6d29b2fe08178f78b
  ✓ th06MD  种子 0x6c9807ba   密钥 0a61809291532b492d528896036b933f
  ✓ th06ST  种子 0xa56e2801   密钥 4f7cf19ca84b554b5afc59b4ded70b63
  ✓ th06TL  种子 0xf9432690   密钥 35486ae729d1313753daf048a2f163b5

── 条目密钥 ──
  ✓ musiccmt.txt   0x720dc49d → 1ef02168319bab37feaf08458bef6118

通过 25 项，失败 0 项
```

其中 `crc32("123456789") = 0xcbf43926` 是 CRC-32/IEEE 的标准测试向量，用来确认 CRC 实现本身没写错。

### 2. 全量解包校验

```bash
th06nc-unpack "th06nc/data" -o ./unpacked --verify
```

```
  完成：1783 个文件，6.66 GB，用时 21.6s
```

`--verify` 会逐条比对解压结果与索引声明的大小。**1783 条全部吻合，失败 0。**

### 3. 结构自洽性

索引记录之间没有对齐填充，首尾相接 —— 因此「能否刚好走完索引区」是格式判断正确与否的硬指标：

| 归档 | 条目数 | 遍历结果 |
|---|---|---|
| th06CM | 311 | ✓ 正好走完 |
| th06ED | 93 | ✓ |
| th06FN | 476 | ✓ |
| th06IN | 96 | ✓ |
| th06MD | 38 | ✓ |
| th06ST | 169 | ✓ |
| th06TL | 600 | ✓ |

另外 `th06MD.dat` 的最后一条记录是 `ver0102.dat`：偏移 3232 + 大小 63 = **3295**，正好是文件长度减一。少一个字节或多一个字节都会对不上。

### 4. 产物格式校验

| 类型 | 数量 | 校验方式 |
|---|---|---|
| `.dds` | 1225 | `DDS ` 魔数 + 头长 124 —— 286/286 抽查全部有效 |
| `.ecl` | 7 | 可被 thtk 系工具直接读取，识别为 `TH06` 布局 |
| `.anm` | 125 | 123 个可被 ANM 解析器正常读取（thtk 外置贴图格式） |
| `.wav` | 28 | 标准 RIFF 波形 |
| `.txt` / `.json` | 332 | 文本可正常解码（含 8 种语言） |

ECL 抽查：

```
ecldata1.ecl  26936 B   布局 ecl-th06   38 个子程序   main=0x5074
ecldata5.ecl  35672 B   布局 ecl-th06   75 个子程序   main=0x71f0
```

---

## 完整清单

仓库里的 [`manifest.json`](manifest.json) 是 7 个归档的**全部 1783 条记录**：

```json
{
  "file": "th06ST.dat",
  "fileSize": 35539216,
  "indexEntries": 169,
  "entries": [
    {
      "name": "ecldata1.ecl",
      "compressed": true,
      "seed": "0x602b32bd",
      "originalSize": 26936,
      "storedSize": 3737,
      "offset": 7488
    }
  ]
}
```

有了它，任何拥有游戏的人都能：

- 不下载任何资源就**逐条核对**本工具的输出（名字、大小、偏移、压缩标志、种子全在里面）
- 直接复核密钥派生——把任意一条的 `seed` 丢进 `deriveKey()`，再拿 `offset`/`storedSize` 去文件里取数据，解密结果必然对得上
- 做二次开发时不必先解包就能知道归档里有什么

清单本身只是文件名与数字，不含任何游戏内容。

**本仓库不包含游戏资源。** 游戏本体与全部素材版权归上海爱丽丝幻乐团（ZUN）及发行方所有，
请自备游戏后用本工具自行解包。

---

## 作为库使用

```ts
import { PkgArchive } from './src/pkg.ts';

PkgArchive.with('th06ST.dat', (archive) => {
  console.log(archive.entries.map((e) => e.name));

  const ecl = archive.readByName('ecldata1.ecl');
  // → 26936 字节的 TH06 格式 ECL 脚本
});
```

`PkgArchive` 只把索引读进内存，条目数据按需从文件读取，
因此打开 267 MB 的 `th06TL.dat` 也只占用几 KB。

---

## 已知限制

- 仅验证过 **TH06NC**。系列中的其他作品若沿用同一打包器，改一下归档名即可复用，
  但未经实测。
- 解出的 `.anm` 是 thtk 重编译格式，贴图以 `data/xxx/xxx.png` 形式**外置引用**，
  实际贴图在同名 `.dds` 里（扩展名不一致，需自行对应）。
- `eff00.anm`、`stg2bg.anm` 两个文件的内部结构较特殊，常见 ANM 解析器可能读不了；
  文件本身已正确解出。

---

## 许可证

MIT。见 [LICENSE](LICENSE)。

**版权提示**：游戏资源版权归上海爱丽丝幻乐团（ZUN）。本工具只做格式解析，
不包含任何游戏资源。请自行判断解包产物的使用范围。
