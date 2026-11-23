# CLAUDE.md · 给 Claude 的项目说明

这是 Lili 自己用的个人管理网页（项目名待定，仓库叫 MyJournal）。每次开始工作前先读完这份说明。
想知道某个设计“为什么这样做”（选型、版本历史、踩过的坑），读 `docs/开发记录.md`；做了重要决定后在那里补一条。

## 和 Lili 合作的方式

- **用中文交流**，直接、具体、讲人话。她是设计 / 交互艺术背景，会写一点代码，但不是专业程序员：技术概念用一两句话解释清楚就好，不用长篇大论。
- **改代码前先说清楚要改什么**，尤其是会影响数据的改动。推送 / 提交前让她看过改动。
- **她会自己改视觉（主要是 `style.css`）**。动任何文件之前，先读仓库里的**最新版本**，绝对不能用旧版本覆盖她的修改。只改需要改的部分，不要顺手重排、重写整个文件。
- 她在意：手机上写日记要顺手（打开就能写）、极简纸面风、数据安全（不能丢日记）、免费服务。

## 项目是什么

- 两个板块：**手记**（日记，已上线）和 **纪念日 / 倒数日**（筹备中）。两个板块的数据放在一起，界面分开设计。
- 纯静态网页，部署在 GitHub Pages：<https://lilili444.github.io/MyJournal/>（main 分支根目录，推送后 1～3 分钟生效）。
- 后端是 Supabase 免费版（项目网址写在 `config.js` 里）。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架：电脑侧栏、手机顶部按钮栏、主区、登录页 |
| `style.css` | 全部视觉。颜色和字体用 `:root` 里的变量，手机样式在底部 `@media (max-width: 760px)` 里 |
| `app.js` | 全部功能，没有构建步骤、没有框架，直接是浏览器 JS |
| `config.js` | Supabase 网址 + Publishable key（可以公开） |
| `supabase/schema.sql` | 建表、RLS、存储桶。可以重复运行；改了它要提醒 Lili 去 SQL Editor 再运行一次 |
| `dev/mock.js` | 本地预览用的假数据（见下文），不会碰真实数据 |
| `README.md` | 给 Lili 看的说明书。功能有变化时同步更新 |
| `docs/开发记录.md` | 选型理由、版本历史、踩过的坑 |

## 数据

- Supabase `records` 表：`(user_id, store, id, data jsonb, updated_at)`，主键 `(user_id, store, id)`。`store` 取值：`entries` / `tags` / `notebooks` / `meta` / `anniversaries`（纪念日预留）。RLS 只允许本人；`authenticated` 角色有表权限（新项目不会自动授权，已写进 schema.sql）。
- 存储桶：`photos`（`用户ID/照片ID.jpg`，只收 JPEG，≤5MB）、`media`（录音，`用户ID/文件ID`，≤50MB）。
- 日记（entry）结构：
  ```js
  { id, date: 'YYYY-MM-DDTHH:MM', title, body, tags: [tagId], photos: [photoId],
    audios: [{ id, name, mime, size }], links: [{ url, title }],
    notebookId, createdAt, updatedAt, source?, sourceFile?, bookmarked? }
  ```
  `bookmarked` 是 v0.5 去掉的收藏功能留下的旧字段，不读也不删。
- **标签以正文为准**（v0.5 起）：正文里的 `#标签` 在保存时由 `tagsInText()` 识别，再由 `ensureTags()` 换成 `tags: [tagId]`。不要再做单独的标签输入。`loadAll()` 里的 `syncTags()` 负责旧数据迁移和保持一致。改名、删除标签要同时改正文（`oneTagRE`）。
  `source: 'apple-journal'` 的 319 篇是从苹果手记导入的（2026-11-22），只有日期没有时间，所以同一天从 12:00 起每篇加一分钟。
- 日记本：`{ id, name, order, createdAt }`；标签：`{ id, name, createdAt }`。
- 备份文件格式（导出 / 导入）：`{ app: 'paper-journal', version: 3, notebooks, tags, entries, photos: [{id, data}], media: [{id, mime, data}] }`。`app` 的值不要改，否则旧备份导不进去。
- 照片一律压缩到长边 1600px、JPEG 质量 0.82（Lili 确认过的标准）。
- **加新字段**：直接在 JSON 里加，在 `loadAll()` 里给旧数据补默认值即可，不用改表。

## 代码规则

- `app.js` 最上面的 **`Store` 是唯一碰 Supabase 的地方**（`all / put / putMany / del / putPhoto / photoURL / delPhoto / photoData / putMedia / mediaURL / delMedia / mediaData`）。界面代码只调用 Store，不要在别处直接用 supabase 客户端（登录除外）。
- 写入失败不能丢内容：保存失败时编辑页保持打开并提示，参考 `saveEditor()`。
- 界面文字全部中文，按钮写清楚会发生什么。
- 视觉只用 `:root` 里的变量（`--paper --sheet --ink --ink-soft --rule --accent --danger`、`--font-display --font-body`），不要硬写新颜色。
- 电脑侧栏的“视图 / 日记本 / 标签”可以点名字收起（`data-collapse`，存在 localStorage）；手机面板里始终展开。
- 手机版：顶部 6 个按钮（视图 / 日记本 / 标签 / 搜索 / 统计 / 备份），点开才展开面板；面板里显示的是侧栏的同一块 DOM（`openMPanel` 把它搬过去，关闭时 `restoreSide` 搬回来），所以电脑和手机共用一套功能代码。
- 点日记先打开阅读页（`openReader`，显示在右栏主区，`state.reading` 记着是哪篇；“← 返回”回到列表原位置），点“编辑”才进编辑页（`openEditor(e, false, true)`，浮在上面的 `#editor` 层），完成后回到阅读页。
- 侧栏标签的编辑模式不换成输入框：点标签弹出 `tagDialog`（改名 / 删除）。
- **版本号和缓存**：版本号是 `v大.功能.修补`（规则见 `docs/开发记录.md`）。GitHub Pages 让浏览器缓存 10 分钟，所以**改了 `style.css`、`app.js` 或 `config.js`，就要升版本号：改 `app.js` 的 `APP_VERSION`，并把 `index.html` 里三处 `?v=` 改成同一个版本号**，否则会出现新页面配旧程序、页面全乱的情况（2026-11-22 发生过）。然后在开发记录里补一条这个版本改了什么。

## 安全

- 永远不要把 Supabase **Secret key（`sb_secret_…`）/ service_role key / 数据库密码** 写进仓库，也不要让 Lili 发出来。Publishable key 可以公开。
- 仓库是公开的：不要提交任何日记内容、备份 `.json`、照片。`.gitignore` 已经挡掉了常见的备份文件名。
- 删除类操作（数据、存储桶、文件）先问 Lili。

## 本地预览和检查

- 起一个本地服务器（比如 `python3 -m http.server`），打开 `http://localhost:8000/?mock`：带 `?mock` 时会加载 `dev/mock.js`，用内存里的假日记代替 Supabase，不用登录，也碰不到真实数据。
- 改完界面后，在电脑宽度（1280px）和手机宽度（390px）各看一眼；确认浏览器控制台没有报错。
- `node --check app.js` 可以快速查语法。

## 待办

- [ ] 纪念日 / 倒数日板块（数据用 `store: 'anniversaries'`；提醒可以考虑导出到苹果日历；手机端需要加板块切换）
- [ ] 每周用 GitHub Actions 自动备份到另一个**私有**仓库（Secret key 只能放在 GitHub Secrets）
- [ ] 项目名待定：改 `index.html` 的 `<title>` 和登录页 `<h1>`
