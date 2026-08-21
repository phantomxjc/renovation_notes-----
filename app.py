"""装修防宰攻略 · 可记笔记版（Flask 小项目）。

- 读取 guide_full.html（由 build_html3.py 生成的完整攻略），在 </body> 前注入
  笔记组件（note.css / note.js），让每个知识点 / 工艺 / 材料后面都能记笔记。
- 笔记以 SQLite 持久化（db.py）。
- /imgs/<path> 提供本地工艺图片。
- /api/note  GET/POST  读写单条笔记
- /api/notes/export    导出全部笔记为 Markdown

运行：
    python app.py                 # 默认监听 :::5000（IPv6 双栈，IPv4/IPv6 均可访问）
    BIND=0.0.0.0 PORT=8080 python app.py   # 仅 IPv4、换端口的写法
"""
import os
import re
import base64
import uuid
import json
import hashlib
from urllib.parse import quote

from flask import (
    Flask,
    request,
    jsonify,
    send_from_directory,
    Response,
    session,
    redirect,
)
from datetime import timedelta
import config
import db

BASE = os.path.dirname(os.path.abspath(__file__))
GUIDE = os.path.join(BASE, "guide_full.html")
IMG_DIR = os.path.join(BASE, "imgs")
NOTES_IMGS_DIR = os.path.join(BASE, "notes_imgs")
os.makedirs(NOTES_IMGS_DIR, exist_ok=True)

NOTE_CSS = '<link rel="stylesheet" href="/static/note.css">'
NOTE_JS = '<script src="/static/note.js"></script>'

app = Flask(__name__, static_folder="static")
app.secret_key = os.environ.get("SECRET_KEY", config.SECRET_KEY)
app.permanent_session_lifetime = timedelta(days=config.SESSION_DAYS)
db.init_db()


@app.before_request
def require_login():
    """全站会话登录保护：未登录跳登录页，API/图片返回 401。"""
    path = request.path
    # 登录页、登出、favicon 直接放行
    if path in ("/login", "/logout") or path == "/favicon.ico":
        return None
    if session.get("user"):
        return None
    # 未登录：页面请求重定向到登录页；API / 图片返回 401 JSON
    if path.startswith(("/api/", "/imgs/", "/notes_imgs/")):
        return jsonify(ok=False, error="unauthorized"), 401
    return redirect("/login")


@app.route("/")
def index():
    with open(GUIDE, encoding="utf-8") as f:
        html = f.read()
    # 注入笔记组件（仅替换最后一个 </body>，保证在 body 闭合前）
    html = html.replace("</body>", NOTE_CSS + "\n" + NOTE_JS + "\n</body>", 1)
    return html


@app.route("/login", methods=["GET", "POST"])
def login():
    """登录封面页：GET 展示，POST 校验并设置会话。"""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if db.verify_user(username, password):
            session["user"] = username
            session.permanent = True
            return redirect("/")
        return render_login("账号或密码错误")
    return render_login()


def render_login(error=""):
    with open(os.path.join(BASE, "login.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace(
        "<title>登录 · 装修防宰攻略</title>",
        "<title>" + config.SITE_TITLE + "</title>",
        1,
    )
    return html.replace(
        '<p class="err" id="loginErr"></p>',
        '<p class="err" id="loginErr">' + error + "</p>",
        1,
    )


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/imgs/<path:filename>")
def serve_imgs(filename):
    return send_from_directory(IMG_DIR, filename)


@app.route("/notes_imgs/<path:filename>")
def serve_notes_imgs(filename):
    return send_from_directory(NOTES_IMGS_DIR, filename)


def _parse_items(content):
    """把 notes.content 解析成分条 items 列表；兼容旧版纯文本。"""
    if not content:
        return []
    if isinstance(content, list):
        return content
    try:
        obj = json.loads(content)
        if isinstance(obj, list):
            return obj
    except Exception:
        pass
    # 旧版：整段纯文本，作为单条
    return [{"text": content, "images": []}]


def _save_note_image(nid, data_url):
    """把 dataURL 图片存为文件，返回可访问路径 /notes_imgs/<nid>/<uuid>.<ext>。"""
    m = re.match(r"^data:image/(\w+);base64,(.+)$", data_url.strip(), re.I)
    if not m:
        return None
    ext = m.group(1).lower()
    if ext == "jpeg":
        ext = "jpg"
    if ext not in config.ALLOWED_IMG_EXT:
        ext = "png"
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception:
        return None
    if len(raw) > config.NOTE_IMG_MAX_MB * 1024 * 1024:  # 单张上限（来自 config）
        return None
    # 用 nid 的哈希做子目录名，避免 nid 含冒号/中文等非法路径字符（Windows 尤其敏感）
    sub_dir = hashlib.md5(nid.encode("utf-8")).hexdigest()
    sub = os.path.join(NOTES_IMGS_DIR, sub_dir)
    os.makedirs(sub, exist_ok=True)
    fname = uuid.uuid4().hex + "." + ext
    with open(os.path.join(sub, fname), "wb") as f:
        f.write(raw)
    return f"/notes_imgs/{sub_dir}/{fname}"


@app.route("/api/note/<path:nid>", methods=["GET"])
def api_get_note(nid):
    row = db.get_note(nid)
    links = []
    if row and row[2]:
        try:
            links = json.loads(row[2])
        except Exception:
            links = []
    items = _parse_items(row[0] if row else "")
    return jsonify(
        {
            "id": nid,
            "items": items,
            "updated_at": row[1] if row else None,
            "links": links,
        }
    )


@app.route("/api/note", methods=["POST"])
def api_save_note():
    data = request.get_json(force=True, silent=True) or {}
    nid = data.get("id")
    if not nid:
        return jsonify({"ok": False, "error": "missing id"}), 400
    # 分条笔记：每条 {text, images:[dataURL 或已存路径]}
    items = data.get("items")
    if not isinstance(items, list):
        items = []
    clean_items = []
    for it in items:
        if not isinstance(it, dict):
            continue
        text = str(it.get("text", "") or "")
        imgs = []
        for img in it.get("images", []) or []:
            img = str(img or "").strip()
            if not img:
                continue
            if img.startswith("/notes_imgs/"):
                imgs.append(img)  # 已存好的路径，原样保留
            elif img.startswith("data:image/"):
                path = _save_note_image(nid, img)
                if path:
                    imgs.append(path)
        if text.strip() or imgs:
            clean_items.append({"text": text, "images": imgs})
    # 链接：只保留非空字符串
    links = data.get("links") or []
    if not isinstance(links, list):
        links = []
    links = [str(x).strip() for x in links if str(x).strip()]
    now = db.save_note(nid, json.dumps(clean_items, ensure_ascii=False), links)
    return jsonify({"ok": True, "updated_at": now})


@app.route("/api/notes/export", methods=["GET"])
def api_export():
    notes = db.all_notes()
    md = "# 我的装修笔记\n\n> 由「装修防宰攻略 · 笔记版」导出\n\n"
    n = 0
    for item in notes:
        items = _parse_items(item.get("content"))
        links = item.get("links")
        try:
            links = json.loads(links) if isinstance(links, str) else (links or [])
        except Exception:
            links = []
        # 取出每张条的文字与图片数
        texts = [it.get("text", "") for it in items if (it.get("text") or "").strip()]
        imgs = sum(len(it.get("images", []) or []) for it in items)
        if not texts and not links and imgs == 0:
            continue
        n += 1
        md += f"## {item['id']}\n\n"
        for t in texts:
            md += t + "\n\n"
        if imgs:
            md += f"📎 含 {imgs} 张图片（见站点对应知识点）\n\n"
        if links:
            md += "**相关链接：**\n\n"
            for lk in links:
                md += f"- {lk}\n"
            md += "\n"
        md += f"*更新时间：{item['updated_at']}*\n\n---\n\n"
    if n == 0:
        md += "_还没有任何笔记。在每个知识点后面写下你的记录吧～_\n"
    # 中文文件名必须用 RFC 5987 编码，否则 HTTP 头 latin-1 报错
    fname = quote("我的装修笔记.md")
    return Response(
        md,
        mimetype="text/markdown; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + fname},
    )


if __name__ == "__main__":
    # 关闭 reloader 避免重复注入 / 重复启动；threaded=True 支持并发请求
    # BIND 默认 '::'（IPv6 双栈），仅需 IPv4 时设环境变量 BIND=0.0.0.0
    bind = os.environ.get("BIND", config.BIND)
    port = int(os.environ.get("PORT", str(config.PORT)))
    app.run(host=bind, port=port, debug=False, use_reloader=False, threaded=True)
