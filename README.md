# 装修防宰攻略 · 笔记版

一个可以**边看攻略边记笔记**的本地小项目。装修里每一个知识点、每一道工艺、
每一种材料，后面都挂着一个输入框；你写的笔记存在本地 SQLite 里，关掉网页也不丢。

## 功能
- 阅读完整装修防宰攻略（基础知识 / 合同避坑 / 施工工艺图文 / 材料对比 / 注意事项）。
- 每个细节后都有「📝 我的笔记」输入框：报价、踩坑、待办、心得随便记。
- 笔记自动保存（失焦即存），右下角「我的笔记」面板汇总全部笔记、可一键导出 Markdown。
- 数据持久化在 `notes.db`（SQLite），纯本地，不上传。

## 运行
```bash
cd renovation_notes
pip install -r requirements.txt
python app.py
# 浏览器打开 http://127.0.0.1:5000
```

## 目录
```
renovation_notes/
├── app.py            # Flask 后端：页面注入 + 笔记 API + 图片服务
├── db.py             # SQLite 存储层
├── guide_full.html   # 完整攻略正文（由 build_html3.py 生成）
├── notes.db          # 笔记数据库（自动生成）
├── imgs/             # 27 张施工工艺图
├── static/
│   ├── note.js       # 前端笔记组件
│   └── note.css      # 笔记组件样式
└── requirements.txt
```

## 笔记 API
- `GET  /api/note/<id>`        读取某条笔记
- `POST /api/note`             保存笔记 `{id, content}`
- `GET  /api/notes/export`    导出全部笔记为 Markdown

## 更新攻略内容
攻略正文来自 `build_html3.py` 生成的 `装修防宰攻略_完全版.html`。
改完攻略后，把它复制/覆盖为本项目的 `guide_full.html` 即可，无需改代码。
