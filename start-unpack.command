#!/bin/bash
# 东方红魔乡 新典版 · 双击一键解包（零提问）
# 双击即自动解包到 /tmp/th06nc-unpacked，全程无需输入。
# 解包完成后清理：rm -rf /tmp/th06nc-unpacked
cd "/Users/mouxiaobing/ai代码/东方素材研究库/tools/th06nc-unpack" || exit 1
clear
echo "════════════════════════════════════════════"
echo "  东方红魔乡 新典版 · 一键解包"
echo "════════════════════════════════════════════"

# 自动定位游戏 data 目录（~/Downloads 下任意一层 th06nc/data）
GAME=$(ls -d ~/Downloads/*/th06nc/data 2>/dev/null | head -n1)
if [ -z "$GAME" ]; then
  GAME=$(ls -d ~/Desktop/*/th06nc/data 2>/dev/null | head -n1)
fi
if [ -z "$GAME" ]; then
  echo "未在 ~/Downloads、~/Desktop 找到 th06nc/data，请改用 start.command 手动指定。"
  echo "按回车关闭…"
  read -r
  exit 1
fi

echo "（首次运行会静默安装依赖，请稍候…）"
npm install >/dev/null 2>&1

OUT=/tmp/th06nc-unpacked
rm -rf "$OUT"
echo ""
echo "游戏目录：$GAME"
echo "解包到  ：$OUT"
echo "开始解包（约十几秒，ST 音频归档较大请稍候）…"
echo ""
npx tsx src/cli.ts "$GAME" -o "$OUT" --verify

echo ""
echo "──────── 完成 ────────"
echo "产物目录：$OUT"
echo "清理命令：rm -rf $OUT"
echo "按回车关闭此窗口…"
read -r
