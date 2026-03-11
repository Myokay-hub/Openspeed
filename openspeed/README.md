# ⬡ Openspeed · 智能体监控平台

> 本地优先、数据安全、开源可改 — 基于 Claude Sonnet API 的全功能智能体平台

---

## ✨ 功能特性

| 模块 | 功能 |
|------|------|
| 💬 智能对话 | 多轮对话、流式显示、Token 追踪、导出记录 |
| 📊 运行监控 | 实时调用统计、延迟折线图、费用估算 |
| 🛡 安全中心 | 数据流向图、安全检查、WebSocket 实时日志 |
| 📋 请求日志 | 全量审计记录、CSV 导出 |
| ⚙ 模型设置 | API Key 管理、模型/温度/Token 配置 |
| 📦 提示词库 | 9 个内置模板、一键插入 |

---

## 🚀 快速启动（macOS）

### 前置条件

```bash
# 检查 Node.js（需要 v18+）
node -v

# 如未安装，选一种方式：
# 官网下载（推荐新手）: https://nodejs.org
# Homebrew:
brew install node
```

### 三步启动

```bash
# 1. 进入项目目录
cd agentos

# 2. 一键启动（自动安装依赖 + 打开浏览器）
./start.sh

# 3. 在「模型设置」填入 API Key 后即可使用
```

手动启动（等价）：
```bash
npm install    # 仅首次
npm start      # 或 node server/index.js
```

自定义端口：
```bash
PORT=8080 ./start.sh
```

---

## 📁 项目结构

```
agentos/
├── start.sh              # 一键启动脚本（macOS）
├── package.json          # 项目依赖声明
├── README.md             # 本文档
│
├── config/
│   └── settings.json     # API Key + 模型配置（本机存储）
│
├── server/
│   └── index.js          # ★ Express 后端服务器
│                         #   - API 反向代理
│                         #   - WebSocket 日志推送
│                         #   - 监控数据统计
│                         #   - 本机访问控制
│
└── public/
    ├── index.html        # ★ 应用 HTML 骨架 + 所有视图
    ├── css/
    │   └── main.css      # ★ 完整样式（CSS 变量 + 主题）
    └── js/
        └── app.js        # ★ 前端逻辑（模块化，8 个子模块）
```

> **修改指南**：
> - 改后端逻辑 → `server/index.js`
> - 改界面布局 → `public/index.html`
> - 改样式主题 → `public/css/main.css`（修改 `:root` 变量即可换肤）
> - 改前端功能 → `public/js/app.js`（各功能独立模块）

---

## 🔧 二次开发指南

### 修改主题色

打开 `public/css/main.css`，修改 `:root` 中的变量：

```css
:root {
  --green:  #00ffb4;   /* 主强调色 */
  --cyan:   #22d3ee;   /* 次强调色 */
  --bg0:    #070d18;   /* 最深背景 */
  --bg1:    #0c1422;   /* 侧栏背景 */
  /* ... */
}
```

### 添加新视图

1. 在 `public/index.html` 添加导航项和 `<section class="view" id="view-xxx">`
2. 在 `public/js/app.js` 的 `nav.go()` 中添加对应初始化调用
3. 实现业务逻辑模块

### 添加提示词模板

编辑 `public/js/app.js` 中的 `PROMPTS` 数组：

```js
{
  icon:  '🎨',
  title: '我的模板',
  desc:  '模板描述',
  text:  '提示词内容，[方括号] 表示需要填写的部分',
},
```

### 扩展 API 路由

在 `server/index.js` 中添加新的 Express 路由：

```js
// 示例：添加历史对话持久化
app.post('/api/save-session', async (req, res) => {
  // 将 req.body.messages 写入文件或数据库
  res.json({ ok: true });
});
```

### 接入数据库

推荐使用 SQLite（零配置）：

```bash
npm install better-sqlite3
```

```js
// server/db.js
const Database = require('better-sqlite3');
const db = new Database('./data/agentos.db');
db.exec(`CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  ts INTEGER, model TEXT,
  in_tok INTEGER, out_tok INTEGER, latency INTEGER
)`);
module.exports = db;
```

---

## 🔒 数据安全

```
您的浏览器 (127.0.0.1)
      │
      ▼ HTTP（本机内部）
本机代理服务器 :3456
      │
      ▼ HTTPS / TLS 1.3
api.anthropic.com
```

| 安全项 | 说明 |
|--------|------|
| 网络隔离 | 服务器仅监听 `127.0.0.1`，外网不可访问 |
| 对话数据 | 仅存于内存，重启后自动清除 |
| API Key  | 存于本机 `config/settings.json`，不上传任何服务器 |
| 访问控制 | 非本机 IP 请求 API 路由将返回 403 |
| 日志内容 | 终端日志只记录 Token 数量，不记录对话内容 |

**安全建议：**
- 使用完毕在「安全中心」清除 API Key
- 不要将 `config/settings.json` 提交到 Git（已在 .gitignore 中排除）
- 生产环境部署时请增加认证层

---

## 📦 依赖说明

| 包 | 版本 | 用途 |
|----|------|------|
| express | ^4.18 | HTTP 服务器与路由 |
| ws | ^8.16 | WebSocket 实时推送 |
| node-fetch | ^2.7 | （备用）服务端 fetch |

**无前端构建工具依赖**：前端使用原生 HTML/CSS/JS，直接修改文件即可看到效果。

---

## 💰 API 定价参考（2025）

| 模型 | 输入 | 输出 |
|------|------|------|
| Claude Sonnet 4 | $3/M tok | $15/M tok |
| Claude Opus 4 | $15/M tok | $75/M tok |
| Claude Haiku 4.5 | $0.8/M tok | $4/M tok |

平台内置费用估算（按 USD×7.3 换算人民币，仅供参考）。

---

## ❓ 常见问题

**Q: 端口被占用**
```bash
PORT=3457 ./start.sh
```

**Q: npm install 失败**
```bash
npm install --registry https://registry.npmmirror.com
```

**Q: API Key 填入后返回 401**
确认 Key 以 `sk-ant-` 开头，账户余额充足。

**Q: WebSocket 断开后不重连**
页面保持打开即可，客户端会每 10 秒自动重试。

---

*AgentOS · 本地部署 · 数据不离设备*
