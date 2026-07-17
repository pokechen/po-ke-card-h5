# 来盘昆特牌吧（po-ke-card-h5）

巫师三 · 昆特牌的纯前端 H5 应用，支持本地双人热座与系统对战。

## 技术栈

- 纯静态前端：HTML + CSS + 原生 JavaScript（无构建步骤、无前端框架）。
- 卡牌数据来自 `docs/gwent_cards.json`，由 `app.js` 通过 `fetch` 加载。
- 当前为**纯单机版本**：仅支持本地双人热座与系统对战，无任何联网 / 登录 / 后端依赖。

## 本地启动

因为页面通过 `fetch` 读取 `docs/gwent_cards.json`，**必须用 HTTP 服务器打开，不能直接双击 `index.html`（file:// 协议会被浏览器拦截）**。任选其一即可：

### 方式一：Python（推荐，macOS 自带）

```bash
cd <项目目录>
python3 -m http.server 8080
```

然后在浏览器访问：<http://127.0.0.1:8080/index.html>

### 方式二：Node

```bash
cd <项目目录>
npx serve -l 8080
# 或：npx http-server -p 8080
```

### 方式三：其他任意静态服务器

只要把项目根目录作为静态根目录提供出来即可（如 Nginx、VS Code Live Server 等），默认首页为 `index.html`。

## 目录结构

```
.
├── index.html          # 入口页面
├── app.js              # 全部游戏逻辑（昆特牌规则、UI、AI）
├── styles.css          # 样式
├── docs/               # 卡牌资料（md）与卡牌数据（json）
└── assets/             # 卡面图片（webp/svg）
```

## 常见问题

- **页面一直显示“正在加载卡牌数据...”**：说明 `docs/gwent_cards.json` 没加载成功，通常是用 `file://` 直接打开了页面。请改用上面的 HTTP 服务器方式访问。
- **图片不显示**：卡面图走懒加载，首次打开需要联网或确保 `assets/` 目录完整。
