"""SQLite 笔记存储层。

笔记按「知识点 id」存储，id 由前端根据内容自动生成（稳定且唯一）。
表 notes: id(TEXT 主键) / content(TEXT) / updated_at(TEXT)
表 users: username(TEXT 主键) / password_hash(TEXT) —— 用于 Basic Auth 登录
"""
import os
import sqlite3
import json
import datetime

from werkzeug.security import generate_password_hash, check_password_hash
from config import USERNAME as DEFAULT_USER, PASSWORD as DEFAULT_PASS

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes.db")


def init_db():
    """建表（幂等），并兼容旧库补加 links 列。"""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS notes (
                   id TEXT PRIMARY KEY,
                   content TEXT,
                   updated_at TEXT
               )"""
        )
        # 旧版库可能没有 links 列，自动补上，避免部署后报错
        cols = [r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()]
        if "links" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN links TEXT")

        # 用户登录表
        conn.execute(
            """CREATE TABLE IF NOT EXISTS users (
                   username TEXT PRIMARY KEY,
                   password_hash TEXT
               )"""
        )
        # 默认账号，仅当不存在时写入
        default_user = DEFAULT_USER
        default_pass = DEFAULT_PASS
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username=?", (default_user,)
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO users(username, password_hash) VALUES(?,?)",
                (default_user, generate_password_hash(default_pass)),
            )

        conn.commit()
    finally:
        conn.close()


def get_user(username):
    """返回 (username, password_hash) 或 None。"""
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            "SELECT username, password_hash FROM users WHERE username=?", (username,)
        ).fetchone()
    finally:
        conn.close()
    return row


def verify_user(username, password):
    """验证账号密码。"""
    row = get_user(username)
    if not row:
        return False
    return check_password_hash(row[1], password)


def set_password(username, password):
    """修改某账号密码（账号不存在则创建）。返回是否成功。"""
    try:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO users(username, password_hash) VALUES(?,?)",
                (username, generate_password_hash(password)),
            )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception:
        return False


def get_note(nid):
    """返回 (content, updated_at, links) 或 None。"""
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            "SELECT content, updated_at, links FROM notes WHERE id=?", (nid,)
        ).fetchone()
    finally:
        conn.close()
    return row


def save_note(nid, content, links=None):
    """新增或覆盖一条笔记（含链接），返回 updated_at 时间戳。"""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if links is None:
        links = []
    links_json = json.dumps(links, ensure_ascii=False)
    conn = sqlite3.connect(DB_PATH)
    try:
        # INSERT OR REPLACE 兼容各种 SQLite 版本，无需 ON CONFLICT 语法
        conn.execute(
            "INSERT OR REPLACE INTO notes(id, content, updated_at, links) VALUES(?,?,?,?)",
            (nid, content, now, links_json),
        )
        conn.commit()
    finally:
        conn.close()
    return now


def all_notes():
    """返回全部笔记，按更新时间倒序。"""
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT id, content, updated_at, links FROM notes ORDER BY updated_at DESC"
        ).fetchall()
    finally:
        conn.close()
    return [
        {"id": r[0], "content": r[1], "updated_at": r[2], "links": r[3]}
        for r in rows
    ]


def count_notes():
    """有内容或有链接的笔记数量。"""
    return sum(
        1
        for n in all_notes()
        if (n["content"] or "").strip() or (n.get("links") or "").strip()
    )
