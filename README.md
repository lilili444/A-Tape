# 纸页日记 MyJournal

一个只给自己用的日记网页。手机和电脑打开同一个网址就能写，数据存在自己的 Supabase 里，登录后才能看到。

- 网址：<https://lilili444.github.io/MyJournal/>
- 视觉：极简纸面风
- 功能参考：苹果“手记”，另外加了标签、日记本、三年 / 五年日记

---

## 功能

| 模块 | 说明 |
|---|---|
| 浏览 | **时间线**：按月份分组，最新的在最上面；**三年日记 / 五年日记**：把同一天的往年日记叠在一页，可以前后翻天、选日期、补写某一天 |
| 日记本 | 可以自己新建、改名、删除；每篇日记属于一个日记本。删除日记本时，里面的日记会移到另一个日记本，不会被删掉 |
| 标签 | 一篇可以打多个标签。输入时会自动提示，回车或逗号添加；侧栏可以按标签筛选，也可以改名、删除 |
| 写日记 | 标题可写可不写；可以改日期和时间；加照片（自动压缩到 300KB 左右）；收藏；关闭时自动保存 |
| 搜索 | 正文、标题、标签都能搜。日记本、标签、搜索三种筛选可以叠加 |
| 统计 | 连续写作天数、今年篇数、总字数 |
| 备份 | 导出成一个 `.json` 文件（包含照片），也可以导入 |
| 快捷键 | `N` 写新日记 · `⌘K` 搜索 · `Esc` 或 `⌘↵` 完成 · 三年 / 五年日记里用 `←` `→` 翻天 |

---

## 结构

```
MyJournal/
├── index.html           页面骨架：侧栏、主区、登录页这些“有哪些东西”
├── style.css            全部视觉：颜色、字体、间距、版式（自己装修主要改这里）
├── app.js               全部功能：读写数据、筛选、编辑器、三年/五年日记、登录
├── config.js            Supabase 的网址和 Publishable key（可以公开）
├── supabase/
│   └── schema.sql       建表、权限规则和照片存储桶，在 Supabase 后台运行一次
└── README.md            就是这份说明
```

### 自己改视觉

- **先改 `style.css` 最上面的 `:root`**：`--paper`（页面底色）、`--sheet`（编辑纸）、`--ink`（文字）、`--ink-soft`（次要文字）、`--rule`（细线）、`--accent`（选中/收藏的强调色）、`--font-display` / `--font-body`（字体）。改这几个变量，全站会一起变。
- 想换字体：在 `index.html` 的 Google Fonts 链接里换字体名，再改 `--font-display` / `--font-body`。
- 各部分对应的样式块：侧栏 `.side`、时间线 `.entry`、月份标题 `.month`、三年/五年日记 `.yrow`、编辑纸 `.sheet`、标签 `.chip`、登录页 `.login-sheet`。
- 只改 `style.css` 不会影响数据和功能；`app.js` 里也有一部分 HTML 结构（比如每篇日记卡片的排列），想改布局结构时再动它。
- 改完上传到 GitHub 后，浏览器可能还在用旧的样式，按 `⌘⇧R` 强制刷新即可。

**数据放在哪里**

| 地方 | 放什么 | 是否公开 |
|---|---|---|
| 这个 GitHub 仓库 | 只有程序代码 | 公开（GitHub Pages 免费版要求公开） |
| Supabase · `records` 表 | 日记、标签、日记本，每条一行，内容是 JSON | 私有，只有登录的本人能读写 |
| Supabase · `photos` 存储桶 | 照片，路径是 `用户ID/照片ID.jpg` | 私有，只有登录的本人能读写 |

`index.html` 里的 `Store` 对象是唯一和 Supabase 打交道的地方（`all / get / put / putMany / del / photoData`）。以后要换存储方式，只需要改这一块。

---

## 第一次设置（只做一次）

### 1. 建数据库
Supabase 后台 → **SQL Editor** → New query → 把 `supabase/schema.sql` 的全部内容粘贴进去 → **Run**。
看到 `Success. No rows returned` 就说明成功了。这个脚本可以重复运行，不会删掉已有数据。

### 2. 建自己的账号
Supabase 后台 → **Authentication → Users → Add user → Create new user**
- 填你的邮箱和一个密码
- 勾选 **Auto Confirm User**
- 点 Create user

### 3. 关闭注册（重要）
Supabase 后台 → **Authentication → Sign In / Providers**（旧版界面叫 Settings）→ 把 **Allow new users to sign up** 关掉 → Save。
关掉之后，就算别人打开了网页，也没办法注册账号。

### 4. 打开 GitHub Pages
这个仓库 → **Settings → Pages** → Source 选 **Deploy from a branch**，Branch 选 **main**、文件夹选 **/ (root)** → Save。
等 1～3 分钟，打开 <https://lilili444.github.io/MyJournal/>，用第 2 步的邮箱和密码登录。

---

## 日常使用

- **更新代码**：在 GitHub 网页上打开要改的文件 → 点铅笔图标编辑，或者用 **Add file → Upload files** 上传新版本覆盖 → Commit。1～3 分钟后网页会自动更新。
- **把以前的日记搬进来**：在旧版本（本地版）里点“导出备份”，再在这里点“导入备份”。同一篇日记不会重复。
- **Supabase 暂停**：免费项目一周没有任何访问就会被暂停。暂停不会删数据，去 Supabase 后台点 **Resume project** 就能恢复。

---

## 备份（请定期做）

Supabase 免费版**没有自动备份**。误删、改错的数据，云端没办法帮你找回。所以：

1. **手动备份**：每隔一两周点一次侧栏的“导出备份”，把 `.json` 文件存到电脑或 iCloud。
2. **自动备份**（计划中）：用 GitHub Actions 每周把数据导出到另一个**私有**仓库。这个功能需要 Supabase 的 Secret key，但它只能存在 GitHub 的 Secrets 里，绝对不能写进代码。

---

## 安全

- `config.js` 里的 **Publishable key**（`sb_publishable_…`）本来就是给网页用的，放在公开仓库里没问题。数据安全靠 `schema.sql` 里的权限规则（Row Level Security）：没登录什么都读不到，登录了也只能读写自己的数据。
- **Secret key（`sb_secret_…`）、旧版的 service_role key、数据库密码**：绝对不能出现在这个仓库的任何文件里，也不要发给任何人。万一泄露了，去 Supabase 后台 **Settings → API Keys** 换一把新的。
- 这个仓库是公开的，所以**不要**把日记内容或备份文件上传到这里。备份要放进单独的私有仓库。

---

## 路线图

- [x] 日记：时间线、三年 / 五年日记、日记本、标签、照片、搜索、统计、导入 / 导出
- [x] 接入 Supabase 云端 + 登录
- [ ] 从苹果“手记”导入（原来的 Journals 转成标签，按日期分进三个日记本）
- [ ] 每周自动备份到私有仓库
- [ ] 手机端布局
- [ ] 纪念日 / 倒数日
