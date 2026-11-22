/* ============================================================
   存储层：Supabase 云端版。
   日记、标签、日记本 → records 表（每条一行，内容是 JSON）
   照片 → photos 存储桶，路径是 “用户ID/照片ID.jpg”
   界面代码只调用 all / get / put / putMany / del / photoData，
   不直接碰 Supabase，以后换存储也只改这里。
   ============================================================ */
const Store = (() => {
  const cfg = window.JOURNAL_CONFIG || {};
  const sb = window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const PAGE = 1000;
  const SIGNED_TTL = 60 * 60 * 24; // 照片临时链接有效 24 小时
  let userId = null;
  const keyOf = (store, obj) => store === 'meta' ? obj.key : obj.id;
  const photoPath = id => `${userId}/${id}.jpg`;
  const check = ({ data, error }) => { if (error) throw error; return data; };

  function dataURLToBlob(url) {
    const [head, b64] = url.split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const blobToDataURL = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  return {
    client: sb,
    ready: !!sb,
    setUser(id) { userId = id; },

    async all(store) {
      const out = [];
      for (let from = 0; ; from += PAGE) {
        const rows = check(await sb.from('records').select('data').eq('store', store).order('id').range(from, from + PAGE - 1));
        out.push(...rows.map(r => r.data));
        if (rows.length < PAGE) break;
      }
      return out;
    },
    async get(store, key) {
      if (store === 'photos') {
        const res = check(await sb.storage.from('photos').createSignedUrl(photoPath(key), SIGNED_TTL));
        return { id: key, data: res.signedUrl };
      }
      const row = check(await sb.from('records').select('data').eq('store', store).eq('id', key).maybeSingle());
      return row ? row.data : undefined;
    },
    async put(store, obj) {
      if (store === 'photos') {
        check(await sb.storage.from('photos').upload(photoPath(obj.id), dataURLToBlob(obj.data), { contentType: 'image/jpeg', upsert: true }));
        return;
      }
      check(await sb.from('records').upsert(
        { user_id: userId, store, id: keyOf(store, obj), data: obj, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,store,id' }));
    },
    async putMany(store, list) {
      for (let i = 0; i < list.length; i += 300) {
        const rows = list.slice(i, i + 300).map(obj => ({ user_id: userId, store, id: keyOf(store, obj), data: obj, updated_at: new Date().toISOString() }));
        check(await sb.from('records').upsert(rows, { onConflict: 'user_id,store,id' }));
      }
    },
    async del(store, key) {
      if (store === 'photos') { check(await sb.storage.from('photos').remove([photoPath(key)])); return; }
      check(await sb.from('records').delete().eq('store', store).eq('id', key));
    },
    // 导出备份时用：把照片下载回来，转成可以放进 JSON 的文本
    async photoData(id) {
      const blob = check(await sb.storage.from('photos').download(photoPath(id)));
      return blobToDataURL(blob);
    },
  };
})();

/* ---------- 小工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const RIBBON = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M1 0h10v16l-5-4-5 4z" fill="currentColor"/></svg>';
const RIBBON_LINE = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M1.5.5h9v14.2L6 11.2 1.5 14.7z" fill="none" stroke="currentColor"/></svg>';
const VIEWS = [
  { id: 'timeline', label: '时间线' },
  { id: 'y3', label: '三年日记', years: 3, name: '三年' },
  { id: 'y5', label: '五年日记', years: 5, name: '五年' },
];

function countWords(text) {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9À-ɏ']+/g) || []).length;
  return cjk + latin;
}

/* ---------- 状态 ---------- */
const state = {
  entries: [], tags: [], notebooks: [],
  view: 'timeline',          // timeline | y3 | y5
  notebook: null,            // null = 全部日记本
  tag: null,                 // null = 不按标签筛选
  query: '',
  anchor: dayKey(new Date()), // 三年/五年日记看的是哪一天
  editing: null,
  editTags: false, editNotebooks: false, addingNotebook: false,
  photoCache: new Map(),
};
const tagById = id => state.tags.find(t => t.id === id);
const tagName = id => (tagById(id) || {}).name || '';
const nbById = id => state.notebooks.find(n => n.id === id);
const sortedNotebooks = () => [...state.notebooks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
const defaultNotebookId = () => (sortedNotebooks()[0] || {}).id;

async function photoURL(id) {
  if (state.photoCache.has(id)) return state.photoCache.get(id);
  let url = '';
  try { const p = await Store.get('photos', id); url = p ? p.data : ''; } catch (err) { console.warn('照片读取失败', id, err); }
  state.photoCache.set(id, url);
  return url;
}
function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async img => { img.src = await photoURL(img.dataset.photo); });
}

/* 把照片缩到长边 1600px、JPEG 压缩，一张通常 200–400KB */
function compressImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`读不了“${file.name}”。如果是 iPhone 的 HEIC 照片，请先在 Safari 里打开，或者把照片导出成 JPG。`)); };
    img.src = url;
  });
}

/* ---------- 筛选：日记本 × 标签 × 搜索 ---------- */
function filtered() {
  const q = state.query.trim().toLowerCase().replace(/^#/, '');
  return state.entries.filter(e => {
    if (state.notebook && e.notebookId !== state.notebook) return false;
    if (state.tag && !e.tags.includes(state.tag)) return false;
    if (q) {
      const hay = (e.title + '\n' + e.body + '\n' + e.tags.map(tagName).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function stats() {
  const days = new Set(state.entries.map(e => e.date.slice(0, 10)));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  const y = String(new Date().getFullYear());
  const thisYear = state.entries.filter(e => e.date.startsWith(y)).length;
  const words = state.entries.reduce((s, e) => s + countWords(e.title + ' ' + e.body), 0);
  return { streak, thisYear, words };
}

/* ---------- 渲染：侧栏 ---------- */
function renderSide() {
  // 浏览方式
  $('#views').innerHTML = VIEWS.map(v =>
    `<li><button type="button" data-view="${v.id}" aria-current="${state.view === v.id}"><span>${v.label}</span></button></li>`).join('');

  // 日记本
  const nbCount = new Map();
  state.entries.forEach(e => nbCount.set(e.notebookId, (nbCount.get(e.notebookId) || 0) + 1));
  const nbs = sortedNotebooks();
  let nbHTML = '';
  if (state.editNotebooks) {
    nbHTML = nbs.map(n => `<li class="edit-row">
      <label class="sr-only" for="nb-name-${n.id}">日记本名称</label>
      <input id="nb-name-${n.id}" data-nbrename="${n.id}" value="${esc(n.name)}">
      <button type="button" data-delnb="${n.id}" ${nbs.length < 2 ? 'disabled title="至少要保留一个日记本"' : ''} aria-label="删除日记本 ${esc(n.name)}">删除</button></li>`).join('');
  } else {
    nbHTML = `<li><button type="button" data-nb="" aria-current="${!state.notebook}"><span>全部日记</span><span class="n">${state.entries.length}</span></button></li>`
      + nbs.map(n => `<li><button type="button" data-nb="${n.id}" aria-current="${state.notebook === n.id}"><span>${esc(n.name)}</span><span class="n">${nbCount.get(n.id) || 0}</span></button></li>`).join('');
  }
  if (state.addingNotebook) {
    nbHTML += `<li class="edit-row"><label class="sr-only" for="new-nb">新日记本名称</label><input id="new-nb" placeholder="新日记本名称，回车确定" autocomplete="off"></li>`;
  }
  $('#notebook-list').innerHTML = nbHTML;
  $('#toggle-nb-edit').textContent = state.editNotebooks ? '完成' : '编辑';

  // 标签
  const counts = new Map();
  state.entries.forEach(e => e.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = [...state.tags].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh'));
  const list = $('#tag-list');
  if (!tags.length) {
    list.innerHTML = '<li><p class="muted">写日记时加上标签，就会出现在这里。</p></li>';
  } else if (state.editTags) {
    list.innerHTML = tags.map(t => `<li class="edit-row">
      <label class="sr-only" for="tag-name-${t.id}">标签名称</label>
      <input id="tag-name-${t.id}" data-rename="${t.id}" value="${esc(t.name)}">
      <button type="button" data-deltag="${t.id}" aria-label="删除标签 ${esc(t.name)}">删除</button></li>`).join('');
  } else {
    list.innerHTML = tags.map(t =>
      `<li><button type="button" data-tag="${t.id}" aria-current="${state.tag === t.id}" title="${state.tag === t.id ? '再点一次取消筛选' : '只看这个标签'}"><span>#${esc(t.name)}</span><span class="n">${counts.get(t.id) || 0}</span></button></li>`).join('');
  }
  $('#toggle-tag-edit').textContent = state.editTags ? '完成' : '编辑';
  $('#toggle-tag-edit').hidden = !tags.length;

  const s = stats();
  $('#stats').innerHTML = `
    <div class="stat"><b>${s.streak}</b><span>连续天数</span></div>
    <div class="stat"><b>${s.thisYear}</b><span>今年篇数</span></div>
    <div class="stat"><b>${s.words >= 10000 ? (s.words / 10000).toFixed(1) + '万' : s.words}</b><span>总字数</span></div>`;
}

/* ---------- 渲染：主区 ---------- */
function contextLabel() {
  const parts = [state.notebook ? (nbById(state.notebook) || {}).name : '全部日记'];
  if (state.tag) parts.push('#' + tagName(state.tag));
  if (state.query.trim()) parts.push(`搜索“${state.query.trim()}”`);
  return parts.join(' · ');
}
function nbBadge(e) {
  if (state.notebook || state.notebooks.length < 2) return '';
  const nb = nbById(e.notebookId);
  return nb ? `<span class="nb">${esc(nb.name)}</span>` : '';
}
function thumbsHTML(e) {
  const photos = e.photos || [];
  const shown = photos.slice(0, 3);
  if (!shown.length) return '';
  return `<div class="thumbs n${shown.length}">${shown.map((p, i) =>
    `<div class="thumb"><img data-photo="${p}" alt="">${i === 2 && photos.length > 3 ? `<span class="more">+${photos.length - 3}</span>` : ''}</div>`).join('')}</div>`;
}
function tagsHTML(e, withNb) {
  const nb = withNb ? nbBadge(e) : '';
  if (!e.tags.length && !nb) return '';
  return `<div class="meta">${nb}${e.tags.map(t => `<span class="tag">#${esc(tagName(t))}</span>`).join('')}</div>`;
}
function ariaLabel(e) {
  const d = new Date(e.date);
  return esc(`${e.title || e.body.slice(0, 20) || '没有文字的日记'}，${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`);
}

function entryHTML(e) {
  const d = new Date(e.date);
  return `<article class="entry" data-id="${e.id}" tabindex="0" aria-label="${ariaLabel(e)}">
    <div class="e-date"><span class="day">${d.getDate()}</span><span class="wk">${WEEK[d.getDay()]}</span><span class="tm">${pad(d.getHours())}:${pad(d.getMinutes())}</span></div>
    <div class="entry-body">
      ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}
      ${e.body.trim() ? `<p class="preview">${esc(e.body.trim())}</p>` : ''}
      ${thumbsHTML(e)}${tagsHTML(e, true)}
    </div>
    ${e.bookmarked ? `<span class="ribbon" title="已收藏">${RIBBON}</span>` : ''}
  </article>`;
}
function yearEntryHTML(e) {
  const d = new Date(e.date);
  return `<article class="entry yentry" data-id="${e.id}" tabindex="0" aria-label="${ariaLabel(e)}">
    <div class="y-time"><span>${pad(d.getHours())}:${pad(d.getMinutes())}</span>${nbBadge(e)}</div>
    ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}
    ${e.body.trim() ? `<p class="preview">${esc(e.body.trim())}</p>` : ''}
    ${thumbsHTML(e)}${tagsHTML(e, false)}
    ${e.bookmarked ? `<span class="ribbon" title="已收藏">${RIBBON}</span>` : ''}
  </article>`;
}

function renderBanner() {
  const sampleTag = state.tags.find(t => t.sample);
  const hasSamples = sampleTag && state.entries.some(e => e.tags.includes(sampleTag.id));
  $('#banner-slot').innerHTML = hasSamples
    ? `<div class="banner"><span>带 #示例 的是演示用的日记，看完可以一键删掉。</span><button type="button" class="btn ghost" id="clear-samples">删除示例</button></div>` : '';
}

function renderTimeline(list) {
  $('#view-title').innerHTML = `${esc(contextLabel())}<span class="count">时间线 · ${list.length} 篇</span>`;
  const tl = $('#timeline');
  if (!list.length) {
    tl.innerHTML = state.entries.length
      ? `<div class="empty"><p>没有符合条件的日记。</p><button type="button" class="btn ghost" id="clear-filters">查看全部日记</button></div>`
      : `<div class="empty"><p>还没有日记。</p><button type="button" class="btn" id="empty-new">写第一篇</button></div>`;
    return;
  }
  list.sort((a, b) => b.date.localeCompare(a.date));
  let html = '', current = '';
  for (const e of list) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== current) {
      if (current) html += '</section>';
      current = key;
      html += `<section><div class="month"><h3>${d.getFullYear()} · ${MONTH_CN[d.getMonth()]}</h3></div>`;
    }
    html += entryHTML(e);
  }
  tl.innerHTML = html + '</section>';
  hydratePhotos(tl);
}

function renderYears(list, view) {
  const [ay, am, ad] = state.anchor.split('-').map(Number);
  const md = state.anchor.slice(5);
  const today = dayKey(new Date());
  let shown = 0, html = `<div class="daynav">
    <button type="button" data-shift="-1" aria-label="前一天">‹ 前一天</button>
    <label class="sr-only" for="anchor">选择日期</label>
    <input type="date" id="anchor" value="${state.anchor}">
    <button type="button" data-shift="1" aria-label="后一天">后一天 ›</button>
    ${state.anchor !== today ? '<button type="button" id="to-today">回到今天</button>' : ''}
    <span class="hint">键盘 ← → 翻页</span>
  </div>`;
  for (let i = 0; i < view.years; i++) {
    const y = ay - i;
    const date = new Date(y, am - 1, ad);
    const exists = date.getMonth() === am - 1;   // 2月29日在平年不存在
    const key = `${y}-${md}`;
    const items = exists ? list.filter(e => e.date.slice(0, 10) === key).sort((a, b) => a.date.localeCompare(b.date)) : [];
    shown += items.length;
    let body;
    if (!exists) body = `<div class="slot-empty">这一年没有 2 月 29 日。</div>`;
    else if (items.length) body = items.map(yearEntryHTML).join('');
    else body = `<div class="slot-empty"><span>这一天没有写日记。</span>${key <= today ? `<button type="button" class="slot-write" data-write="${key}">${key === today ? '现在写' : '补写这一天'}</button>` : ''}</div>`;
    html += `<section class="yrow${key === today ? ' now' : ''}" aria-label="${y}年">
      <div class="y-label"><span class="y">${y}</span>${exists ? `<span class="wk">${WEEK[date.getDay()]}</span>` : ''}</div>
      <div class="y-entries">${body}</div></section>`;
  }
  $('#view-title').innerHTML = `${am}月${ad}日<span class="count">${view.name}日记 · ${esc(contextLabel())} · ${shown} 篇</span>`;
  const tl = $('#timeline');
  tl.innerHTML = html;
  hydratePhotos(tl);
}

function renderMain() {
  renderBanner();
  const list = filtered();
  const view = VIEWS.find(v => v.id === state.view);
  if (view.years) renderYears(list, view); else renderTimeline(list);
}
function render() { renderSide(); renderMain(); }

/* ---------- 编辑器 ---------- */
function newEntry(date) {
  return {
    id: uid(), date: date || localISO(new Date()), title: '', body: '', tags: [], photos: [], bookmarked: false,
    notebookId: state.notebook || defaultNotebookId(),
    createdAt: new Date().toISOString(), updatedAt: null,
  };
}
function openEditor(entry, isNew) {
  state.editing = { e: JSON.parse(JSON.stringify(entry)), isNew, added: [], removed: [], suggestIndex: 0 };
  renderEditor();
  $('#editor').hidden = false;
  (isNew ? $('#ed-body') : $('#ed-title')).focus();
  autosize();
}
function renderEditor() {
  const { e, isNew } = state.editing;
  const nbOptions = sortedNotebooks().map(n => `<option value="${n.id}" ${n.id === e.notebookId ? 'selected' : ''}>${esc(n.name)}</option>`).join('');
  $('#editor').innerHTML = `
  <div class="sheet" role="dialog" aria-modal="true" aria-label="${isNew ? '写日记' : '编辑日记'}">
    <div class="sheet-bar">
      <div class="bar-left">
        <label class="sr-only" for="ed-date">日期和时间</label>
        <input type="datetime-local" id="ed-date" value="${e.date}">
        <label class="sr-only" for="ed-notebook">放进哪个日记本</label>
        <select id="ed-notebook" class="nb-select">${nbOptions}</select>
      </div>
      <div class="bar-actions">
        <button type="button" class="icon-btn" id="ed-mark" aria-pressed="${e.bookmarked}">${e.bookmarked ? RIBBON : RIBBON_LINE}<span>${e.bookmarked ? '已收藏' : '收藏'}</span></button>
        ${isNew ? '' : '<button type="button" class="text-btn danger" id="ed-del">删除</button>'}
        <button type="button" class="btn" id="ed-done" title="Esc 或 ⌘↵">完成</button>
      </div>
    </div>
    <label class="sr-only" for="ed-title">标题</label>
    <input id="ed-title" class="ed-title" placeholder="标题（可以不写）" value="${esc(e.title)}" autocomplete="off">
    <label class="sr-only" for="ed-body">正文</label>
    <textarea id="ed-body" class="ed-body" placeholder="今天发生了什么……">${esc(e.body)}</textarea>

    <div class="ed-section">
      <p class="ed-label">照片</p>
      <div class="ed-photos" id="ed-photos"></div>
      <input type="file" id="ed-file" accept="image/*" multiple hidden>
    </div>

    <div class="ed-section">
      <p class="ed-label"><label for="ed-taginput">标签</label></p>
      <div class="tag-field" id="tag-field">
        <span id="ed-chips" style="display:contents"></span>
        <input id="ed-taginput" class="tag-input" placeholder="输入标签，回车添加" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ed-suggest">
        <ul class="suggest" id="ed-suggest" role="listbox" hidden></ul>
      </div>
    </div>

    <div class="sheet-foot"><span id="ed-words"></span><span>${e.updatedAt ? '上次修改 ' + new Date(e.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '关闭时自动保存'}</span></div>
  </div>`;
  renderEdPhotos();
  renderEdChips();
  updateWords();
}
function renderEdPhotos() {
  const { e } = state.editing;
  const box = $('#ed-photos');
  box.innerHTML = e.photos.map(p => `<div class="ed-photo"><img data-photo="${p}" data-zoom="${p}" alt="日记照片"><button type="button" data-rmphoto="${p}" aria-label="移除这张照片">×</button></div>`).join('')
    + `<label class="add-photo" for="ed-file" id="add-photo" tabindex="0">＋<br>添加照片</label>`;
  hydratePhotos(box);
}
function renderEdChips() {
  const { e } = state.editing;
  $('#ed-chips').innerHTML = e.tags.map(id => `<span class="chip">#${esc(tagName(id))}<button type="button" data-rmtag="${id}" aria-label="移除标签 ${esc(tagName(id))}">×</button></span>`).join('');
}
function updateWords() {
  const { e } = state.editing;
  $('#ed-words').textContent = `${countWords(e.title + ' ' + e.body)} 字`;
}
function autosize() {
  const ta = $('#ed-body');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(240, ta.scrollHeight) + 'px';
}

function suggestions(value) {
  const { e } = state.editing;
  const raw = value.trim().replace(/^#/, '');
  const v = raw.toLowerCase();
  const matches = state.tags.filter(t => !e.tags.includes(t.id) && (!v || t.name.toLowerCase().includes(v))).slice(0, 8);
  const out = matches.map(t => ({ type: 'tag', id: t.id, label: '#' + t.name }));
  if (v && !state.tags.some(t => t.name.toLowerCase() === v)) out.push({ type: 'new', name: raw, label: `新建标签“${raw}”` });
  return out;
}
function renderSuggest() {
  const input = $('#ed-taginput');
  const ul = $('#ed-suggest');
  if (!input) return;
  const items = suggestions(input.value);
  state.editing.items = items;
  if (!items.length || document.activeElement !== input) { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  state.editing.suggestIndex = Math.min(state.editing.suggestIndex, items.length - 1);
  ul.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === state.editing.suggestIndex}"><button type="button" tabindex="-1" data-sug="${i}" class="${i === state.editing.suggestIndex ? 'active' : ''}">${esc(it.label)}</button></li>`).join('');
  ul.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
async function createTag(name) {
  name = name.trim().replace(/^#/, '').trim();
  if (!name) return null;
  const existing = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const tag = { id: uid(), name, createdAt: new Date().toISOString() };
  await Store.put('tags', tag);
  state.tags.push(tag);
  return tag.id;
}
async function applySuggestion(it) {
  const { e } = state.editing;
  const id = it.type === 'tag' ? it.id : await createTag(it.name);
  if (id && !e.tags.includes(id)) e.tags.push(id);
  $('#ed-taginput').value = '';
  state.editing.suggestIndex = 0;
  renderEdChips();
  renderSuggest();
}

async function addPhotos(files) {
  const ed = state.editing;
  const btn = $('#add-photo');
  btn.classList.add('busy');
  btn.innerHTML = '处理中…';
  for (const file of files) {
    try {
      const data = await compressImage(file);
      const id = uid();
      await Store.put('photos', { id, data, createdAt: new Date().toISOString() });
      state.photoCache.set(id, data);
      ed.e.photos.push(id);
      ed.added.push(id);
    } catch (err) {
      toast(err.message || '这张照片没能添加', 5000);
    }
  }
  renderEdPhotos();
}

async function saveEditor() {
  const ed = state.editing;
  if (!ed) return;
  const e = ed.e;
  e.title = e.title.trim();
  const empty = !e.title && !e.body.trim() && !e.photos.length;
  if (ed.isNew && empty) {
    for (const p of ed.added) await Store.del('photos', p);
    closeEditor();
    return;
  }
  const original = state.entries.find(x => x.id === e.id);
  const changed = !original || JSON.stringify({ ...original, updatedAt: null }) !== JSON.stringify({ ...e, updatedAt: null });
  if (changed) {
    const prevUpdated = e.updatedAt;
    e.updatedAt = new Date().toISOString();
    try {
      await Store.put('entries', e);
    } catch (err) {
      e.updatedAt = prevUpdated;
      toast('没能保存，可能是网络断了。内容还在编辑页里，联网后再点“完成”。', 6000);
      return;
    }
    for (const p of ed.removed) { try { await Store.del('photos', p); } catch (err) {} state.photoCache.delete(p); }
    const i = state.entries.findIndex(x => x.id === e.id);
    if (i >= 0) state.entries[i] = e; else state.entries.push(e);
  }
  closeEditor();
  render();
  if (ed.isNew) toast('已保存');
}
function closeEditor() {
  const id = state.editing && state.editing.e.id;
  state.editing = null;
  $('#editor').hidden = true;
  $('#editor').innerHTML = '';
  const card = id && document.querySelector(`.entry[data-id="${id}"]`);
  if (card) card.focus({ preventScroll: true });
}
async function deleteEntry(id) {
  const e = state.entries.find(x => x.id === id) || (state.editing && state.editing.e);
  await Store.del('entries', id);
  for (const p of (e.photos || [])) { try { await Store.del('photos', p); } catch (err) {} state.photoCache.delete(p); }
  if (state.editing) for (const p of state.editing.added) { try { await Store.del('photos', p); } catch (err) {} }
  state.entries = state.entries.filter(x => x.id !== id);
}

/* ---------- 日记本 ---------- */
async function createNotebook(name) {
  name = name.trim();
  if (!name) return;
  if (state.notebooks.some(n => n.name === name)) { toast('已经有同名的日记本了'); return; }
  const maxOrder = Math.max(0, ...state.notebooks.map(n => n.order ?? 0));
  const nb = { id: uid(), name, order: maxOrder + 1, createdAt: new Date().toISOString() };
  await Store.put('notebooks', nb);
  state.notebooks.push(nb);
  state.notebook = nb.id;
  toast(`已新建日记本“${name}”`);
}
async function finishAddingNotebook(save) {
  if (!state.addingNotebook) return;
  const input = $('#new-nb');
  const value = input ? input.value : '';
  state.addingNotebook = false;
  if (save && value.trim()) await createNotebook(value);
  render();
}
async function deleteNotebook(id) {
  const nb = nbById(id);
  const others = sortedNotebooks().filter(n => n.id !== id);
  if (!others.length) return;
  const target = others[0];
  const inside = state.entries.filter(e => e.notebookId === id);
  const msg = inside.length
    ? `删除日记本“${nb.name}”？里面的 ${inside.length} 篇日记会移到“${target.name}”，不会被删掉。`
    : `删除日记本“${nb.name}”？`;
  if (!await askConfirm(msg, '删除日记本')) return;
  for (const e of inside) { e.notebookId = target.id; await Store.put('entries', e); }
  await Store.del('notebooks', id);
  state.notebooks = state.notebooks.filter(n => n.id !== id);
  if (state.notebook === id) state.notebook = null;
  render();
}

/* ---------- 通用：确认框 / 提示 / 大图 ---------- */
function askConfirm(message, okLabel = '确定', danger = true) {
  return new Promise(resolve => {
    const box = $('#confirm');
    box.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cf-msg">
      <p id="cf-msg">${esc(message)}</p>
      <div class="row"><button type="button" class="btn ghost" id="cf-no">取消</button><button type="button" class="btn ${danger ? 'danger' : ''}" id="cf-yes">${esc(okLabel)}</button></div></div>`;
    box.hidden = false;
    $('#cf-no').focus();
    const done = v => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } };
    document.addEventListener('keydown', onKey, true);
    $('#cf-no').onclick = () => done(false);
    $('#cf-yes').onclick = () => done(true);
    box.onclick = ev => { if (ev.target === box) done(false); };
  });
}
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function showLightbox(src) {
  const lb = $('#lightbox');
  $('img', lb).src = src;
  lb.hidden = false;
}

/* ---------- 备份 ---------- */
async function exportData() {
  const ids = [...new Set(state.entries.flatMap(e => e.photos || []))];
  const photos = [];
  for (let i = 0; i < ids.length; i++) {
    toast(`正在打包照片 ${i + 1} / ${ids.length}……`, 60000);
    try { photos.push({ id: ids[i], data: await Store.photoData(ids[i]) }); }
    catch (err) { console.warn('照片导出失败', ids[i], err); }
  }
  const data = {
    app: 'paper-journal', version: 2, exportedAt: new Date().toISOString(),
    notebooks: state.notebooks, entries: state.entries, tags: state.tags, photos,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `日记备份-${dayKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`已导出 ${state.entries.length} 篇日记、${data.photos.length} 张照片`);
}
async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('这个文件不是有效的备份文件', 4000); return; }
  if (!data || data.app !== 'paper-journal' || !Array.isArray(data.entries)) { toast('这个文件不是纸页日记的备份', 4000); return; }
  const ok = await askConfirm(`备份里有 ${data.entries.length} 篇日记。导入后会和现有日记合并，同一篇日记会被备份里的版本覆盖。`, '导入', false);
  if (!ok) return;
  const photos = data.photos || [];
  let failed = 0;
  try {
    for (let i = 0; i < photos.length; i++) {
      toast(`正在上传照片 ${i + 1} / ${photos.length}……`, 60000);
      try { await Store.put('photos', photos[i]); } catch (err) { failed++; console.warn('照片上传失败', photos[i].id, err); }
    }
    toast('正在保存日记……', 60000);
    // 云端自动建的空“日记”本，如果和备份里的同名，就删掉空的那个，避免出现两个同名日记本
    const incoming = data.notebooks || [];
    for (const n of state.notebooks) {
      const dup = !incoming.some(x => x.id === n.id) && incoming.some(x => x.name === n.name);
      if (dup && !state.entries.some(e => e.notebookId === n.id)) await Store.del('notebooks', n.id);
    }
    await Store.putMany('notebooks', incoming);
    await Store.putMany('tags', data.tags || []);
    await Store.putMany('entries', data.entries);
  } catch (err) {
    toast('导入中途失败了：' + (err.message || '网络问题') + '。可以再导入一次，已经导入的不会重复。', 8000);
    await loadAll(); render();
    return;
  }
  state.photoCache.clear();
  await loadAll();
  render();
  toast(`已导入 ${data.entries.length} 篇日记${failed ? `，有 ${failed} 张照片没传上去` : ''}`, 5000);
}

/* ---------- 读取 + 补齐旧数据 ---------- */
async function loadAll() {
  state.notebooks = await Store.all('notebooks');
  if (!state.notebooks.length) {
    const nb = { id: uid(), name: '日记', order: 0, createdAt: new Date().toISOString() };
    await Store.put('notebooks', nb);
    state.notebooks = [nb];
  }
  const fallback = defaultNotebookId();
  const ids = new Set(state.notebooks.map(n => n.id));
  state.tags = await Store.all('tags');
  state.entries = [];
  for (const raw of await Store.all('entries')) {
    const e = { tags: [], photos: [], bookmarked: false, title: '', body: '', ...raw };
    if (!ids.has(e.notebookId)) { e.notebookId = fallback; await Store.put('entries', e); }
    state.entries.push(e);
  }
}

async function clearSamples() {
  const sample = state.tags.find(t => t.sample);
  if (!sample) return;
  const targets = state.entries.filter(e => e.tags.includes(sample.id));
  for (const e of targets) await deleteEntry(e.id);
  const stillUsed = new Set(state.entries.flatMap(e => e.tags));
  for (const t of [...state.tags]) {
    if (t.sample || !stillUsed.has(t.id)) await Store.del('tags', t.id);
  }
  state.tags = state.tags.filter(t => !t.sample && stillUsed.has(t.id));
  if (state.tag && !tagById(state.tag)) state.tag = null;
  render();
  toast('示例已删除');
}

/* ---------- 事件 ---------- */
function shiftAnchor(days) {
  const [y, m, d] = state.anchor.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  state.anchor = dayKey(date);
  renderMain();
}

document.addEventListener('click', async ev => {
  const t = ev.target.closest('button, .entry, label.add-photo, img[data-zoom]');
  if (!t) return;

  // 侧栏
  if (t.matches('[data-view]')) { state.view = t.dataset.view; render(); $('#main').scrollTop = 0; return; }
  if (t.matches('[data-nb]')) { state.notebook = t.dataset.nb || null; render(); $('#main').scrollTop = 0; return; }
  if (t.matches('[data-tag]')) { state.tag = state.tag === t.dataset.tag ? null : t.dataset.tag; render(); $('#main').scrollTop = 0; return; }
  if (t.id === 'add-notebook') { state.addingNotebook = true; state.editNotebooks = false; renderSide(); $('#new-nb').focus(); return; }
  if (t.id === 'toggle-nb-edit') { state.editNotebooks = !state.editNotebooks; state.addingNotebook = false; renderSide(); return; }
  if (t.matches('[data-delnb]')) return deleteNotebook(t.dataset.delnb);
  if (t.id === 'toggle-tag-edit') { state.editTags = !state.editTags; renderSide(); return; }
  if (t.matches('[data-deltag]')) {
    const tag = tagById(t.dataset.deltag);
    if (!await askConfirm(`删除标签“${tag.name}”？日记本身会保留，只是去掉这个标签。`, '删除标签')) return;
    for (const e of state.entries.filter(e => e.tags.includes(tag.id))) {
      e.tags = e.tags.filter(x => x !== tag.id);
      await Store.put('entries', e);
    }
    await Store.del('tags', tag.id);
    state.tags = state.tags.filter(x => x.id !== tag.id);
    if (state.tag === tag.id) state.tag = null;
    render();
    return;
  }
  if (t.id === 'export-btn') return exportData();
  if (t.id === 'import-btn') return $('#import-file').click();

  // 主区
  if (t.id === 'new-btn' || t.id === 'empty-new') {
    const inYears = state.view !== 'timeline' && state.anchor !== dayKey(new Date());
    return openEditor(newEntry(inYears ? state.anchor + 'T21:00' : undefined), true);
  }
  if (t.matches('[data-write]')) {
    const key = t.dataset.write;
    return openEditor(newEntry(key === dayKey(new Date()) ? undefined : key + 'T21:00'), true);
  }
  if (t.matches('[data-shift]')) return shiftAnchor(+t.dataset.shift);
  if (t.id === 'to-today') { state.anchor = dayKey(new Date()); renderMain(); return; }
  if (t.id === 'clear-filters') { state.notebook = null; state.tag = null; state.query = ''; $('#search').value = ''; render(); return; }
  if (t.id === 'clear-samples') { if (await askConfirm('删除所有带 #示例 的日记？', '删除')) clearSamples(); return; }
  if (t.classList.contains('entry')) {
    const e = state.entries.find(x => x.id === t.dataset.id);
    if (e) openEditor(e, false);
    return;
  }

  // 编辑器
  if (!state.editing) return;
  const ed = state.editing;
  if (t.id === 'ed-done') return saveEditor();
  if (t.id === 'ed-mark') {
    ed.e.bookmarked = !ed.e.bookmarked;
    t.setAttribute('aria-pressed', ed.e.bookmarked);
    t.innerHTML = `${ed.e.bookmarked ? RIBBON : RIBBON_LINE}<span>${ed.e.bookmarked ? '已收藏' : '收藏'}</span>`;
    return;
  }
  if (t.id === 'ed-del') {
    if (!await askConfirm('删除这篇日记？删除后无法恢复。', '删除')) return;
    try { await deleteEntry(ed.e.id); } catch (err) { toast('没能删除，可能是网络断了，请稍后再试。', 5000); return; }
    state.editing = null;
    $('#editor').hidden = true;
    render();
    toast('已删除');
    return;
  }
  if (t.matches('[data-rmphoto]')) {
    const id = t.dataset.rmphoto;
    ed.e.photos = ed.e.photos.filter(p => p !== id);
    if (ed.added.includes(id)) { ed.added = ed.added.filter(p => p !== id); await Store.del('photos', id); state.photoCache.delete(id); }
    else ed.removed.push(id);
    renderEdPhotos();
    return;
  }
  if (t.matches('img[data-zoom]')) return showLightbox(t.src);
  if (t.matches('[data-rmtag]')) {
    ed.e.tags = ed.e.tags.filter(x => x !== t.dataset.rmtag);
    renderEdChips();
    return;
  }
  if (t.matches('[data-sug]')) return applySuggestion(ed.items[+t.dataset.sug]);
});

// 点编辑纸外面的空白处 = 完成
$('#editor').addEventListener('mousedown', ev => { if (ev.target.id === 'editor') saveEditor(); });
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'search') { state.query = t.value; renderMain(); return; }
  if (t.id === 'anchor') { if (t.value) { state.anchor = t.value; renderMain(); } return; }
  if (!state.editing) return;
  const e = state.editing.e;
  if (t.id === 'ed-title') { e.title = t.value; updateWords(); }
  if (t.id === 'ed-body') { e.body = t.value; autosize(); updateWords(); }
  if (t.id === 'ed-date' && t.value) e.date = t.value;
  if (t.id === 'ed-notebook') e.notebookId = t.value;
  if (t.id === 'ed-taginput') { state.editing.suggestIndex = 0; renderSuggest(); }
});
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.id === 'ed-file' && t.files.length) { await addPhotos([...t.files]); t.value = ''; }
  if (t.id === 'import-file' && t.files[0]) { await importData(t.files[0]); t.value = ''; }
  if (t.matches('[data-rename]')) {
    const tag = tagById(t.dataset.rename);
    const name = t.value.trim().replace(/^#/, '');
    if (!name) { t.value = tag.name; return; }
    if (state.tags.some(x => x.id !== tag.id && x.name.toLowerCase() === name.toLowerCase())) { toast('已经有同名标签了'); t.value = tag.name; return; }
    tag.name = name;
    await Store.put('tags', tag);
    renderMain();
  }
  if (t.matches('[data-nbrename]')) {
    const nb = nbById(t.dataset.nbrename);
    const name = t.value.trim();
    if (!name) { t.value = nb.name; return; }
    if (state.notebooks.some(x => x.id !== nb.id && x.name === name)) { toast('已经有同名的日记本了'); t.value = nb.name; return; }
    nb.name = name;
    await Store.put('notebooks', nb);
    renderMain();
  }
});
document.addEventListener('focusin', ev => { if (ev.target.id === 'ed-taginput') renderSuggest(); });
document.addEventListener('focusout', ev => {
  if (ev.target.id === 'ed-taginput') setTimeout(() => { const ul = $('#ed-suggest'); if (ul && !ul.contains(document.activeElement)) ul.hidden = true; }, 150);
  if (ev.target.id === 'new-nb') setTimeout(() => finishAddingNotebook(true), 0);
});

document.addEventListener('keydown', ev => {
  if (!$('#login').hidden || !$('#loading').hidden) return;
  const mod = ev.metaKey || ev.ctrlKey;
  if (!$('#lightbox').hidden && ev.key === 'Escape') { $('#lightbox').hidden = true; return; }
  if (!$('#confirm').hidden) return;

  if (ev.target.id === 'new-nb') {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); finishAddingNotebook(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); finishAddingNotebook(false); }
    return;
  }

  if (state.editing) {
    if (ev.key === 'Escape' || (mod && ev.key === 'Enter')) { ev.preventDefault(); saveEditor(); return; }
    if (ev.target.id === 'ed-taginput') {
      const items = state.editing.items || [];
      if (ev.key === 'ArrowDown' && items.length) { ev.preventDefault(); state.editing.suggestIndex = (state.editing.suggestIndex + 1) % items.length; renderSuggest(); }
      else if (ev.key === 'ArrowUp' && items.length) { ev.preventDefault(); state.editing.suggestIndex = (state.editing.suggestIndex - 1 + items.length) % items.length; renderSuggest(); }
      else if ((ev.key === 'Enter' || ev.key === ',' || ev.key === '，') && !ev.isComposing) {
        if (!ev.target.value.trim()) { if (ev.key === 'Enter') ev.preventDefault(); return; }
        ev.preventDefault();
        applySuggestion(items[state.editing.suggestIndex] || { type: 'new', name: ev.target.value });
      } else if (ev.key === 'Backspace' && !ev.target.value && state.editing.e.tags.length) {
        state.editing.e.tags.pop(); renderEdChips();
      }
    }
    if (ev.target.id === 'add-photo' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); $('#ed-file').click(); }
    return;
  }
  if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); $('#search').focus(); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (typing) {
    if (ev.key === 'Escape' && document.activeElement.id === 'search') { ev.target.value = ''; state.query = ''; renderMain(); }
    return;
  }
  if (!mod && ev.key.toLowerCase() === 'n') { ev.preventDefault(); $('#new-btn').click(); return; }
  if (state.view !== 'timeline' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); shiftAnchor(ev.key === 'ArrowLeft' ? -1 : 1); return; }
  if (ev.key === 'Enter' && document.activeElement.classList.contains('entry')) document.activeElement.click();
});

/* ---------- 登录与启动 ---------- */
function showLogin(message) {
  $('#loading').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = message || '';
  $('#login-btn').disabled = false;
  setTimeout(() => $('#login-email').focus(), 0);
}
async function boot(session) {
  Store.setUser(session.user.id);
  $('#account-email').textContent = session.user.email || '';
  $('#login').hidden = true;
  $('#loading').hidden = false;
  try {
    await loadAll();
  } catch (err) {
    $('#loading').textContent = '读取日记失败：' + (err.message || '网络问题') + '。请刷新页面重试。';
    return;
  }
  $('#loading').hidden = true;
  render();
}
$('#login-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email || !password) { $('#login-error').textContent = '请填写邮箱和密码。'; return; }
  $('#login-btn').disabled = true;
  $('#login-error').textContent = '';
  const { data, error } = await Store.client.auth.signInWithPassword({ email, password });
  if (error) {
    showLogin(/invalid/i.test(error.message) ? '邮箱或密码不对。' : '登录失败：' + error.message);
    return;
  }
  $('#login-password').value = '';
  boot(data.session);
});
document.addEventListener('click', async ev => {
  if (ev.target.id !== 'signout-btn') return;
  await Store.client.auth.signOut();
  state.entries = []; state.tags = []; state.notebooks = [];
  state.photoCache.clear();
  $('#timeline').innerHTML = '';
  showLogin();
});

(async function start() {
  if (!Store.ready) {
    $('#loading').hidden = false;
    $('#loading').textContent = '没能加载 Supabase。请检查网络后刷新页面。';
    return;
  }
  $('#loading').hidden = false;
  const { data } = await Store.client.auth.getSession();
  if (data.session) boot(data.session); else showLogin();
})();
