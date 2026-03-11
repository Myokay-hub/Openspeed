#!/bin/bash
# ╔══════════════════════════════════════════════╗
# ║   AgentOS · 一键启动 (macOS)                 ║
# ╚══════════════════════════════════════════════╝

set -e
BOLD="\033[1m"; GREEN="\033[32m"; CYAN="\033[36m"
YELLOW="\033[33m"; RED="\033[31m"; DIM="\033[2m"; R="\033[0m"

PORT=${PORT:-3456}
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "${BOLD}${GREEN}  ⬡  AgentOS 启动器${R}"
echo "${DIM}  ─────────────────────────────────────${R}"

# ── 检查 Node.js ──────────────────────────────────
echo "${CYAN}  → 检查 Node.js ...${R}"
if ! command -v node &>/dev/null; then
  echo "${RED}  ✗ 未找到 Node.js${R}"
  echo ""
  echo "  请安装 Node.js（选一种）："
  echo "  ${CYAN}  官网下载：https://nodejs.org  (LTS 版本)${R}"
  echo "  ${DIM}  Homebrew：brew install node${R}"
  echo ""
  exit 1
fi

NODE_VER=$(node -v)
NODE_MAJ=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJ" -lt 18 ]; then
  echo "${YELLOW}  ⚠ Node.js 版本过低: $NODE_VER (需要 v18+)${R}"
  echo "${DIM}  升级: brew upgrade node${R}"
  exit 1
fi
echo "${GREEN}  ✓ Node.js $NODE_VER${R}"

# ── 安装依赖 ──────────────────────────────────────
cd "$DIR"
if [ ! -d "node_modules" ]; then
  echo "${CYAN}  → 安装依赖 (首次运行)...${R}"
  npm install --silent
  echo "${GREEN}  ✓ 依赖安装完成${R}"
else
  echo "${GREEN}  ✓ 依赖已就绪${R}"
fi

# ── 检查端口 ──────────────────────────────────────
echo "${CYAN}  → 检查端口 $PORT ...${R}"
if lsof -i ":$PORT" -sTCP:LISTEN &>/dev/null 2>&1; then
  PID=$(lsof -ti ":$PORT" -sTCP:LISTEN | head -1)
  PNAME=$(ps -p "$PID" -o comm= 2>/dev/null || echo "未知进程")
  echo "${YELLOW}  ⚠ 端口 $PORT 被占用 (PID:$PID $PNAME)${R}"
  read -rp "  切换到端口 $((PORT+1))? [Y/n] " ans
  [ "${ans:-Y}" = "n" ] || [ "${ans:-Y}" = "N" ] && { echo "${RED}  已取消${R}"; exit 1; }
  PORT=$((PORT+1))
fi
echo "${GREEN}  ✓ 端口 $PORT 可用${R}"

echo "${DIM}  ─────────────────────────────────────${R}"
echo ""

export PORT=$PORT
exec node server/index.js
