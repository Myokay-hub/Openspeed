/**
 * AgentOS · app.js
 * ─────────────────────────────────────────────────────
 * 前端主逻辑，模块化结构，方便二次开发：
 *
 *  App.nav      — 路由 / 视图切换
 *  App.chat     — 对话功能
 *  App.monitor  — 监控数据
 *  App.security — 安全检查 / WebSocket 日志
 *  App.logs     — 请求日志
 *  App.settings — 配置管理
 *  App.prompts  — 提示词库
 *  App.ui       — 工具函数（toast, clock…）
 * ─────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════
   GLOBAL STATE
   ═══════════════════════════════════════════════════ */
const State = {
  messages:    [],   // 当前会话消息历史
  isLoading:   false,
  ws:          null,
  wsReady:     false,
  currentView: 'chat',
  latencies:   [],   // 本地缓存的延迟数组（画图用）
};

/* ═══════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════ */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ═══════════════════════════════════════════════════
   APP.UI — 界面工具
   ═══════════════════════════════════════════════════ */
const ui = {
  toastTimer: null,

  toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
  },

  startClock() {
    const tick = () => {
      const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      document.getElementById('clock').textContent = t;
    };
    tick(); setInterval(tick, 1000);
  },

  updateTopStats(stats) {
    document.getElementById('chipCalls').innerHTML  = `调用 <b>${stats.totalCalls}</b>`;
    document.getElementById('chipTokens').innerHTML = `Token <b>${fmt(stats.totalTokens)}</b>`;
    document.getElementById('sfCalls').textContent  = stats.totalCalls;
    document.getElementById('sfTokens').textContent = fmt(stats.totalTokens);
  },

  setSysStatus(ok, label) {
    const dot = document.getElementById('sysDot');
    dot.className = 'sys-dot ' + (ok ? 'ok' : 'error');
    document.getElementById('sysLabel').textContent = label;
  },
};

/* ═══════════════════════════════════════════════════
   APP.NAV — 视图路由
   ═══════════════════════════════════════════════════ */
const nav = {
  init() {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const view = el.dataset.view;
        if (view) this.go(view);
      });
    });
  },

  go(name) {
    if (State.currentView === name) return;
    State.currentView = name;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const viewEl = document.getElementById('view-' + name);
    if (viewEl) viewEl.classList.add('active');

    document.querySelectorAll(`.nav-item[data-view="${name}"]`)
      .forEach(n => n.classList.add('active'));

    // 切换时刷新数据
    if (name === 'monitor')  App.monitor.refresh();
    if (name === 'settings') App.settings.load();
    if (name === 'logs')     App.logs.refresh();
    if (name === 'prompts')  App.prompts.render();
    if (name === 'security') App.security.render();
  },
};

/* ═══════════════════════════════════════════════════
   APP.CHAT — 对话模块
   ═══════════════════════════════════════════════════ */
const chat = {
  init() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    input.addEventListener('input', () => {
      const len = input.value.length;
      document.getElementById('charCnt').textContent = `${len} / 4096`;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); this.send();
      }
    });

    // 欢迎消息
    this._addBubble('ai', `你好！我是基于 Claude API 的智能助手。

当前具备能力：
• 💬 多轮对话 — 完整上下文记忆
• 📊 代码生成与调试
• 📝 文档撰写与内容创作
• 🔍 分析与问答

请先在「模型设置」中配置 API Key，然后开始对话。`);
  },

  async send() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || State.isLoading) return;

    this._addBubble('user', text);
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('charCnt').textContent = '0 / 4096';

    State.messages.push({ role: 'user', content: text });

    const typingEl = this._showTyping();
    State.isLoading = true;
    document.getElementById('sendBtn').disabled = true;

    const t0 = Date.now();
    try {
      const data = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: State.messages }),
      });

      const reply  = data.content.map(b => b.text || '').join('');
      const inTok  = data.usage?.input_tokens  || 0;
      const outTok = data.usage?.output_tokens || 0;
      const latency = Date.now() - t0;

      State.messages.push({ role: 'assistant', content: reply });
      State.latencies.push(latency);

      typingEl.remove();
      this._addBubble('ai', reply, { inTok, outTok, latency });

      // 更新 topbar 统计（从服务端拉最新）
      const stats = await apiFetch('/api/stats');
      ui.updateTopStats(stats);

    } catch (err) {
      typingEl.remove();
      this._addError(err.message);
    } finally {
      State.isLoading = false;
      document.getElementById('sendBtn').disabled = false;
      document.getElementById('chatInput').focus();
    }
  },

  _addBubble(role, text, meta = null) {
    const container = document.getElementById('chatMessages');
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    const roleLabels = { ai: 'Claude', user: '您', sys: '系统' };
    const avatars    = { ai: '⬡', user: '👤', sys: '⚙' };

    const tokenHtml = meta
      ? `<div class="msg-tokens">
           <span class="tok-pill">输入 ${meta.inTok} tok</span>
           <span class="tok-pill">输出 ${meta.outTok} tok</span>
           <span class="tok-pill">${meta.latency}ms</span>
         </div>`
      : '';

    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.innerHTML = `
      <div class="msg-avatar ${role}">${avatars[role] || '?'}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-role">${roleLabels[role] || role}</span>
          <span>${t}</span>
        </div>
        <div class="msg-bubble">${esc(text)}</div>
        ${tokenHtml}
      </div>`;

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  _addError(msg) {
    const container = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'msg err';
    el.innerHTML = `
      <div class="msg-avatar sys">⚠</div>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-role" style="color:var(--red)">错误</span></div>
        <div class="msg-bubble">❌ ${esc(msg)}\n\n请检查 API Key 配置或网络连接。</div>
      </div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  _showTyping() {
    const container = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'msg ai';
    el.innerHTML = `
      <div class="msg-avatar ai">⬡</div>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-role">Claude</span></div>
        <div class="msg-bubble"><div class="typing-dots">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div></div>
      </div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  clear() {
    if (!confirm('确认清除所有对话记录？')) return;
    State.messages = [];
    document.getElementById('chatMessages').innerHTML = '';
    this._addBubble('sys', '对话已清空，可以开始新的会话。');
    ui.toast('对话已清空', 'ok');
  },

  export() {
    const lines = State.messages.map(m =>
      `[${m.role === 'user' ? '用户' : 'Claude'}]\n${m.content}`
    ).join('\n\n---\n\n');
    if (!lines) { ui.toast('暂无对话内容', ''); return; }
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    ui.toast('对话已导出', 'ok');
  },

  insertPrompt(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.focus();
    nav.go('chat');
  },
};

/* ═══════════════════════════════════════════════════
   APP.MONITOR — 监控模块
   ═══════════════════════════════════════════════════ */
const monitor = {
  chartCtx: null,
  chartData: [],

  async refresh() {
    try {
      const [stats, hist] = await Promise.all([
        apiFetch('/api/stats'),
        apiFetch('/api/history'),
      ]);

      // 统计卡
      document.getElementById('mCalls').textContent   = stats.totalCalls;
      document.getElementById('mTokens').textContent  = fmt(stats.totalTokens);
      document.getElementById('mLatency').textContent = stats.avgLatency ? stats.avgLatency + 'ms' : '—';
      document.getElementById('mSuccess').textContent = stats.successRate + '%';

      // 费用
      const inCostCNY  = (stats.totalInputTokens  / 1e6 * 3  * 7.3).toFixed(4);
      const outCostCNY = (stats.totalOutputTokens / 1e6 * 15 * 7.3).toFixed(4);
      document.getElementById('cInTok').textContent   = stats.totalInputTokens.toLocaleString();
      document.getElementById('cOutTok').textContent  = stats.totalOutputTokens.toLocaleString();
      document.getElementById('cInCost').textContent  = '¥' + inCostCNY;
      document.getElementById('cOutCost').textContent = '¥' + outCostCNY;
      document.getElementById('cTotal').textContent   = '¥' + stats.costEstCNY;

      // Sparkline
      this.drawSparkline(stats.recentLatencies || []);

      // 调用历史表
      this.renderHistory(hist.history || []);

      ui.updateTopStats(stats);
    } catch (e) {
      ui.toast('监控数据加载失败: ' + e.message, 'err');
    }
  },

  drawSparkline(data) {
    const canvas = document.getElementById('latencyChart');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth - 32;
    const H = 80;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (!data.length) {
      ctx.fillStyle = 'rgba(74,101,128,0.5)';
      ctx.font = '12px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }

    const max = Math.max(...data, 100);
    const pts = data.map((v, i) => ({
      x: (i / Math.max(data.length - 1, 1)) * W,
      y: H - (v / max) * (H - 10) - 5,
    }));

    // gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,255,180,0.2)');
    grad.addColorStop(1, 'rgba(0,255,180,0)');

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.lineTo(pts[0].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#00ffb4';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // dots
    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#00ffb4';
      ctx.fill();
    });
  },

  renderHistory(list) {
    const tbody = document.getElementById('historyTable');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">暂无调用记录</td></tr>';
      return;
    }
    tbody.innerHTML = list.slice(0, 50).map(r => `
      <tr>
        <td class="yellow">#${r.id}</td>
        <td style="color:var(--text-dim)">${r.time}</td>
        <td style="color:var(--cyan);font-size:10px">${r.model.replace('claude-','').split('-20')[0]}</td>
        <td>${r.inTok}</td>
        <td>${r.outTok}</td>
        <td style="color:${r.latency < 2000 ? 'var(--green)' : 'var(--yellow)'}">${r.latency}ms</td>
        <td><span class="tag ok">200</span></td>
        <td style="color:var(--text-dim);font-size:11px">${esc(r.preview)}${r.preview.length >= 40 ? '…' : ''}</td>
      </tr>`).join('');
  },
};

/* ═══════════════════════════════════════════════════
   APP.SECURITY — 安全模块
   ═══════════════════════════════════════════════════ */
const security = {
  init() {
    this.connectWS();
  },

  connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws`;

    try {
      State.ws = new WebSocket(wsUrl);

      State.ws.addEventListener('open', () => {
        State.wsReady = true;
        ui.setSysStatus(true, 'WebSocket 已连接');
        const sub = document.getElementById('wsStatus');
        if (sub) sub.textContent = '● 实时推送已连接';
      });

      State.ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log' || msg.type === 'history') {
          const logs = msg.type === 'history' ? msg.data : [msg.data];
          logs.forEach(entry => this.appendLogLine(entry));
        }
        if (msg.type === 'stats_update') {
          // 轻量更新 sidebar token 计数
          apiFetch('/api/stats').then(s => ui.updateTopStats(s)).catch(() => {});
        }
      });

      State.ws.addEventListener('close', () => {
        State.wsReady = false;
        ui.setSysStatus(false, 'WebSocket 已断开');
        const sub = document.getElementById('wsStatus');
        if (sub) sub.textContent = '○ 已断开，10s 后重连…';
        setTimeout(() => this.connectWS(), 10000);
      });

      State.ws.addEventListener('error', () => {
        ui.setSysStatus(false, 'WebSocket 错误');
      });

    } catch (err) {
      ui.setSysStatus(false, 'WebSocket 不可用');
    }
  },

  appendLogLine(entry) {
    const el = document.getElementById('realtimeLog');
    if (!el) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    const col = `log-${entry.level}`;
    line.innerHTML = `<span class="log-time">${entry.time}</span><span class="${col}">[${entry.level}]</span><span class="log-msg"> ${esc(entry.msg)}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    // 保留最近 200 行
    while (el.children.length > 200) el.removeChild(el.firstChild);
  },

  render() {
    const checks = [
      { icon: '🔒', ok: true,  title: '传输加密 (TLS 1.3)',      detail: '所有请求通过 HTTPS 加密传输至 Anthropic API' },
      { icon: '🏠', ok: true,  title: '本地监听 (127.0.0.1)',    detail: '服务器仅监听本机，外网无法直接访问' },
      { icon: '🚫', ok: true,  title: '对话数据不落盘',          detail: '会话消息仅存于内存，重启后自动清除' },
      { icon: '🔑', ok: true,  title: 'API Key 保存本机',         detail: '存于 config/settings.json，不经过任何第三方' },
      { icon: '🛡', ok: true,  title: 'API 访问控制',            detail: '非本机 IP 的 /api/* 请求将被拒绝 (403)' },
      { icon: '📡', ok: true,  title: '直连 Anthropic',          detail: '无中间代理服务器，请求直达 api.anthropic.com' },
      { icon: '🧹', ok: false, title: '建议：定期清除 API Key',   detail: '公共设备使用后请在「模型设置」中清除 Key' },
    ];

    const el = document.getElementById('securityChecks');
    if (!el) return;
    el.innerHTML = checks.map(c => `
      <div class="check-item">
        <div class="check-icon">${c.icon}</div>
        <div class="check-info">
          <div class="check-title">${esc(c.title)}</div>
          <div class="check-detail">${esc(c.detail)}</div>
        </div>
        <span class="tag ${c.ok ? 'ok' : 'warn'}">${c.ok ? '安全' : '提示'}</span>
      </div>`).join('');
  },

  async clearKey() {
    if (!confirm('确认清除保存的 API Key？此操作不可撤销。')) return;
    try {
      await apiFetch('/api/config/key', { method: 'DELETE' });
      ui.toast('API Key 已清除', 'ok');
      if (document.getElementById('cfgApiKey'))
        document.getElementById('cfgApiKey').value = '';
    } catch (e) {
      ui.toast('清除失败: ' + e.message, 'err');
    }
  },
};

/* ═══════════════════════════════════════════════════
   APP.LOGS — 日志模块
   ═══════════════════════════════════════════════════ */
const logs = {
  _data: [],

  async refresh() {
    try {
      const { logs: list, total } = await apiFetch('/api/logs?limit=200');
      this._data = list;
      document.getElementById('logCountLabel').textContent = `${total} 条记录`;
      this.render();
    } catch (e) {
      ui.toast('日志加载失败', 'err');
    }
  },

  render() {
    const tbody = document.getElementById('logsTable');
    if (!this._data.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-row">暂无日志</td></tr>';
      return;
    }
    const tagClass = { OK: 'ok', INFO: 'info', WARN: 'warn', ERR: 'err' };
    tbody.innerHTML = this._data.map(r => `
      <tr>
        <td class="yellow">#${r.id}</td>
        <td style="color:var(--text-dim)">${r.time}</td>
        <td><span class="tag ${tagClass[r.level] || 'info'}">${r.level}</span></td>
        <td>${esc(r.msg)}</td>
      </tr>`).join('');
  },

  export() {
    if (!this._data.length) { ui.toast('暂无日志', ''); return; }
    const csv = ['#,时间,级别,消息', ...this._data.map(r =>
      `${r.id},"${r.time}",${r.level},"${r.msg.replace(/"/g,'""')}"`)
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agentos-logs-${Date.now()}.csv`;
    a.click();
    ui.toast('日志已导出', 'ok');
  },

  clear() {
    if (!confirm('确认清除前端日志缓存？服务器端日志不受影响。')) return;
    this._data = [];
    this.render();
    document.getElementById('logCountLabel').textContent = '0 条记录';
    ui.toast('日志已清除', 'ok');
  },
};

/* ═══════════════════════════════════════════════════
   APP.SETTINGS — 设置模块
   ═══════════════════════════════════════════════════ */
const settings = {
  async load() {
    try {
      const cfg = await apiFetch('/api/config');
      const el = (id) => document.getElementById(id);
      if (el('cfgApiKey'))   el('cfgApiKey').placeholder = cfg.apiKey ? '已配置（' + cfg.apiKey + '）' : 'sk-ant-…';
      if (el('cfgModel'))    el('cfgModel').value    = cfg.model;
      if (el('cfgTemp'))   { el('cfgTemp').value     = cfg.temperature; el('tempVal').textContent = cfg.temperature; }
      if (el('cfgMaxTok'))   el('cfgMaxTok').value   = cfg.maxTokens;
      if (el('cfgSystem'))   el('cfgSystem').value   = cfg.systemPrompt;
      if (el('modelBadge'))  el('modelBadge').textContent = cfg.model;
      if (el('sfNode'))      el('sfNode').textContent = 'v' + (window._nodeVersion || '—');
    } catch (e) {
      ui.toast('配置加载失败: ' + e.message, 'err');
    }
  },

  async saveKey() {
    const key = document.getElementById('cfgApiKey')?.value.trim();
    if (!key || key.startsWith('••')) { ui.toast('请输入完整的 API Key', ''); return; }
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
      ui.toast('API Key 已保存', 'ok');
      document.getElementById('cfgApiKey').value = '';
      this.load();
    } catch (e) {
      ui.toast('保存失败: ' + e.message, 'err');
    }
  },

  async save() {
    const el = (id) => document.getElementById(id);
    const payload = {
      apiKey:       el('cfgApiKey')?.value.trim() || undefined,
      model:        el('cfgModel')?.value,
      temperature:  parseFloat(el('cfgTemp')?.value),
      maxTokens:    parseInt(el('cfgMaxTok')?.value),
      systemPrompt: el('cfgSystem')?.value,
    };
    if (!payload.apiKey || payload.apiKey.startsWith('••')) delete payload.apiKey;
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(payload) });
      ui.toast('配置已保存', 'ok');
      this.load();
    } catch (e) {
      ui.toast('保存失败: ' + e.message, 'err');
    }
  },
};

/* ═══════════════════════════════════════════════════
   APP.PROMPTS — 提示词库
   ═══════════════════════════════════════════════════ */
const PROMPTS = [
  {
    icon: '📊', title: '数据分析',
    desc: '上传数据，生成分析报告与洞察建议',
    text: '请帮我分析以下数据，找出关键趋势和业务洞察，并给出行动建议：\n\n[粘贴您的数据]',
  },
  {
    icon: '💻', title: '代码生成',
    desc: '描述功能，自动生成高质量代码',
    text: '请用 Python 实现以下功能，要求代码清晰、有注释、包含错误处理：\n\n功能描述：[描述]',
  },
  {
    icon: '🐛', title: '代码调试',
    desc: '粘贴报错信息，快速定位问题',
    text: '以下代码出现了报错，请帮我分析原因并给出修复方案：\n\n```\n[粘贴代码]\n```\n\n错误信息：\n```\n[粘贴错误]\n```',
  },
  {
    icon: '📝', title: '文档撰写',
    desc: '生成专业技术文档或产品说明',
    text: '请帮我为以下内容撰写一份专业的技术文档，包括概述、功能介绍和使用说明：\n\n[描述产品/功能]',
  },
  {
    icon: '🌐', title: '中英翻译',
    desc: '准确翻译，保持专业语气',
    text: '请将以下内容翻译为英文，保持专业、流畅的技术表达：\n\n[输入中文]',
  },
  {
    icon: '🎯', title: '方案规划',
    desc: '输入目标，生成完整实施方案',
    text: '请帮我制定一个完整的实施方案，目标是：\n\n[描述目标]\n\n请包含：背景分析、具体步骤、时间规划、风险预估。',
  },
  {
    icon: '🔍', title: '问题排查',
    desc: '描述问题现象，快速定位根因',
    text: '我遇到了以下问题，请帮我分析可能的原因并提供排查步骤：\n\n问题现象：[描述]\n\n已尝试的方法：[描述]',
  },
  {
    icon: '📈', title: '商业分析',
    desc: '市场洞察与竞争分析',
    text: '请对以下业务场景进行商业分析，包括市场机会、竞争态势和差异化策略：\n\n业务描述：[描述]',
  },
  {
    icon: '✉️', title: '邮件撰写',
    desc: '起草专业商务邮件',
    text: '请帮我起草一封专业的商务邮件：\n\n收件人：[职位/称呼]\n目的：[写信目的]\n关键信息：[需要传达的内容]',
  },
];

const prompts = {
  render() {
    const grid = document.getElementById('promptsGrid');
    if (!grid) return;
    grid.innerHTML = PROMPTS.map((p, i) => `
      <div class="prompt-card" onclick="App.prompts.use(${i})">
        <div class="prompt-icon">${p.icon}</div>
        <div class="prompt-title">${esc(p.title)}</div>
        <div class="prompt-desc">${esc(p.desc)}</div>
        <div class="prompt-use">使用此模板 →</div>
      </div>`).join('');
  },

  use(idx) {
    const p = PROMPTS[idx];
    if (!p) return;
    chat.insertPrompt(p.text);
    ui.toast(`已插入「${p.title}」模板`, 'ok');
  },
};

/* ═══════════════════════════════════════════════════
   APP — 主入口
   ═══════════════════════════════════════════════════ */
const App = { nav, chat, monitor, security, logs, settings, prompts, ui };

// 全局挂载（方便 HTML onclick 调用）
window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  ui.startClock();
  nav.init();
  chat.init();
  security.init();

  // 初始状态
  ui.setSysStatus(false, '正在连接...');

  // 定时刷新 topbar 统计（每 30s）
  setInterval(async () => {
    try {
      const s = await apiFetch('/api/stats');
      ui.updateTopStats(s);
    } catch (_) {}
  }, 30000);

  // 初始加载配置（用于更新 model badge）
  settings.load();
});
