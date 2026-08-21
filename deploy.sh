#!/usr/bin/env bash
# 装修防宰攻略 · 笔记版 —— 服务器一键部署脚本
# 在服务器上，把 renovation_notes/ 上传到某目录后执行：
#   cd /path/to/renovation_notes && sudo bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then echo "✗ 未找到 python3，请先安装"; exit 1; fi

PORT="${PORT:-5000}"
RUN_USER="${RUN_USER:-$(whoami)}"

echo ">> [1/5] 安装系统依赖 (python3-venv / python3-pip)..."
if [ -f /etc/os-release ]; then . /etc/os-release; fi
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y python3-venv python3-pip
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y python3-venv python3-pip
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y python3-venv python3-pip
else
  echo "⚠ 未识别包管理器，跳过系统依赖安装（请手动确保 python3-venv 可用）"
fi

echo ">> [2/5] 创建虚拟环境并安装 Python 依赖..."
# venv 已存在则复用，避免重复部署时报错
if [ ! -d venv ]; then python3 -m venv venv; fi
./venv/bin/pip install --upgrade pip -q
./venv/bin/pip install -r requirements.txt -q

echo ">> [3/5] 初始化本地 SQLite 笔记库..."
./venv/bin/python -c "import db; db.init_db()" 2>/dev/null || python3 -c "import db; db.init_db()"

# 启动方式：root + 有 systemd → 注册服务常驻；否则 nohup 后台
if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" = "0" ] && [ "${USE_SYSTEMD:-1}" = "1" ]; then
  echo ">> [4/5] 注册 systemd 开机自启服务..."
  # 先清掉可能残留的旧进程，避免它占着 5000（只监听 IPv4）导致双栈起不来
  systemctl stop renovation_notes 2>/dev/null || true
  pkill -f "app.py" 2>/dev/null || true
  sed "s|__DIR__|$(pwd)|g; s|__USER__|${RUN_USER}|g; s|__PORT__|${PORT}|g" \
      renovation_notes.service > /etc/systemd/system/renovation_notes.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now renovation_notes
  # 真正监听地址由服务文件里的 Environment=BIND=:: 决定（IPv6 双栈）
  echo ">> [5/5] 完成 ✅ 已通过 systemd 启动，监听 [::]:${PORT}（IPv4/IPv6 双栈）"
else
  echo ">> [4/5] 用 nohup 后台启动（普通用户 / 无 systemd）..."
  pkill -f "app.py" 2>/dev/null || true
  BIND="${BIND:-::}" nohup ./venv/bin/python app.py > run.log 2>&1 &
  sleep 1
  echo ">> [5/5] 完成 ✅ 已在后台启动，日志 run.log，监听 ${BIND:-::}:${PORT}（IPv6 双栈）"
fi

# 防火墙：若服务器启用了 ufw，确保放行端口，并且让 ufw 同时管理 IPv6
# （否则即便应用监听了 ::，IPv6 入站仍会被默认策略丢弃）
if command -v ufw >/dev/null 2>&1; then
  echo ">> [防火墙] 放行 ${PORT}/tcp（ufw 存在时）..."
  if [ -f /etc/default/ufw ]; then
    sudo sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
  fi
  sudo ufw allow ${PORT}/tcp >/dev/null 2>&1 || true
  sudo ufw reload >/dev/null 2>&1 || true
  echo "   ufw 当前状态："; sudo ufw status verbose 2>/dev/null | sed 's/^/   /' || true
fi

echo "------------------------------------------------------------"
echo "浏览器访问："
echo "  IPv4 :  http://<服务器IPv4或域名>:${PORT}"
echo "  IPv6 :  http://[服务器全局IPv6或DDNS域名]:${PORT}"
echo "         （若用 IPv6 DDNS 域名，确认其 AAAA 记录指向本机全局 IPv6）"
echo "笔记数据：   $(pwd)/notes.db  (SQLite，可定期备份)"
echo "导出笔记：   页面左下角『📝 我的笔记』→ 导出 Markdown"
echo "------------------------------------------------------------"
echo "若 IPv6 公网仍连不上，在服务器上逐项排查："
echo "  1) sudo ss -tlnp | grep ${PORT}      # 应显示 :::${PORT}（双栈）；若显示 0.0.0.0:${PORT} 说明没生效"
echo "  2) curl -6 -s -o /dev/null -w '%{http_code}' http://[::1]:${PORT}   # 本机 IPv6 应返回 200"
echo "  3) dig +short AAAA 你的域名          # 应与 ip -6 addr 的全局地址一致"
echo "  4) 路由器需放行『入站 IPv6 → 服务器IPv6:${PORT}』（IPv6 是每地址放行，不是端口转发）"
