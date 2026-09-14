# 东方新典工具 · th06nc-unpack（解包 / 回装）

《东方红魔乡 新典版》（Touhou Koumakyou **New Classic**）资源归档**解包 / 回装**工具。

游戏把 896 MB 资源打进 7 个 `.dat` 归档，并加了一层**自定义混淆加密**。
本项目完整还原了该格式，把这两件事做在了一起：

- **解包** `th06nc-unpack`：全部 **1783 个文件 / 6.66 GB** 原样导出；
- **回装** `th06nc-pack`：改完素材重新封回 `.dat`，按原名放回去游戏就能跑
  （见 [改完素材怎么装回去](#改完素材怎么装回去)）。

更新记录见 [CHANGELOG.md](CHANGELOG.md)。

```
th06CM.dat  合辑贴图      th06ST.dat  关卡脚本(ECL)
th06ED.dat  结局演出      th06TL.dat  标题与界面
th06FN.dat  字体与多语言  th06MD.dat  音乐数据
th06IN.dat  初始化资源
```

---

## 获取

### 方式一：免安装（推荐）

到 [Releases](https://github.com/mengyuezhibing/th06nc-toolkit/releases) 下载对应平台的文件：

| 文件 | 适合 |
|---|---|
| `th06nc-unpack-windows-x64.exe` | Windows，直接命令行运行 |
| `th06nc-unpack-macos-arm64` / `-x64` | macOS（Apple 芯片 / Intel） |
| `th06nc-unpack-linux-x64` / `-arm64` | Linux |
| `th06nc-unpack.cjs` | 解包，**任何装了 Node ≥18 的机器**，单文件 |
| `th06nc-pack.cjs` | **回装**，同上（解包工具本体也可用 `pack` 子命令） |

`.cjs` 版是通用兜底：所有依赖已内置，`node th06nc-unpack.cjs <归档>` 即可，无需 `npm install`。
回装用 `node th06nc-pack.cjs …`，参数见 [改完素材怎么装回去](#改完素材怎么装回去)。
（平台原生可执行只含解包；回装请用 `.cjs`。）

> 原生可执行由 GitHub Actions 在 Node 22 上构建。若某平台构建失败，
> Release 里就没有那个文件 —— 用 `.cjs` 兜底即可，功能完全一样。

### 方式二：源码运行

```bash
git clone https://github.com/mengyuezhibing/th06nc-toolkit.git
cd th06nc-unpack && npm install
```

## 打开就有向导（不想记命令就用这个）

**不带任何参数**打开工具（`node th06nc-unpack.cjs`，或直接运行平台可执行），
终端里会出现向导，选数字就行：

```
  ─────────────────────────────────────────────
   东方红魔乡 新典版 · 归档解包 / 回装工具
   1783 个资源原样导出 · 改完素材封回 .dat
  ─────────────────────────────────────────────

  要做什么？
    1) 解包：把 .dat 里的资源导出成文件
    2) 回装：把改过的素材封回 .dat
    3) 看看归档里有什么（不导出）
    4) 退出
```

- **自动匹配本地游戏文件**：先扫当前目录、向上 3 层、下载 / 桌面 / 文档和 Steam
  常见安装位置；找到含 `th06CM.dat` 的目录就列出来让你挑，旁边有 `th06nc.exe`
  的会标「游戏本体 ✓」。没找到会让你手动输入路径。
- **输出地址自己定**：解包问「放到哪个目录」（默认 `./unpacked`）；回装自动识别
  `./unpacked` 里的改动文件，并让你指定封装结果的输出文件 / 目录
  （默认归档旁的 `repacked/`，别直接覆盖原包，确认没问题再放回去）。
- 向导的两个流程**自动带 `--verify`**，跑完会把产物位置和覆盖回哪里提示给你。
- 脚本 / 管道调用时不会进入向导（检测到非终端输入会打印用法），自动化不受影响。

## 命令行用法

```bash
npm install

# 解开整个目录
npm run unpack -- "path/to/th06nc/data" --out ./unpacked --verify

# 先看看里面有什么
npm run unpack -- "path/to/th06nc/data/th06ST.dat" --list

# 只要 ECL 脚本
npm run unpack -- "path/to/th06ST.dat" --filter '\.ecl$' -o ./ecl

# 改完素材重新封回 .dat（详见「改完素材怎么装回去」）
npm run pack -- "path/to/th06nc/data/th06ST.dat" --from ./unpacked --verify
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

## 改完素材怎么装回去

解包 → 改文件 → 回装。回装跟解包是**同一个工具**：源码方式是 `npm run pack`，
免安装版是 Release 里的 `th06nc-pack.cjs`（`th06nc-unpack` 本体也认
`th06nc-unpack pack …` 子命令）。

```bash
# 1) 解包（得到 ./unpacked/th06CM/eff00.dds 这样的目录）
npm run unpack -- "th06nc/data" -o ./unpacked --verify

# 2) 改素材——想改哪个改哪个，其余文件留着不用管
#    ./unpacked/th06CM/eff00.dds  ← 换成自己画的

# 3) 回装：产物落到 th06nc/data/repacked/th06CM.dat
npm run pack -- "th06nc/data/th06CM.dat" --from ./unpacked --verify

# 4) 放回原位（文件名必须一模一样，见下面的「文件名不能改」）
cp "th06nc/data/repacked/th06CM.dat" "th06nc/data/th06CM.dat"
```

免安装版的三种等价写法：

```bash
node th06nc-pack.cjs   "th06nc/data/th06CM.dat" --from ./unpacked --verify
node th06nc-unpack.cjs pack "th06nc/data/th06CM.dat" --from ./unpacked --verify
./th06nc-unpack-macos-arm64 pack "th06nc/data/th06CM.dat" --from ./unpacked --verify
```

### 三条硬规则

1. **文件名不能改。** 索引区的密钥由 `CRC32(归档名)` 派生，而文件里**没有任何地方
   存放这个密钥** —— 游戏（以及本工具）都靠**文件名**解密索引。所以产物必须仍叫
   `th06CM.dat`：改名 = 索引直接解不开。工具默认把产物写进 `repacked/` 并沿用原名，
   你指定的输出名若与原名不同，它会明确告警。
2. **数据区 16 字节对齐。** 实测 1783 条记录：每条数据的偏移都是 16 的倍数，索引区
   结束后也补齐到 16 才开始放数据，文件末尾同样补齐到 16（所以几个归档都以 1 字节
   `0x00` 收尾）。回装照此排布，未改动的条目**连压缩字节都原样搬运**。
3. **素材本身的形状不要乱改。** 回装只保证「格式合法、引擎读得到」。DDS 的宽高、
   压缩格式（BC7 等）、贴图层数一旦变了，引擎仍按原形状分配显存，基本必崩 ——
   工具会比对 DDS 头并给出 `⚠` 警告；同时按 DDS 头算出「这个文件本该有多少字节」，
   数据缺斤少两（截断）也会告警。ANM / ECL / MSG 这类带内部偏移表的容器，
   改长度要自己同步修正内部表。

### 选项

| 选项 | 作用 |
|---|---|
| `--from <目录>` | 改动后的条目目录（不给就自动找：`<归档目录>/<归档名>/` → `./unpacked/<归档名>/` → `./<归档名>/`） |
| `-o, --out <文件>` | 输出路径（默认 `<归档目录>/repacked/<原名>.dat`） |
| `--out-dir <目录>` | 输出目录，每个归档输出 `<目录>/<原名>.dat`（一次回装多个归档时用这个） |
| `--inplace` | 追加式：除改动条目外一个字节都不动。改大的条目会追加到文件末尾，此时数据区不再按偏移递增（官方包都是递增的），工具会提示；进游戏异常就改用默认 rebuild |
| `--raw` | 不做 zstd 压缩（体积变大、零依赖；引擎原生支持 raw） |
| `--zstd-level <n>` | zstd 级别，默认 **19**（实测与官方打包器产出一致） |
| `--keep-seed` | 复用原条目的密钥种子（默认给改动条目生成新种子，与官方行为一致） |
| `-n, --dry-run` | 只报告会改哪些条目，不落盘 |
| `-v, --verify` | 写完后重开产物，逐条解码并与改动文件比对 |
| `-l, --list` | 列出归档条目（含偏移对齐检查）后退出 |
| `--force` | 允许覆盖已存在的输出 |

输入既可以是单个 `.dat`，也可以是含 `.dat` 的目录（一次把多个归档装回去）。

### 只替换「真的改过」的条目

工具逐条比对内容，只替换与原条目**不同**的文件，没改的条目一个字节都不重写。
因此把解包目录原样回装，产物与原 `.dat` **逐字节相同** —— 这条在真实数据上验证过，
也固化进了 `npm run selftest`（外加 1783 条真实记录的结构规则自检）。

### 压缩

- 默认级别 19 是反推出来的：拿原归档自带的 zstd 数据做对照，19 级重新压缩后与原条目
  的字节流**完全一致**（例如 `th06ST` 的 `ecldata1`~`ecldata6` 六条逐字节相同，
  22 级反而在部分条目上偏小）。
- 压缩器按「Node 内置 `zlib.zstdCompressSync`（Node ≥ 22.15 / 23.8）→ 可选依赖
  `@bokuweb/zstd-wasm`（`npm i` 后可用）→ 回退 raw」的顺序查找。
- 压缩只影响体积：原归档里本来就有 375 条 raw（`th06MD.dat` 整包 raw），引擎两种都吃，
  所以**没有任何 zstd 依赖时也能正常回装**。

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

── 回装布局规则（依据 manifest.json 的 1783 条真实记录）──
  ✓ 全部条目偏移 16 字节对齐
  ✓ 索引区长度 → 数据区起点（8+索引 后补齐到 16）
  ✓ 条目之间补齐到 16 后首尾相接
  ✓ raw 条目 storedSize == originalSize
  ✓ 文件长度 = 末尾补齐到 16
  ✓ 记录总数 1783

── 回装往返（现场构造 PKGL 归档）──
  ✓ ① 未改动回装 = 逐字节副本
  ✓ rebuild / inplace 全部条目可解码、未改动条目内容不变
  ✓ ③ 改名的产物用原名密钥仍可解
  ✓ ④ 无压缩器 → 改动条目按 raw 存储、产物仍可解码

通过 57 项，失败 0 项
```

其中 `crc32("123456789") = 0xcbf43926` 是 CRC-32/IEEE 的标准测试向量，用来确认 CRC 实现本身没写错。
「回装布局规则」一组直接用仓库里的 `manifest.json`（7 个归档 / 1783 条真实记录的偏移与大小）
反查打包器的排布约定，因此**不需要游戏文件**也能验证回装逻辑是否走对了。

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

### 5. 回装无损 & 编码器等价（真实数据实测，4 个归档 / 614 条 / 2.2 GB 明文）

```bash
th06nc-unpack "th06nc/data/th06ST.dat" -o ./unpacked --verify   # 解包
th06nc-pack   "th06nc/data/th06ST.dat" --from ./unpacked -v      # 原样回装
```

**一条都没改时，产物与原 `.dat` 逐字节相同** —— `th06MD`(3.3 KB)、`th06ST`(35.5 MB)、
`th06CM`(307 MB)、`th06IN`(82 MB) 四个归档全部如此。回装复现了官方打包器的
偏移、16 字节对齐、填充与索引加密。

改两条再回装，逐条核对原包与产物：

| 检查项 | th06MD | th06ST | th06CM | th06IN |
|---|---|---|---|---|
| 识别改动条目数 | 2 ✓ | 2 ✓ | 2 ✓ | 2 ✓ |
| 未改动条目**磁盘载荷**逐字节不变 | 36/36 | 167/167 | 309/309 | 94/94 |
| 产物全文可解码（含 zstd 解压） | 38/38 | 169/169 | 311/311 | 96/96 |
| 校验问题数 | 0 | 0 | 0 | 0 |

**官方压缩级别也反推出来了**：拿原归档里官方已写好的 zstd 流做对照，用本工具的
编码器（19 级）重新压一遍 —— **573 条压缩条目里 449 条连字节都一样**，帧头
（single-segment、无校验和、同 FCS 字段）则 **573/573 全部一致**。其余 124 条
体积差 ±1 ~ 500 字节（<0.5%），首个差异字节都在流的 90% 之后，是 zstd 库小版本
在最优解析上的细微出入 —— 对游戏没有影响（解码器只关心帧是否合法）。

```
ecldata1.ecl   官方 3737   L3:4459  L9:4082  L12:4101  L19:3737=官方✔  L22:3737
ecldata2.ecl   官方 4000   L3:4683  L9:4342  L12:4260  L19:4000=官方✔  L22:4001
ecldata3.ecl   官方 5045   L3:6159  L9:5568  L12:5523  L19:5045=官方✔  L22:5044
eff01.dds      官方 176803  L19 逐字节相同（首个差异字节 = 文件末尾）
```

条目密钥种子则是**随机的**（抽查 40 条，与 `crc32(明文)`、`crc32(名字)`、`crc32(载荷)`
都不相关），所以回装给改动条目生成新种子与原程序行为一致。

### 6. 回装后能不能跑

回装产物已通过上面全部规则校验：布局 / 加密 / 对齐与官方包一致（未改动时甚至
逐字节相同），改动条目用官方同款压缩级别重压、且能原样解回。**剩下的最后一关是
「进游戏实测」**—— `th06nc.exe` 是 Windows 程序，做逆向的这台机器跑不了。

请把产物按原名覆盖回 `th06nc/data/` 后进游戏看对应场景。工具把能提前拦的都拦了：

- `--verify`：产物全文逐条解码，与改动文件逐字节比对；
- DDS 守卫：改了形状（宽高 / 格式 / 贴图层数）会告警；按 DDS 头算出「本该有多少字节」，
  数据截断也会告警；
- `--dry-run`：先看看会改哪些条目，不落盘。

若进游戏仍有异常，按这个顺序排查：`--verify` 是否 0 问题 → 改动的 DDS 是否被
`⚠` 标记 → 换成默认 rebuild 模式（不要 `--inplace`）再试一次。

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

## 作为库使用 / 二次开发

欢迎直接拿代码改。模块划分刻意保持简单，每个文件都能单独读懂：

| 文件 | 内容 |
|---|---|
| `src/pkg.ts` | 格式本体：CRC32 / SplitMix64 密钥派生 / 索引与条目的编解码 / 读写两侧原语 |
| `src/pack.ts` | 回装库：编码、布局、索引回写、校验、DDS 守卫（无 CLI 依赖，可直接 import） |
| `src/unpack-cli.ts` / `src/pack-cli.ts` | 两个命令行实现（导出 `runUnpackCli` / `runPackCli`，可编程调用） |
| `src/interactive.ts` + `src/prompt.ts` + `src/discover.ts` | 交互式向导（提问组件 / 找游戏 / 流程） |
| `src/cli.ts` | 统一入口：向导 / 解包 / 回装的调度 |
| `manifest.json` | 1783 条记录的完整清单（不含资源），可独立复核全部结论 |

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

回装同样可以作为库调用：

```ts
import { packArchive, loadCompressor, verifyArchive } from './src/pack.ts';

const compressor = await loadCompressor(19); // 可为 null，回退 raw
const result = packArchive({
  archivePath: 'th06nc/data/th06CM.dat',
  outPath: 'th06nc/data/repacked/th06CM.dat',
  replacements: new Map([['eff00.dds', '/tmp/my-eff00.dds']]),
  compressor,
});
console.log(result.changes); // 只有 eff00.dds 一条
console.log(verifyArchive(result.outPath, undefined, 'th06CM').issues);
```

---

## 已知限制

- 仅验证过 **TH06NC**。系列中的其他作品若沿用同一打包器，改一下归档名即可复用，
  但未经实测。
- 解出的 `.anm` 是 thtk 重编译格式，贴图以 `data/xxx/xxx.png` 形式**外置引用**，
  实际贴图在同名 `.dds` 里（扩展名不一致，需自行对应）。
- `eff00.anm`、`stg2bg.anm` 两个文件的内部结构较特殊，常见 ANM 解析器可能读不了；
  文件本身已正确解出。
- 回装**只支持替换已有条目**，不支持新增 / 删除条目（索引长度因此保持不变，最不容易
  出岔子）。若真要新增文件，先确认引擎会去读它，再自行扩展索引区。
- 回装产物**必须用原文件名**放回游戏目录，否则索引解不开（见「三条硬规则」第 1 条）。

---

## 许可证

MIT。见 [LICENSE](LICENSE)。

**版权提示**：游戏资源版权归上海爱丽丝幻乐团（ZUN）。本工具只做格式解析，
不包含任何游戏资源。请自行判断解包产物的使用范围。
