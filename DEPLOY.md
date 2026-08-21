# 装修防宰攻略 · 笔记版 —— 服务器部署教程（小白版）

这是一个 Flask 小项目：把完整装修攻略做成一个网页，每个知识点 / 工艺 / 材料后面都能写你自己的笔记，笔记存在服务器上的 `notes.db`（SQLite）。本教程教你把它跑在自己的服务器上，通过 **IPv6 DDNS 域名 + 端口** 访问。

---

## 〇、你需要准备什么

1. 一台能 SSH 登录的 Linux 服务器（Ubuntu / Debian / CentOS / 树莓派 / NAS 都行，下文以 Ubuntu 为例）。
2. 一个终端工具连服务器：Windows 用 **PowerShell / PuTTY / FinalShell**；Mac 用自带终端。
3. （可选）一个域名做 DDNS，解析到服务器的 IPv6 地址——这样你在外面也能用 `域名:端口` 访问。

> 不需要装数据库、不需要装 Nginx（除非你要 HTTPS）。Python 依赖一键脚本会自动装。

---

## 一、把项目弄到服务器上

我给你打包成了 `renovation_notes.tar.gz`。两种方式传到服务器：

**A. 用 scp（你电脑是 Windows，在 PowerShell 里跑）**
```powershell
# 把 路径\renovation_notes.tar.gz 传到服务器用户的家目录
scp 路径\renovation_notes.tar.gz 用户名@你的服务器地址:~/
```

**B. 用网盘 / QQ / U 盘**：把 `renovation_notes.tar.gz` 下载到本地，再传到服务器任意目录。

在**服务器上**解压：
```bash
cd ~
tar -xzf renovation_notes.tar.gz
cd renovation_notes
ls          # 应该看到 app.py、deploy.sh、guide_full.html、imgs/ 等
```

---

## 二、方式一：一键脚本部署（最省事，推荐）

在服务器上执行：
```bash
cd ~/renovation_notes
sudo bash deploy.sh
```
脚本会自动：① 装 python3-venv/pip → ② 建虚拟环境并装 Flask → ③ 初始化笔记库 → ④ 注册开机自启服务（如果你是 root 且有 systemd）→ 启动。

跑完最后会打印访问地址。直接跳到「四、访问」。

> 如果你**不是 root**（普通用户），脚本会自动改用 `nohup` 后台启动（不会开机自启，但重启后手动 `nohup ./venv/bin/python app.py > run.log 2>&1 &` 即可）。

---

## 三、方式二：手动部署（想看懂每一步）

```bash
cd ~/renovation_notes

# 1) 装系统依赖
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip

# 2) 建虚拟环境 + 装 Flask
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# 3) 初始化笔记数据库
./venv/bin/python -c "import db; db.init_db()"

# 4) 后台启动（监听 :: 即 IPv6 双栈，端口默认 5000）
nohup ./venv/bin/python app.py > run.log 2>&1 &

# 5) 看一眼有没有起来
sleep 2
cat run.log
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000
# 返回 200 就成功了
```

想开机自启？见文末「附：systemd 服务」。

---

## 四、IPv6 / DDNS 访问特别说明（重点！）

程序默认监听 `::`（IPv6 双栈），所以 IPv4 和 IPv6 都能访问。但**光程序监听不够，防火墙要放行端口**，而且 IPv6 经常被人忘。

### 1) 放行端口（以 5000 为例）

**Ubuntu / Debian（ufw）**
```bash
sudo ufw allow 5000/tcp
# 如果是 IPv6，确认 /etc/ufw/ufw.conf 里 IPV6=yes（默认就是）
```

**CentOS / Rocky（firewalld）**
```bash
sudo firewall-cmd --permanent --add-port=5000/tcp
sudo firewall-cmd --reload
```

**云厂商安全组**（阿里云/腾讯云/华为云控制台）：入方向加一条 TCP `5000` 端口放行，源 `::/0`（IPv6）和 `0.0.0.0/0`（IPv4）都加上。

### 2) 用 DDNS 域名访问

把你的 DDNS 域名（比如 `home.example.com`）的 **AAAA 记录**解析到服务器 IPv6 地址。然后浏览器打开：
```
http://你的DDNS域名:5000
```
就能用了。在外面（手机流量）也能开，前提是手机支持 IPv6（现在基本都支持）。

> 想换端口？启动前设环境变量：`PORT=8080 ./venv/bin/python app.py`；或一键脚本用 `PORT=8080 sudo bash deploy.sh`。

---

## 五、日常管理

| 想做 | 命令（在 ~/renovation_notes 下）|
|---|---|
| 看运行日志 | `cat run.log`（nohup） / `sudo journalctl -u renovation_notes -f`（systemd）|
| 重启服务 | `pkill -f app.py && nohup ./venv/bin/python app.py > run.log 2>&1 &`（nohup）<br>`sudo systemctl restart renovation_notes`（systemd）|
| **更新攻略内容** | 把你新生成的 `guide_full.html` 覆盖到本目录同名文件，重启服务即可（笔记代码不动）|
| **备份笔记** | 把 `notes.db` 复制走就行（纯文件，SQLite）|
| 导出笔记 | 网页左下角「📝 我的笔记」→ 导出 Markdown |

---

## 六、常见问题

**Q1：浏览器打不开 / 超时？**
- 先服务器本地 `curl http://127.0.0.1:5000` 看 200 没有——有说明程序 OK，是网络/防火墙问题。
- 检查防火墙和安全组是否放行该端口（IPv6 别漏）。
- DDNS 域名确认 AAAA 记录解析正确：`nslookup 你的域名` 或 `ping6 你的域名`。

**Q2：IPv6 连不上，但 IPv4 能连？**
- 确认程序监听 `::`（默认就是）。`ss -tlnp | grep 5000` 应看到 `:::5000`。
- 确认服务器有公网 IPv6 且 DDNS 解析到它。

**Q3：端口被占用？**
- `sudo lsof -i:5000` 看是谁；或换个端口 `PORT=8080 ...`。

**Q4：重启服务器后没自启？**
- 你是普通用户 nohup 启动的，本就不会自启。要么用 root 跑 `deploy.sh`（会注册 systemd），要么把启动命令写进 `~/.bashrc` 或 crontab `@reboot`。

---

## 附：systemd 开机自启（root 用户）

把 `renovation_notes.service` 里的 `__DIR__ / __USER__ / __PORT__` 换成真实值，或直接用脚本生成：
```bash
sudo sed "s|__DIR__|$(pwd)|g; s|__USER__|$(whoami)|g; s|__PORT__|5000|g" \
     renovation_notes.service > /etc/systemd/system/renovation_notes.service
sudo systemctl daemon-reload
sudo systemctl enable --now renovation_notes
sudo systemctl status renovation_notes
```

---

## 附：想要 HTTPS（可选，更安心）

IPv6 直连是 HTTP 明文。要上 HTTPS：装 Nginx 反代 + 免费证书（certbot）。
1. `sudo apt-get install -y nginx certbot python3-certbot-nginx`
2. 把 `nginx_renovation.conf` 的 `server_name` 改成你的域名，放到 `/etc/nginx/sites-available/`，软链到 `sites-enabled/`。
3. `sudo certbot --nginx -d 你的域名` 自动签证书。
4. `sudo nginx -t && sudo systemctl reload nginx`
之后用 `https://你的域名` 访问（80/443 端口，不用再带 5000）。
