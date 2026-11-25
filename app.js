/* ============================================================
   一卷磁带 · 程序逻辑（手记 + 纪念日）
   ------------------------------------------------------------
   存储层 Store：唯一和 Supabase 打交道的地方。
     records 表 → 日记 / 标签 / 日记本 / 纪念日 / 设置（每条一行，内容是 JSON）
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
const APP_VERSION = '0.8.0';
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
function tagText(text) {
  let out = '', last = 0;
  for (const m of (text || '').matchAll(TAG_FIND)) {
    if (isNumberTag(m[2])) continue;
    const start = m.index + m[1].length;
    out += esc(text.slice(last, start)) + `<span class="htag">#${esc(m[2])}</span>`;
    last = start + 1 + m[2].length;
  }
  return out + esc((text || '').slice(last));
}
/* 正文格式：正文里存的仍是纯文字，用符号标记（v0.8 起），显示时才变成格式。
     **粗体**   *斜体*   ++下划线++   ~~删除线~~   一行开头写 “> ” 是引用（灰色）
   符号必须成对、在同一行里，里面的文字两头不能是空格；不成对的符号照原样显示。 */
const FMT = [
  { mark: '**', tag: 'strong', re: /\*\*(?=\S)(.+?)(?<=\S)\*\*/g },
  { mark: '~~', tag: 's', re: /~~(?=\S)(.+?)(?<=\S)~~/g },
  { mark: '++', tag: 'u', re: /\+\+(?=\S)(.+?)(?<=\S)\+\+/g },
  { mark: '*', tag: 'em', re: /(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\w])/g },
];
const QUOTE_RE = /^>\s?/;
const inlineFmt = html => FMT.reduce((h, f) => h.replace(f.re, `<${f.tag}>$1</${f.tag}>`), html);
// block：阅读页里引用单独成块；列表预览里只变灰
function richText(text, block = false) {
  const lines = (text || '').split('\n');
  return lines.map((line, i) => {
    const last = i === lines.length - 1;
    if (QUOTE_RE.test(line)) {
      const inner = inlineFmt(tagText(line.replace(QUOTE_RE, '')));
      return block ? `<span class="quote">${inner || ' '}</span>` : `<span class="quote-inline">${inner}</span>${last ? '' : '\n'}`;
    }
    return inlineFmt(tagText(line)) + (last ? '' : '\n');
  }).join('');
}
// 去掉格式符号的纯文字（用在标题提示、字数之外的地方）
const plainText = text => (text || '').split('\n').map(l => l.replace(QUOTE_RE, '')).join('\n').replace(/\*\*|~~|\+\+/g, '');

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
  section: 'journal',          // journal | days（时间轴板块）
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
  // 纪念日板块
  prefs: { key: 'prefs' },     // 跟着账号走的设置（存在 meta）：默认日记本、标签分组、时间轴分类顺序
  days: [], life: { key: 'life', birth: '', lifespan: 88 },
  dview: 'today',              // today | list | life
  dgroups: [],                 // 时间轴只看这些分类（可以多选，空 = 全部）
  dsel: null,                  // 选中的日子（电脑上显示在右边）
  dopen: false,                // 手机上是否打开了详情页
  dAllMarks: false,            // 时间节点显示全部
  lifeAge: null,               // 人生页看的是哪一岁
  dcalMonth: todayKey().slice(0, 7),   // 日历页看的月份
  dcalDay: null,               // 日历页选中的一天
  calEmoji: readPref('calEmoji', false),   // 手记的小日历里显示时间轴 emoji
  dEditing: null,              // 正在编辑的日子 / 出生日期
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
// 新日记默认放进“设为默认”的日记本；没设就放进最近一篇日记所在的日记本
function defaultNotebookId() {
  if (nbById(state.prefs.defaultNotebook)) return state.prefs.defaultNotebook;
  const newest = [...state.entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (newest && nbById(newest.notebookId)) return newest.notebookId;
  return (sortedNotebooks()[0] || {}).id;
}

/* 标签：手动排序 + 分组。分组列表存在 prefs.tagGroups：[{ id, name }]（顺序就是显示顺序），
   标签自己记着 groupId 和 order。没排过序的标签排在后面，按篇数多少。 */
const tagGroups = () => state.prefs.tagGroups || [];
function sortedTags() {
  const counts = tagCounts();
  const o = t => typeof t.order === 'number' ? t.order : Infinity;
  return [...state.tags].sort((a, b) => o(a) - o(b) || (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh'));
}
const groupOfTag = t => tagGroups().some(g => g.id === t.groupId) ? t.groupId : '';
async function savePrefs(patch) {
  const next = { ...state.prefs, ...patch };
  await Store.put('meta', next);
  state.prefs = next;
}

/* ---------- 拖动排序（电脑用鼠标拖，手机长按后拖） ----------
   可以拖的东西：data-sort-kind="种类" data-sort-id="id"；放的地方：data-sort-zone="种类" data-zone-id="…"。
   带 .drag-handle 的把手按下就能拖。松手后把每个区域里的新顺序交给 onSortDone(种类, { 区域id: [id…] })。 */
const drag = { el: null, kind: '', timer: 0, x: 0, y: 0, moved: false, pid: null, justDropped: false };
function dragStart() {
  drag.el.classList.add('dragging');
  document.body.classList.add('is-dragging');
  if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { /* 不支持就算了 */ }
}
document.addEventListener('pointerdown', ev => {
  if (ev.button > 0) return;
  const el = ev.target.closest('[data-sort-id]');
  if (!el || (ev.target.closest('input, textarea, select') && !ev.target.closest('.drag-handle'))) return;
  Object.assign(drag, { el, kind: el.dataset.sortKind, x: ev.clientX, y: ev.clientY, moved: false, pid: ev.pointerId, started: false });
  const handle = !!ev.target.closest('.drag-handle');
  if (ev.pointerType === 'touch' && !handle) {
    drag.timer = setTimeout(() => { drag.started = true; dragStart(); }, 380);   // 手机：长按才开始拖，不影响滑动
  } else drag.immediate = true;
  drag.handle = handle;
});
document.addEventListener('pointermove', ev => {
  if (!drag.el || ev.pointerId !== drag.pid) return;
  const dist = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y);
  if (!drag.started) {
    if (ev.pointerType === 'touch' && !drag.handle) { if (dist > 8) { clearTimeout(drag.timer); drag.el = null; } return; }
    if (dist < 5) return;
    drag.started = true; dragStart();
  }
  ev.preventDefault();
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!hit) return;
  const over = hit.closest(`[data-sort-kind="${drag.kind}"]`);
  if (over && over !== drag.el && !over.contains(drag.el) && !drag.el.contains(over)) {
    const r = over.getBoundingClientRect();
    const zone = over.parentElement;
    const horizontal = getComputedStyle(zone).flexDirection === 'row';
    const after = horizontal ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
    zone.insertBefore(drag.el, after ? over.nextSibling : over);
    drag.moved = true;
    return;
  }
  const zone = hit.closest(`[data-sort-zone="${drag.kind}"]`);
  if (zone && !zone.contains(drag.el) && !drag.el.contains(zone)) {
    const tail = zone.querySelector(':scope > .sort-tail');
    zone.insertBefore(drag.el, tail);
    drag.moved = true;
  }
}, { passive: false });
// 手机：开始拖之后不让页面跟着滑
document.addEventListener('touchmove', ev => { if (drag.el && drag.started) ev.preventDefault(); }, { passive: false });
function dragEnd(ev) {
  if (!drag.el || (ev && ev.pointerId !== drag.pid)) return;
  clearTimeout(drag.timer);
  const { el, kind, started, moved } = drag;
  drag.el = null;
  el.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  if (!started) return;
  drag.justDropped = true;                 // 拖完松手不算“点一下”
  setTimeout(() => { drag.justDropped = false; }, 0);
  if (!moved) return;
  const zones = {};
  document.querySelectorAll(`[data-sort-zone="${kind}"]`).forEach(z => {
    zones[z.dataset.zoneId || ''] = [...z.querySelectorAll(`:scope > [data-sort-kind="${kind}"]`)].map(x => x.dataset.sortId);
  });
  onSortDone(kind, zones);
}
document.addEventListener('pointerup', dragEnd);
document.addEventListener('pointercancel', dragEnd);
document.addEventListener('click', ev => { if (drag.justDropped) { ev.stopPropagation(); ev.preventDefault(); } }, true);
document.addEventListener('contextmenu', ev => { if (drag.el) ev.preventDefault(); });

async function onSortDone(kind, zones) {
  try {
    if (kind === 'nb') {
      const ids = zones[''] || [];
      const changed = ids.map((id, i) => ({ ...nbById(id), order: i })).filter(n => n.id);
      await Store.putMany('notebooks', changed);
      changed.forEach(n => Object.assign(nbById(n.id), n));
    } else if (kind === 'tag') {
      const changed = [];
      let i = 0;
      for (const [gid, ids] of Object.entries(zones)) for (const id of ids) {
        const t = tagById(id);
        if (t) changed.push({ ...t, groupId: gid, order: i++ });
      }
      await Store.putMany('tags', changed);
      changed.forEach(t => Object.assign(tagById(t.id), t));
    } else if (kind === 'tgroup') {
      const ids = zones[''] || [];
      await savePrefs({ tagGroups: ids.map(id => tagGroups().find(g => g.id === id)).filter(Boolean) });
    } else if (kind === 'dgroup') {
      await savePrefs({ dayGroupOrder: zones[''] || [] });
    }
  } catch (err) { toast('没能保存新的顺序，可能是网络断了'); }
  render();
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
  const emo = state.calEmoji ? eventsInMonth(state.calMonth) : new Map();   // 打开时，有时间轴日子的那天显示 emoji
  let cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="wd" aria-hidden="true">${w}</span>`).join('');
  cells += '<span></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const k = `${y}-${pad(m)}-${pad(d)}`;
    const cls = ['cal-day', has.has(k) && 'has', k === today && 'today', k === sel && 'sel', k > today && 'dim'].filter(Boolean).join(' ');
    const ev = (emo.get(k) || []).find(a => a.emoji);
    cells += `<button type="button" class="${cls}${ev ? ' emo' : ''}" data-day="${k}" aria-label="${m}月${d}日${has.has(k) ? '，有日记' : ''}${ev ? '，' + esc(annName(ev)) : ''}"${ev ? ` title="${esc(annName(ev))}"` : ''}>${ev ? esc(ev.emoji) : d}</button>`;
  }
  $('#mini-cal').innerHTML = `<div class="cal-head"><button type="button" data-cal="-1" aria-label="上个月">‹</button><span>${y} · ${MONTH_CN[m - 1]}</span><button type="button" data-cal="1" aria-label="下个月">›</button></div><div class="cal-grid">${cells}</div><button type="button" class="link-btn cal-emoji-toggle" id="cal-emoji">${state.calEmoji ? '隐藏' : '显示'}时间轴 emoji</button>`;
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

  const nDays = allDays().filter(a => a.date <= todayKey()).length;   // 和时间轴列表一致：只数已经过去的
  $('#dview-list').innerHTML = DVIEWS.filter(v => v.id !== 'cal').map(v =>   // 电脑上日历直接放在侧栏，不单独成页
    `<li><button type="button" data-dview="${v.id}" aria-current="${state.section === 'days' && state.dview === v.id}"><span>${v.label}</span>${v.id === 'list' ? `<span class="n">${nDays}</span>` : ''}</button></li>`).join('');
  if (state.section === 'days') renderDaysSideCal();
  document.querySelectorAll('#dbar [data-dview]').forEach(b => b.setAttribute('aria-current', String(state.dview === b.dataset.dview)));

  $('#views').innerHTML = VIEWS.map(v =>
    `<li><button type="button" data-view="${v.id}" aria-current="${state.page === 'journal' && state.view === v.id}"><span>${v.label}</span></button></li>`).join('');

  // 日记本
  const nbCount = new Map();
  state.entries.forEach(e => nbCount.set(e.notebookId, (nbCount.get(e.notebookId) || 0) + 1));
  const nbs = sortedNotebooks();
  let nbHTML;
  const defNb = nbById(state.prefs.defaultNotebook) ? state.prefs.defaultNotebook : '';
  if (state.editNotebooks) {
    // 编辑：拖左边的把手排序；“设为默认”= 打开网站时先显示这一本，新日记也默认放进这一本
    nbHTML = nbs.map(n => `<li class="edit-row" data-sort-kind="nb" data-sort-id="${n.id}">
      <span class="drag-handle" title="拖动排序" aria-hidden="true">⠿</span>
      <label class="sr-only" for="nb-name-${n.id}">日记本名称</label>
      <input id="nb-name-${n.id}" data-nbrename="${n.id}" value="${esc(n.name)}">
      ${n.id === defNb ? `<button type="button" class="nb-def on" data-nbdef="" title="再点一次取消，打开网站时显示“所有”">默认</button>`
        : `<button type="button" class="nb-def" data-nbdef="${n.id}" title="打开网站时先显示这一本">设为默认</button>`}
      <button type="button" data-delnb="${n.id}" ${nbs.length < 2 ? 'disabled title="至少要保留一个日记本"' : ''} aria-label="删除日记本 ${esc(n.name)}">删除</button></li>`).join('');
  } else {
    nbHTML = `<li><button type="button" data-nb="" aria-current="${!state.notebook}"><span>所有</span><span class="n">${state.entries.length}</span></button></li>`
      + nbs.map(n => `<li><button type="button" data-nb="${n.id}" aria-current="${state.notebook === n.id}"><span>${esc(n.name)}${n.id === defNb ? '<span class="def-mark">默认</span>' : ''}</span><span class="n">${nbCount.get(n.id) || 0}</span></button></li>`).join('');
  }
  if (state.addingNotebook) nbHTML += `<li class="edit-row"><label class="sr-only" for="new-nb">新日记本名称</label><input id="new-nb" placeholder="新日记本名称，回车确定" autocomplete="off"></li>`;
  $('#notebook-list').innerHTML = nbHTML;
  if (state.editNotebooks) { $('#notebook-list').dataset.sortZone = 'nb'; $('#notebook-list').dataset.zoneId = ''; }
  else delete $('#notebook-list').dataset.sortZone;
  $('#toggle-nb-edit').textContent = state.editNotebooks ? '完成' : '编辑';

  // 标签：按分组显示，平时一行排好几个“生活（10）”，可以多选。
  // 编辑时：点标签改名 / 删除 / 换分组；拖动标签换位置或拖进别的分组；拖分组名给分组排序
  const counts = tagCounts();
  const tags = sortedTags();
  const shown = state.editTags ? tags : tags.filter(t => counts.get(t.id) || state.tagSel.includes(t.id));
  const list = $('#tag-list');
  list.className = state.editTags ? 'nav tag-groups editing' : 'nav tag-groups';
  const tagBtn = t => {
    if (state.editTags) return `<li data-sort-kind="tag" data-sort-id="${t.id}"><button type="button" data-tagedit="${t.id}" title="点一下改名、删除或换分组；按住拖动排序">${esc(t.name)}<span class="n">（${counts.get(t.id) || 0}）</span></button></li>`;
    const on = state.tagSel.includes(t.id);
    return `<li><button type="button" data-tag="${t.id}" aria-pressed="${on}" title="${on ? '再点一次取消' : '只看有这个标签的日记（可以多选）'}">${esc(t.name)}<span class="n">（${counts.get(t.id) || 0}）</span></button></li>`;
  };
  const cloud = (gid, items) => `<ul class="nav cloud"${state.editTags ? ` data-sort-zone="tag" data-zone-id="${gid}"` : ''}>${items.map(tagBtn).join('')}${state.editTags && !items.length ? '<li class="sort-tail"><span class="muted">拖标签到这里</span></li>' : ''}</ul>`;
  if (!tags.length) list.innerHTML = '<li><p class="muted">在正文里写 #标签，就会出现在这里。</p></li>';
  else {
    const loose = shown.filter(t => !groupOfTag(t));
    let html = loose.length || state.editTags ? `<li class="tg-block tg-loose">${cloud('', loose)}</li>` : '';
    const groupsHTML = tagGroups().map(g => {
      const items = shown.filter(t => groupOfTag(t) === g.id);
      if (!items.length && !state.editTags) return '';
      const head = state.editTags
        ? `<p class="tg-name"><span class="drag-handle" title="拖动给分组排序" aria-hidden="true">⠿</span><button type="button" data-tgedit="${g.id}" title="改名或删除分组">${esc(g.name)}</button></p>`
        : `<p class="tg-name">${esc(g.name)}</p>`;
      return `<li class="tg-block"${state.editTags ? ` data-sort-kind="tgroup" data-sort-id="${g.id}"` : ''}>${head}${cloud(g.id, items)}</li>`;
    }).join('');
    html += state.editTags ? `<li><ul class="nav tg-list" data-sort-zone="tgroup" data-zone-id="">${groupsHTML}</ul></li>` : groupsHTML;
    if (state.editTags) html += '<li class="hint"><button type="button" class="link-btn" id="add-tgroup">＋ 新建分组</button><p class="muted">点标签可以改名、删除或换分组；按住标签拖动可以排序，拖进别的分组。</p></li>';
    list.innerHTML = html;
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
// 日记下面的浅灰标注：第一个是所在日记本（只在“所有”里显示），后面是这篇的标签
function tagsHTML(e, withNb) {
  const nb = withNb ? nbBadge(e) : '';
  if (!e.tags.length && !nb) return '';
  return `<div class="meta">${nb}${e.tags.map(t => `<span class="tag">#${esc(tagName(t))}</span>`).join('')}</div>`;
}
// 列表预览：去掉正文最后“只有 #标签”的几行（这些标签已经显示在下面的浅灰标注里）。阅读页仍显示全文
function previewText(e) {
  const lines = e.body.trim().split('\n');
  const tagOnly = new RegExp(`^\\s*(#${TAG_CHARS}+\\s*)+$`);
  while (lines.length && (tagOnly.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n').trim();
}
function ariaLabel(e) {
  const d = new Date(e.date);
  return esc(`${e.title || plainText(e.body).slice(0, 20) || '没有文字的日记'}，${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`);
}
function entryHTML(e) {
  const d = new Date(e.date);
  return `<article class="entry" data-id="${e.id}" tabindex="0" aria-label="${ariaLabel(e)}">
    <div class="e-date"><span class="day">${d.getDate()}</span><span class="wk">${WEEK[d.getDay()]}</span><span class="tm">${pad(d.getHours())}:${pad(d.getMinutes())}</span></div>
    <div class="entry-body">
      ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}
      ${previewText(e) ? `<p class="preview">${richText(previewText(e))}</p>` : ''}
      ${thumbsHTML(e)}${attachHTML(e)}${tagsHTML(e, true)}
    </div>
  </article>`;
}
function yearEntryHTML(e) {
  const d = new Date(e.date);
  return `<article class="entry yentry" data-id="${e.id}" tabindex="0" aria-label="${ariaLabel(e)}">
    <div class="y-time"><span>${pad(d.getHours())}:${pad(d.getMinutes())}</span></div>
    ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}
    ${previewText(e) ? `<p class="preview">${richText(previewText(e))}</p>` : ''}
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
    else body = `<div class="slot-empty"><span>这一天没有写日记。</span>${key === today ? `<button type="button" class="slot-write" data-write="${key}">现在写</button>` : ''}</div>`;
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

/* ============================================================
   纪念日 · 倒数日
   ------------------------------------------------------------
   数据：records 表 store = 'anniversaries'，每条一个“日子”：
     { id, title, date: 'YYYY-MM-DD', emoji, group, repeat: 'none' | 'yearly', life, note, createdAt, updatedAt }
     group：分类（文字，比如“英国”）；repeat：每年重复（生日、周年）；life：放进“人生足迹”
   出生日期和预计寿命存在 meta：{ key: 'life', birth: 'YYYY-MM-DD', lifespan: 88 }，生日会自动出现在倒数里。
   天数按“日”算，当天算 0：9月28日 → 11月23日 = 56 天。
   三个页面：今日 / 倒数（电脑上左边列表、右边详情）/ 人生
   ============================================================ */
const DVIEWS = [{ id: 'today', label: '今日' }, { id: 'list', label: '时间轴' }, { id: 'life', label: '人生' }, { id: 'cal', label: '日历' }];
const DAY_MARKS = [30, 50, 100, 200, 300, 500, 1000, 1500, 2000, 3000, 5000, 10000];
const EMOJI_PICKS = ['🎂', '❤️', '🎓', '✈️', '🏠', '📚', '🎵', '🧗', '💼', '🌱', '⭐', '🎉'];
const BDAY_ID = '__birthday';
const WEEK_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const dayDiff = (a, b) => Math.round((keyToUTC(b) - keyToUTC(a)) / 86400000);   // b 比 a 晚几天
const wkOf = k => WEEK[new Date(keyToUTC(k)).getUTCDay()];
const fmtMD = k => { const [, m, d] = k.split('-').map(Number); return `${m}月${d}日 ${wkOf(k)}`; };
const fmtFull = k => `${shortDate(k)} ${wkOf(k)}`;
const fmtSmart = k => k.slice(0, 4) === todayKey().slice(0, 4) ? fmtMD(k) : fmtFull(k);
const fmtN = n => n.toLocaleString('zh-CN');
// 某年没有这一天（2月29日）就用这个月最后一天
const clampDay = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate()))}`;
const yearsLater = (k, n) => { const [y, m, d] = k.split('-').map(Number); return clampDay(y + n, m, d); };
function nextYearly(k, from) {
  let n = Math.max(0, Number(from.slice(0, 4)) - Number(k.slice(0, 4)));
  while (yearsLater(k, n) < from) n++;
  return { date: yearsLater(k, n), n };
}
// “3 个月 15 天”
function spanText(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number);
  let y = y2 - y1, m = m2 - m1, d = d2 - d1;
  if (d < 0) { m--; d += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return [y && `${y} 年`, m && `${m} 个月`, d && `${d} 天`].filter(Boolean).join(' ') || '0 天';
}
const firstGrapheme = s => {
  if (!s) return '';
  try { return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)][0].segment; } catch (e) { return [...s][0]; }
};

/* v0.8：“倒数日”“纪念日”变成两个标记（countdown / memorial），和“放进人生足迹”并列。
   以前的 countMode 不读也不删：没有标记的旧数据按原来的样子补上——
   每年重复的：显示“离下一次”→ 倒数日，显示“已经多少天”→ 纪念日；不重复的：以后的 → 倒数日，过去的 → 纪念日。
   remind：提前几天提醒（null = 不提醒）；remindSeen：已经看过哪一次的提醒（那一次的日期）；
   entries：关联的手记 id。 */
function normalizeAnn(raw) {
  const a = { emoji: '', group: '', repeat: 'none', countMode: 'next', life: false, note: '', remind: null, remindSeen: '', entries: [], ...raw };
  const future = a.date > todayKey();
  if (typeof a.countdown !== 'boolean') a.countdown = a.repeat === 'yearly' ? a.countMode !== 'since' : future;
  if (typeof a.memorial !== 'boolean') a.memorial = a.repeat === 'yearly' ? a.countMode === 'since' : !future;
  return a;
}
function birthdayItem() {
  const L = state.life;
  return L.birth ? { id: BDAY_ID, title: '生日', emoji: '🎂', date: L.birth, repeat: 'yearly', group: '', life: false, note: '', birthday: true,
    countdown: true, memorial: false, remind: L.remind ?? null, remindSeen: L.remindSeen || '', entries: [] } : null;
}
const allDays = () => { const b = birthdayItem(); return b ? [b, ...state.days] : [...state.days]; };
const annById = id => allDays().find(a => a.id === id);
// 名称可以有好几行；只能放一行的地方用第一行
const annName = a => (a.title || '').split('\n').find(l => l.trim()) || '';
// 分类：按拖出来的顺序，没排过的按名字排在后面
function dayGroups() {
  const order = state.prefs.dayGroupOrder || [];
  const all = [...new Set(state.days.map(a => a.group).filter(Boolean))];
  const idx = g => { const i = order.indexOf(g); return i < 0 ? Infinity : i; };
  return all.sort((a, b) => idx(a) - idx(b) || a.localeCompare(b, 'zh'));
}

// 一个日子现在的状态：since 已经 N 天 / until 还有 N 天 / next 每年重复的，离下一次还有 N 天
function dayInfo(a, today = todayKey()) {
  const since = dayDiff(a.date, today);
  if (a.repeat === 'yearly' && since > 0 && a.countdown) {   // 标了“倒数日”的每年重复的日子：显示离下一次还有几天
    const nx = nextYearly(a.date, today);
    return { mode: 'next', target: nx.date, days: dayDiff(today, nx.date), since, nth: nx.n };
  }
  if (since >= 0) return { mode: 'since', target: a.date, days: since, since };
  return { mode: 'until', target: a.date, days: -since, since };
}
const nthLabel = (a, n) => a.birthday ? `${n} 岁生日` : `${n} 周年`;
function annSub(a, i) {
  if (i.mode === 'since') return `已经 · 自 ${fmtSmart(a.date)}`;
  if (i.mode === 'next') return `还有 · ${fmtSmart(i.target)} · ${nthLabel(a, i.nth)}`;
  return `还有 · ${fmtSmart(i.target)}`;
}
const numHTML = i => i.days === 0 ? '<span class="big-num">今天</span>' : `<span class="big-num">${fmtN(i.days)}</span><small>天</small>`;

// 时间节点：30 / 50 / 100 天……和每一个周年
function marksOf(a, today) {
  const out = DAY_MARKS.map(n => ({ label: `${n} 天纪念`, date: addDays(a.date, n) }));
  for (let y = 1; y <= 120; y++) out.push({ label: a.birthday ? `${y} 岁` : `${y} 周年`, date: yearsLater(a.date, y) });
  out.sort((x, y) => x.date.localeCompare(y.date));
  return { past: out.filter(m => m.date <= today), future: out.filter(m => m.date > today) };
}
// 列表里那一排小格子：离下一个节点走了多少
function annProgress(a, i, today) {
  if (i.mode === 'since') {
    const m = marksOf(a, today);
    const prev = m.past.length ? m.past[m.past.length - 1].date : a.date, nx = m.future[0];
    return nx ? dayDiff(prev, today) / Math.max(1, dayDiff(prev, nx.date)) : 1;
  }
  if (i.mode === 'next') { const last = yearsLater(a.date, i.nth - 1); return dayDiff(last, today) / Math.max(1, dayDiff(last, i.target)); }
  const from = (a.createdAt || '').slice(0, 10) || today;
  return from >= a.date ? 0 : Math.max(0, dayDiff(from, today)) / dayDiff(from, a.date);
}
const dotsHTML = (frac, n) => {
  const on = Math.round(Math.min(1, Math.max(0, frac)) * n);
  return `<span class="dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => k < on ? '<i class="on"></i>' : '<i></i>').join('')}</span>`;
};

// 年龄（带小数）：每过一个生日加 1
function ageAt(birth, k) {
  const [by, bm, bd] = birth.split('-').map(Number);
  let y = Number(k.slice(0, 4)) - by;
  if (clampDay(by + y, bm, bd) > k) y--;
  const start = clampDay(by + y, bm, bd), end = clampDay(by + y + 1, bm, bd);
  return y + dayDiff(start, k) / dayDiff(start, end);
}

/* ----- 时间轴：列表 + 详情 ----- */
// 只放已经过去（含今天）的日子：同一天的几件事放在同一个日期下面，名称可以有好几行，不显示天数
function tlDayHTML(day, items, sel) {
  return `<li class="tl-day"><p class="tl-date">${day}</p>${items.map(a =>
    `<button type="button" class="tl-ev" data-ann="${a.id}" aria-current="${a.id === sel}">${esc(a.title)}</button>`).join('')}</li>`;
}
// 一格一格的时间：格子太多时自动换成每格一周 / 一个月 / 一年
const UNITS = [[1, '一天'], [7, '一周'], [30.4375, '一个月'], [365.25, '一年']];
function gridHTML(a, i, today) {
  const COLS = 14, MAX = 140;
  const span = Math.max(1, i.days);       // 格子数和天数一致：已经 107 天 = 107 格，最后一格是今天
  const [size, unit] = UNITS.find(u => Math.ceil(span / u[0]) <= MAX) || UNITS[3];
  const n = Math.ceil(span / size);
  let cells = '', cap;
  if (i.mode === 'since') {
    const total = Math.ceil(n / COLS) * COLS + COLS;     // 多留一排空格：接下来的日子
    for (let k = 0; k < total; k++) {
      if (k >= n) { cells += '<i></i>'; continue; }
      const op = n > 1 ? (0.35 + 0.65 * k / (n - 1)).toFixed(2) : 1;
      cells += `<i class="on${k === n - 1 ? ' now' : ''}" style="opacity:${op}"></i>`;
    }
    cap = [`${shortDate(a.date)}`, '今天', `每格${unit} · 已走 ${fmtN(n)} 格`];
  } else {
    const total = Math.ceil(n / COLS) * COLS;
    for (let k = 0; k < total; k++) cells += k >= n ? '<i class="pad"></i>' : `<i class="${k === 0 ? 'now' : k === n - 1 ? 'goal' : ''}"></i>`;
    cap = ['今天', shortDate(i.target), `每格${unit} · 还有 ${fmtN(n)} 格`];
  }
  return `<div class="d-grid" aria-hidden="true">${cells}</div>
    <div class="d-cap"><span>${cap[0]}</span><span>${cap[1]}</span></div><p class="d-cap-note">${cap[2]}</p>`;
}
function marksHTML(a, today) {
  const m = marksOf(a, today);
  if (!m.past.length && !m.future.length) return '';
  const past = state.dAllMarks ? m.past : m.past.slice(-2);
  const future = m.future.slice(0, state.dAllMarks ? 8 : 3);
  const row = (k, cls, sub) => `<li class="mark ${cls}"><span class="mk-dot" aria-hidden="true"></span><span><b>${esc(k.label)}</b><span class="ann-sub">${fmtSmart(k.date)} · ${sub}</span></span></li>`;
  return `<section class="marks">
    <div class="td-row"><p class="d-label">时间节点</p>${m.past.length > 2 ? `<button type="button" class="text-btn" id="toggle-marks">${state.dAllMarks ? '收起' : '显示全部'}</button>` : ''}</div>
    <ol>${past.map(k => row(k, 'done', '已达成')).join('')}${future.map((k, j) => row(k, j === 0 ? 'next' : '', `${fmtN(dayDiff(today, k.date))} 天后`)).join('')}</ol>
  </section>`;
}
const remindLabel = n => n === 0 ? '当天提醒' : `提前 ${n} 天提醒`;
const entryTime = e => `${fmtFull(e.date.slice(0, 10))} ${e.date.slice(11, 16)}`;
const entryLabel = e => (e.title || plainText(e.body).split('\n').find(l => l.trim()) || '没有文字的日记').slice(0, 80);
// 关联的手记：点一下打开那篇的阅读页
function annEntriesHTML(a) {
  if (a.birthday) return '';
  const linked = (a.entries || []).map(id => state.entries.find(e => e.id === id)).filter(Boolean).sort((x, y) => x.date.localeCompare(y.date));
  const sameDay = state.entries.filter(e => e.date.slice(0, 10) === a.date && !(a.entries || []).includes(e.id)).length;
  return `<section class="d-entries">
    <div class="td-row"><p class="d-label">关联手记</p><button type="button" class="text-btn" id="ann-link">${linked.length ? '修改' : '＋ 关联手记'}</button></div>
    ${linked.map(e => `<button type="button" class="d-entry" data-openentry="${e.id}"><span class="ann-sub">${entryTime(e)}</span><span class="td-title">${esc(entryLabel(e))}</span></button>`).join('')}
    ${linked.length ? '' : `<p class="muted">${sameDay ? `这天写了 ${sameDay} 篇手记，可以关联起来。` : '还没有关联手记。'}</p>`}
  </section>`;
}
function annDetailHTML(a) {
  const today = todayKey(), i = dayInfo(a, today);
  const lines = [];
  if (i.mode === 'since') {
    const nx = marksOf(a, today).future[0];
    if (nx) lines.push(`再 ${fmtN(dayDiff(today, nx.date))} 天，就满 ${nx.label.replace('纪念', '')}了`);
    if (i.days >= 31) lines.push(`也就是 ${spanText(a.date, today)}`);
    lines.push(`${fmtFull(a.date)} 起`);
    if (a.repeat === 'yearly') { const nx2 = nextYearly(a.date, addDays(today, 1)); lines.push(`下一次 ${fmtSmart(nx2.date)} · ${nthLabel(a, nx2.n)} · 还有 ${fmtN(dayDiff(today, nx2.date))} 天`); }
  } else if (i.mode === 'next') {
    lines.push(`${fmtFull(i.target)} · ${nthLabel(a, i.nth)}`);
    lines.push(`从 ${fmtFull(a.date)} 起，已经 ${fmtN(i.since)} 天`);
  } else {
    lines.push(fmtFull(a.date));
    if (i.days >= 31) lines.push(`也就是 ${spanText(today, a.date)}以后`);
  }
  const tags = [a.group && '#' + a.group, a.countdown && '倒数日', a.memorial && '纪念日', a.life && '人生足迹', a.repeat === 'yearly' && '每年重复',
    a.remind != null && remindLabel(a.remind)].filter(Boolean);
  return `<article class="d-detail" aria-label="${esc(annName(a))}">
    ${isPhone() ? '<button type="button" class="back-link" id="ann-back">← 返回</button>' : ''}
    ${gridHTML(a, i, today)}
    <div class="d-head">${a.emoji ? `<span class="ann-emoji" aria-hidden="true">${esc(a.emoji)}</span>` : ''}<h3>${esc(a.title)}</h3>
      <button type="button" class="text-btn" id="ann-edit">${a.birthday ? '改出生日期' : '编辑'}</button></div>
    ${tags.length ? `<p class="d-meta">${esc(tags.join(' · '))}</p>` : ''}
    <div class="d-big"><span class="pre">${i.days === 0 ? '' : i.mode === 'since' ? '已经' : '还有'}</span>${numHTML(i)}</div>
    <div class="d-lines">${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
    ${a.note ? `<p class="d-note">${esc(a.note)}</p>` : ''}
    ${annEntriesHTML(a)}
    ${i.mode !== 'until' ? marksHTML(a, today) : ''}
  </article>`;
}
function renderDList() {
  const today = todayKey();
  const groups = dayGroups();
  state.dgroups = state.dgroups.filter(g => groups.includes(g));
  const inGroup = a => !state.dgroups.length || state.dgroups.includes(a.group);
  const gone = allDays().filter(a => inGroup(a) && a.date <= today)
    .sort((x, y) => y.date.localeCompare(x.date) || (x.createdAt || '').localeCompare(y.createdAt || ''));
  setTitle(state.dgroups.length ? state.dgroups.join(' + ') : '时间轴', `${gone.length} 条`);
  // 从“今日”点进来的以后的日子也能看详情，只是不在列表里
  let sel = annById(state.dsel);
  if (!sel || !inGroup(sel)) { sel = gone[0] || null; state.dsel = sel ? sel.id : null; }
  const phone = isPhone();
  if (phone && state.dopen && sel) { $('#timeline').innerHTML = annDetailHTML(sel); return; }
  state.dopen = false;
  // 分类：可以多选；电脑上按住拖动、手机上长按拖动可以排序
  const chips = groups.length ? `<div class="chips" role="group" aria-label="分类（可以多选）" data-sort-zone="dgroup" data-zone-id="">
    <button type="button" data-dgroup="" aria-pressed="${!state.dgroups.length}">全部</button>
    ${groups.map(g => `<button type="button" data-dgroup="${esc(g)}" data-sort-kind="dgroup" data-sort-id="${esc(g)}" aria-pressed="${state.dgroups.includes(g)}" title="可以多选；按住拖动排序">${esc(g)}</button>`).join('')}</div>` : '';
  const selId = phone ? null : state.dsel;
  let rows = '';
  if (gone.length) {
    let tl = '', day = '', items = [];
    for (const a of gone) {
      if (a.date !== day) { if (items.length) tl += tlDayHTML(day, items, selId); day = a.date; items = []; }
      items.push(a);
    }
    tl += tlDayHTML(day, items, selId);
    rows = `<ol class="tl">${tl}</ol>`;
  } else {
    rows = `<div class="empty"><p>${!state.days.length ? '还没有记下任何日子。' : state.dgroups.length ? '这个分类里还没有过去的日子。' : '还没有过去的日子。以后的日子在“今日”的倒数日里。'}</p><button type="button" class="btn" id="ann-new">记一个日子</button></div>`;
  }
  const listHTML = `<div class="d-list">${chips}${rows}</div>`;
  $('#timeline').innerHTML = phone ? listHTML : `<div class="d-split">${listHTML}<div class="d-side">${sel ? annDetailHTML(sel) : ''}</div></div>`;
}

/* ----- 今日 ----- */
function smallRowHTML({ a, i }) {
  const n = i.days === 0 ? '今天' : `${i.mode === 'since' ? '已' : '还有'} <b>${fmtN(i.days)}</b> 天`;
  const sub = i.mode === 'since' ? `自 ${fmtSmart(a.date)}` : fmtSmart(i.target);
  return `<button type="button" class="td-item" data-goann="${a.id}">
    <span class="ann-emoji" aria-hidden="true">${esc(a.emoji)}</span>
    <span class="ann-main"><span class="td-title">${esc(annName(a))}</span><span class="ann-sub">${esc(sub)}</span></span>
    <span class="td-n">${n}</span></button>`;
}
function renderDToday() {
  const today = todayKey(), now = new Date();
  const items = allDays().map(a => ({ a, i: dayInfo(a, today) }));
  // 倒数日：标了“倒数日”、还没到（或每年重复的下一次）；纪念日：标了“纪念日”的，显示已经多少天
  const coming = items.filter(x => x.a.countdown && x.i.mode !== 'since').sort((x, y) => x.i.days - y.i.days);
  const memorials = items.filter(x => x.a.memorial)
    .map(x => x.i.mode === 'next' ? { a: x.a, i: { mode: 'since', target: x.a.date, days: x.i.since, since: x.i.since } } : x)
    .sort((x, y) => y.a.date.localeCompare(x.a.date));
  const y = now.getFullYear();
  const frac = (now - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1));
  const [, m, d] = today.split('-').map(Number);
  const next = coming[0];
  const own = items.filter(x => !x.a.birthday);
  const sumDays = own.reduce((s, x) => s + Math.max(0, x.i.since), 0);
  // 已陪伴：从记下第一个日子那天算起
  const firstRec = state.days.map(a => (a.createdAt || '').slice(0, 10)).filter(Boolean).sort()[0];
  const thisYear = state.days.filter(a => a.date.startsWith(String(y))).length;
  setTitle('今日', '');
  const sTop = `<section class="td-top">
      ${next ? `<p class="td-hint">离 ${esc(annName(next.a))} ${next.i.days ? `还有 ${fmtN(next.i.days)} 天` : '就是今天'}</p>` : ''}
      <div class="td-date"><span class="big-num">${m}月${d}日</span><span class="td-wk">${WEEK_FULL[now.getDay()]}</span></div>
    </section>`;
  const sYear = `<section>
      <div class="td-row"><p class="d-label">今年已过</p><span class="td-pct">${(frac * 100).toFixed(1)}%</span></div>
      <span title="每格一周">${dotsHTML(frac, 52)}</span>
    </section>`;
  const sNext = `<section>
      <p class="d-label">倒数日</p>
      ${next ? `<button type="button" class="td-next" data-goann="${next.a.id}">
          <span class="ann-main"><span class="td-title"><span class="ann-emoji" aria-hidden="true">${esc(next.a.emoji)}</span>${esc(annName(next.a))}</span>
          <span class="ann-sub">${esc(annSub(next.a, next.i))}</span></span>
          <span class="ann-num">${numHTML(next.i)}</span></button>
          ${coming.slice(1).map(smallRowHTML).join('')}`
        : `<p class="muted">还没有标为“倒数日”的日子。</p>`}
    </section>`;
  const sPast = `<section>
      <p class="d-label">纪念日</p>
      ${memorials.length ? memorials.map(smallRowHTML).join('') : `<p class="muted">还没有标为“纪念日”的日子。<button type="button" class="slot-write" id="ann-new">记一个</button></p>`}
    </section>`;
  const sLedger = `<section class="ledger">
      <p class="d-label">时间账本</p>
      <p class="ledger-lead">记下的日子加起来，已经走过</p>
      <p class="ledger-big"><span class="big-num">${fmtN(sumDays)}</span><small>天</small></p>
      <div class="ledger-row">
        <div><span class="big-num">${thisYear}</span><span class="ann-sub">今年记下的日子</span></div>
        <div><span class="big-num">${state.days.length}</span><span class="ann-sub">一共记着</span></div>
      </div>
      ${firstRec ? `<p class="ledger-note">已陪伴 ${fmtN(Math.max(0, dayDiff(firstRec, today)) + 1)} 天</p>` : ''}
    </section>`;
  // 电脑：左栏 日期 / 今年已过 / 时间账本，右栏 倒数日 / 纪念日。手机：一栏。时间刻度在“人生”页最后
  $('#timeline').innerHTML = isPhone()
    ? `<div class="today"><div class="td-col">${sTop}${sYear}${sNext}${sPast}${sLedger}</div></div>`
    : `<div class="today"><div class="td-col">${sTop}${sYear}${sLedger}</div><div class="td-col">${sNext}${sPast}</div></div>`;
}
// 时间刻度：在世界上逗留了多久 + 今年 / 本月 / 本周过了多少
function timeScaleHTML(now) {
  const today = todayKey();
  const cell = (num, unit) => `<div class="ts-cell"><span class="big-num">${fmtN(num)}</span><span class="ann-sub">${unit}</span></div>`;
  const pulse = (label, start, end) => {
    const pct = Math.round((now - start) / (end - start) * 100);
    const left = dayDiff(today, dayKey(new Date(end - 1))) + 1;
    return `<div class="ts-cell"><span class="ann-sub">${label}</span><span class="ts-pct"><span class="big-num">${pct}</span><small>%</small></span><span class="ann-sub">含今天，剩 ${left} 天</span></div>`;
  };
  const y = now.getFullYear(), m = now.getMonth();
  const wk = new Date(y, m, now.getDate() - (now.getDay() + 6) % 7);
  let stay = `<p class="muted">填写出生日期后，这里会显示你在世界上逗留了多久。<button type="button" class="slot-write" id="life-settings">填写出生日期</button></p>`;
  const b = state.life.birth;
  if (b) {
    const [by, bm, bd] = b.split('-').map(Number);
    const born = new Date(by, bm - 1, bd), ms = now - born, days = dayDiff(b, today);
    const months = (y - by) * 12 + (m + 1 - bm) - (now.getDate() < bd ? 1 : 0);
    stay = `<div class="ts-grid">${cell(Math.floor(ageAt(b, today)), '年')}${cell(months, '月')}${cell(Math.floor(days / 7), '周')}
      ${cell(days, '天')}${cell(Math.floor(ms / 3600000), '时')}${cell(Math.floor(ms / 60000), '分')}</div>`;
  }
  return `<section class="tscale">
      <p class="d-label">时间刻度</p>
      <p class="ts-h">逗留了</p>${stay}
      <p class="ts-h">时间脉搏</p>
      <div class="ts-grid">${pulse('今年', new Date(y, 0, 1), new Date(y + 1, 0, 1))}${pulse('本月', new Date(y, m, 1), new Date(y, m + 1, 1))}${pulse('本周', wk, new Date(wk.getFullYear(), wk.getMonth(), wk.getDate() + 7))}</div>
    </section>`;
}

/* ----- 人生：每个点是一个月，一行两年 ----- */
function lifeDotsHTML(birth, span, age, sel, events) {
  const total = span * 12, nowM = Math.floor(age * 12);
  const ev = new Map();
  for (const e of events) {
    if (e.date < birth) continue;
    const mi = Math.floor(ageAt(birth, e.date) * 12);
    if (mi >= 0 && mi < total && !ev.has(mi)) ev.set(mi, e);
  }
  let s = '';
  for (let mi = 0; mi < total; mi++) {
    const yr = Math.floor(mi / 12);
    const cls = [mi < nowM ? 'past' : mi === nowM ? 'now' : '', yr === sel && 'sel'].filter(Boolean).join(' ');
    const e = ev.get(mi);
    if (e && e.emoji) s += `<span class="ld ev${yr === sel ? ' sel' : ''}" data-lifeage="${yr}" title="${esc(annName(e))} · ${yr} 岁">${esc(e.emoji)}</span>`;
    else s += `<span class="ld ${cls}${e ? ' mark' : ''}" data-lifeage="${yr}" title="${e ? esc(annName(e)) + ' · ' : ''}${yr} 岁${mi === nowM ? ' · 现在' : ''}"></span>`;
  }
  return `<div class="life-dots" role="img" aria-label="从出生到 ${span} 岁，每个点是一个月">${s}</div>`;
}
function renderDLife() {
  setTitle('人生', '');
  const L = state.life;
  if (!L.birth) {
    $('#timeline').innerHTML = `<div class="empty"><p>“人生”页面按出生日期来画：从出生到老，每个点是一个月。</p><button type="button" class="btn" id="life-settings">填写出生日期</button></div>`;
    return;
  }
  const today = todayKey(), span = L.lifespan || 88;
  const age = ageAt(L.birth, today);
  const cur = Math.floor(age);
  const sel = Math.min(span - 1, Math.max(0, state.lifeAge ?? cur));
  const evs = state.days.filter(a => a.life).sort((x, y) => y.date.localeCompare(x.date));
  const inYear = evs.filter(a => a.date >= L.birth && Math.floor(ageAt(L.birth, a.date)) === sel).reverse();
  const nextBday = nextYearly(L.birth, addDays(today, 1));
  const yStart = yearsLater(L.birth, sel), yEnd = addDays(yearsLater(L.birth, sel + 1), -1);
  const ago = a => { const n = dayDiff(a.date, today); return n > 0 ? `${fmtN(n)} 天前` : n === 0 ? '今天' : `还有 ${fmtN(-n)} 天`; };
  let fps = '', year = '';
  for (const a of evs) {
    if (a.date.slice(0, 4) !== year) { year = a.date.slice(0, 4); fps += `<li class="fp-year">${year}</li>`; }
    const ageTxt = a.date >= L.birth ? ` · ${Math.floor(ageAt(L.birth, a.date))} 岁` : '';
    fps += `<li><button type="button" class="fp" data-goann="${a.id}"><span class="ann-emoji" aria-hidden="true">${esc(a.emoji)}</span>
      <span class="ann-main"><span class="td-title">${esc(annName(a))}</span><span class="ann-sub">${shortDate(a.date)}${ageTxt} · ${ago(a)}</span></span></button></li>`;
  }
  // 时间刻度放在“人生”页最后：电脑在左栏最下面，手机在整页最下面
  const phone = isPhone(), sScale = timeScaleHTML(new Date());
  $('#timeline').innerHTML = `<div class="life">
    <div class="life-col">
      <div class="life-head">
        <div><p class="life-pct"><span class="big-num">${(age / span * 100).toFixed(1)}%</span></p>
          <p class="ann-sub">人生第 ${cur + 1} 年 · 已走过 ${fmtN(dayDiff(L.birth, today))} 天</p></div>
        <button type="button" class="text-btn" id="life-settings">设置</button>
      </div>
      ${lifeDotsHTML(L.birth, span, age, sel, evs)}
      <div class="td-row life-foot"><span>${Math.floor(age * 12) + 1} / ${span * 12} 个月</span><span>每个点是一个月 · 点一下看那一年</span></div>
      <section class="life-year">
        <div class="td-row"><h3>${sel} 岁这一年</h3><span class="life-nav">
          <button type="button" class="text-btn" data-lifeage="${sel - 1}" ${sel <= 0 ? 'disabled' : ''} aria-label="前一年">‹</button>
          ${sel !== cur ? `<button type="button" class="text-btn" data-lifeage="${cur}">回到今年</button>` : ''}
          <button type="button" class="text-btn" data-lifeage="${sel + 1}" ${sel >= span - 1 ? 'disabled' : ''} aria-label="后一年">›</button></span></div>
        <p class="ann-sub">${shortDate(yStart)} – ${shortDate(yEnd)}${sel === cur ? ' · 就是现在' : ''}</p>
        ${inYear.length ? `<ul class="fp-list">${inYear.map(a => `<li><button type="button" class="fp" data-goann="${a.id}"><span class="ann-emoji" aria-hidden="true">${esc(a.emoji)}</span><span class="ann-main"><span class="td-title">${esc(annName(a))}</span><span class="ann-sub">${fmtSmart(a.date)}</span></span></button></li>`).join('')}</ul>`
          : `<p class="muted">这一年还没有记下人生足迹。</p>`}
      </section>
      <section class="life-next"><p class="d-label">下一站</p><p>再过 ${fmtN(dayDiff(today, nextBday.date))} 天，迎来 ${nextBday.n} 岁生日</p></section>
      ${phone ? '' : sScale}
    </div>
    <div class="life-col">
      <div class="td-row"><p class="d-label">人生足迹</p><button type="button" class="text-btn" id="ann-new" data-life="1">＋ 添加</button></div>
      ${evs.length ? `<ol class="fp-list fp-line">${fps}</ol>` : `<p class="muted">新建日子时勾选“放进人生足迹”，重要的事就会出现在这里，也会标在上面的点阵里。</p>`}
      ${phone ? sScale : ''}
    </div>
  </div>`;
}

/* ----- 日历：有日子的那天显示 emoji ----- */
// 某个月里每天有哪些日子（每年重复的也算上，比如生日）
function eventsInMonth(ym) {
  const y = Number(ym.slice(0, 4)), map = new Map();
  for (const a of allDays()) {
    let k = a.date;
    if (a.repeat === 'yearly') { const n = y - Number(a.date.slice(0, 4)); if (n < 0) continue; k = yearsLater(a.date, n); }
    if (k.slice(0, 7) !== ym) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(a);
  }
  return map;
}
// 电脑侧栏里的小日历：有日子的那天显示 emoji，点一下打开那个日子
function renderDaysSideCal() {
  const ym = state.dcalMonth, [y, m] = ym.split('-').map(Number);
  const evs = eventsInMonth(ym), today = todayKey();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, daysIn = new Date(y, m, 0).getDate();
  let cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="wd" aria-hidden="true">${w}</span>`).join('') + '<span></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const k = `${ym}-${pad(d)}`, list = evs.get(k) || [];
    const ev = list.find(a => a.emoji);
    const selDay = state.dview === 'list' && state.dsel && (annById(state.dsel) || {}).date;
    const cls = ['cal-day', k === today && 'today', k === selDay && 'sel', ev && 'emo', list.length && !ev && 'has', list.length > 1 && 'more'].filter(Boolean).join(' ');
    const names = list.map(annName).join('、');
    cells += `<button type="button" class="${cls}" ${list.length ? `data-dgo="${list[0].id}" title="${esc(names)}"` : 'tabindex="-1"'} aria-label="${m}月${d}日${names ? '：' + esc(names) : ''}">${ev ? esc(ev.emoji) : d}</button>`;
  }
  $('#days-cal').innerHTML = `<div class="cal-head"><button type="button" data-dcal="-1" aria-label="上个月">‹</button><span>${y} · ${MONTH_CN[m - 1]}</span><button type="button" data-dcal="1" aria-label="下个月">›</button></div><div class="cal-grid">${cells}</div>`;
}
function renderDCal() {
  const ym = state.dcalMonth, [y, m] = ym.split('-').map(Number);
  const today = todayKey();
  const evs = eventsInMonth(ym);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, daysIn = new Date(y, m, 0).getDate();
  setTitle(`${y}年${m}月`, '日历');
  let cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="ec-wd" aria-hidden="true">${w}</span>`).join('') + '<span></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const k = `${ym}-${pad(d)}`, list = evs.get(k) || [];
    const first = list[0];
    const cls = ['ec-day', k === today && 'today', k === state.dcalDay && 'sel', list.length && !(first && first.emoji) && 'has'].filter(Boolean).join(' ');
    const label = list.length ? `${m}月${d}日：${list.map(annName).join('、')}` : `${m}月${d}日`;
    cells += `<button type="button" class="${cls}" data-dday="${k}" aria-label="${esc(label)}">
      ${first && first.emoji ? `<span class="ec-emoji">${esc(first.emoji)}</span>` : `<span class="ec-num">${d}</span>`}${list.length > 1 ? '<i class="ec-more" aria-hidden="true"></i>' : ''}</button>`;
  }
  // 右边（手机在下面）：选中的那天，没选就列出这个月
  const day = state.dcalDay && state.dcalDay.startsWith(ym) ? state.dcalDay : null;
  const rowOf = a => smallRowHTML({ a, i: dayInfo(a, today) });
  let side;
  if (day) {
    const [, , dd] = day.split('-').map(Number);
    const n = state.entries.filter(e => e.date.slice(0, 10) === day).length;
    const list = evs.get(day) || [];
    side = `<p class="d-label">${m}月${dd}日 ${wkOf(day)}</p>
      ${list.length ? list.map(rowOf).join('') : '<p class="muted">这一天没有记下日子。</p>'}
      <div class="ec-links">${n ? `<button type="button" class="slot-write" data-jday="${day}">这天写了 ${n} 篇手记 →</button>` : ''}
        <button type="button" class="slot-write" id="ann-new" data-date="${day}">在这天记一个日子</button></div>`;
  } else {
    const all = [...evs.entries()].sort((p, q) => p[0].localeCompare(q[0]));
    side = `<p class="d-label">这个月</p>${all.length ? all.map(([, list]) => list.map(rowOf).join('')).join('') : '<p class="muted">这个月没有记下日子。</p>'}`;
  }
  $('#timeline').innerHTML = `<div class="ecal-wrap">
    <div>
      <div class="ec-head"><button type="button" class="text-btn" data-dcal="-1" aria-label="上个月">‹ 上个月</button>
        ${ym !== today.slice(0, 7) ? '<button type="button" class="text-btn" id="dcal-today">回到这个月</button>' : ''}
        <button type="button" class="text-btn" data-dcal="1" aria-label="下个月">下个月 ›</button></div>
      <div class="ec-grid">${cells}</div>
    </div>
    <div class="ec-side">${side}</div>
  </div>`;
}

function renderDays() {
  $('#banner-slot').innerHTML = '';
  if (state.dview === 'today') return renderDToday();
  if (state.dview === 'life') return renderDLife();
  if (state.dview === 'cal') { if (isPhone()) return renderDCal(); state.dview = 'today'; return renderDToday(); }
  return renderDList();
}
function goAnn(id) {
  const a = annById(id);
  if (!a) return;
  state.section = 'days'; state.dview = 'list'; state.dsel = id; state.dopen = isPhone();
  if (state.dgroups.length && !state.dgroups.includes(a.group)) state.dgroups = [];
  state.readFrom = null;
  state.dAllMarks = false;
  closeMPanel(); render(); scrollTop();
}

/* ----- 新建 / 编辑一个日子（浮在上面的小纸） ----- */
function newAnn(extra = {}) {
  return {
    id: uid(), title: '', date: todayKey(), emoji: '', group: state.dview === 'list' && state.dgroups.length === 1 ? state.dgroups[0] : '',
    repeat: 'none', countdown: false, memorial: false, life: state.dview === 'life', remind: null, remindSeen: '', entries: [], note: '',
    createdAt: new Date().toISOString(), updatedAt: null, ...extra,
  };
}
const REMIND_OPTS = [['', '不提醒'], ['0', '当天'], ['1', '提前 1 天'], ['3', '提前 3 天'], ['7', '提前 7 天']];
const remindSelect = (id, v) => `<select id="${id}" class="dialog-input">${REMIND_OPTS.map(([k, l]) => `<option value="${k}" ${String(v ?? '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
function openAnnEditor(a, isNew) {
  if (a.birthday) return openLifeSettings();
  closeMPanel();
  state.dEditing = { kind: 'ann', a: { ...a }, isNew, flagsTouched: !isNew };
  $('#editor').innerHTML = `<div class="dialog ann-form" role="dialog" aria-modal="true" aria-label="${isNew ? '记一个日子' : '编辑日子'}">
    <div class="af-top">
      <label class="sr-only" for="af-emoji">图标（一个 emoji）</label>
      <input id="af-emoji" class="af-emoji" value="${esc(a.emoji)}" placeholder="☺" autocomplete="off">
      <label class="sr-only" for="af-title">内容</label>
      <textarea id="af-title" class="af-title" rows="1" placeholder="发生了什么？可以写好几行">${esc(a.title)}</textarea>
    </div>
    <div class="af-picks" role="group" aria-label="常用图标">${EMOJI_PICKS.map(e => `<button type="button" data-pick="${e}">${e}</button>`).join('')}</div>
    <label class="dialog-label" for="af-date">日期</label>
    <input type="date" id="af-date" class="dialog-input" value="${esc(a.date)}">
    <label class="dialog-label" for="af-group">分类（可以不填）</label>
    <input id="af-group" class="dialog-input" list="af-groups" value="${esc(a.group)}" placeholder="比如：英国、攀岩、DDL" autocomplete="off">
    <datalist id="af-groups">${dayGroups().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <label class="af-check"><input type="checkbox" id="af-repeat" ${a.repeat === 'yearly' ? 'checked' : ''}> 每年重复（生日、周年纪念）</label>
    <div class="af-flags" role="group" aria-label="标记">
      <label class="af-check"><input type="checkbox" id="af-countdown" ${a.countdown ? 'checked' : ''}> 倒数日</label>
      <label class="af-check"><input type="checkbox" id="af-memorial" ${a.memorial ? 'checked' : ''}> 纪念日</label>
      <label class="af-check"><input type="checkbox" id="af-life" ${a.life ? 'checked' : ''}> 放进人生足迹</label>
    </div>
    <p class="af-hint">倒数日、纪念日会出现在“今日”页。</p>
    <label class="dialog-label" for="af-remind">提醒（打开网站时先看到）</label>
    ${remindSelect('af-remind', a.remind)}
    <label class="dialog-label" for="af-note">备注（可以不写）</label>
    <textarea id="af-note" class="dialog-input af-note" rows="2">${esc(a.note)}</textarea>
    <div class="row">${isNew ? '' : '<button type="button" class="text-btn danger" id="af-del">删除</button>'}<span class="grow"></span>
      <button type="button" class="btn ghost" id="af-cancel">取消</button><button type="button" class="btn" id="af-save" title="⌘↵">保存</button></div>
  </div>`;
  $('#editor').hidden = false;
  fitAnnTitle();
  $('#af-title').focus();
}
// 内容框跟着文字变高
function fitAnnTitle() {
  const ta = $('#af-title');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
function readAnnForm() {
  const r = $('#af-remind').value;
  return {
    ...state.dEditing.a,
    emoji: firstGrapheme($('#af-emoji').value.trim()),
    title: $('#af-title').value.replace(/^\s*\n/, '').trimEnd(),
    date: $('#af-date').value,
    group: $('#af-group').value.trim().replace(/^#/, ''),
    repeat: $('#af-repeat').checked ? 'yearly' : 'none',
    countdown: $('#af-countdown').checked,
    memorial: $('#af-memorial').checked,
    life: $('#af-life').checked,
    remind: r === '' ? null : Number(r),
    note: $('#af-note').value.trim(),
  };
}
function annDirty() {
  const ed = state.dEditing;
  if (!ed) return false;
  if (ed.kind === 'links') return ed.changed;
  if (ed.kind !== 'ann') return false;
  const now = readAnnForm();
  return ['emoji', 'title', 'date', 'group', 'repeat', 'countdown', 'memorial', 'life', 'remind', 'note'].some(k => now[k] !== ed.a[k]);
}
function closeAnnEditor() { state.dEditing = null; $('#editor').hidden = true; $('#editor').innerHTML = ''; }
async function cancelAnnEditor() {
  if (annDirty() && !await askConfirm('放弃这次修改？', '放弃')) return;
  closeAnnEditor();
}
async function saveAnn() {
  const ed = state.dEditing;
  if (!ed) return;
  const a = readAnnForm();
  if (!a.title.trim()) { toast('写点内容吧'); $('#af-title').focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) { toast('请选一个日期'); $('#af-date').focus(); return; }
  a.updatedAt = new Date().toISOString();
  $('#af-save').disabled = true;
  try { await Store.put('anniversaries', a); }
  catch (err) {
    $('#af-save').disabled = false;
    toast('没能保存，可能是网络断了。内容还在，联网后再点“保存”。', 6000);
    return;
  }
  const i = state.days.findIndex(x => x.id === a.id);
  if (i >= 0) state.days[i] = a; else state.days.push(a);
  closeAnnEditor();
  if (state.dview === 'list') { state.dsel = a.id; if (state.dgroups.length && !state.dgroups.includes(a.group)) state.dgroups = []; }
  render();
  toast(ed.isNew ? '已保存' : '已更新');
}
async function deleteAnn() {
  const a = state.dEditing.a;
  if (!await askConfirm(`删除“${annName(a)}”？删除后无法恢复。`, '删除')) return;
  try { await Store.del('anniversaries', a.id); } catch (err) { toast('没能删除，可能是网络断了，请稍后再试。', 5000); return; }
  state.days = state.days.filter(x => x.id !== a.id);
  if (state.dsel === a.id) { state.dsel = null; state.dopen = false; }
  closeAnnEditor();
  render();
  toast('已删除');
}

/* ----- 关联手记：选哪几篇手记和这个日子放在一起 ----- */
function openLinkDialog(a) {
  closeMPanel();
  state.dEditing = { kind: 'links', a, sel: new Set((a.entries || []).filter(id => state.entries.some(e => e.id === id))), day: a.date, changed: false };
  renderLinkDialog();
  $('#editor').hidden = false;
}
function renderLinkDialog() {
  const ed = state.dEditing;
  const byDate = (x, y) => x.date.localeCompare(y.date);
  const dayList = state.entries.filter(e => e.date.slice(0, 10) === ed.day).sort(byDate);
  const others = [...ed.sel].map(id => state.entries.find(e => e.id === id)).filter(e => e && e.date.slice(0, 10) !== ed.day).sort(byDate);
  const row = e => `<label class="lk-row"><input type="checkbox" data-lkentry="${e.id}" ${ed.sel.has(e.id) ? 'checked' : ''}>
    <span class="ann-main"><span class="ann-sub">${entryTime(e)}</span><span class="lk-title">${esc(entryLabel(e))}</span></span></label>`;
  $('#editor').innerHTML = `<div class="dialog ann-form" role="dialog" aria-modal="true" aria-labelledby="lk-h">
    <p id="lk-h" class="lk-h">勾选要和“${esc(annName(ed.a))}”关联的手记</p>
    <label class="dialog-label" for="lk-day">看哪一天的手记</label>
    <input type="date" id="lk-day" class="dialog-input" value="${ed.day}">
    <div class="lk-list">${dayList.length ? dayList.map(row).join('') : '<p class="muted">这一天没有手记。</p>'}</div>
    ${others.length ? `<p class="dialog-label lk-other">已关联的其他日子</p><div class="lk-list">${others.map(row).join('')}</div>` : ''}
    <div class="row"><span class="grow"></span><button type="button" class="btn ghost" id="af-cancel">取消</button><button type="button" class="btn" id="lk-save" title="⌘↵">保存</button></div>
  </div>`;
}
async function saveLinks() {
  const ed = state.dEditing;
  const a = state.days.find(x => x.id === ed.a.id);
  if (!a) return closeAnnEditor();
  const next = { ...a, entries: [...ed.sel], updatedAt: new Date().toISOString() };
  $('#lk-save').disabled = true;
  try { await Store.put('anniversaries', next); } catch (err) { $('#lk-save').disabled = false; toast('没能保存，可能是网络断了。', 5000); return; }
  state.days[state.days.indexOf(a)] = next;
  closeAnnEditor();
  render();
}

/* ----- 提醒：到了提醒的日子，打开网站先看到 ----- */
// 这一次提醒的是哪一天（每年重复的看下一次）；不用提醒就返回 null
function remindTarget(a, today) {
  if (a.remind == null) return null;
  const target = a.repeat === 'yearly' ? nextYearly(a.date, today).date : a.date;
  if (target < today || dayDiff(today, target) > a.remind || a.remindSeen === target) return null;
  return target;
}
function showReminders() {
  const today = todayKey();
  const due = allDays().map(a => ({ a, target: remindTarget(a, today) })).filter(x => x.target).sort((x, y) => x.target.localeCompare(y.target));
  if (!due.length || !$('#confirm').hidden) return;
  const box = $('#confirm');
  box.innerHTML = `<div class="dialog remind-box" role="alertdialog" aria-modal="true" aria-labelledby="rm-h">
    <p class="d-label" id="rm-h">提醒</p>
    ${due.map(({ a, target }) => {
      const n = dayDiff(today, target);
      const nth = a.repeat === 'yearly' ? ' · ' + nthLabel(a, nextYearly(a.date, today).n) : '';
      return `<button type="button" class="td-item" data-rmgo="${a.id}"><span class="ann-emoji" aria-hidden="true">${esc(a.emoji)}</span>
        <span class="ann-main"><span class="td-title">${esc(annName(a))}</span><span class="ann-sub">${fmtFull(target)}${nth}</span></span>
        <span class="td-n">${n ? `还有 <b>${n}</b> 天` : '就是今天'}</span></button>`;
    }).join('')}
    <div class="row"><button type="button" class="btn" id="rm-ok">知道了</button></div></div>`;
  box.hidden = false;
  $('#rm-ok').focus();
  const close = () => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };   // Esc：先关掉，下次打开还会提醒
  document.addEventListener('keydown', onKey, true);
  $('#rm-ok').onclick = () => { close(); markRemindersSeen(due); };
  box.querySelectorAll('[data-rmgo]').forEach(b => { b.onclick = () => { close(); markRemindersSeen(due); goAnn(b.dataset.rmgo); }; });
}
// 记下“这一次已经看过了”（存在数据库里，换手机也不会再弹）
async function markRemindersSeen(due) {
  const anns = [];
  let life = null;
  for (const { a, target } of due) {
    if (a.birthday) life = { ...state.life, remindSeen: target };
    else { const x = state.days.find(d => d.id === a.id); if (x) anns.push({ ...x, remindSeen: target }); }
  }
  try {
    if (anns.length) await Store.putMany('anniversaries', anns);
    if (life) await Store.put('meta', life);
  } catch (err) { toast('没能记下“已看过”，下次打开还会提醒', 4000); return; }
  anns.forEach(n => { state.days[state.days.findIndex(d => d.id === n.id)] = n; });
  if (life) state.life = life;
}
function openLifeSettings() {
  closeMPanel();
  state.dEditing = { kind: 'life' };
  $('#editor').innerHTML = `<div class="dialog ann-form" role="dialog" aria-modal="true" aria-labelledby="lf-h">
    <p id="lf-h">“人生”页面按出生日期来画，生日也会自动出现在倒数里。</p>
    <label class="dialog-label" for="lf-birth">出生日期</label>
    <input type="date" id="lf-birth" class="dialog-input" value="${esc(state.life.birth)}">
    <label class="dialog-label" for="lf-span">这条线画到多少岁</label>
    <input type="number" id="lf-span" class="dialog-input" min="30" max="120" inputmode="numeric" value="${state.life.lifespan || 88}">
    <label class="dialog-label" for="lf-remind">生日提醒</label>
    ${remindSelect('lf-remind', state.life.remind)}
    <div class="row"><span class="grow"></span><button type="button" class="btn ghost" id="af-cancel">取消</button><button type="button" class="btn" id="lf-save">保存</button></div>
  </div>`;
  $('#editor').hidden = false;
  $('#lf-birth').focus();
}
async function saveLife() {
  const birth = $('#lf-birth').value, span = Math.round(Number($('#lf-span').value) || 88);
  if (birth && birth > todayKey()) { toast('出生日期不能晚于今天'); return; }
  if (span < 30 || span > 120) { toast('请填 30 到 120 之间的数字'); return; }
  const r = $('#lf-remind').value;
  const life = { ...state.life, key: 'life', birth, lifespan: span, remind: r === '' ? null : Number(r) };
  try { await Store.put('meta', life); } catch (err) { toast('没能保存，可能是网络断了。', 5000); return; }
  state.life = life;
  state.lifeAge = null;
  closeAnnEditor();
  render();
  toast('已保存');
}

function renderMain() {
  const journal = state.section === 'journal';
  const reading = journal && state.page === 'journal' && !!state.reading;
  $('#new-btn').hidden = journal && reading;
  $('#new-btn').textContent = journal ? '写一篇' : '记一个日子';
  $('#fab').hidden = journal ? reading : state.dopen;
  $('#fab').textContent = journal ? '写' : '＋';
  $('#fab').setAttribute('aria-label', journal ? '写一篇日记' : '记一个日子');
  $('#rd-back').hidden = !reading;
  $('#rd-edit').hidden = !reading;
  $('#mbar').hidden = !journal;
  $('#dbar').hidden = journal;
  $('#main').classList.toggle('wide', !journal);
  if (!journal) return renderDays();
  if (state.page === 'stats') return renderStatsPage();
  if (reading) return renderReader();
  $('#banner-slot').innerHTML = '';
  const list = filtered();
  const view = VIEWS.find(v => v.id === state.view);
  if (view.years) renderYears(list, view); else renderTimeline(list);
}
function render() { renderSide(); renderMain(); }

/* ---------- 阅读页：点日记先看全文，右上角“编辑”才进编辑页 ---------- */
const fmtEdited = iso => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function audiosHTML(audios, removable) {
  return audios.map(a => `<div class="audio-item">
      <audio controls preload="none" data-media="${a.id}"></audio>
      <span class="name" title="${esc(a.name)}">${esc(a.name || '录音')}${a.size ? ' · ' + fmtSize(a.size) : ''}</span>
      ${removable ? `<button type="button" data-rmaudio="${a.id}" aria-label="移除录音 ${esc(a.name)}">移除</button>` : ''}</div>`).join('');
}
// 链接卡片：标题、作者 · 网站名、一两行简介（不存图片）
function linksHTML(links, removable) {
  return links.map((l, i) => {
    const by = [l.author, l.site || domainOf(l.url)].filter(Boolean);
    return `<div class="link-card">
      <span class="lc-mark" aria-hidden="true">${esc((l.site || domainOf(l.url) || '↗').slice(0, 1).toUpperCase())}</span>
      <span class="lc-main">
        <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="lc-title">${esc(l.title || l.url)}</a>
        <span class="lc-by">${esc(by.join(' · '))}</span>
        ${l.desc ? `<span class="lc-desc">${esc(l.desc)}</span>` : ''}
        ${removable && !l.fetched ? `<button type="button" class="lc-fetch" data-fetchlink="${i}">读取标题和作者</button>` : ''}
      </span>
      ${removable ? `<button type="button" class="lc-rm" data-rmlink="${i}" aria-label="移除链接">×</button>` : ''}</div>`;
  }).join('');
}
/* 读取链接的标题、作者、网站名：浏览器不能直接读别的网站，借用免费的 microlink（每天 50 次，只发送链接网址）。
   读不到也没关系，卡片照样显示网址。 */
async function fetchLinkInfo(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url), { signal: ctl.signal });
    const j = await res.json();
    if (j.status !== 'success' || !j.data) return null;
    const d = j.data, clip = (v, n) => (v || '').replace(/\s+/g, ' ').trim().slice(0, n);
    return { title: clip(d.title, 200), author: clip(d.author, 60), site: clip(d.publisher, 40), desc: clip(d.description, 160) };
  } catch (err) { return null; } finally { clearTimeout(timer); }
}
async function fillLinkInfo(link) {
  const ed = state.editing;
  setAddBusy('正在读取链接信息……');
  const info = await fetchLinkInfo(link.url);
  if (state.editing !== ed) return;
  setAddBusy('');
  link.fetched = true;
  if (info) {
    if (!link.title) link.title = info.title;
    ['author', 'site', 'desc'].forEach(k => { if (info[k] && !link[k]) link[k] = info[k]; });
  } else toast('没能读到这个链接的信息，卡片会显示网址');
  renderEdLinks();
}
// 阅读页直接显示在右栏（主区）。“← 返回”回到列表，并回到原来看到的位置
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
const mainScroll = () => isPhone() ? window.scrollY : $('#main').scrollTop;
const setMainScroll = y => { $('#main').scrollTop = y; window.scrollTo(0, y); };
function openReader(id) {
  if (!state.entries.some(x => x.id === id)) return;
  closeMPanel();
  if (!state.reading) state.listScroll = mainScroll();
  state.reading = id;
  renderMain();
  setMainScroll(0);
  $('#rd-back').focus({ preventScroll: true });
}
function closeReader() {
  if (state.readFrom === 'days') {        // 从时间轴详情打开的手记：回到时间轴
    state.readFrom = null; state.reading = null; state.section = 'days';
    render(); return;
  }
  const id = state.reading;
  state.reading = null;
  renderMain();
  setMainScroll(state.listScroll || 0);
  const card = id && document.querySelector(`.entry[data-id="${id}"]`);
  if (card) card.focus({ preventScroll: true });
}
function renderReader() {
  const e = state.entries.find(x => x.id === state.reading);
  if (!e) { state.reading = null; return renderMain(); }
  const d = new Date(e.date);
  const nb = state.notebooks.length > 1 ? nbById(e.notebookId) : null;
  setTitle(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, `${WEEK[d.getDay()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}${nb ? ' · #' + nb.name : ''}`);
  $('#banner-slot').innerHTML = '';
  const anns = state.days.filter(a => (a.entries || []).includes(e.id)).sort((x, y) => x.date.localeCompare(y.date));
  const tl = $('#timeline');
  tl.innerHTML = `<article class="reader" aria-label="${ariaLabel(e)}">
    ${e.title ? `<h1 class="rd-title">${esc(e.title)}</h1>` : ''}
    ${e.body.trim() ? `<div class="rd-body">${richText(e.body.trim(), true)}</div>` : ''}
    ${e.photos.length ? `<div class="rd-photos n${Math.min(e.photos.length, 3)}">${e.photos.map(p => `<img data-photo="${p}" data-zoom="1" alt="日记照片">`).join('')}</div>` : ''}
    ${e.audios.length ? `<div class="audio-list">${audiosHTML(e.audios, false)}</div>` : ''}
    ${e.links.length ? `<div class="link-list">${linksHTML(e.links, false)}</div>` : ''}
    ${anns.length ? `<div class="rd-anns"><p class="d-label">关联的时间轴</p>${anns.map(a => `<button type="button" class="rd-ann" data-goann="${a.id}">${a.emoji ? `<span class="ann-emoji" aria-hidden="true">${esc(a.emoji)}</span>` : ''}<span class="ann-main"><span class="td-title">${esc(annName(a))}</span><span class="ann-sub">${fmtFull(a.date)}</span></span></button>`).join('')}</div>` : ''}
    <div class="sheet-foot"><span>${countWords(e.title + ' ' + e.body)} 字</span><span>${e.updatedAt ? '上次修改 ' + fmtEdited(e.updatedAt) : ''}</span></div>
  </article>`;
  hydrate(tl);
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
  if (!fromReader) state.reading = null;
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
      <div class="fmt-bar" role="toolbar" aria-label="正文格式（选中文字后点）">
      <button type="button" data-fmt="**" title="粗体（⌘B）" aria-label="粗体"><b>B</b></button>
      <button type="button" data-fmt="*" title="斜体（⌘I）" aria-label="斜体"><i>I</i></button>
      <button type="button" data-fmt="++" title="下划线（⌘U）" aria-label="下划线"><u>U</u></button>
      <button type="button" data-fmt="~~" title="删除线" aria-label="删除线"><s>S</s></button>
      <button type="button" data-fmt=">" title="引用：整行变成灰色" aria-label="引用">“ 引用</button>
    </div>
    </div>
    <label class="sr-only" for="ed-title">标题</label>
    <input id="ed-title" class="ed-title" placeholder="标题" value="${esc(e.title)}" autocomplete="off">
    <label class="sr-only" for="ed-body">正文</label>
    <textarea id="ed-body" class="ed-body" placeholder="今天发生了什么……">${esc(e.body)}</textarea>
    <div class="tag-suggest" id="ed-tagsug" role="group" aria-label="已有标签，点一下补全" hidden></div>

    <div class="ed-attach">
      <div class="ed-photos" id="ed-photos"></div>
      <div class="audio-list" id="ed-audios"></div>
      <div class="link-list" id="ed-links"></div>
      <div class="link-form" id="ed-link-form" hidden>
        <label class="sr-only" for="ed-link-url">链接地址</label>
        <input id="ed-link-url" type="url" placeholder="粘贴链接，比如一首歌、一部电影" autocomplete="off">
        <label class="sr-only" for="ed-link-title">链接标题</label>
        <input id="ed-link-title" placeholder="标题（不写会自动读取）" autocomplete="off">
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
  const link = { url, title: $('#ed-link-title').value.trim() };
  ed.e.links.push(link);
  renderEdLinks();
  showLinkForm(false);
  fillLinkInfo(link);
}

/* 正文格式按钮：选中文字点一下加上符号，再点一下去掉；“引用”是给选中的每一行开头加 “> ” */
function replaceInBody(ta, start, end, text) {
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  // 用 insertText 才能 ⌘Z 撤销；不支持的浏览器直接改
  if (!document.execCommand || !document.execCommand('insertText', false, text)) ta.setRangeText(text, start, end, 'end');
}
function applyFormat(mark) {
  const ta = $('#ed-body');
  if (!ta || !state.editing) return;
  const v = ta.value;
  // 手机上点按钮时正文可能已经失去焦点，就用最后记下的选区
  const saved = document.activeElement !== ta && state.editing.sel;
  let s = saved ? saved[0] : ta.selectionStart, e = saved ? saved[1] : ta.selectionEnd;
  if (mark === '>') {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e); if (le < 0) le = v.length;
    const lines = v.slice(ls, le).split('\n');
    const allQuoted = lines.every(l => QUOTE_RE.test(l) || !l.trim());
    const out = lines.map(l => allQuoted ? l.replace(QUOTE_RE, '') : (QUOTE_RE.test(l) || !l.trim() ? l : '> ' + l)).join('\n');
    replaceInBody(ta, ls, le, out);
    ta.setSelectionRange(ls, ls + out.length);
  } else {
    const n = mark.length;
    const sel = v.slice(s, e);
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= 2 * n) {          // 选中的连符号一起：去掉
      const inner = sel.slice(n, -n);
      replaceInBody(ta, s, e, inner); ta.setSelectionRange(s, s + inner.length);
    } else if (v.slice(s - n, s) === mark && v.slice(e, e + n) === mark && !(mark === '*' && (v[s - 2] === '*' || v[e + 1] === '*'))) {   // 两边已经有符号：去掉
      replaceInBody(ta, s - n, e + n, sel); ta.setSelectionRange(s - n, e - n);
    } else {
      // 选区两头的空格留在外面，不然符号不生效
      const lead = sel.length - sel.trimStart().length, trail = sel.length - sel.trimEnd().length;
      const core = sel.trim();
      if (!core) { replaceInBody(ta, s, e, mark + mark); ta.setSelectionRange(s + n, s + n); }
      else {
        replaceInBody(ta, s + lead, e - trail, mark + core + mark);
        ta.setSelectionRange(s + lead + n, s + lead + n + core.length);
      }
    }
  }
  state.editing.e.body = ta.value;
  autosize(); updateWords();
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
  if ($('#ed-add-menu') && $('#ed-add-menu').classList.contains('busy')) { toast("还在上传文件或读取链接，请等一下再点“完成”"); return; }
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
  render();             // 从阅读页进来的，会回到这篇的阅读页
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

/* ---------- 标签：改名 / 删除（正文里的 #标签 一起改） ---------- */
function tagDialog(tag) {
  if (!tag) return;
  const n = state.entries.filter(e => e.tags.includes(tag.id)).length;
  const box = $('#confirm');
  box.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tg-msg">
    <p id="tg-msg">标签 <span class="htag">#${esc(tag.name)}</span>，用在 ${n} 篇日记里。</p>
    <label class="dialog-label" for="tg-name">改名（正文里的 #${esc(tag.name)} 会一起改）</label>
    <input id="tg-name" class="dialog-input" value="${esc(tag.name)}" autocomplete="off">
    ${tagGroups().length ? `<label class="dialog-label" for="tg-group">分组</label>
    <select id="tg-group" class="dialog-input"><option value="">不分组</option>${tagGroups().map(g => `<option value="${g.id}" ${groupOfTag(tag) === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>` : ''}
    <div class="row"><button type="button" class="text-btn danger" id="tg-del">删除这个标签</button><span class="grow"></span>
      <button type="button" class="btn ghost" id="tg-no">取消</button><button type="button" class="btn" id="tg-save">保存</button></div></div>`;
  box.hidden = false;
  $('#tg-name').focus(); $('#tg-name').select();
  const close = () => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Enter' && ev.target.id === 'tg-name' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); $('#tg-save').click(); }
  };
  document.addEventListener('keydown', onKey, true);
  $('#tg-no').onclick = close;
  box.onclick = ev => { if (ev.target === box) close(); };
  $('#tg-save').onclick = async () => {
    const name = $('#tg-name').value, gid = $('#tg-group') ? $('#tg-group').value : groupOfTag(tag);
    close();
    if (gid !== groupOfTag(tag)) {
      try { await Store.put('tags', { ...tag, groupId: gid }); tag.groupId = gid; } catch (err) { toast('没能换分组，可能是网络断了'); }
    }
    await renameTag(tag, name);
    render();
  };
  $('#tg-del').onclick = async () => { close(); await deleteTag(tag); };
}
async function renameTag(tag, input) {
  const name = input.trim().replace(/^#/, '');
  if (!name || name === tag.name) return;
  if (!validTagName(name)) { toast('标签名里不能有空格或标点，也不能全是数字'); return; }
  if (state.tags.some(x => x.id !== tag.id && x.name.toLowerCase() === name.toLowerCase())) { toast('已经有同名标签了'); return; }
  const re = oneTagRE(tag.name);
  const touched = state.entries.filter(e => e.tags.includes(tag.id)).map(e => ({ ...e, body: e.body.replace(re, (m, before) => before + '#' + name) }));
  try {
    await Store.put('tags', { ...tag, name });
    await Store.putMany('entries', touched);
  } catch (err) { toast('没能改名，可能是网络断了'); await loadAll(); render(); return; }
  tag.name = name;
  touched.forEach(e => { state.entries[state.entries.findIndex(x => x.id === e.id)] = e; });
  render();
  toast(`已改名为 #${name}`);
}
async function deleteTag(tag) {
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
}

/* ---------- 标签分组：新建 / 改名 / 删除（删除分组不删标签，标签回到“不分组”） ---------- */
function askText(message, value = '', okLabel = '确定', extra = '') {
  return new Promise(resolve => {
    const box = $('#confirm');
    box.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tx-msg">
      <label class="dialog-label" id="tx-msg" for="tx-in">${esc(message)}</label>
      <input id="tx-in" class="dialog-input" value="${esc(value)}" autocomplete="off">
      <div class="row">${extra}<span class="grow"></span><button type="button" class="btn ghost" id="tx-no">取消</button><button type="button" class="btn" id="tx-yes">${esc(okLabel)}</button></div></div>`;
    box.hidden = false;
    $('#tx-in').focus(); $('#tx-in').select();
    const done = v => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); done(null); }
      if (ev.key === 'Enter' && ev.target.id === 'tx-in' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); done($('#tx-in').value.trim()); }
    };
    document.addEventListener('keydown', onKey, true);
    $('#tx-no').onclick = () => done(null);
    $('#tx-yes').onclick = () => done($('#tx-in').value.trim());
    const del = $('#tx-del'); if (del) del.onclick = () => done({ del: true });
    box.onclick = ev => { if (ev.target === box) done(null); };
  });
}
async function addTagGroup() {
  const name = await askText('新分组的名字', '', '新建分组');
  if (!name) return;
  if (tagGroups().some(g => g.name === name)) { toast('已经有同名的分组了'); return; }
  try { await savePrefs({ tagGroups: [...tagGroups(), { id: uid(), name }] }); } catch (err) { toast('没能新建分组，可能是网络断了'); return; }
  renderSide();
}
async function editTagGroup(id) {
  const g = tagGroups().find(x => x.id === id);
  if (!g) return;
  const r = await askText('分组名字', g.name, '改名', '<button type="button" class="text-btn danger" id="tx-del">删除这个分组</button>');
  if (!r) return;
  try {
    if (r.del) {
      if (!await askConfirm(`删除分组“${g.name}”？里面的标签不会删除，会回到“不分组”。`, '删除分组')) return;
      const moved = state.tags.filter(t => t.groupId === id).map(t => ({ ...t, groupId: '' }));
      await Store.putMany('tags', moved);
      moved.forEach(t => { tagById(t.id).groupId = ''; });
      await savePrefs({ tagGroups: tagGroups().filter(x => x.id !== id) });
    } else if (r !== g.name) {
      if (tagGroups().some(x => x.name === r)) { toast('已经有同名的分组了'); return; }
      await savePrefs({ tagGroups: tagGroups().map(x => x.id === id ? { ...x, name: r } : x) });
    }
  } catch (err) { toast('没能保存，可能是网络断了'); }
  renderSide();
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
    app: 'paper-journal', version: 4, exportedAt: new Date().toISOString(),
    notebooks: state.notebooks, entries: state.entries, tags: state.tags, photos, media,
    anniversaries: state.days, meta: [...(state.life.birth ? [state.life] : []), state.prefs],
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `一卷磁带备份-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`已导出 ${state.entries.length} 篇日记、${state.days.length} 条时间轴、${photos.length} 张照片、${media.length} 段录音${failed ? `；有 ${failed} 个文件没能打包` : ''}`, 5000);
}
async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('这个文件不是有效的备份文件', 4000); return; }
  if (!data || data.app !== 'paper-journal' || !Array.isArray(data.entries)) { toast('这个文件不是一卷磁带（手记）的备份', 4000); return; }
  const anns = Array.isArray(data.anniversaries) ? data.anniversaries : [];
  const ok = await askConfirm(`备份里有 ${data.entries.length} 篇日记${anns.length ? `、${anns.length} 条时间轴` : ''}。导入后会和现有内容合并，同一篇会被备份里的版本覆盖。`, '导入', false);
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
    await Store.putMany('anniversaries', anns);
    if (Array.isArray(data.meta)) await Store.putMany('meta', data.meta.filter(m => m && m.key));
  } catch (err) {
    toast('导入中途失败了：' + (err.message || '网络问题') + '。可以再导入一次，已经导入的不会重复。', 8000);
    await loadAll(); render();
    return;
  }
  state.urls.clear();
  await loadAll();
  render();
  toast(`已导入 ${data.entries.length} 篇日记${anns.length ? `、${anns.length} 条时间轴` : ''}${failed ? `，有 ${failed} 个文件没传上去` : ''}`, 5000);
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
  // 纪念日：旧数据缺的字段补上默认值
  state.days = (await Store.all('anniversaries')).map(normalizeAnn);
  const meta = await Store.all('meta');
  const life = meta.find(m => m.key === 'life');
  state.life = { key: 'life', birth: '', lifespan: 88, ...(life || {}) };
  state.prefs = { key: 'prefs', ...(meta.find(m => m.key === 'prefs') || {}) };
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
const MPANELS = { views: ['sec-sections', 'sec-cal', 'sec-views'], nb: ['sec-nb'], tags: ['sec-tags'], search: ['sec-search'], backup: ['sec-backup'] };
const SIDE_ORDER = ['sec-sections', 'sec-dviews', 'sec-dcal', 'sec-cal', 'sec-search', 'sec-views', 'sec-nb', 'sec-tags', 'sec-stats', 'sec-backup'];
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
window.matchMedia('(min-width: 761px)').addEventListener('change', () => {
  closeMPanel();
  if (state.section === 'days' && $('#loading').hidden) renderMain();   // 纪念日：电脑是左右两栏，手机是单独一页
});

/* ---------- 事件 ---------- */
function goJournal() { state.page = 'journal'; state.section = 'journal'; state.reading = null; state.readFrom = null; }
function shiftAnchor(days) { state.anchor = addDays(state.anchor, days); state.calMonth = state.anchor.slice(0, 7); render(); }
const scrollTop = () => { $('#main').scrollTop = 0; window.scrollTo(0, 0); };

document.addEventListener('click', async ev => {
  if (ev.target.closest('a[href]')) return; // 链接照常打开，不打开编辑页
  const t = ev.target.closest('button, .entry, img[data-zoom], #mscrim, [data-lifeage]');
  if (!t) return;
  if (t.id === 'mscrim') return closeMPanel();
  if (t.matches('img[data-zoom]')) return showLightbox(t.src);

  // 纪念日：编辑小纸
  if (state.dEditing) {
    if (t.matches('[data-pick]')) { $('#af-emoji').value = t.dataset.pick; return; }
    if (t.id === 'af-save') return saveAnn();
    if (t.id === 'lf-save') return saveLife();
    if (t.id === 'lk-save') return saveLinks();
    if (t.id === 'af-cancel') return cancelAnnEditor();
    if (t.id === 'af-del') return deleteAnn();
    return;
  }
  // 纪念日：页面
  if (t.matches('[data-dview]')) { state.section = 'days'; state.dview = t.dataset.dview; state.dopen = false; state.lifeAge = null; closeMPanel(); render(); scrollTop(); return; }
  if (t.matches('[data-dgroup]')) {   // 分类可以多选，再点一次取消
    const g = t.dataset.dgroup;
    state.dgroups = !g ? [] : state.dgroups.includes(g) ? state.dgroups.filter(x => x !== g) : [...state.dgroups, g];
    state.dsel = null; renderMain(); return;
  }
  if (t.matches('[data-ann]')) {
    state.dsel = t.dataset.ann; state.dAllMarks = false;
    if (isPhone()) { state.dopen = true; renderMain(); scrollTop(); } else render();   // render：侧栏日历也要圈出这一天
    return;
  }
  if (t.matches('[data-goann]')) return goAnn(t.dataset.goann);
  if (t.id === 'ann-back') { state.dopen = false; renderMain(); return; }
  if (t.id === 'ann-edit') { const a = annById(state.dsel); if (a) openAnnEditor(a, false); return; }
  if (t.id === 'ann-new') return openAnnEditor(newAnn({ ...(t.dataset.life ? { life: true } : {}), ...(t.dataset.date ? { date: t.dataset.date } : {}) }), true);
  if (t.id === 'toggle-marks') { state.dAllMarks = !state.dAllMarks; renderMain(); return; }
  if (t.id === 'life-settings') return openLifeSettings();
  if (t.matches('[data-lifeage]')) { state.lifeAge = +t.dataset.lifeage; renderMain(); return; }
  if (t.id === 'ann-link') { const a = state.days.find(x => x.id === state.dsel); if (a) openLinkDialog(a); return; }
  if (t.matches('[data-openentry]')) {   // 从时间轴打开关联的手记；“← 返回”回到时间轴
    const id = t.dataset.openentry;
    state.section = 'journal'; state.page = 'journal'; state.reading = null; state.readFrom = 'days';
    renderSide(); openReader(id); return;
  }
  if (t.matches('[data-dcal]')) {
    const [y, m] = state.dcalMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(t.dataset.dcal), 1);
    state.dcalMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; state.dcalDay = null;
    render(); return;
  }
  if (t.matches('[data-dgo]')) return goAnn(t.dataset.dgo);
  if (t.id === 'dcal-today') { state.dcalMonth = todayKey().slice(0, 7); state.dcalDay = null; renderMain(); return; }
  if (t.matches('[data-dday]')) { state.dcalDay = state.dcalDay === t.dataset.dday ? null : t.dataset.dday; renderMain(); return; }
  if (t.matches('[data-jday]')) {   // 从日历跳到那天的手记
    const k = t.dataset.jday;
    state.section = 'journal'; goJournal(); state.view = 'timeline'; state.day = k; state.calMonth = k.slice(0, 7);
    render(); scrollTop(); return;
  }
  if (t.id === 'cal-emoji') { state.calEmoji = !state.calEmoji; writePref('calEmoji', state.calEmoji); renderCalendar(); return; }

  // 阅读页
  if (t.id === 'rd-back') return closeReader();
  if (t.id === 'rd-edit') { const e = state.entries.find(x => x.id === state.reading); if (e) openEditor(e, false, true); return; }

  // 板块 / 页面 / 手机面板
  if (t.matches('[data-section]')) { state.section = t.dataset.section; state.page = 'journal'; state.reading = null; state.readFrom = null; state.dopen = false; closeMPanel(); render(); scrollTop(); return; }
  if (t.matches('[data-mpanel]')) return openMPanel(t.dataset.mpanel);
  if (t.matches('[data-page]')) { state.page = t.dataset.page; state.reading = null; closeMPanel(); render(); scrollTop(); return; }
  if (t.id === 'stats-summary') { state.page = 'stats'; state.reading = null; render(); scrollTop(); return; }
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
  if (t.matches('[data-tagedit]')) return tagDialog(tagById(t.dataset.tagedit));
  if (t.matches('[data-tgedit]')) return editTagGroup(t.dataset.tgedit);
  if (t.id === 'add-tgroup') return addTagGroup();
  if (t.matches('[data-nbdef]')) {
    try { await savePrefs({ defaultNotebook: t.dataset.nbdef }); } catch (err) { toast('没能保存，可能是网络断了'); return; }
    renderSide();
    toast(t.dataset.nbdef ? `打开网站时会先显示“${nbById(t.dataset.nbdef).name}”` : '打开网站时显示“所有”');
    return;
  }
  // 备份 / 账户
  if (t.id === 'export-btn') { closeMPanel(); return exportData(); }
  if (t.id === 'import-btn') return $('#import-file').click();
  if (t.id === 'signout-btn') {
    closeMPanel();
    await quietly(() => Store.client.auth.signOut());
    state.entries = []; state.tags = []; state.notebooks = []; state.urls.clear();
    state.days = []; state.life = { key: 'life', birth: '', lifespan: 88 };
    $('#timeline').innerHTML = '';
    showLogin();
    return;
  }

  // 主区
  if (t.id === 'new-btn' || t.id === 'fab' || t.id === 'empty-new') {
    if (state.section === 'days') return openAnnEditor(newAnn(), true);
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
  if (t.matches('[data-fmt]')) return applyFormat(t.dataset.fmt);
  if (t.id === 'ed-del') {
    if (!await askConfirm('删除这篇日记？删除后无法恢复。', '删除')) return;
    try { await deleteEntry(ed.e.id); } catch (err) { toast('没能删除，可能是网络断了，请稍后再试。', 5000); return; }
    state.editing = null;
    state.reading = null;
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
  if (t.matches('[data-fetchlink]')) { const l = ed.e.links[+t.dataset.fetchlink]; if (l) fillLinkInfo(l); return; }
  if (t.id === 'ed-link-add') return addLinkFromForm();
});

// 点纸外面的空白处：编辑时 = 完成，阅读时 = 关闭
$('#editor').addEventListener('mousedown', ev => {
  if (ev.target.closest('#ed-tagsug, .fmt-bar')) { ev.preventDefault(); return; }   // 点标签提示、格式按钮时不让正文失去焦点
  if (ev.target.id !== 'editor') return;
  if (state.editing) saveEditor();
  else if (state.dEditing) cancelAnnEditor();
});
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'search') { state.query = t.value; goJournal(); renderMain(); renderCalendar(); return; }
  if (t.id === 'af-title') { fitAnnTitle(); return; }
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
  if (state.dEditing && state.dEditing.kind === 'links') {
    const ed = state.dEditing;
    if (t.matches('[data-lkentry]')) { if (t.checked) ed.sel.add(t.dataset.lkentry); else ed.sel.delete(t.dataset.lkentry); ed.changed = true; return; }
    if (t.id === 'lk-day' && t.value) { ed.day = t.value; renderLinkDialog(); $('#lk-day').focus(); return; }
  }
  if (t.id === 'af-countdown' || t.id === 'af-memorial') { state.dEditing.flagsTouched = true; return; }
  // 新记的日子：选了以后的日期，自动勾上“倒数日”（自己改过勾选就不动）
  if (t.id === 'af-date' && state.dEditing && !state.dEditing.flagsTouched && t.value) { $('#af-countdown').checked = t.value > todayKey(); return; }
  if (t.id === 'ed-file' && t.files.length) { const files = [...t.files]; t.value = ''; await addPhotos(files); }
  if (t.id === 'ed-audio-file' && t.files.length) { const files = [...t.files]; t.value = ''; await addAudios(files); }
  if (t.id === 'import-file' && t.files[0]) { closeMPanel(); await importData(t.files[0]); t.value = ''; }
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
document.addEventListener('selectionchange', () => {
  const ta = document.activeElement;
  if (state.editing && ta && ta.id === 'ed-body') state.editing.sel = [ta.selectionStart, ta.selectionEnd];
});
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

  if (state.dEditing) {
    if (ev.key === 'Escape') { ev.preventDefault(); cancelAnnEditor(); }
    else if (mod && ev.key === 'Enter') { ev.preventDefault(); const k = state.dEditing.kind; if (k === 'life') saveLife(); else if (k === 'links') saveLinks(); else saveAnn(); }
    return;
  }
  if (state.editing) {
    if (ev.key === 'Escape' && !$('#ed-link-form').hidden) { ev.preventDefault(); showLinkForm(false); return; }
    if (ev.key === 'Escape' || (mod && ev.key === 'Enter')) { ev.preventDefault(); saveEditor(); return; }
    if (ev.target.id === 'ed-body' && mod && !ev.shiftKey && !ev.altKey && /^[biu]$/i.test(ev.key)) { ev.preventDefault(); applyFormat({ b: '**', i: '*', u: '++' }[ev.key.toLowerCase()]); return; }
    if (ev.target.id === 'ed-body' && ev.key === 'Tab' && !ev.isComposing && state.editing.hash && state.editing.sug.length) { ev.preventDefault(); insertHashtag(state.editing.sug[0]); return; }
    if ((ev.target.id === 'ed-link-url' || ev.target.id === 'ed-link-title') && ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); addLinkFromForm(); return; }
    if ((ev.target.id === 'add-photo' || ev.target.id === 'add-audio') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.target.click(); }
    return;
  }
  if (ev.key === 'Escape' && state.mpanel) { closeMPanel(); return; }
  if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (window.matchMedia('(max-width: 760px)').matches) openMPanel('search'); else $('#search').focus(); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (typing) {
    if (ev.key === 'Escape' && document.activeElement.id === 'search') { ev.target.value = ''; state.query = ''; render(); }
    return;
  }
  if (state.section !== 'journal') {
    if (!mod && ev.key.toLowerCase() === 'n') { ev.preventDefault(); openAnnEditor(newAnn(), true); }
    else if (ev.key === 'Escape' && state.dopen) { ev.preventDefault(); state.dopen = false; renderMain(); }
    return;
  }
  if (state.reading && state.page === 'journal') {
    if (ev.key === 'Escape') { ev.preventDefault(); closeReader(); }
    else if (!mod && ev.key.toLowerCase() === 'e') { ev.preventDefault(); $('#rd-edit').click(); }
    return;
  }
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
  if (nbById(state.prefs.defaultNotebook)) state.notebook = state.prefs.defaultNotebook;   // 打开网站时先显示默认的日记本
  render();
  showReminders();
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
