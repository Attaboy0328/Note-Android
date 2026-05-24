# Note

极简文字记录 PWA：小说素材与心得体会。独立项目，与 [Habit](https://github.com/Attaboy0328/Habit) 无代码或数据耦合。

## 功能

- 一键新建、全屏纯文字编辑器（Noto Serif SC）
- 分类：小说素材、心得体会
- 自动保存（本地 IndexedDB，防抖 600ms）
- 可选 Supabase 云端同步（匿名登录）
- 搜索、字数统计、左滑删除
- 纸墨浅色主题 + 纸墨·夜深色模式
- PWA 可安装，支持「快速记录」快捷方式

## 在线访问

https://attaboy0328.github.io/Note/

## 本地运行

ES Module 需要 HTTP 服务，不能直接双击 `index.html`。

```bash
cd D:/Cursor/Note
python -m http.server 8080
```

浏览器打开 http://localhost:8080

## Supabase 配置

1. 新建 **独立** Supabase Project（不要用 Habit 的 project）
2. Authentication → Providers → **Anonymous** → Enable
3. SQL Editor 执行 [supabase-setup.sql](./supabase-setup.sql)
4. 在 App **设置** 页填入 Project URL 与 Anon Key，点「保存并连接」

## 项目结构

```
Note/
├── index.html
├── app.js          # UI 与交互
├── db.js           # IndexedDB
├── sync.js         # Supabase 同步
├── styles.css
├── manifest.webmanifest
├── service-worker.js
├── supabase-setup.sql
└── icons/
```

## 部署

### GitHub Pages

仓库：[github.com/Attaboy0328/Note](https://github.com/Attaboy0328/Note)

- 推送 `main` 分支后，GitHub Actions 自动部署
- 首次需在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
- 访问地址：https://attaboy0328.github.io/Note/

也可使用其他静态托管（Cloudflare Pages 等），需 HTTPS 以启用 Service Worker。

## 主题色（纸墨）

| Token | 浅色 |
|-------|------|
| 背景 | `#FAF7F2` |
| 强调 | `#6B5344` |
| 正文 | `#2C2825` |
