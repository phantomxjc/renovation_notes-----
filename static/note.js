/* 装修防宰攻略 · 笔记组件
 * 每个知识点后挂载「分条笔记」：可逐条添加、每条支持文字 + 粘贴图片；
 * 另有「相关链接」区。笔记与图片存到后端 SQLite + notes_imgs 目录。
 */
(function () {
  "use strict";

  // 简单字符串散列，生成稳定且唯一的笔记 id
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  // 用于 HTML 属性值（如 value="..." href="..."）的转义
  function escapeAttr(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // 取该元素的「可读标题」，用于「我的笔记」面板展示
  function titleOf(el) {
    if (el.classList.contains("mat-cat")) {
      var cn = el.querySelector(".cat-name");
      return "材料：" + (cn ? cn.textContent.trim() : "未知材料");
    }
    if (el.classList.contains("tech")) {
      var h4 = el.querySelector("h4");
      return "工艺：" + (h4 ? h4.textContent.trim() : "未知工艺");
    }
    var sum = el.querySelector("summary");
    return sum ? "要点：" + sum.textContent.trim() : "笔记";
  }

  // 前缀区分大类，避免跨类碰撞
  function prefixOf(el) {
    if (el.classList.contains("mat-cat")) return "mat";
    if (el.classList.contains("tech")) return "tech";
    if (el.classList.contains("sub")) return "sub";
    return "acc";
  }

  var boxes = []; // {id, title, box}

  // ===== 图片双击放大（灯箱）=====
  var lb = null;
  function ensureLightbox() {
    if (lb) return lb;
    lb = document.createElement("div");
    lb.className = "note-lightbox";
    lb.innerHTML = '<div class="lb-close" title="关闭 (Esc)">×</div><img alt="放大查看">';
    document.body.appendChild(lb);
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.classList.contains("lb-close")) closeLight();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && lb.classList.contains("open")) closeLight();
    });
    return lb;
  }
  function openLight(src) {
    var box = ensureLightbox();
    box.querySelector("img").src = src;
    box.classList.add("open");
  }
  function closeLight() {
    if (lb) lb.classList.remove("open");
  }

  function buildNote(el) {
    var title = titleOf(el);
    if (!title) return;
    var id = prefixOf(el) + ":" + hash(title);

    var box = document.createElement("div");
    box.className = "note-box";
    box.dataset.noteId = id;
    box.innerHTML =
      '<div class="note-head"><span>📝 我的笔记</span>' +
      '<span class="note-flag" title="已保存">●</span></div>' +
      '<div class="note-items"></div>' +
      '<button class="note-add-item" type="button">＋ 添加一条笔记</button>' +
      '<div class="note-actions"><button class="note-save" type="button">保存</button>' +
      '<span class="note-status"></span></div>' +
      '<div class="note-links-head"><span>🔗 相关链接</span>' +
      '<button class="note-link-add" type="button">＋ 添加链接</button></div>' +
      '<div class="note-links"></div>';

    // 插在被标注元素内部末尾：随 <details> 展开/收起一起显示或隐藏
    el.appendChild(box);

    var itemsWrap = box.querySelector(".note-items");
    var linksWrap = box.querySelector(".note-links");
    var status = box.querySelector(".note-status");
    var flag = box.querySelector(".note-flag");
    var btn = box.querySelector(".note-save");

    flag.style.opacity = "0";

    function markSaved(ts) {
      flag.style.opacity = "1";
      status.textContent = "已保存 " + (ts || "");
      status.className = "note-status ok";
    }
    function markUnsaved() {
      flag.style.opacity = "0.35";
    }

    // 新建一条笔记卡片
    function addItem(text, images) {
      var card = document.createElement("div");
      card.className = "note-item";
      card.innerHTML =
        '<div class="note-item-bar">' +
        '<span class="note-item-hint">在框内 Ctrl/⌘+V 可粘贴图片</span>' +
        '<button class="note-item-del" type="button" title="删除这条">×</button></div>' +
        '<textarea class="note-area" placeholder="写一条笔记…（可贴图）"></textarea>' +
        '<div class="note-imgs"></div>';
      var ta = card.querySelector(".note-area");
      var imgsWrap = card.querySelector(".note-imgs");
      ta.value = text || "";

      // 图片数组：保存时收集；渲染已存在的图片
      var imgList = (images || []).slice();
      function renderImgs() {
        imgsWrap.innerHTML = "";
        imgList.forEach(function (src, idx) {
          var fig = document.createElement("div");
          fig.className = "note-img";
          fig.innerHTML =
            '<img src="' + escapeAttr(src) + '" alt="笔记图片">' +
            '<button class="note-img-del" type="button" title="删除图片">×</button>';
          fig.querySelector(".note-img-del").addEventListener("click", function () {
            imgList.splice(idx, 1);
            renderImgs();
            saveAll();
          });
          var imgEl = fig.querySelector("img");
          imgEl.addEventListener("dblclick", function () { openLight(src); });
          if ("ontouchstart" in window) {
            imgEl.addEventListener("click", function () { openLight(src); });
          }
          imgsWrap.appendChild(fig);
        });
      }
      renderImgs();

      // 粘贴图片：从剪贴板取图，转 dataURL 暂存，触发保存
      ta.addEventListener("paste", function (e) {
        var items = (e.clipboardData || window.clipboardData || {}).items;
        if (!items) return;
        var handled = false;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf("image") === 0) {
            var blob = items[i].getAsFile();
            if (!blob) continue;
            handled = true;
            var reader = new FileReader();
            reader.onload = function () {
              imgList.push(reader.result); // dataURL，保存时由后端落盘
              renderImgs();
              saveAll();
            };
            reader.readAsDataURL(blob);
          }
        }
        if (handled) e.preventDefault();
      });

      ta.addEventListener("input", function () {
        markUnsaved();
        autoGrow(ta);
      });
      ta.addEventListener("blur", maybeSave);
      card.querySelector(".note-item-del").addEventListener("click", function () {
        card.remove();
        saveAll();
      });

      itemsWrap.appendChild(card);
      autoGrow(ta);
      return card;
    }

    // 收集全部笔记条 -> [{text, images}]
    function collectItems() {
      var arr = [];
      itemsWrap.querySelectorAll(".note-item").forEach(function (card) {
        var ta = card.querySelector(".note-area");
        var imgs = [];
        card.querySelectorAll(".note-img img").forEach(function (im) {
          imgs.push(im.getAttribute("src"));
        });
        arr.push({ text: ta.value, images: imgs });
      });
      return arr;
    }

    // 链接收集
    function collectLinks() {
      var arr = [];
      linksWrap.querySelectorAll(".note-link-input").forEach(function (inp) {
        var v = inp.value.trim();
        if (v) arr.push(v);
      });
      return arr;
    }

    function addLinkRow(url) {
      var row = document.createElement("div");
      row.className = "note-link-row";
      row.innerHTML =
        '<input class="note-link-input" type="url" placeholder="粘贴视频 / 文章链接…" value="' +
        escapeAttr(url || "") + '">' +
        '<a class="note-link-open" href="#" target="_blank" rel="noopener" title="打开链接">↗</a>' +
        '<button class="note-link-del" type="button" title="删除">×</button>';
      var inp = row.querySelector(".note-link-input");
      var open = row.querySelector(".note-link-open");
      function syncOpen() {
        var v = inp.value.trim();
        open.href = v ? v : "#";
        open.style.visibility = v ? "visible" : "hidden";
      }
      syncOpen();
      inp.addEventListener("input", syncOpen);
      inp.addEventListener("blur", saveAll);
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); saveAll(); }
      });
      open.addEventListener("click", function (e) {
        if (!inp.value.trim()) e.preventDefault();
      });
      row.querySelector(".note-link-del").addEventListener("click", function () {
        row.remove();
        saveAll();
      });
      linksWrap.appendChild(row);
      return row;
    }

    function autoGrow(ta) {
      if (ta.offsetParent === null) return; // 在收起的 <details> 内不可见，跳过
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }

    function saveAll() {
      var payload = { id: id, items: collectItems(), links: collectLinks() };
      fetch("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          if (r.status === 401) { location.reload(); return; }
          return r.json();
        })
        .then(function (d) {
          if (!d) return;
          if (d.ok) {
            markSaved(d.updated_at ? d.updated_at.slice(11) : "");
            if (panel && panel.classList.contains("open")) renderPanel();
          } else {
            status.textContent = "保存失败";
            status.className = "note-status err";
          }
        })
        .catch(function () {
          status.textContent = "保存失败（网络）";
          status.className = "note-status err";
        });
    }

    function maybeSave() {
      var items = collectItems();
      var links = collectLinks();
      var has = items.some(function (it) { return (it.text || "").trim() || (it.images || []).length; })
        || links.length;
      if (has) saveAll();
    }

    // 加载已有笔记（分条 + 图片）+ 链接
    fetch("/api/note/" + encodeURIComponent(id))
      .then(function (r) {
        if (r.status === 401) { location.reload(); return; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        var items = d.items || [];
        if (items.length === 0) addItem("", []);
        else items.forEach(function (it) { addItem(it.text || "", it.images || []); });
        markSaved(d.updated_at ? d.updated_at.slice(11) : "");
        var links = d.links || [];
        links.forEach(function (u) { addLinkRow(u); });
      })
      .catch(function () {});

    btn.addEventListener("click", saveAll);
    box.querySelector(".note-add-item").addEventListener("click", function () {
      var card = addItem("", []);
      card.querySelector(".note-area").focus();
      saveAll();
    });
    box.querySelector(".note-link-add").addEventListener("click", function () {
      var row = addLinkRow("");
      row.querySelector(".note-link-input").focus();
    });

    // <details> 展开时，把已存在的笔记撑到合适高度
    if (el.tagName === "DETAILS") {
      el.addEventListener("toggle", function () {
        if (el.open) {
          itemsWrap.querySelectorAll(".note-area").forEach(autoGrow);
        }
      });
    }

    boxes.push({ id: id, title: title, box: box });
  }

  // 「我的笔记」浮动面板
  var fab, panel;
  function buildPanel() {
    fab = document.createElement("button");
    fab.id = "noteFab";
    fab.type = "button";
    fab.textContent = "📝 我的笔记";

    panel = document.createElement("div");
    panel.id = "notePanel";
    panel.innerHTML =
      '<div class="np-head"><b>我的笔记</b>' +
      '<button id="npExp" type="button">导出 .md</button>' +
      '<button id="npClose" type="button">×</button></div>' +
      '<div class="np-body"></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.addEventListener("click", function () {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) renderPanel();
    });
    panel.querySelector("#npClose").addEventListener("click", function () {
      panel.classList.remove("open");
    });
    panel.querySelector("#npExp").addEventListener("click", function () {
      window.open("/api/notes/export", "_blank");
    });
  }

  function renderPanel() {
    var body = panel.querySelector(".np-body");
    body.innerHTML = "";
    var n = 0;
    boxes.forEach(function (b) {
      var texts = [];
      var imgCount = 0;
      b.box.querySelectorAll(".note-item").forEach(function (card) {
        var t = card.querySelector(".note-area").value.trim();
        if (t) texts.push(t);
        imgCount += card.querySelectorAll(".note-img img").length;
      });
      var lks = [];
      b.box.querySelectorAll(".note-link-input").forEach(function (inp) {
        var lv = inp.value.trim();
        if (lv) lks.push(lv);
      });
      if (!texts.length && !imgCount && !lks.length) return;
      n++;
      var item = document.createElement("div");
      item.className = "np-item";
      var html = '<div class="np-title">' + escapeHtml(b.title) + "</div>";
      if (texts.length) {
        html += '<div class="np-text">' + escapeHtml(texts.join("\n\n")) + "</div>";
      }
      if (imgCount) {
        html += '<div class="np-imgs">📎 ' + imgCount + " 张图片</div>";
      }
      if (lks.length) {
        html +=
          '<div class="np-links">🔗 ' +
          lks
            .map(function (u) {
              return (
                '<a href="' + escapeAttr(u) + '" target="_blank" rel="noopener">' +
                escapeHtml(u.length > 42 ? u.slice(0, 42) + "…" : u) + "</a>"
              );
            })
            .join(" ") +
          "</div>";
      }
      item.innerHTML = html;
      item.addEventListener("click", function () {
        b.box.scrollIntoView({ behavior: "smooth", block: "center" });
        b.box.classList.add("note-flash");
        setTimeout(function () { b.box.classList.remove("note-flash"); }, 1200);
      });
      body.appendChild(item);
    });
    if (n === 0) {
      body.innerHTML =
        '<div class="np-empty">还没有笔记。在每个知识点后面写下你的记录吧～</div>';
    }
    fab.textContent = "📝 我的笔记 (" + n + ")";
  }

  function scan() {
    var sels = "details.acc, details.sub, div.tech, details.mat-cat";
    document.querySelectorAll(sels).forEach(buildNote);
    buildPanel();
  }

  if (document.readyState !== "loading") scan();
  else document.addEventListener("DOMContentLoaded", scan);
})();
