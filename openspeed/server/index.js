/**
 * AgentOS · 主服务器
 * ─────────────────────────────────────────────────
 * 职责：
 *  1. 静态文件服务（public/）
 *  2. Anthropic API 反向代理（/api/chat）
 *  3. WebSocket 实时日志推送（ws://localhost:PORT）
 *  4. 监控数据 REST 接口（/api/stats, /api/logs）
 *  5. 配置管理（/api/config GET/POST）
 * ─────────────────────────────────────────────────
 */

'use strict';

const express    = require('express');
const http       = require('http');
const https      = require('https');
const WebSocket  = require('ws');
const path       = require('path');
const fs         = require('fs');

// ── 配置加载 ──────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, '..', 'config', 'settings.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return {
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 1000,
    systemPrompt: '你是一个专业的 AI 助手，请用中文简洁准确地回答用户问题。',
    apiKey: '',
  };
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

// ── 内存监控数据（会话级，不落盘）────────────────
const monitor = {
  totalCalls:        0,
  totalInputTokens:  0,
  totalOutputTokens: 0,
  errorCount:        0,
  latencies:         [],         // 保留最近 100 条
  callHistory:       [],         // 保留最近 50 条
};

// ── 应用日志（保留最近 200 条）──────────────────
const appLogs = [];

function addLog(level, msg, meta = {}) {
  const entry = {
    id:    appLogs.length + 1,
    time:  new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    ts:    Date.now(),
    level, msg, meta,
  };
  appLogs.push(entry);
  if (appLogs.length > 200) appLogs.shift();

  // 终端输出（不含敏感内容）
  const colors = { INFO:'\x1b[36m', OK:'\x1b[32m', WARN:'\x1b[33m', ERR:'\x1b[31m' };
  const col = colors[level] || '\x1b[0m';
  console.log(`\x1b[2m${entry.time}\x1b[0m ${col}[${level}]\x1b[0m ${msg}`);

  // 广播给所有 WebSocket 客户端
  broadcastWS({ type: 'log', data: entry });
}

// ── Express 应用 ──────────────────────────────────
const app    = express();
const server = http.createServer(app);

// WebSocket 服务
const wss = new WebSocket.Server({ server, path: '/ws' });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  // 发送最近 50 条历史日志
  ws.send(JSON.stringify({ type: 'history', data: appLogs.slice(-50) }));
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

function broadcastWS(payload) {
  const msg = JSON.stringify(payload);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ── 中间件 ────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// 安全头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // 只允许本机访问 API
  const ip = req.ip || req.socket.remoteAddress || '';
  if (req.path.startsWith('/api/') && !isLocalIP(ip)) {
    addLog('WARN', `拒绝非本机 API 访问: ${ip}`);
    return res.status(403).json({ error: '仅允许本机访问' });
  }
  next();
});

function isLocalIP(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('::ffff:127.');
}

// 静态文件
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API 路由 ──────────────────────────────────────

// GET /api/stats — 监控统计
app.get('/api/stats', (req, res) => {
  const avgLatency = monitor.latencies.length
    ? Math.round(monitor.latencies.reduce((a, b) => a + b, 0) / monitor.latencies.length)
    : 0;
  const successRate = monitor.totalCalls
    ? (((monitor.totalCalls - monitor.errorCount) / monitor.totalCalls) * 100).toFixed(1)
    : 100;
  // 成本估算 (Sonnet 4: $3/$15 per M tokens → 换算人民币 ×7.3)
  const costUSD = (monitor.totalInputTokens / 1e6 * 3) + (monitor.totalOutputTokens / 1e6 * 15);
  res.json({
    totalCalls:        monitor.totalCalls,
    totalInputTokens:  monitor.totalInputTokens,
    totalOutputTokens: monitor.totalOutputTokens,
    totalTokens:       monitor.totalInputTokens + monitor.totalOutputTokens,
    errorCount:        monitor.errorCount,
    avgLatency,
    successRate: parseFloat(successRate),
    costEstCNY:        (costUSD * 7.3).toFixed(4),
    recentLatencies:   monitor.latencies.slice(-20),
  });
});

// GET /api/logs — 请求历史
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ logs: appLogs.slice(-limit).reverse(), total: appLogs.length });
});

// GET /api/history — 调用历史
app.get('/api/history', (req, res) => {
  res.json({ history: monitor.callHistory });
});

// GET /api/config — 读取配置（隐藏 apiKey）
app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  res.json({ ...cfg, apiKey: cfg.apiKey ? '••••••••' + cfg.apiKey.slice(-6) : '' });
});

// POST /api/config — 保存配置
app.post('/api/config', (req, res) => {
  const existing = loadConfig();
  const body = req.body;
  const updated = {
    model:        body.model        || existing.model,
    temperature:  body.temperature  !== undefined ? parseFloat(body.temperature)  : existing.temperature,
    maxTokens:    body.maxTokens    !== undefined ? parseInt(body.maxTokens)    : existing.maxTokens,
    systemPrompt: body.systemPrompt !== undefined ? body.systemPrompt : existing.systemPrompt,
    // 如果传来的 key 不是掩码，才更新
    apiKey: body.apiKey && !body.apiKey.startsWith('••') ? body.apiKey : existing.apiKey,
  };
  saveConfig(updated);
  addLog('OK', `配置已更新: model=${updated.model}, temp=${updated.temperature}`);
  res.json({ ok: true });
});

// DELETE /api/config/key — 清除 API Key
app.delete('/api/config/key', (req, res) => {
  const cfg = loadConfig();
  cfg.apiKey = '';
  saveConfig(cfg);
  addLog('WARN', 'API Key 已从配置文件清除');
  res.json({ ok: true });
});

// POST /api/chat — Anthropic API 代理（核心）
app.post('/api/chat', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    addLog('WARN', '聊天请求被拒绝：未配置 API Key');
    return res.status(401).json({ error: '请先在设置中配置 API Key' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '无效的消息格式' });
  }

  const startTime = Date.now();
  const model = req.body.model || cfg.model;

  addLog('INFO', `→ API 请求 [${model}] ${messages.length} 条消息`);

  const payload = JSON.stringify({
    model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    system: cfg.systemPrompt,
    messages,
  });

  const options = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => { body += chunk; });
    proxyRes.on('end', () => {
      const latency = Date.now() - startTime;

      try {
        const data = JSON.parse(body);
        if (proxyRes.statusCode !== 200) {
          monitor.errorCount++;
          addLog('ERR', `API 错误 ${proxyRes.statusCode}: ${data.error?.message || '未知错误'}`);
          return res.status(proxyRes.statusCode).json(data);
        }

        // 更新监控数据
        const inTok  = data.usage?.input_tokens  || 0;
        const outTok = data.usage?.output_tokens || 0;
        monitor.totalCalls++;
        monitor.totalInputTokens  += inTok;
        monitor.totalOutputTokens += outTok;
        monitor.latencies.push(latency);
        if (monitor.latencies.length > 100) monitor.latencies.shift();

        const histEntry = {
          id:      monitor.totalCalls,
          time:    new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          ts:      Date.now(),
          model,
          inTok,
          outTok,
          latency,
          status:  200,
          preview: messages[messages.length - 1]?.content?.slice(0, 40) || '',
        };
        monitor.callHistory.unshift(histEntry);
        if (monitor.callHistory.length > 50) monitor.callHistory.pop();

        addLog('OK', `← 响应成功 ${latency}ms | in:${inTok} out:${outTok} tokens`);

        // 广播实时统计更新
        broadcastWS({ type: 'stats_update', data: { latency, inTok, outTok } });

        res.json(data);
      } catch (parseErr) {
        monitor.errorCount++;
        addLog('ERR', `响应解析失败: ${parseErr.message}`);
        res.status(500).json({ error: '响应解析失败' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    monitor.errorCount++;
    const latency = Date.now() - startTime;
    addLog('ERR', `网络请求失败 (${latency}ms): ${err.message}`);
    res.status(502).json({ error: `网络请求失败: ${err.message}` });
  });

  proxyReq.write(payload);
  proxyReq.end();
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── 启动 ──────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3456;

server.listen(PORT, '127.0.0.1', () => {
  const { exec } = require('child_process');
  console.log('\n\x1b[1m\x1b[32m  ⬡  AgentOS 已启动\x1b[0m');
  console.log('\x1b[2m  ─────────────────────────────────\x1b[0m');
  console.log(`\x1b[36m  ▶  http://localhost:${PORT}\x1b[0m`);
  console.log('\x1b[2m  仅监听 127.0.0.1，外网不可访问\x1b[0m');
  console.log('\x1b[33m  按 Ctrl+C 停止\x1b[0m\n');

  addLog('OK',   `服务启动 → http://localhost:${PORT}`);
  addLog('INFO', `WebSocket  → ws://localhost:${PORT}/ws`);
  addLog('INFO', `配置文件   → ${CONFIG_FILE}`);

  // macOS 自动打开浏览器
  if (process.platform === 'darwin') {
    exec(`open http://localhost:${PORT}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\x1b[31m端口 ${PORT} 已被占用，请修改 PORT 环境变量\x1b[0m`);
    console.error(`示例: PORT=3457 npm start`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n\x1b[2m  AgentOS 已停止\x1b[0m\n');
  process.exit(0);
});
