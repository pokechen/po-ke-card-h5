# 破壳牌 EdgeOne 网页版部署与联机对战方案

生成时间：2026-07-03

## 1. 结论先行

当前项目是原生静态前端 + EdgeOne Functions 的轻量全栈应用，适合部署到 EdgeOne Pages / EdgeOne Makers：

- 前端：`index.html`、`styles.css`、`app.js`、`auth.js`，无 React/Vue/Vite 构建流程。
- 静态资源：`assets/`、`gwent_cards.json` 等直接作为静态文件分发。
- 后端：当前已有 `functions/api/auth/*`，负责注册、登录、用户态校验、头像读取。
- 当前本地数据：个人卡组、战绩等仍在浏览器 `localStorage`，只能在单台设备使用。

建议目标架构：

1. EdgeOne 托管静态前端。
2. EdgeOne Functions 提供 API。
3. KV 存登录 Session、短期状态、轻量索引。
4. Blob 存头像、用户个人卡组、战绩、对局房间状态、对局日志等 JSON/文件。
5. 联机对战先做“房间码 + 回合制 HTTP 轮询”版本，稳定后再升级 WebSocket 实时推送。

> 关键原则：账号密码、用户卡组、联机对局状态都不能只放前端 localStorage；必须以服务端存储为准。

---

## 2. 从腾讯云文档提取的关键点

用户提供的项目管理文档说明：

- 一个 Makers 项目对应一个从 Git 仓库部署到平台的应用。
- 每个项目可以有一个生产部署和多个预览部署。
- 创建项目可导入 Git 仓库、选模板或上传文件。
- 项目设置里可以配置项目名、构建输出、环境变量、自定义域名、Git 生产分支和预览分支。

相关 EdgeOne 存储与函数文档要点：

### 2.1 KV

EdgeOne Makers KV 是键值持久化存储：

- 架构：中心化存储 + 边缘缓存。
- 一致性：最终一致，其他边缘节点可能最长 60 秒读到旧值。
- 适合：配置、计数器、Session、小型用户数据。
- 免费版容量：账户级 1GB。
- 命名空间：一个账号可创建多个命名空间，项目绑定时通过变量名引用。
- API：`put`、`get`、`delete`、`list`。
- 注意：文档示例里 key 仅支持数字、字母、下划线，当前项目的 `user:${username}`、`session:${token}` 这种冒号 key 建议改掉。

### 2.2 Blob

EdgeOne Makers Blob 是面向 Functions 的对象存储：

- 适合：头像、图片、文档、用户上传文件、按目录组织的 JSON 数据。
- 默认读取：最终一致，速度快。
- 强一致读取：`consistency: "strong"`，适合状态机、计数器、必须读到最新写入的场景。
- 在 Functions 中通过 `@edgeone/pages-blob` 的 `getStore("store-name")` 使用。
- 首次调用 `getStore("xxx")` 会自动为当前项目创建 store。
- 控制台只读浏览，数据写入/修改/删除通过 SDK 完成。
- 免费版容量：账户级 1GB。

### 2.3 Functions

文档里有两类相关说明：

- Makers Functions：
  - Edge Functions：全球边缘节点，低延迟，适合轻量 API、鉴权、短任务。
  - Cloud Functions：云端运行，支持 Node.js/Python/Go，适合复杂逻辑。
  - 本地调试：`edgeone makers dev`。
- Pages Node Functions：
  - 目录：`node-functions/api/...`。
  - 支持 Node.js 生态和 WebSocket。
  - 默认 Node.js v20.x。
  - 限制：函数代码包 128MB，请求 body 6MB，单次运行 30s。
  - 本地调试：`edgeone pages dev`。

当前项目已有 `functions/api/auth/*`，这可能是 legacy Functions 写法。正式部署前建议按你控制台实际入口确认：

- 如果 EdgeOne 仍识别 `functions/`，可以先保留。
- 如果新 Makers 项目要求新目录，建议迁移到 `edge-functions/api/auth/*`。
- 如果要做 WebSocket 联机，建议新增 `node-functions` 或 Cloud Functions 专门处理实时连接。

---

## 3. 当前项目现状

### 3.1 前端

当前是纯静态原生前端：

```txt
index.html
styles.css
app.js
auth.js
assets/
gwent_cards.json
```

部署时前端框架应选：

```txt
前端 → 其他框架
```

构建配置建议：

```txt
Build Command：留空
Output Directory：./ 或项目根目录
Install Command：如果没有 package.json，可留空；如果添加 Blob SDK 依赖，则使用 npm install
```

### 3.2 已有认证接口

当前已有：

```txt
functions/api/auth/register.js
functions/api/auth/login.js
functions/api/auth/me.js
functions/api/auth/avatar.js
```

当前逻辑：

- 用户注册：写入 `users_kv`。
- 密码：SHA-256 + 固定 salt。
- Session：写入 `users_kv`，token 存前端 localStorage。
- 头像：写入 Blob store `avatars`。

需要优化点：

1. Blob SDK 包名应按文档改为 `@edgeone/pages-blob`，当前代码是 `@tencent/pages-blob`，部署前要确认是否可用。
2. KV key 不建议使用冒号，应改成 `user_${safeUsername}` / `session_${tokenHash}` 或用用户 ID。
3. 注册用户名需要限制字符集，避免不合法 KV key。
4. 密码不建议固定 salt，建议改为每用户独立 salt + 环境变量 pepper。
5. Session 不建议明文 token 作为 key；建议前端拿随机 token，后端只存 token hash。

### 3.3 当前个人卡组与战绩

当前 `app.js` 里这些数据仍是本地存储：

```js
SAVED_DECKS_KEY = "gwent.savedDecks.v1"
LAST_SELECTION_KEY = "gwent.lastSelectionByFaction.v1"
MATCH_HISTORY_KEY = "gwent.matchHistory.v1"
```

这意味着：

- 换电脑/手机后看不到卡组和战绩。
- 登录账号后也无法同步配置。
- 联机对战无法依赖这些本地状态。

必须改成服务端 API + Blob/KV 存储。

---

## 4. 推荐最终架构

```txt
浏览器 / 手机
  │
  │ 静态资源、API、WebSocket
  ▼
EdgeOne Pages / Makers
  ├─ 静态前端：index.html / app.js / auth.js / assets
  ├─ Auth API：注册、登录、校验、退出
  ├─ User API：个人资料、头像
  ├─ Deck API：个人卡组配置同步
  ├─ Match API：创建房间、加入房间、提交动作、读取状态
  └─ WS API：实时对战推送（第二阶段）
       │
       ├─ KV：Session、短期索引、轻量映射
       └─ Blob：头像、用户资料、卡组、战绩、房间状态、对局日志
```

### 为什么这样分层

- 静态前端放 EdgeOne：全球加速，最简单。
- Session 放 KV：小数据、高频读、边缘读取快。
- 头像放 Blob：非结构化文件。
- 个人卡组/战绩放 Blob JSON：需要跨设备同步、按用户目录管理。
- 对局状态放 Blob 强一致：回合制对战要保证动作顺序和最新状态。
- WebSocket 只负责推送，不把最终状态只放内存里。

---

## 5. 存储设计

### 5.1 KV 命名空间建议

建议至少拆成两个 KV 命名空间：

| 命名空间 | 绑定变量名 | 用途 |
|---|---|---|
| `pokepai_sessions` | `sessions_kv` | 登录 session、临时 token、房间在线状态索引 |
| `pokepai_indexes` | `indexes_kv` | 用户名到 userId 映射、房间码到 matchId 映射等轻量索引 |

如果想先少配置，也可以保留一个：

```txt
users_kv
```

但长期建议拆开，避免账号数据、session、索引混在一起。

KV key 建议：

```txt
session_<sha256(token)>
username_<normalizedUsername>
room_<roomCode>
```

避免使用：

```txt
user:xxx
session:xxx
```

因为文档对 key 字符有限制。

### 5.2 Blob Store 建议

| Store | 用途 | 关键路径示例 |
|---|---|---|
| `avatars` | 用户头像 | `avatars/<userId>/<avatarId>.webp` |
| `user-data` | 用户资料、卡组、战绩 | `users/<userId>/profile.json`、`users/<userId>/decks/<deckId>.json` |
| `matches` | 对局房间状态、动作日志 | `matches/<matchId>/state.json`、`matches/<matchId>/actions/<seq>.json` |

Blob 读取模式：

- 头像：默认最终一致即可。
- 用户卡组：普通读取可默认最终一致，保存后立即回显可强一致读取。
- 对局房间状态：建议强一致读取/写入后再读，避免两端看到旧回合状态。

---

## 6. 账号密码怎么存

### 6.1 不要做的事

不要：

- 把密码明文放 localStorage。
- 把密码明文或固定 hash 放前端代码。
- 用固定 salt 作为唯一保护。
- 把用户完整敏感信息返回前端。

### 6.2 推荐方案

用户注册时：

1. 后端生成 `userId`。
2. 后端生成每用户独立 `salt`。
3. 使用 `password + salt + AUTH_PEPPER` 做 hash。
4. `AUTH_PEPPER` 放 EdgeOne 项目环境变量，不能进 Git。
5. 用户资料写 Blob 或 KV。
6. 用户名索引写 KV 或 Blob 条件写入。

用户记录示例：

```json
{
  "userId": "u_xxx",
  "username": "pokechen",
  "nickname": "破壳玩家",
  "passwordHash": "...",
  "passwordSalt": "...",
  "avatarKey": "avatars/u_xxx/avatar.webp",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

登录成功后：

1. 生成随机 token。
2. 前端 localStorage 只保存 token、过期时间和展示用 user 信息。
3. 后端 KV 保存 token hash 对应的 session。

Session 示例：

```json
{
  "userId": "u_xxx",
  "username": "pokechen",
  "nickname": "破壳玩家",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "expiresAt": "2026-07-10T00:00:00.000Z"
}
```

Session key：

```txt
session_<sha256(token)>
```

---

## 7. 用户个人卡牌配置存哪里

建议从 localStorage 迁移到服务端 Blob。

### 7.1 卡组数据

Blob 路径：

```txt
user-data/users/<userId>/decks/<deckId>.json
```

示例：

```json
{
  "deckId": "d_abc123",
  "name": "北方爆点卡组",
  "faction": "Northern Realms",
  "leaderId": "foltest_king_of_temeria",
  "cardIds": ["ciri", "geralt", "catapult_1"],
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

### 7.2 最近选择

Blob 路径：

```txt
user-data/users/<userId>/settings/last-selection.json
```

示例：

```json
{
  "mode": "ai",
  "lastFaction": "Northern Realms",
  "lastLeaderId": "foltest_king_of_temeria",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

### 7.3 战绩

Blob 路径：

```txt
user-data/users/<userId>/match-history/<matchId>.json
```

或汇总文件：

```txt
user-data/users/<userId>/stats.json
```

建议保留两个层次：

- `stats.json`：快速展示胜负统计。
- `match-history/<matchId>.json`：完整对局记录。

---

## 8. 跨 PC / 手机联机对战怎么做

### 8.1 第一阶段：房间码 + HTTP 轮询（推荐先做）

这是最稳的 MVP，适合你当前项目快速上线。

流程：

1. 玩家 A 登录。
2. 创建房间，后端生成 `matchId` 和 6 位 `roomCode`。
3. 玩家 B 在手机/另一台 PC 登录，输入房间码加入。
4. 双方前端每 1~2 秒请求一次房间状态。
5. 当前回合玩家出牌时，前端提交动作给后端。
6. 后端校验动作是否合法，更新 `matches/<matchId>/state.json`。
7. 双方下一次轮询拿到最新状态。

优点：

- 不依赖长连接。
- Serverless 环境更稳定。
- 容易和 Blob 强一致状态结合。
- 手机浏览器兼容性好。

缺点：

- 实时性略弱，1~2 秒延迟。

API 建议：

```txt
POST /api/matches/create
POST /api/matches/join
GET  /api/matches/<matchId>
POST /api/matches/<matchId>/actions
POST /api/matches/<matchId>/leave
```

对局状态 Blob：

```txt
matches/matches/<matchId>/state.json
matches/matches/<matchId>/actions/000001.json
matches/matches/<matchId>/actions/000002.json
```

状态示例：

```json
{
  "matchId": "m_xxx",
  "roomCode": "839201",
  "status": "playing",
  "players": [
    { "userId": "u_1", "nickname": "玩家A", "side": 0 },
    { "userId": "u_2", "nickname": "玩家B", "side": 1 }
  ],
  "currentTurnUserId": "u_1",
  "round": 1,
  "seq": 12,
  "gameState": {},
  "createdAt": "...",
  "updatedAt": "..."
}
```

提交动作示例：

```json
{
  "seq": 12,
  "action": "play_card",
  "cardUid": "card_123",
  "row": "melee"
}
```

后端必须校验：

- token 是否有效。
- 用户是否在该房间。
- 是否轮到该用户。
- `seq` 是否等于当前状态 seq，防止重复提交或旧状态覆盖。
- 卡牌是否属于该用户手牌。
- 行位置是否合法。

### 8.2 第二阶段：WebSocket 实时推送

如果希望体验更像实时对战，再加 WebSocket。

建议定位：

- WebSocket 负责“推送状态变化”。
- Blob 强一致状态仍是最终权威。
- 客户端断线重连后重新 GET 房间状态。

可选结构：

```txt
node-functions/api/ws.js 或 cloud-functions/api/ws.js
```

注意：

- Serverless WebSocket 的连接生命周期、实例分布、30s 限制等要实际压测。
- 不建议只把房间状态放在函数内存里。
- 如果后续在线人数增加，建议引入专门的实时服务或 Redis/数据库。

### 8.3 第三阶段：排行榜、观战、匹配

后续可以再做：

- 在线匹配队列。
- 排行榜。
- 好友邀请。
- 观战。
- 对局回放。

这些建议在联机 MVP 稳定后再做。

---

## 9. 建议 API 清单

### 9.1 Auth API

```txt
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/auth/avatar?userId=xxx
```

### 9.2 Deck API

```txt
GET    /api/decks
POST   /api/decks
PUT    /api/decks/<deckId>
DELETE /api/decks/<deckId>
GET    /api/settings/last-selection
PUT    /api/settings/last-selection
```

### 9.3 Match API

```txt
POST /api/matches/create
POST /api/matches/join
GET  /api/matches/<matchId>
POST /api/matches/<matchId>/actions
POST /api/matches/<matchId>/surrender
POST /api/matches/<matchId>/leave
```

### 9.4 Realtime API（可选）

```txt
GET /api/ws?matchId=<matchId>&token=<token>
```

---

## 10. 代码结构建议

当前结构：

```txt
functions/api/auth/*.js
```

建议迁移后结构之一：

### 方案 A：以 Edge Functions 为主

适合：认证、卡组、回合制 HTTP 对战。

```txt
edge-functions/
  api/
    auth/
      register.js
      login.js
      logout.js
      me.js
      avatar.js
    decks/
      index.js
      [deckId].js
    matches/
      create.js
      join.js
      [matchId].js
```

### 方案 B：Edge Functions + Node/Cloud Functions

适合：要做 WebSocket。

```txt
edge-functions/
  api/
    auth/
    decks/
    matches/

node-functions/
  api/
    ws.js
```

或如果控制台使用 Cloud Functions：

```txt
cloud-functions/
  api/
    ws.js
```

### 方案 C：短期保留 legacy functions

如果 EdgeOne 当前项目能识别 `functions/`，可以短期保留：

```txt
functions/api/auth/*.js
```

但新功能建议按新文档目录新增，避免之后迁移成本更高。

---

## 11. 部署步骤

### 11.1 准备代码

1. 确认前端资源都在项目根目录。
2. 添加 `package.json`，用于声明 Blob SDK 依赖：

```json
{
  "type": "module",
  "dependencies": {
    "@edgeone/pages-blob": "latest"
  }
}
```

3. 把函数里的 Blob SDK import 改成：

```js
import { getStore } from "@edgeone/pages-blob";
```

4. 修改 KV key：冒号改下划线或哈希。
5. 添加环境变量：

```txt
AUTH_PEPPER=<随机长字符串>
SESSION_DAYS=7
```

### 11.2 创建 EdgeOne 项目

1. 进入 EdgeOne Pages / Makers 控制台。
2. 创建项目。
3. 导入 GitHub 仓库：`pokechen/po-ke-card`。
4. 前端框架选择：`其他框架`。
5. 构建配置：

```txt
Install Command：npm install（如果有 package.json）
Build Command：留空
Output Directory：./
```

6. 生产分支选择 `main` 或当前稳定分支。
7. 开启预览分支自动部署，方便后续测试。

### 11.3 配置 KV

1. 进入 `Pages > 存储 > KV 存储`。
2. 申请/开通 KV 账户。
3. 创建命名空间：

```txt
pokepai_sessions
pokepai_indexes
```

4. 绑定到项目：

```txt
pokepai_sessions -> sessions_kv
pokepai_indexes  -> indexes_kv
```

如果先沿用当前代码：

```txt
某个命名空间 -> users_kv
```

但建议尽快拆分。

### 11.4 配置 Blob

Blob 不需要像 KV 一样先手动写数据，按文档在 Functions 里：

```js
const store = getStore("avatars");
```

首次请求触发后，会自动创建 store。

建议使用：

```txt
avatars
user-data
matches
```

部署后触发一次对应接口，再到 Blob 控制台确认 store 和对象是否出现。

### 11.5 配置环境变量

在项目设置里配置：

```txt
AUTH_PEPPER
SESSION_DAYS
```

如果将来外部脚本要访问 Blob，需要额外配置项目 ID 和 API Token，但 Functions 内部访问不需要。

### 11.6 本地调试

不要用普通 Python 静态服务器测试注册/登录接口，因为它不支持 `/api/auth/*` 的 POST，会出现：

```txt
501 Unsupported method ('POST')
```

应使用 EdgeOne CLI：

```bash
npm install -g edgeone
edgeone makers dev
```

如果走 Pages Node Functions 文档，则使用：

```bash
edgeone pages dev
```

具体以控制台项目类型为准。

---

## 12. 分阶段实施计划

### 阶段 0：部署当前版本

目标：先让网页登录、注册、头像上传能在线跑通。

任务：

- 修正 Blob SDK 包名。
- 修正 KV key 命名。
- 配置 `users_kv` 或拆分后的 KV。
- 配置 Blob `avatars`。
- 部署到 EdgeOne。
- 验证注册、登录、退出、强制登录。

### 阶段 1：账号跨端同步

目标：同一账号在 PC 和手机看到相同卡组、战绩。

任务：

- 新增 Deck API。
- 新增 Settings API。
- 新增 Match History API。
- 前端把 localStorage 读写替换为 API。
- localStorage 只保留 token 和少量 UI 缓存。

### 阶段 2：联机房间 MVP

目标：两个登录用户用房间码对战。

任务：

- 新增 Match API。
- 服务端生成双方牌组和初始状态。
- 客户端轮询房间状态。
- 客户端提交动作。
- 服务端校验动作并更新状态。
- 支持认输、掉线重连、结算战绩。

### 阶段 3：实时体验增强

目标：降低轮询延迟，提升对战体验。

任务：

- 新增 WebSocket 推送。
- 进入房间后订阅状态变化。
- 出牌后主动广播。
- 断线后回退到 GET 状态。

### 阶段 4：生产化

目标：稳定运营。

任务：

- 自定义域名。
- 日志分析。
- 错误告警。
- 简单风控：注册频率、登录失败次数、房间创建频率。
- 数据备份导出脚本。
- 隐私和用户数据删除能力。

---

## 13. 风险与注意事项

1. KV 最终一致，不适合作为强一致对局状态主存储。
2. Blob 强一致读取更慢，只在对局状态、保存后立即读取等必要场景使用。
3. EdgeOne Functions 请求 body 限制约 6MB，头像当前限制 2MB 是合理的。
4. Blob 不建议当公网图床滥用；头像通过 `/api/auth/avatar` 代理返回即可。
5. 密码 hash 需要升级，当前固定 salt 只能算 MVP。
6. localStorage token 有 XSS 风险，后续可以考虑 HttpOnly Cookie，但实现会复杂一些。
7. 联机对战必须以后端状态为准，不能信任前端提交的分数、手牌、牌库。
8. 随机发牌建议由后端完成，避免客户端作弊。
9. 如果 WebSocket 在 Serverless 环境中连接时长或实例调度不稳定，应改用专门实时服务或轮询方案。
10. 当前没有前端构建流程，部署最简单；如果以后改 React/Vue，再引入 Vite。

---

## 14. 推荐优先级

我建议按这个顺序做：

1. 修正当前 Auth Functions 的部署兼容问题。
2. 正式部署 EdgeOne，跑通注册/登录/头像。
3. 把个人卡组和战绩从 localStorage 迁移到 Blob。
4. 做房间码联机 MVP，先用 HTTP 轮询。
5. 再考虑 WebSocket 实时化。

这样风险最低，也最适合当前项目体量。

---

## 15. 当前项目需要立即调整的清单

部署前建议先改：

- [ ] 确认 Functions 目录：`functions/` 是否被当前 EdgeOne 项目识别；不识别则迁移到 `edge-functions/`。
- [ ] `@tencent/pages-blob` 改为 `@edgeone/pages-blob`。
- [ ] 添加 `package.json` 依赖。
- [ ] KV key 从 `user:${username}`、`session:${token}` 改为合法 key。
- [ ] 用户名增加正则校验，例如只允许 `[a-zA-Z0-9_]`。
- [ ] 密码 hash 改为每用户 salt + 环境变量 pepper。
- [ ] 拆分或规划 KV 命名空间。
- [ ] 新增用户卡组/战绩 API。
- [ ] 本地调试改用 EdgeOne CLI，不再用 Python 静态服务器测试 API。
