/* 本地预览用的假数据：打开 index.html?mock 时加载。
   用内存代替 Supabase，不需要登录，也不会读写任何真实数据。刷新页面就恢复原样。 */
(function () {
  const db = { entries: new Map(), tags: new Map(), notebooks: new Map(), meta: new Map(), anniversaries: new Map() };
  const files = new Map();
  const key = (s, o) => s === 'meta' ? o.key : o.id;
  const pad = n => String(n).padStart(2, '0');
  const day = (offset, h = 21, m = 0) => {
    const d = new Date(); d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
  };

  // 一张纯色“照片”，用来测试照片布局
  function fakePhoto(color) {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 800, 600);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '48px serif'; g.fillText('示例照片', 300, 320);
    return c.toDataURL('image/jpeg', 0.8);
  }

  [['nb-a', '日记', 1], ['nb-b', '旅行', 2]].forEach(([id, name, order]) => db.notebooks.set(id, { id, name, order, createdAt: '2026-01-01T00:00:00Z' }));
  [['t1', '散步'], ['t2', '看展'], ['t3', '读书']].forEach(([id, name]) => db.tags.set(id, { id, name }));

  const samples = [
    [0, '', '示例：今天的日记。这里的内容都是假的，只用来预览界面。', ['t1']],
    [1, '沿着运河走了一圈', '下午四点天就开始暗了。\n\n回来的路上想到一个作品的点子。', ['t1'], { photos: 1 }],
    [3, '看展笔记', '最后一间展厅几乎全黑，只有声音在房间里慢慢移动。', ['t2', 't3'], { link: true }],
    [7, '', '一篇没有标题的短日记。写在正文里的 #生活 标签会被自动识别。', []],
    [10, '一篇很长的日记', Array.from({ length: 40 }, (_, k) => `第 ${k + 1} 段：用来测试长日记在编辑页里能不能上下滑动。`).join('\n\n'), ['t3']],
    [365, '去年的今天', '用来测试三年 / 五年日记。', ['t3'], { nb: 'nb-b' }],
    [365 * 2 + 1, '', '两年前的这一天（示例）。', []],
    [40, '一个月前', '用来测试时间线的月份分组。', ['t2'], { photos: 3 }],
  ];
  samples.forEach(([offset, title, body, tags, opt = {}], i) => {
    const photos = [];
    for (let k = 0; k < (opt.photos || 0); k++) {
      const id = `mock-p${i}-${k}`;
      files.set('p:' + id, fakePhoto(['#8c9a8a', '#a8907a', '#7d8aa3'][k % 3]));
      photos.push(id);
    }
    const id = 'mock-' + i;
    db.entries.set(id, {
      id, date: day(offset, 21, i), title, body, tags, photos, audios: [],
      links: opt.link ? [{ url: 'https://example.com/song', title: '一首歌（示例链接）' }] : [],
      bookmarked: i === 1, notebookId: opt.nb || 'nb-a', createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
    });
  });

  // 纪念日示例（都是假的）
  const dk = offset => day(offset).slice(0, 10);
  db.meta.set('life', { key: 'life', birth: '2000-06-15', lifespan: 88 });
  [
    ['🧗', '示例：第一次攀岩', 107, '爱好', { life: true }],
    ['🎵', '示例：开始学钢琴', 56, '爱好'],
    ['🏠', '示例：搬进新家', 300, '生活', { life: true }],
    ['🎓', '示例：毕业', 900, '', { life: true }],
    ['✈️', '示例：第一次出国', 1500, '', { life: true }],
    ['❤️', '示例：认识好朋友', 1100, '', { repeat: 'yearly' }],
    ['💼', '示例：作品集截止', -18, 'DDL'],
    ['🎉', '示例：旅行出发', -45, '生活'],
    ['', '示例：没有图标的日子', 6, ''],
  ].forEach(([emoji, title, offset, group, opt = {}], i) => {
    const id = 'mock-a' + i;
    db.anniversaries.set(id, { id, title, emoji, date: dk(offset), group, repeat: 'none', life: false, note: '', createdAt: day(Math.max(offset, 30)).slice(0, 10) + 'T00:00:00Z', updatedAt: null, ...opt });
  });

  window.__TEST_STORE__ = {
    ready: true,
    client: { auth: {
      getSession: async () => ({ data: { session: { user: { id: 'mock-user', email: '本地预览（假数据）' } } } }),
      signOut: async () => ({}),
      signInWithPassword: async () => ({ error: { message: '本地预览不需要登录' } }),
    } },
    setUser() {},
    all: async s => [...db[s].values()],
    put: async (s, o) => { db[s].set(key(s, o), o); },
    putMany: async (s, l) => { l.forEach(o => db[s].set(key(s, o), o)); },
    del: async (s, k) => { db[s].delete(k); },
    putPhoto: async (id, d) => { files.set('p:' + id, d); },
    photoURL: async id => files.get('p:' + id) || '',
    delPhoto: async id => { files.delete('p:' + id); },
    photoData: async id => files.get('p:' + id),
    putMedia: async (id, d) => { files.set('m:' + id, typeof d === 'string' ? d : URL.createObjectURL(d)); },
    mediaURL: async id => files.get('m:' + id) || '',
    delMedia: async id => { files.delete('m:' + id); },
    mediaData: async id => files.get('m:' + id),
  };
})();
