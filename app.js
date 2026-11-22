/* ============================================================
   手记 · 程序逻辑
   ------------------------------------------------------------
   存储层 Store：唯一和 Supabase 打交道的地方。
     records 表 → 日记 / 标签 / 日记本（每条一行，内容是 JSON）
     photos 桶  → 照片，路径 “用户ID/照片ID.jpg”
     media 桶   → 录音，路径 “用户ID/文件ID”
   以后换存储，只改这一块。
   ============================================================ */
const Store = window.__TEST_STORE__ || (() => {
  const cfg = window.JOURNAL_CONFIG || {};
  const sb = window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const PAGE = 1000;
  const TTL = 60 * 60 * 24; // 文件临时链接有效 24 小时
  let userId = null;
  const keyOf = (store, obj) => store === 'meta' ? obj.key : obj.id;
  const check = ({ data, error }) => { if (error) throw error; return data; };
  const photoPath = id => `${userId}/${id}.jpg`;
  const mediaPath = id => `${userId}/${id}`;

  function dataURLToBlob(url) {
    const [head, b64] = url.split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const toBlob = (data, mime) => typeof data === 'string' ? dataURLToBlob(data) : (mime && data.type !== mime ? new Blob([data], { type: mime }) : data);
  const blobToDataURL = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const signed = async (bucket, path) => check(await sb.storage.from(bucket).createSignedUrl(path, TTL)).signedUrl;
  const upload = async (bucket, path, blob, contentType) => check(await sb.storage.from(bucket).upload(path, blob, { contentType, upsert: true }));
  const remove = async (bucket, path) => check(await sb.storage.from(bucket).remove([path]));
  const download = async (bucket, path) => blobToDataURL(check(await sb.storage.from(bucket).download(path)));
  const row = (store, obj) => ({ user_id: userId, store, id: keyOf(store, obj), data: obj, updated_at: new Date().toISOString() });

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
    async put(store, obj) { check(await sb.from('records').upsert(row(store, obj), { onConflict: 'user_id,store,id' })); },
    async putMany(store, list) {
      for (let i = 0; i < list.length; i += 300) {
        check(await sb.from('records').upsert(list.slice(i, i + 300).map(o => row(store, o)), { onConflict: 'user_id,store,id' }));
      }
    },
    async del(store, key) { check(await sb.from('records').delete().eq('store', store).eq('id', key)); },

    putPhoto: (id, data) => upload('photos', photoPath(id), toBlob(data, 'image/jpeg'), 'image/jpeg'),
    photoURL: id => signed('photos', photoPath(id)),
    delPhoto: id => remove('photos', photoPath(id)),
    photoData: id => download('photos', photoPath(id)),

    putMedia: (id, data, mime) => upload('media', mediaPath(id), toBlob(data, mime), mime),
    mediaURL: id => signed('media', mediaPath(id)),
    delMedia: id => remove('media', mediaPath(id)),
    mediaData: id => download('media', mediaPath(id)),
  };
})();

/* ---------- 小工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
// 版本号：和 index.html 里三处 ?v= 保持一致。规则见 docs/开发记录.md
const APP_VERSION = '0.5.0';
const VIEWS = [
  { id: 'timeline', label: '时间线' },
  { id: 'y3', label: '三年日记', years: 3, name: '三年' },
  { id: 'y5', label: '五年日记', years: 5, name: '五年' },
];
const MAX_AUDIO = 50 * 1024 * 1024; // Supabase 免费版单个文件上限
const AUDIO_EXT = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', caf: 'audio/x-caf' };

// 日期计算一律用 UTC 的“日”，避免夏令时把一天算成 23 或 25 小时
const keyToUTC = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const utcToKey = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const addDays = (k, n) => utcToKey(keyToUTC(k) + n * 86400000);
const weekStart = k => { const t = keyToUTC(k); const wd = (new Date(t).getUTCDay() + 6) % 7; return utcToKey(t - wd * 86400000); };
const shortDate = k => { const [y, m, d] = k.split('-').map(Number); return `${y}年${m}月${d}日`; };

function countWords(text) {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9À-ɏ']+/g) || []).length;
  return cjk + latin;
}
function normalizeURL(input) {
  let u = (input || '').trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try { const url = new URL(u); return /^https?:$/.test(url.protocol) ? url.href : null; } catch (e) { return null; }
}
const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

/* ---------- #标签：直接写在正文里，保存时自动识别 ----------
   标签名遇到空格、换行、# 或标点就结束（#生活 很开心 → “生活”）。
   # 前面紧挨着英文字母、数字或 / & 时不算标签（比如网址里的 #、C#）；纯数字（#1）也不算。 */
const TAG_STOP = '\\s#.,;:!?，。、；：！？…“”‘’"\'()（）【】\\[\\]{}<>《》「」『』/\\\\|';
const TAG_CHARS = `[^${TAG_STOP}]`;
const TAG_BEFORE = '(^|[^A-Za-z0-9_&#/])';
const TAG_FIND = new RegExp(`${TAG_BEFORE}#(${TAG_CHARS}+)`, 'g');
const escRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isNumberTag = n => /^\d+$/.test(n);
const validTagName = n => !!n && new RegExp(`^${TAG_CHARS}+$`).test(n) && !isNumberTag(n);
// 正文里某一个标签（不分大小写），用来改名和删除
const oneTagRE = name => new RegExp(`${TAG_BEFORE}#${escRE(name)}(?!${TAG_CHARS})`, 'gi');
function tagsInText(text) {
  const out = [], seen = new Set();
  for (const m of (text || '').matchAll(TAG_FIND)) {
    const key = m[2].toLowerCase();
    if (isNumberTag(m[2]) || seen.has(key)) continue;
    seen.add(key); out.push(m[2]);
  }
  return out;
}
// 显示正文：转义，并把 #标签 包起来上色
function richText(text) {
  let out = '', last = 0;
  for (const m of (text || '').matchAll(TAG_FIND)) {
    if (isNumberTag(m[2])) continue;
    const start = m.index + m[1].length;
    out += esc(text.slice(last, start)) + `<span class="htag">#${esc(m[2])}</span>`;
    last = start + 1 + m[2].length;
  }
  return out + esc((text || '').slice(last));
}

/* 只存在这台设备浏览器里的小偏好（比如侧栏收起了哪几块）。读不到也没关系 */
function readPref(key, fallback) {
  try { const v = localStorage.getItem('journal:' + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem('journal:' + key, JSON.stringify(value)); } catch (e) { /* 无痕模式等情况下存不了，忽略 */ }
}

/* ---------- 状态 ---------- */
const state = {
  entries: [], tags: [], notebooks: [],
  section: 'journal',          // journal | days（纪念日，筹备中）
  page: 'journal',             // journal | stats
  view: 'timeline',            // timeline | y3 | y5
  notebook: null, tagSel: [], query: '',   // tagSel：选中的标签（可以多选，要同时有这些标签）
  day: null,                   // 时间线里只看某一天
  anchor: todayKey(),          // 三年/五年日记看的那一天
  calMonth: todayKey().slice(0, 7),
  statsYear: String(new Date().getFullYear()),
  editing: null,
  reading: null,               // 正在阅读的日记 id
  collapsed: new Set(readPref('collapsed', [])),   // 电脑侧栏收起的部分
  editTags: false, editNotebooks: false, addingNotebook: false,
  mpanel: null,
  urls: new Map(),
};
const tagById = id => state.tags.find(t => t.id === id);
const tagName = id => (tagById(id) || {}).name || '';
const tagByName = name => state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
function tagCounts() {
  const counts = new Map();
  state.entries.forEach(e => e.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  return counts;
}
const nbById = id => state.notebooks.find(n => n.id === id);
const sortedNotebooks = () => [...state.notebooks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
// 新日记默认放进“最近一篇日记所在的日记本”
function defaultNotebookId() {
  const newest = [...state.entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (newest && nbById(newest.notebookId)) return newest.notebookId;
  return (sortedNotebooks()[0] || {}).id;
}

/* 照片、录音的临时链接（缓存 20 小时） */
async function fileURL(kind, id) {
  const key = kind + ':' + id;
  const hit = state.urls.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  let url = '';
  try { url = await (kind === 'p' ? Store.photoURL(id) : Store.mediaURL(id)); }
  catch (err) { console.warn('文件读取失败', key, err); }
  if (url) state.urls.set(key, { url, until: Date.now() + 20 * 3600 * 1000 });
  return url;
}
function hydrate(root) {
  root.querySelectorAll('img[data-photo]').forEach(async el => { el.src = await fileURL('p', el.dataset.photo); });
  root.querySelectorAll('audio[data-media]').forEach(async el => { el.src = await fileURL('m', el.dataset.media); });
}

/* 照片：长边缩到 1600px、JPEG 压缩，一张通常 200–400KB */
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`读不了“${file.name}”。如果是 iPhone 的 HEIC 照片，请用 Safari 打开，或者先导出成 JPG。`)); };
    img.src = url;
  });
}

/* ---------- 筛选：日记本 × 标签 × 搜索（× 某一天） ---------- */
function baseFiltered() {
  const q = state.query.trim().toLowerCase().replace(/^#/, '');
  return state.entries.filter(e => {
    if (state.notebook && e.notebookId !== state.notebook) return false;
    if (state.tagSel.length && !state.tagSel.every(t => e.tags.includes(t))) return false;
    if (q) {
      const hay = (e.title + '\n' + e.body + '\n' + e.tags.map(tagName).join(' ') + '\n' + e.links.map(l => l.title + ' ' + l.url).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function filtered() {
  const list = baseFiltered();
  return state.view === 'timeline' && state.day ? list.filter(e => e.date.slice(0, 10) === state.day) : list;
}

/* ---------- 统计 ---------- */
function runsOf(keys, step) {
  const runs = [];
  for (const k of keys) {
    const last = runs[runs.length - 1];
    if (last && keyToUTC(k) - keyToUTC(last.end) === step * 86400000) { last.end = k; last.len++; }
    else runs.push({ start: k, end: k, len: 1 });
  }
  return runs;
}
function computeStats() {
  const all = state.entries;
  const days = [...new Set(all.map(e => e.date.slice(0, 10)))].sort();
  const weeks = [...new Set(days.map(weekStart))].sort();
  const dayRuns = runsOf(days, 1), weekRuns = runsOf(weeks, 7);
  const today = todayKey(), thisWeek = weekStart(today);
  const lastDay = dayRuns[dayRuns.length - 1], lastWeek = weekRuns[weekRuns.length - 1];
  const longest = runs => runs.reduce((b, r) => (!b || r.len > b.len ? r : b), null);
  return {
    current: lastDay && (lastDay.end === today || lastDay.end === addDays(today, -1)) ? lastDay : null,
    longestDay: longest(dayRuns),
    currentWeek: lastWeek && (lastWeek.end === thisWeek || lastWeek.end === addDays(thisWeek, -7)) ? lastWeek : null,
    longestWeek: longest(weekRuns),
    years: [...new Set(all.map(e => e.date.slice(0, 4)))].sort().reverse(),
  };
}
function periodStats(year) {
  const list = year === 'all' ? state.entries : state.entries.filter(e => e.date.startsWith(year));
  const monthKey = todayKey().slice(0, 7);
  return {
    count: list.length,
    days: new Set(list.map(e => e.date.slice(0, 10))).size,
    words: list.reduce((s, e) => s + countWords(e.title + ' ' + e.body), 0),
    photos: list.reduce((s, e) => s + e.photos.length, 0),
    audios: list.reduce((s, e) => s + e.audios.length, 0),
    links: list.reduce((s, e) => s + e.links.length, 0),
    thisMonth: state.entries.filter(e => e.date.startsWith(monthKey)).length,
    list,
  };
}
const fmtWords = n => n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);

/* ---------- 渲染：侧栏 ---------- */
function renderCalendar() {
  const [y, m] = state.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, m, 0).getDate();
  const has = new Set(baseFiltered().map(e => e.date.slice(0, 10)));
  const today = todayKey();
  const sel = state.page !== 'journal' ? null : state.view === 'timeline' ? state.day : state.anchor;
  let cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="wd" aria-hidden="true">${w}</span>`).join('');
  cells += '<span></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const k = `${y}-${pad(m)}-${pad(d)}`;
    const cls = ['cal-day', has.has(k) && 'has', k === today && 'today', k === sel && 'sel', k > today && 'dim'].filter(Boolean).join(' ');
    cells += `<button type="button" class="${cls}" data-day="${k}" aria-label="${m}月${d}日${has.has(k) ? '，有日记' : ''}">${d}</button>`;
  }
  $('#mini-cal').innerHTML = `<div class="cal-head"><button type="button" data-cal="-1" aria-label="上个月">‹</button><span>${y} · ${MONTH_CN[m - 1]}</span><button type="button" data-cal="1" aria-label="下个月">›</button></div><div class="cal-grid">${cells}</div>`;
}

function renderSide() {
  $('#side').classList.toggle('days-mode', state.section !== 'journal');
  document.querySelectorAll('[data-section]').forEach(b => b.setAttribute('aria-current', String(b.dataset.section === state.section)));
  renderCalendar();

  // 电脑侧栏：点“视图 / 日记本 / 标签”收起或展开（手机面板里始终展开）
  document.querySelectorAll('[data-collapse]').forEach(b => {
    const shut = state.collapsed.has(b.dataset.collapse);
    document.getElementById(b.dataset.collapse).classList.toggle('collapsed', shut);
    b.setAttribute('aria-expanded', String(!shut));
    b.title = shut ? '展开' : '收起';
  });

  $('#views').innerHTML = VIEWS.map(v =>
    `<li><button type="button" data-view="${v.id}" aria-current="${state.page === 'journal' && state.view === v.id}"><span>${v.label}</span></button></li>`).join('');

  // 日记本
  const nbCount = new Map();
  state.entries.forEach(e => nbCount.set(e.notebookId, (nbCount.get(e.notebookId) || 0) + 1));
  const nbs = sortedNotebooks();
  let nbHTML;
  if (state.editNotebooks) {
    nbHTML = nbs.map(n => `<li class="edit-row">
      <label class="sr-only" for="nb-name-${n.id}">日记本名称</label>
      <input id="nb-name-${n.id}" data-nbrename="${n.id}" value="${esc(n.name)}">
      <button type="button" data-delnb="${n.id}" ${nbs.length < 2 ? 'disabled title="至少要保留一个日记本"' : ''} aria-label="删除日记本 ${esc(n.name)}">删除</button></li>`).join('');
  } else {
    nbHTML = `<li><button type="button" data-nb="" aria-current="${!state.notebook}"><span>所有</span><span class="n">${state.entries.length}</span></button></li>`
      + nbs.map(n => `<li><button type="button" data-nb="${n.id}" aria-current="${state.notebook === n.id}"><span>${esc(n.name)}</span><span class="n">${nbCount.get(n.id) || 0}</span></button></li>`).join('');
  }
  if (state.addingNotebook) nbHTML += `<li class="edit-row"><label class="sr-only" for="new-nb">新日记本名称</label><input id="new-nb" placeholder="新日记本名称，回车确定" autocomplete="off"></li>`;
  $('#notebook-list').innerHTML = nbHTML;
  $('#toggle-nb-edit').textContent = state.editNotebooks ? '完成' : '编辑';

  // 标签：平时一行排好几个“生活（10）”，可以多选；编辑时一行一个，方便改名、删除
  const counts = tagCounts();
  const tags = [...state.tags].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh'));
  const shown = state.editTags ? tags : tags.filter(t => counts.get(t.id) || state.tagSel.includes(t.id));
  const list = $('#tag-list');
  list.className = state.editTags ? 'nav' : 'nav cloud';
  if (!shown.length) list.innerHTML = '<li><p class="muted">在正文里写 #标签，就会出现在这里。</p></li>';
  else if (state.editTags) {
    list.innerHTML = shown.map(t => `<li class="edit-row">
      <label class="sr-only" for="tag-name-${t.id}">标签名称</label>
      <input id="tag-name-${t.id}" data-rename="${t.id}" value="${esc(t.name)}">
      <span class="n">${counts.get(t.id) || 0}</span>
      <button type="button" data-deltag="${t.id}" aria-label="删除标签 ${esc(t.name)}">删除</button></li>`).join('');
  } else {
    list.innerHTML = shown.map(t => {
      const on = state.tagSel.includes(t.id);
      return `<li><button type="button" data-tag="${t.id}" aria-pressed="${on}" title="${on ? '再点一次取消' : '只看有这个标签的日记（可以多选）'}">${esc(t.name)}<span class="n">（${counts.get(t.id) || 0}）</span></button></li>`;
    }).join('');
  }
  $('#toggle-tag-edit').textContent = state.editTags ? '完成' : '编辑';
  $('#toggle-tag-edit').hidden = !tags.length;
  $('#clear-tags').hidden = !state.tagSel.length || state.editTags;

  // 统计摘要
  const s = computeStats();
  const p = periodStats(String(new Date().getFullYear()));
  const all = periodStats('all');
  $('#stats-summary').innerHTML = `
    <span class="stat"><b>${s.current ? s.current.len : 0}</b><span>连续天数</span></span>
    <span class="stat"><b>${p.count}</b><span>今年篇数</span></span>
    <span class="stat"><b>${fmtWords(all.words)}</b><span>总字数</span></span>
    <span class="more-link">查看全部统计 →</span>`;

  document.querySelectorAll('[data-mpanel]').forEach(b => b.setAttribute('aria-expanded', String(state.mpanel === b.dataset.mpanel)));
  document.querySelector('[data-page="stats"]').setAttribute('aria-current', String(state.page === 'stats'));
}

/* ---------- 渲染：主区 ---------- */
function contextLabel() {
  const parts = [state.notebook ? (nbById(state.notebook) || {}).name : '所有'];
  if (state.tagSel.length) parts.push(state.tagSel.map(id => '#' + tagName(id)).join(' + '));
  if (state.query.trim()) parts.push(`搜索“${state.query.trim()}”`);
  return parts.join(' · ');
}
function nbBadge(e) {
  if (state.notebook || state.notebooks.length < 2) return '';
  const nb = nbById(e.notebookId);
  return nb ? `<span class="tag nb">#${esc(nb.name)}</span>` : '';
}
function thumbsHTML(e) {
  const photos = e.photos;
  const shown = photos.slice(0, 3);
  if (!shown.length) return '';
  return `<div class="thumbs n${shown.length}">${shown.map((p, i) =>
    `<div class="thumb"><img data-photo="${p}" alt="">${i === 2 && photos.length > 3 ? `<span class="more">+${photos.length - 3}</span>` : ''}</div>`).join('')}</div>`;
}
function attachHTML(e) {
  if (!e.audios.length && !e.links.length) return '';
  const parts = [];
  if (e.audios.length) parts.push(`<span>♪ 录音 ${e.audios.length} 段</span>`);
  e.links.slice(0, 3).forEach(l => parts.push(`<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(l.title || domainOf(l.url))}</a>`));
  if (e.links.length > 3) parts.push(`<span>另有 ${e.links.length - 3} 个链接</span>`);
  return `<div class="attach-line">${parts.join('')}</div>`;
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
      ${e.body.trim() ? `<p class="preview">${richText(e.body.trim())}</p>` : ''}
      ${thumbsHTML(e)}${attachHTML(e)}${tagsHTML(e, true)}
    </div>
  </article>`;
}
function yearEntryHTML(e) {
  const d = new Date(e.date);
  return `<article class="entry yentry" data-id="${e.id}" tabindex="0" aria-label="${ariaLabel(e)}">
    <div class="y-time"><span>${pad(d.getHours())}:${pad(d.getMinutes())}</span></div>
    ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}
    ${e.body.trim() ? `<p class="preview">${richText(e.body.trim())}</p>` : ''}
    ${thumbsHTML(e)}${attachHTML(e)}${tagsHTML(e, true)}
  </article>`;
}
const setTitle = (title, sub) => { $('#view-title').innerHTML = `${esc(title)}${sub ? `<span class="count">${esc(sub)}</span>` : ''}`; };

function renderTimeline(list) {
  const tl = $('#timeline');
  if (state.day) {
    const [y, m, d] = state.day.split('-').map(Number);
    setTitle(`${m}月${d}日`, `${y} · ${contextLabel()} · ${list.length} 篇`);
    $('#banner-slot').innerHTML = `<span class="filter-chip">只看这一天<button type="button" id="clear-day" aria-label="显示全部日记">×</button></span>`;
  } else {
    setTitle(contextLabel(), `时间线 · ${list.length} 篇`);
  }
  if (!list.length) {
    if (state.day) {
      tl.innerHTML = `<div class="empty"><p>这一天没有写日记。</p>${state.day <= todayKey() ? `<button type="button" class="btn ghost" data-write="${state.day}">在这一天写</button>` : ''}</div>`;
    } else {
      tl.innerHTML = state.entries.length
        ? `<div class="empty"><p>没有符合条件的日记。</p><button type="button" class="btn ghost" id="clear-filters">查看所有日记</button></div>`
        : `<div class="empty"><p>还没有日记。</p><button type="button" class="btn" id="empty-new">写第一篇</button></div>`;
    }
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
  hydrate(tl);
}

function renderYears(list, view) {
  const [ay, am, ad] = state.anchor.split('-').map(Number);
  const md = state.anchor.slice(5);
  const today = todayKey();
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
  setTitle(`${am}月${ad}日`, `${view.name}日记 · ${contextLabel()} · ${shown} 篇`);
  const tl = $('#timeline');
  tl.innerHTML = html;
  hydrate(tl);
}

function barChart(values, labels) {
  const W = 640, H = 170, top = 18, bottom = 24, gap = 10;
  const max = Math.max(1, ...values);
  const bw = (W - gap * (values.length - 1)) / values.length;
  const ch = H - top - bottom;
  const bars = values.map((v, i) => {
    const h = v ? Math.max(3, (v / max) * ch) : 2;
    const x = i * (bw + gap), y = top + ch - h;
    return `<rect class="bar${v ? '' : ' zero'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`
      + (v ? `<text class="val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${v}</text>` : '')
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${labels.map((l, i) => `${l} ${values[i]} 篇`).join('，')}"><line class="grid" x1="0" x2="${W}" y1="${top + ch + 0.5}" y2="${top + ch + 0.5}"/>${bars}</svg></div>`;
}

function renderStatsPage() {
  $('#banner-slot').innerHTML = '';
  setTitle('统计', `${state.entries.length} 篇日记`);
  const s = computeStats();
  const years = s.years;
  if (state.statsYear !== 'all' && !years.includes(state.statsYear)) state.statsYear = years[0] || 'all';
  const p = periodStats(state.statsYear);
  const range = r => r ? (r.start === r.end ? shortDate(r.start) : `${shortDate(r.start)} – ${shortDate(r.end)}`) : '还没有';
  const cell = (lab, num, unit, sub, lead) => `<div class="st-cell${lead ? ' lead' : ''}"><div class="lab">${lab}</div><div class="num">${num}<small>${unit}</small></div>${sub ? `<div class="range">${sub}</div>` : ''}</div>`;

  let chart;
  if (state.statsYear === 'all') {
    const ys = [...years].reverse();
    chart = ys.length ? barChart(ys.map(y => state.entries.filter(e => e.date.startsWith(y)).length), ys) : '';
  } else {
    const months = Array(12).fill(0);
    p.list.forEach(e => { months[Number(e.date.slice(5, 7)) - 1]++; });
    chart = barChart(months, months.map((_, i) => `${i + 1}月`));
  }
  const isThisYear = state.statsYear === String(new Date().getFullYear());

  $('#timeline').innerHTML = `
    <button type="button" class="back-link" data-page="journal">← 返回手记</button>
    <section class="st-section"><h3>连续记录</h3>
      <div class="st-grid">
        ${cell('当前连续', s.current ? s.current.len : 0, '天', s.current ? `从 ${shortDate(s.current.start)} 开始` : '今天写一篇就开始了', true)}
        ${cell('最长连续', s.longestDay ? s.longestDay.len : 0, '天', range(s.longestDay))}
        ${cell('当前每周连续', s.currentWeek ? s.currentWeek.len : 0, '周', s.currentWeek ? `从 ${shortDate(s.currentWeek.start)} 那周开始` : '这周写一篇就开始了')}
        ${cell('最长每周连续', s.longestWeek ? s.longestWeek.len : 0, '周', s.longestWeek ? `${shortDate(s.longestWeek.start)} 那周起` : '还没有')}
      </div>
    </section>
    <section class="st-section"><h3>数据</h3>
      <div class="yr-tabs" role="group" aria-label="统计范围">
        <button type="button" data-year="all" aria-pressed="${state.statsYear === 'all'}">全部</button>
        ${years.map(y => `<button type="button" data-year="${y}" aria-pressed="${state.statsYear === y}">${y}</button>`).join('')}
      </div>
      ${chart}
      <div class="st-grid">
        ${cell('日记', p.count, '篇', state.statsYear === 'all' ? '全部' : `${state.statsYear} 年`)}
        ${cell('写日记的天数', p.days, '天')}
        ${cell('字数', p.words.toLocaleString('zh-CN'), '字')}
        ${isThisYear ? cell('本月', p.thisMonth, '篇') : ''}
        ${cell('照片', p.photos, '张')}
        ${cell('录音', p.audios, '段')}
        ${cell('链接', p.links, '个')}
      </div>
    </section>`;
}

function renderDays() {
  $('#banner-slot').innerHTML = '';
  setTitle('纪念日 · 倒数日', '');
  $('#timeline').innerHTML = `<div class="empty"><p>这个板块还在筹备中。<br>数据会和手记放在同一个项目里。</p><button type="button" class="btn ghost" data-section="journal">回到手记</button></div>`;
}

function renderMain() {
  const journal = state.section === 'journal';
  $('#new-btn').hidden = !journal;
  $('#fab').hidden = !journal;
  $('#mbar').hidden = !journal;
  if (!journal) return renderDays();
  if (state.page === 'stats') return renderStatsPage();
  $('#banner-slot').innerHTML = '';
  const list = filtered();
  const view = VIEWS.find(v => v.id === state.view);
  if (view.years) renderYears(list, view); else renderTimeline(list);
}
function render() { renderSide(); renderMain(); }

/* ---------- 阅读页：点日记先看全文，右上角“编辑”才进编辑页 ---------- */
const fmtLong = iso => { const d = new Date(iso); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtEdited = iso => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function audiosHTML(audios, removable) {
  return audios.map(a => `<div class="audio-item">
      <audio controls preload="none" data-media="${a.id}"></audio>
      <span class="name" title="${esc(a.name)}">${esc(a.name || '录音')}${a.size ? ' · ' + fmtSize(a.size) : ''}</span>
      ${removable ? `<button type="button" data-rmaudio="${a.id}" aria-label="移除录音 ${esc(a.name)}">移除</button>` : ''}</div>`).join('');
}
function linksHTML(links, removable) {
  return links.map((l, i) => `<div class="link-card">
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title || l.url)}</a>
      <span class="dom">${esc(domainOf(l.url))}</span>
      ${removable ? `<button type="button" data-rmlink="${i}" aria-label="移除链接">×</button>` : ''}</div>`).join('');
}
function openReader(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  closeMPanel();
  state.reading = id;
  const nb = state.notebooks.length > 1 ? nbById(e.notebookId) : null;
  const box = $('#editor');
  box.innerHTML = `
  <div class="sheet reader" role="dialog" aria-modal="true" aria-label="阅读日记" tabindex="-1">
    <div class="sheet-bar">
      <div class="bar-left"><span class="rd-date">${fmtLong(e.date)}</span>${nb ? `<span class="rd-nb">#${esc(nb.name)}</span>` : ''}</div>
      <div class="bar-actions">
        <button type="button" class="text-btn" id="rd-close" title="Esc">关闭</button>
        <button type="button" class="btn" id="rd-edit">编辑</button>
      </div>
    </div>
    ${e.title ? `<h1 class="rd-title">${esc(e.title)}</h1>` : ''}
    ${e.body.trim() ? `<div class="rd-body">${richText(e.body.trim())}</div>` : ''}
    ${e.photos.length ? `<div class="rd-photos n${Math.min(e.photos.length, 3)}">${e.photos.map(p => `<img data-photo="${p}" data-zoom="1" alt="日记照片">`).join('')}</div>` : ''}
    ${e.audios.length ? `<div class="audio-list">${audiosHTML(e.audios, false)}</div>` : ''}
    ${e.links.length ? `<div class="link-list">${linksHTML(e.links, false)}</div>` : ''}
    <div class="sheet-foot"><span>${countWords(e.title + ' ' + e.body)} 字</span><span>${e.updatedAt ? '上次修改 ' + fmtEdited(e.updatedAt) : ''}</span></div>
  </div>`;
  box.hidden = false;
  hydrate(box);
  $('.reader', box).focus({ preventScroll: true });
}
function closeReader() {
  const id = state.reading;
  state.reading = null;
  $('#editor').hidden = true;
  $('#editor').innerHTML = '';
  const card = id && document.querySelector(`.entry[data-id="${id}"]`);
  if (card) card.focus({ preventScroll: true });
}

/* ---------- 编辑器 ---------- */
function newEntry(date) {
  return {
    id: uid(), date: date || localISO(new Date()), title: '', body: '', tags: [], photos: [], audios: [], links: [],
    notebookId: state.notebook || defaultNotebookId(),
    createdAt: new Date().toISOString(), updatedAt: null,
  };
}
// fromReader：从阅读页点“编辑”进来的，完成后回到阅读页
function openEditor(entry, isNew, fromReader = false) {
  closeMPanel();
  state.reading = null;
  state.editing = { e: JSON.parse(JSON.stringify(entry)), isNew, fromReader, added: [], removed: [], addedMedia: [], removedMedia: [], hash: null, sug: [] };
  renderEditor();
  $('#editor').hidden = false;
  (isNew || fromReader ? $('#ed-body') : $('#ed-title')).focus({ preventScroll: true });
  if (fromReader) $('#ed-body').setSelectionRange(0, 0);
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
        ${isNew ? '' : '<button type="button" class="text-btn danger" id="ed-del">删除</button>'}
        <button type="button" class="btn" id="ed-done" title="Esc 或 ⌘↵">完成</button>
      </div>
    </div>
    <label class="sr-only" for="ed-title">标题</label>
    <input id="ed-title" class="ed-title" placeholder="标题（可以不写）" value="${esc(e.title)}" autocomplete="off">
    <label class="sr-only" for="ed-body">正文</label>
    <textarea id="ed-body" class="ed-body" placeholder="今天发生了什么……&#10;想分类就在正文里写 #标签">${esc(e.body)}</textarea>
    <div class="tag-suggest" id="ed-tagsug" role="group" aria-label="已有标签，点一下补全" hidden></div>

    <div class="ed-attach">
      <div class="ed-photos" id="ed-photos"></div>
      <div class="audio-list" id="ed-audios"></div>
      <div class="link-list" id="ed-links"></div>
      <div class="link-form" id="ed-link-form" hidden>
        <label class="sr-only" for="ed-link-url">链接地址</label>
        <input id="ed-link-url" type="url" placeholder="粘贴链接，比如一首歌、一部电影" autocomplete="off">
        <label class="sr-only" for="ed-link-title">链接标题</label>
        <input id="ed-link-title" placeholder="标题（可以不写）" autocomplete="off">
        <button type="button" class="btn ghost small" id="ed-link-add">添加链接</button>
        <button type="button" class="text-btn" id="ed-link-cancel">取消</button>
      </div>
      <div class="add-menu" id="ed-add-menu">
        <button type="button" class="add-btn" id="ed-add" aria-expanded="false" aria-controls="ed-add-opts">＋ 添加</button>
        <span class="add-opts" id="ed-add-opts" hidden>
          <label class="add-opt" for="ed-file" id="add-photo" tabindex="0">照片</label>
          <label class="add-opt" for="ed-audio-file" id="add-audio" tabindex="0">录音</label>
          <button type="button" class="add-opt" id="add-link">链接</button>
        </span>
        <span class="add-status" id="ed-add-status" role="status"></span>
      </div>
      <input type="file" id="ed-file" accept="image/*" multiple hidden>
      <input type="file" id="ed-audio-file" accept="audio/*,.m4a,.mp3,.wav,.aac,.caf" multiple hidden>
    </div>

    <div class="sheet-foot"><span id="ed-words"></span><span>${e.updatedAt ? '上次修改 ' + fmtEdited(e.updatedAt) : '关闭时自动保存'}</span></div>
  </div>`;
  renderEdPhotos(); renderEdAudios(); renderEdLinks(); updateWords();
}
function renderEdPhotos() {
  const { e } = state.editing;
  const box = $('#ed-photos');
  box.innerHTML = e.photos.map(p => `<div class="ed-photo"><img data-photo="${p}" data-zoom="1" alt="日记照片"><button type="button" data-rmphoto="${p}" aria-label="移除这张照片">×</button></div>`).join('');
  hydrate(box);
}
function renderEdAudios() {
  const box = $('#ed-audios');
  box.innerHTML = audiosHTML(state.editing.e.audios, true);
  hydrate(box);
}
function renderEdLinks() {
  $('#ed-links').innerHTML = linksHTML(state.editing.e.links, true);
}
function updateWords() {
  const { e } = state.editing;
  $('#ed-words').textContent = `${countWords(e.title + ' ' + e.body)} 字`;
}
function autosize() {
  const ta = $('#ed-body');
  if (!ta) return;
  const sheet = ta.closest('.sheet');
  const keep = sheet.scrollTop;          // 改高度时不要让页面跳回顶部
  ta.style.height = 'auto';
  ta.style.height = Math.max(240, ta.scrollHeight) + 'px';
  sheet.scrollTop = keep;
}

/* “＋ 添加”：点开才出现 照片 / 录音 / 链接 */
function setAddMenu(open) {
  const btn = $('#ed-add');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(open));
  $('#ed-add-opts').hidden = !open;
}
function setAddBusy(text) {
  const menu = $('#ed-add-menu');
  if (!menu) return;
  menu.classList.toggle('busy', !!text);
  $('#ed-add-status').textContent = text || '';
  if (text) setAddMenu(false);
}
function showLinkForm(open) {
  $('#ed-link-form').hidden = !open;
  $('#ed-add-menu').hidden = open;
  if (open) { setAddMenu(false); $('#ed-link-url').focus(); }
  else { $('#ed-link-url').value = ''; $('#ed-link-title').value = ''; }
}
function addLinkFromForm() {
  const ed = state.editing;
  const url = normalizeURL($('#ed-link-url').value);
  if (!url) { toast('这个链接看起来不对，请检查一下'); return; }
  ed.e.links.push({ url, title: $('#ed-link-title').value.trim() });
  renderEdLinks();
  showLinkForm(false);
}

/* 正文里输入 # 时，提示已有的标签，点一下（或按 Tab）补全 */
function hashAtCaret() {
  const ta = $('#ed-body');
  if (!ta || ta.selectionStart !== ta.selectionEnd) return null;
  const m = ta.value.slice(0, ta.selectionStart).match(new RegExp(`${TAG_BEFORE}#(${TAG_CHARS}*)$`));
  return m ? { start: ta.selectionStart - m[2].length - 1, end: ta.selectionStart, query: m[2] } : null;
}
function renderTagSuggest() {
  const ed = state.editing;
  const box = $('#ed-tagsug');
  if (!ed || !box) return;
  const h = document.activeElement && document.activeElement.id === 'ed-body' ? hashAtCaret() : null;
  let list = [];
  if (h) {
    const q = h.query.toLowerCase();
    const counts = tagCounts();
    list = state.tags
      .filter(t => t.name.toLowerCase() !== q && t.name.toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || (counts.get(b.id) || 0) - (counts.get(a.id) || 0))
      .slice(0, 8);
  }
  ed.hash = list.length ? h : null;
  ed.sug = list.map(t => t.name);
  box.hidden = !list.length;
  box.innerHTML = list.length ? `<span class="lab">已有标签</span>` + list.map((t, i) => `<button type="button" data-hashtag="${i}">#${esc(t.name)}</button>`).join('') + '<span class="lab">Tab 补全第一个</span>' : '';
}
function insertHashtag(name) {
  const ed = state.editing;
  const ta = $('#ed-body');
  if (!ed || !ed.hash || !ta) return;
  const { start, end } = ed.hash;
  const after = ta.value.slice(end);
  ta.focus({ preventScroll: true });
  ta.setRangeText('#' + name + (/^\s/.test(after) ? '' : ' '), start, end, 'end');
  ed.e.body = ta.value;
  autosize(); updateWords(); renderTagSuggest();
}

// 正文里的标签名 → 标签 id；还没有的标签会新建（一次性存进数据库）
async function ensureTags(names) {
  const fresh = [];
  for (const name of names) {
    if (!tagByName(name) && !fresh.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      fresh.push({ id: uid(), name, createdAt: new Date().toISOString() });
    }
  }
  if (fresh.length) { await Store.putMany('tags', fresh); state.tags.push(...fresh); }
  return names.map(n => tagByName(n).id);
}

async function addPhotos(files) {
  const ed = state.editing;
  for (let i = 0; i < files.length; i++) {
    setAddBusy(`照片上传中 ${i + 1} / ${files.length}……`);
    try {
      const data = await compressImage(files[i]);
      const id = uid();
      await Store.putPhoto(id, data);
      state.urls.set('p:' + id, { url: data, until: Date.now() + 3600 * 1000 });
      ed.e.photos.push(id);
      ed.added.push(id);
    } catch (err) {
      toast(err.message && !/fetch|network/i.test(err.message) ? err.message : '照片没能上传，可能是网络断了', 5000);
    }
  }
  if (state.editing === ed) { setAddBusy(''); renderEdPhotos(); }
}
async function addAudios(files) {
  const ed = state.editing;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_AUDIO) { toast(`“${file.name}”有 ${fmtSize(file.size)}，超过 50MB 的上限`, 5000); continue; }
    setAddBusy(`录音上传中 ${i + 1} / ${files.length}……`);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const mime = file.type || AUDIO_EXT[ext] || 'audio/mp4';
    try {
      const id = uid();
      await Store.putMedia(id, file, mime);
      ed.e.audios.push({ id, name: file.name, mime, size: file.size });
      ed.addedMedia.push(id);
    } catch (err) {
      toast(`“${file.name}”没能上传：${/mime|type/i.test(err.message || '') ? '不支持这种音频格式' : '可能是网络断了'}`, 5000);
    }
  }
  if (state.editing === ed) { setAddBusy(''); renderEdAudios(); }
}

const isEmptyEntry = e => !e.title && !e.body.trim() && !e.photos.length && !e.audios.length && !e.links.length;
async function quietly(fn) { try { await fn(); } catch (err) { console.warn(err); } }

async function saveEditor() {
  const ed = state.editing;
  if (!ed) return;
  if ($('#ed-add-menu') && $('#ed-add-menu').classList.contains('busy')) { toast('文件还在上传，请等一下再点“完成”'); return; }
  const e = ed.e;
  e.title = e.title.trim();
  if (ed.isNew && isEmptyEntry(e)) {
    for (const p of ed.added) await quietly(() => Store.delPhoto(p));
    for (const m of ed.addedMedia) await quietly(() => Store.delMedia(m));
    closeEditor();
    return;
  }
  // 标签以正文里的 #标签 为准
  try { e.tags = await ensureTags(tagsInText(e.body)); }
  catch (err) { toast('没能保存，可能是网络断了。内容还在编辑页里，联网后再点“完成”。', 6000); return; }
  const original = state.entries.find(x => x.id === e.id);
  const changed = !original || JSON.stringify({ ...original, updatedAt: null }) !== JSON.stringify({ ...e, updatedAt: null });
  if (changed) {
    const prev = e.updatedAt;
    e.updatedAt = new Date().toISOString();
    try { await Store.put('entries', e); }
    catch (err) {
      e.updatedAt = prev;
      toast('没能保存，可能是网络断了。内容还在编辑页里，联网后再点“完成”。', 6000);
      return;
    }
    for (const p of ed.removed) { await quietly(() => Store.delPhoto(p)); state.urls.delete('p:' + p); }
    for (const m of ed.removedMedia) { await quietly(() => Store.delMedia(m)); state.urls.delete('m:' + m); }
    const i = state.entries.findIndex(x => x.id === e.id);
    if (i >= 0) state.entries[i] = e; else state.entries.push(e);
  }
  closeEditor();
  render();
  if (ed.fromReader) openReader(e.id);
  else if (ed.isNew) toast('已保存');
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
  const photos = [...(e.photos || []), ...(state.editing ? state.editing.added : [])];
  const media = [...(e.audios || []).map(a => a.id), ...(state.editing ? state.editing.addedMedia : [])];
  for (const p of photos) { await quietly(() => Store.delPhoto(p)); state.urls.delete('p:' + p); }
  for (const m of media) { await quietly(() => Store.delMedia(m)); state.urls.delete('m:' + m); }
  state.entries = state.entries.filter(x => x.id !== id);
}

/* ---------- 日记本 ---------- */
async function createNotebook(name) {
  name = name.trim();
  if (!name) return;
  if (state.notebooks.some(n => n.name === name)) { toast('已经有同名的日记本了'); return; }
  const maxOrder = Math.max(0, ...state.notebooks.map(n => n.order ?? 0));
  const nb = { id: uid(), name, order: maxOrder + 1, createdAt: new Date().toISOString() };
  try { await Store.put('notebooks', nb); } catch (err) { toast('没能新建日记本，可能是网络断了'); return; }
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
  try {
    for (const e of inside) e.notebookId = target.id;
    await Store.putMany('entries', inside);
    await Store.del('notebooks', id);
  } catch (err) { toast('没能删除日记本，可能是网络断了'); await loadAll(); render(); return; }
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
  const photoIds = [...new Set(state.entries.flatMap(e => e.photos))];
  const audios = [...new Map(state.entries.flatMap(e => e.audios).map(a => [a.id, a])).values()];
  const photos = [], media = [];
  let failed = 0;
  for (let i = 0; i < photoIds.length; i++) {
    toast(`正在打包照片 ${i + 1} / ${photoIds.length}……`, 60000);
    try { photos.push({ id: photoIds[i], data: await Store.photoData(photoIds[i]) }); } catch (err) { failed++; }
  }
  for (let i = 0; i < audios.length; i++) {
    toast(`正在打包录音 ${i + 1} / ${audios.length}……`, 60000);
    try { media.push({ id: audios[i].id, mime: audios[i].mime, data: await Store.mediaData(audios[i].id) }); } catch (err) { failed++; }
  }
  const data = {
    app: 'paper-journal', version: 3, exportedAt: new Date().toISOString(),
    notebooks: state.notebooks, entries: state.entries, tags: state.tags, photos, media,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `手记备份-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`已导出 ${state.entries.length} 篇日记、${photos.length} 张照片、${media.length} 段录音${failed ? `；有 ${failed} 个文件没能打包` : ''}`, 5000);
}
async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('这个文件不是有效的备份文件', 4000); return; }
  if (!data || data.app !== 'paper-journal' || !Array.isArray(data.entries)) { toast('这个文件不是手记的备份', 4000); return; }
  const ok = await askConfirm(`备份里有 ${data.entries.length} 篇日记。导入后会和现有日记合并，同一篇日记会被备份里的版本覆盖。`, '导入', false);
  if (!ok) return;
  const photos = data.photos || [], media = data.media || [];
  let failed = 0;
  try {
    for (let i = 0; i < photos.length; i++) {
      toast(`正在上传照片 ${i + 1} / ${photos.length}……`, 60000);
      try { await Store.putPhoto(photos[i].id, photos[i].data); } catch (err) { failed++; console.warn('照片上传失败', photos[i].id, err); }
    }
    for (let i = 0; i < media.length; i++) {
      toast(`正在上传录音 ${i + 1} / ${media.length}……`, 60000);
      try { await Store.putMedia(media[i].id, media[i].data, media[i].mime || 'audio/mp4'); } catch (err) { failed++; console.warn('录音上传失败', media[i].id, err); }
    }
    toast('正在保存日记……', 60000);
    // 自动建的空日记本，如果和备份里的同名就删掉，避免出现两个同名日记本
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
  state.urls.clear();
  await loadAll();
  render();
  toast(`已导入 ${data.entries.length} 篇日记${failed ? `，有 ${failed} 个文件没传上去` : ''}`, 5000);
}

/* ---------- 读取 ---------- */
async function loadAll() {
  state.notebooks = await Store.all('notebooks');
  if (!state.notebooks.length) {
    const nb = { id: uid(), name: '日记', order: 0, createdAt: new Date().toISOString() };
    await Store.put('notebooks', nb);
    state.notebooks = [nb];
  }
  const ids = new Set(state.notebooks.map(n => n.id));
  const fallback = (sortedNotebooks()[0] || {}).id;
  state.tags = await Store.all('tags');
  const fix = [];
  state.entries = (await Store.all('entries')).map(raw => {
    const e = { tags: [], photos: [], audios: [], links: [], title: '', body: '', ...raw };
    if (!ids.has(e.notebookId)) { e.notebookId = fallback; fix.push(e); }
    return e;
  });
  if (fix.length) await Store.putMany('entries', fix);
  try { await syncTags(); } catch (err) { console.warn('标签整理失败，下次打开会再试', err); }
  state.tagSel = state.tagSel.filter(id => tagById(id));
  if (state.notebook && !nbById(state.notebook)) state.notebook = null;
}

/* v0.5 起，标签以正文里的 #标签 为准。每次打开时检查一遍，只有需要时才写入：
   1. 以前用标签框打的标签，如果正文里没有，就补到正文最后一行（比如“#生活 #散步”）。
      标签名里有空格或标点的，先改成下划线，不然写进正文会断开。
   2. 根据正文里的 #标签 更新每篇日记的 tags（正文里新出现的标签会自动新建）。
   补过一次之后正文里就有了，不会重复补。 */
async function syncTags() {
  const renamed = [];
  for (const t of state.tags) {
    if (validTagName(t.name)) continue;
    let name = t.name.trim().replace(new RegExp(`[${TAG_STOP}]+`, 'g'), '_').replace(/^_+|_+$/g, '');
    if (!name || isNumberTag(name)) name = '标签' + (name || t.id.slice(-4));
    while (state.tags.some(x => x !== t && x.name.toLowerCase() === name.toLowerCase())) name += '_';
    t.name = name;
    renamed.push(t);
  }
  const changed = new Set();
  for (const e of state.entries) {
    const inBody = new Set(tagsInText(e.body).map(n => n.toLowerCase()));
    const missing = e.tags.map(tagById).filter(t => t && !inBody.has(t.name.toLowerCase()));
    if (!missing.length) continue;
    const body = e.body.replace(/\s+$/, '');
    e.body = body + (body ? '\n\n' : '') + missing.map(t => '#' + t.name).join(' ');
    changed.add(e);
  }
  if (renamed.length) await Store.putMany('tags', renamed);
  await ensureTags([...new Set(state.entries.flatMap(e => tagsInText(e.body)))]);
  for (const e of state.entries) {
    const want = tagsInText(e.body).map(n => tagByName(n).id);
    const same = want.length === e.tags.length && want.every(id => e.tags.includes(id));
    if (!same) { e.tags = want; changed.add(e); }
  }
  if (changed.size) await Store.putMany('entries', [...changed]);
}

/* ---------- 手机：顶部按钮打开的面板 ----------
   面板里显示的就是侧栏里的同一块内容（搬过去，关掉时再搬回来），
   所以电脑和手机共用一套功能代码。 */
const MPANELS = { views: ['sec-cal', 'sec-views'], nb: ['sec-nb'], tags: ['sec-tags'], search: ['sec-search'], backup: ['sec-backup'] };
const SIDE_ORDER = ['sec-cal', 'sec-search', 'sec-views', 'sec-nb', 'sec-tags', 'sec-stats', 'sec-backup'];
function restoreSide() { const side = $('#side'); SIDE_ORDER.forEach(id => side.appendChild(document.getElementById(id))); }
function openMPanel(name) {
  if (state.mpanel === name) { closeMPanel(); return; }
  restoreSide();
  const panel = $('#mpanel');
  MPANELS[name].forEach(id => panel.appendChild(document.getElementById(id)));
  panel.hidden = false;
  $('#mscrim').hidden = false;
  state.mpanel = name;
  renderSide();
  if (name === 'search') setTimeout(() => $('#search').focus(), 0);
}
function closeMPanel() {
  if (!state.mpanel) return;
  restoreSide();
  $('#mpanel').hidden = true;
  $('#mscrim').hidden = true;
  state.mpanel = null;
  document.querySelectorAll('[data-mpanel]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
window.matchMedia('(min-width: 761px)').addEventListener('change', closeMPanel);

/* ---------- 事件 ---------- */
function goJournal() { state.page = 'journal'; state.section = 'journal'; }
function shiftAnchor(days) { state.anchor = addDays(state.anchor, days); state.calMonth = state.anchor.slice(0, 7); render(); }
const scrollTop = () => { $('#main').scrollTop = 0; window.scrollTo(0, 0); };

document.addEventListener('click', async ev => {
  if (ev.target.closest('a[href]')) return; // 链接照常打开，不打开编辑页
  const t = ev.target.closest('button, .entry, img[data-zoom], #mscrim');
  if (!t) return;
  if (t.id === 'mscrim') return closeMPanel();
  if (t.matches('img[data-zoom]')) return showLightbox(t.src);

  // 阅读页
  if (t.id === 'rd-close') return closeReader();
  if (t.id === 'rd-edit') { const e = state.entries.find(x => x.id === state.reading); if (e) openEditor(e, false, true); return; }

  // 板块 / 页面 / 手机面板
  if (t.matches('[data-section]')) { state.section = t.dataset.section; state.page = 'journal'; closeMPanel(); render(); scrollTop(); return; }
  if (t.matches('[data-mpanel]')) return openMPanel(t.dataset.mpanel);
  if (t.matches('[data-page]')) { state.page = t.dataset.page; closeMPanel(); render(); scrollTop(); return; }
  if (t.id === 'stats-summary') { state.page = 'stats'; render(); scrollTop(); return; }
  if (t.matches('[data-year]')) { state.statsYear = t.dataset.year; renderMain(); return; }

  // 日历
  if (t.matches('[data-cal]')) {
    const [y, m] = state.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(t.dataset.cal), 1);
    state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    renderCalendar();
    return;
  }
  if (t.matches('[data-day]')) {
    const k = t.dataset.day;
    goJournal();
    if (state.view === 'timeline') state.day = state.day === k ? null : k;
    else state.anchor = k;
    closeMPanel(); render(); scrollTop();
    return;
  }

  // 视图 / 日记本 / 标签
  if (t.matches('[data-view]')) { goJournal(); state.view = t.dataset.view; closeMPanel(); render(); scrollTop(); return; }
  if (t.matches('[data-nb]')) { goJournal(); state.notebook = t.dataset.nb || null; closeMPanel(); render(); scrollTop(); return; }
  if (t.matches('[data-collapse]')) {
    if (t.closest('#mpanel')) return;          // 手机面板里不收起
    const id = t.dataset.collapse;
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    writePref('collapsed', [...state.collapsed]);
    renderSide();
    return;
  }
  // 标签可以多选：再点一次取消。手机上面板不关，方便连着选几个
  if (t.matches('[data-tag]')) {
    const id = t.dataset.tag;
    goJournal();
    state.tagSel = state.tagSel.includes(id) ? state.tagSel.filter(x => x !== id) : [...state.tagSel, id];
    render(); scrollTop();
    return;
  }
  if (t.id === 'clear-tags') { state.tagSel = []; render(); scrollTop(); return; }
  if (t.id === 'add-notebook') { state.addingNotebook = true; state.editNotebooks = false; renderSide(); $('#new-nb').focus(); return; }
  if (t.id === 'toggle-nb-edit') { state.editNotebooks = !state.editNotebooks; state.addingNotebook = false; renderSide(); return; }
  if (t.matches('[data-delnb]')) return deleteNotebook(t.dataset.delnb);
  if (t.id === 'toggle-tag-edit') { state.editTags = !state.editTags; renderSide(); return; }
  if (t.matches('[data-deltag]')) {
    const tag = tagById(t.dataset.deltag);
    if (!await askConfirm(`删除标签“${tag.name}”？日记会保留，正文里的“#${tag.name}”会变成普通文字“${tag.name}”。`, '删除标签')) return;
    const re = oneTagRE(tag.name);
    const touched = state.entries.filter(e => e.tags.includes(tag.id)).map(e => ({
      ...e, tags: e.tags.filter(x => x !== tag.id),
      body: e.body.replace(re, (m, before) => before + m.slice(before.length + 1)),
    }));
    try {
      await Store.putMany('entries', touched);
      await Store.del('tags', tag.id);
    } catch (err) { toast('没能删除标签，可能是网络断了'); await loadAll(); render(); return; }
    touched.forEach(e => { state.entries[state.entries.findIndex(x => x.id === e.id)] = e; });
    state.tags = state.tags.filter(x => x.id !== tag.id);
    state.tagSel = state.tagSel.filter(x => x !== tag.id);
    render();
    return;
  }

  // 备份 / 账户
  if (t.id === 'export-btn') { closeMPanel(); return exportData(); }
  if (t.id === 'import-btn') return $('#import-file').click();
  if (t.id === 'signout-btn') {
    closeMPanel();
    await quietly(() => Store.client.auth.signOut());
    state.entries = []; state.tags = []; state.notebooks = []; state.urls.clear();
    $('#timeline').innerHTML = '';
    showLogin();
    return;
  }

  // 主区
  if (t.id === 'new-btn' || t.id === 'fab' || t.id === 'empty-new') {
    const inYears = state.page === 'journal' && state.view !== 'timeline' && state.anchor !== todayKey();
    const onDay = state.page === 'journal' && state.view === 'timeline' && state.day && state.day !== todayKey();
    return openEditor(newEntry(inYears ? state.anchor + 'T21:00' : onDay ? state.day + 'T21:00' : undefined), true);
  }
  if (t.matches('[data-write]')) {
    const k = t.dataset.write;
    return openEditor(newEntry(k === todayKey() ? undefined : k + 'T21:00'), true);
  }
  if (t.matches('[data-shift]')) return shiftAnchor(+t.dataset.shift);
  if (t.id === 'to-today') { state.anchor = todayKey(); state.calMonth = state.anchor.slice(0, 7); render(); return; }
  if (t.id === 'clear-day') { state.day = null; render(); return; }
  if (t.id === 'clear-filters') { state.notebook = null; state.tagSel = []; state.query = ''; state.day = null; $('#search').value = ''; render(); return; }
  if (t.classList.contains('entry')) return openReader(t.dataset.id);

  // 编辑器
  if (!state.editing) return;
  const ed = state.editing;
  if (t.id === 'ed-done') return saveEditor();
  if (t.id === 'ed-add') return setAddMenu(t.getAttribute('aria-expanded') !== 'true');
  if (t.id === 'add-link') return showLinkForm(true);
  if (t.id === 'ed-link-cancel') return showLinkForm(false);
  if (t.matches('[data-hashtag]')) return insertHashtag(ed.sug[+t.dataset.hashtag]);
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
    if (ed.added.includes(id)) { ed.added = ed.added.filter(p => p !== id); await quietly(() => Store.delPhoto(id)); }
    else ed.removed.push(id);
    renderEdPhotos();
    return;
  }
  if (t.matches('[data-rmaudio]')) {
    const id = t.dataset.rmaudio;
    ed.e.audios = ed.e.audios.filter(a => a.id !== id);
    if (ed.addedMedia.includes(id)) { ed.addedMedia = ed.addedMedia.filter(m => m !== id); await quietly(() => Store.delMedia(id)); }
    else ed.removedMedia.push(id);
    renderEdAudios();
    return;
  }
  if (t.matches('[data-rmlink]')) { ed.e.links.splice(+t.dataset.rmlink, 1); renderEdLinks(); return; }
  if (t.id === 'ed-link-add') return addLinkFromForm();
});

// 点纸外面的空白处：编辑时 = 完成，阅读时 = 关闭
$('#editor').addEventListener('mousedown', ev => {
  if (ev.target.closest('#ed-tagsug')) { ev.preventDefault(); return; }   // 点标签提示时不让正文失去焦点
  if (ev.target.id !== 'editor') return;
  if (state.editing) saveEditor(); else if (state.reading) closeReader();
});
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'search') { state.query = t.value; goJournal(); renderMain(); renderCalendar(); return; }
  if (t.id === 'anchor') { if (t.value) { state.anchor = t.value; state.calMonth = t.value.slice(0, 7); render(); } return; }
  if (!state.editing) return;
  const e = state.editing.e;
  if (t.id === 'ed-title') { e.title = t.value; updateWords(); }
  if (t.id === 'ed-body') { e.body = t.value; autosize(); updateWords(); renderTagSuggest(); }
  if (t.id === 'ed-date' && t.value) e.date = t.value;
  if (t.id === 'ed-notebook') e.notebookId = t.value;
});
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.id === 'ed-file' && t.files.length) { const files = [...t.files]; t.value = ''; await addPhotos(files); }
  if (t.id === 'ed-audio-file' && t.files.length) { const files = [...t.files]; t.value = ''; await addAudios(files); }
  if (t.id === 'import-file' && t.files[0]) { closeMPanel(); await importData(t.files[0]); t.value = ''; }
  if (t.matches('[data-rename]')) {
    const tag = tagById(t.dataset.rename);
    const name = t.value.trim().replace(/^#/, '');
    if (!name || name === tag.name) { t.value = tag.name; return; }
    if (!validTagName(name)) { toast('标签名里不能有空格或标点，也不能全是数字'); t.value = tag.name; return; }
    if (state.tags.some(x => x.id !== tag.id && x.name.toLowerCase() === name.toLowerCase())) { toast('已经有同名标签了'); t.value = tag.name; return; }
    // 正文里的 #旧名 一起改成 #新名
    const re = oneTagRE(tag.name);
    const touched = state.entries.filter(e => e.tags.includes(tag.id)).map(e => ({ ...e, body: e.body.replace(re, (m, before) => before + '#' + name) }));
    try {
      await Store.put('tags', { ...tag, name });
      await Store.putMany('entries', touched);
    } catch (err) { toast('没能改名，可能是网络断了'); await loadAll(); render(); return; }
    tag.name = name;
    touched.forEach(e => { state.entries[state.entries.findIndex(x => x.id === e.id)] = e; });
    renderMain();
  }
  if (t.matches('[data-nbrename]')) {
    const nb = nbById(t.dataset.nbrename);
    const name = t.value.trim();
    if (!name) { t.value = nb.name; return; }
    if (state.notebooks.some(x => x.id !== nb.id && x.name === name)) { toast('已经有同名的日记本了'); t.value = nb.name; return; }
    try { await Store.put('notebooks', { ...nb, name }); } catch (err) { toast('没能改名，可能是网络断了'); t.value = nb.name; return; }
    nb.name = name;
    renderMain();
  }
});
// 正文里移动光标时，更新 #标签 提示；离开正文就收起
document.addEventListener('keyup', ev => { if (ev.target.id === 'ed-body' && /^Arrow|Home|End/.test(ev.key)) renderTagSuggest(); });
document.addEventListener('pointerup', ev => { if (ev.target.id === 'ed-body') setTimeout(renderTagSuggest, 0); });
document.addEventListener('focusout', ev => {
  if (ev.target.id === 'ed-body') setTimeout(renderTagSuggest, 200);
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
    if (ev.key === 'Escape' && !$('#ed-link-form').hidden) { ev.preventDefault(); showLinkForm(false); return; }
    if (ev.key === 'Escape' || (mod && ev.key === 'Enter')) { ev.preventDefault(); saveEditor(); return; }
    if (ev.target.id === 'ed-body' && ev.key === 'Tab' && !ev.isComposing && state.editing.hash && state.editing.sug.length) { ev.preventDefault(); insertHashtag(state.editing.sug[0]); return; }
    if ((ev.target.id === 'ed-link-url' || ev.target.id === 'ed-link-title') && ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); addLinkFromForm(); return; }
    if ((ev.target.id === 'add-photo' || ev.target.id === 'add-audio') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.target.click(); }
    return;
  }
  if (state.reading) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeReader(); }
    return;
  }
  if (ev.key === 'Escape' && state.mpanel) { closeMPanel(); return; }
  if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (window.matchMedia('(max-width: 760px)').matches) openMPanel('search'); else $('#search').focus(); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (typing) {
    if (ev.key === 'Escape' && document.activeElement.id === 'search') { ev.target.value = ''; state.query = ''; render(); }
    return;
  }
  if (state.section !== 'journal') return;
  if (!mod && ev.key.toLowerCase() === 'n') { ev.preventDefault(); $('#new-btn').click(); return; }
  if (state.page === 'journal' && state.view !== 'timeline' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); shiftAnchor(ev.key === 'ArrowLeft' ? -1 : 1); return; }
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
  $('#app-version').textContent = '版本 v' + APP_VERSION;
  $('#login').hidden = true;
  $('#loading').hidden = false;
  try { await loadAll(); }
  catch (err) {
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
  if (error) { showLogin(/invalid/i.test(error.message) ? '邮箱或密码不对。' : '登录失败：' + error.message); return; }
  $('#login-password').value = '';
  boot(data.session);
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
