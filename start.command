#!/bin/bash
# 东方红魔乡 新典版 · 双击启动（交互向导）
# 双击此文件即可：自动开终端 → 第一次会自动装依赖 → 进入解包/回装交互菜单。
# 向导会自动在本机找到游戏资源目录（~/Downloads 下的 th06nc/data），无需手输路径。
cd "/Users/mouxiaobing/ai代码/东方素材研究库/tools/th06nc-unpack" || exit 1
clear
echo "════════════════════════════════════════════"
echo "  东方红魔乡 新典版 · 解包工具（交互向导）"
echo "════════════════════════════════════════════"
echo "（首次运行会静默安装依赖，请稍候几秒…）"
npm install >/dev/null 2>&1
npx tsx src/cli.ts
echo ""
echo "──────── 已退出 ────────"
echo "按回车关闭此窗口…"
read -r
