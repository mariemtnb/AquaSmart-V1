/* ─── AquaSmart SPA ─────────────────────────────────────── */
const API = '';  // same origin

// ─── Navigation ────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: 'Dashboard', sub: 'Real-time water quality monitoring' },
  ponds:     { title: 'Ponds Monitor', sub: 'Live status of all fish ponds' },
  predict:   { title: 'Predict & Recommend', sub: 'ML-powered feeding recommendation' },
  analytics: { title: 'Analytics', sub: 'Historical trends & model insights' },
  chat:      { title: 'AquaBot Chat', sub: 'Intelligent fish farming assistant' },
  fisher:    { title: '🐠 Fisher Interface', sub: 'Simple view for fish farmers — everything in one place' },
  federated: { title: 'Federated Learning', sub: 'Privacy-preserving distributed training across ponds' },
  about:     { title: 'About AquaSmart', sub: 'Project information & tech stack' },
};

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  const m = PAGE_META[page] || {};
  document.getElementById('topbar-title').textContent = m.title || page;
  document.getElementById('topbar-sub').textContent   = m.sub   || '';
  if (page === 'fisher')    loadFisherInterface();
  if (page === 'ponds')     loadPonds();
  if (page === 'analytics') loadAnalytics();
  if (page === 'about')     loadModelInfo();
  if (page === 'federated') { loadFLStatus(); startFLPolling(); }
}

document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});

document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ─── Clock ──────────────────────────────────────────────────
function updateClock() {
  document.getElementById('live-time').textContent =
    new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000); updateClock();

// ─── Helpers ────────────────────────────────────────────────
function stratBadge(s) {
  const map = { STOP:'red', REDUCE:'orange', NORMAL:'green', INCREASE:'blue' };
  return `<span class="badge badge-${map[s]||'teal'}">${s}</span>`;
}
function wqiBadge(cat) {
  const map = { Excellent:'blue', Good:'green', Fair:'yellow', Poor:'red' };
  return `<span class="badge badge-${map[cat]||'teal'}">${cat}</span>`;
}
function alertClass(sev) {
  return { critical:'alert-critical', warning:'alert-warning', info:'alert-info' }[sev] || 'alert-info';
}
function paramColor(param, val) {
  const ranges = {
    temperature:       { ok:[20,28], warn:[15,33] },
    dissolved_oxygen:  { ok:[5,12],  warn:[3,12] },
    ph:                { ok:[6.5,8.5], warn:[5.5,9.5] },
    turbidity:         { ok:[0,30],  warn:[0,50] },
    ammonia:           { ok:[0,.02], warn:[0,.06] },
    nitrate:           { ok:[0,10],  warn:[0,20] },
  };
  const r = ranges[param]; if (!r) return 'var(--teal)';
  if (val < r.ok[0] || val > r.ok[1]) {
    if (val < r.warn[0] || val > r.warn[1]) return 'var(--red)';
    return 'var(--orange)';
  }
  return 'var(--green)';
}

// ─── Dashboard ──────────────────────────────────────────────
let trendChart = null, trendData = [], currentParam = 'temperature';

const METRICS_CONFIG = [
  { key:'temperature',      label:'Temperature',     unit:'°C',    icon:'🌡️',  accent:'#f97316' },
  { key:'dissolved_oxygen', label:'Dissolved O₂',    unit:'mg/L',  icon:'💨',  accent:'#00b4d8' },
  { key:'ph',               label:'pH',              unit:'',      icon:'⚗️',  accent:'#8b5cf6' },
  { key:'turbidity',        label:'Turbidity',       unit:'NTU',   icon:'🌫️', accent:'#eab308' },
  { key:'ammonia',          label:'Ammonia',         unit:'mg/L',  icon:'☠️', accent:'#ef4444' },
  { key:'nitrate',          label:'Nitrate',         unit:'mg/L',  icon:'🧪',  accent:'#22c55e' },
];

async function refreshDashboard() {
  try {
    const r = await fetch(`${API}/api/dashboard/current${window.location.search}`).then(r => r.json());
    document.getElementById('last-update').textContent = new Date(r.timestamp).toLocaleTimeString();

    // Metric cards
    const grid = document.getElementById('metric-cards');
    grid.innerHTML = METRICS_CONFIG.map(m => {
      const val = r[m.key];
      const col = paramColor(m.key, val);
      const disp = m.key === 'ammonia' ? val.toFixed(4) : parseFloat(val).toFixed(2);
      return `<div class="metric-card" style="--accent-color:${m.accent}">
        <div class="metric-label">${m.label}</div>
        <div class="metric-value" style="color:${col}">${disp}</div>
        <div class="metric-unit">${m.unit}</div>
        <div class="metric-icon">${m.icon}</div>
      </div>`;
    }).join('');

    // WQI gauge
    drawWQIGauge(r.wqi);
    document.getElementById('wqi-value').textContent = r.wqi.toFixed(1);
    document.getElementById('wqi-cat').textContent   = r.wqi_category;
    document.getElementById('wqi-badge').className   = `badge ${wqiBadge(r.wqi_category).match(/badge-\w+/)[0]}`;
    document.getElementById('wqi-badge').textContent = r.wqi_category;

    // Alerts
    const aList = document.getElementById('alerts-list');
    const badge = document.getElementById('alert-count-badge');
    if (!r.alerts || r.alerts.length === 0) {
      aList.innerHTML = `<div class="alert alert-success"><span>✅</span><span>All parameters within safe range.</span></div>`;
      badge.className = 'badge badge-green'; badge.textContent = '0 alerts';
    } else {
      badge.className = r.alerts.some(a=>a.severity==='critical') ? 'badge badge-red' : 'badge badge-orange';
      badge.textContent = `${r.alerts.length} alert${r.alerts.length>1?'s':''}`;
      aList.innerHTML = r.alerts.map(a =>
        `<div class="alert ${alertClass(a.severity)}">
          <span>${a.severity==='critical'?'🚨':'⚠️'}</span>
          <div><strong>${a.param}</strong>: ${a.message}</div>
        </div>`
      ).join('');
    }

    // Feeding banner
    const stratMap = {
      STOP:     { emoji:'⛔', border:'var(--red)',    bg:'rgba(239,68,68,.08)',    text:'var(--red)' },
      REDUCE:   { emoji:'⚠️', border:'var(--orange)', bg:'rgba(249,115,22,.08)', text:'var(--orange)' },
      NORMAL:   { emoji:'✅', border:'var(--green)',  bg:'rgba(34,197,94,.08)',   text:'var(--green)' },
      INCREASE: { emoji:'🆙', border:'var(--blue)',   bg:'rgba(59,130,246,.08)',  text:'var(--blue)' },
    };
    const sm = stratMap[r.strategy] || stratMap.NORMAL;
    const msgs = {
      STOP:     'Do NOT feed — critical water conditions.',
      REDUCE:   'Reduce feeding by 30–50%. Suboptimal conditions.',
      NORMAL:   'Normal feeding recommended. Conditions are good.',
      INCREASE: 'Excellent conditions — slight feed increase (+10%) possible.',
    };
    document.getElementById('feeding-banner').innerHTML = `
      <div class="result-banner" style="border-color:${sm.border};background:${sm.bg}">
        <div>
          <div class="strategy-label" style="color:var(--text-muted)">Strategy</div>
          <div style="font-size:2rem;font-weight:800;color:${sm.text};margin:4px 0">${sm.emoji} ${r.strategy}</div>
          <div class="strategy-msg">${msgs[r.strategy]}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.78rem;color:var(--text-muted)">Water Quality Index</div>
          <div style="font-size:2.2rem;font-weight:800;color:${sm.text}">${r.wqi.toFixed(1)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${r.wqi_category}</div>
        </div>
      </div>`;
  } catch(e) {
    console.error('Dashboard error:', e);
  }
}

// ─── WQI Gauge (canvas arc) ─────────────────────────────────
function drawWQIGauge(value) {
  const canvas = document.getElementById('wqiGauge');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height - 10;
  const r  = 90;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(30,64,96,.6)';
  ctx.lineWidth = 18; ctx.lineCap = 'round';
  ctx.stroke();

  // Value arc
  const pct = Math.min(value / 100, 1);
  const color = value >= 80 ? '#3b82f6' : value >= 60 ? '#22c55e' : value >= 40 ? '#eab308' : '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + pct * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 18; ctx.lineCap = 'round';
  ctx.stroke();

  // Labels
  ctx.fillStyle = 'rgba(127,179,211,.7)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('0', cx - r - 8, cy + 14);
  ctx.fillText('100', cx + r + 12, cy + 14);
}

// ─── Trend chart ────────────────────────────────────────────
async function loadTrend() {
  const data = await fetch(`${API}/api/dashboard/history?hours=24`).then(r => r.json());
  trendData = data;
  renderTrend();
}

function setTrendParam(param) {
  currentParam = param;
  renderTrend();
}

function renderTrend() {
  const labels = trendData.map(r => r.timestamp.substring(11, 16));
  const vals   = trendData.map(r => r[currentParam]);
  const colors = { temperature:'#f97316', dissolved_oxygen:'#00b4d8', ph:'#8b5cf6', wqi:'#22c55e', ammonia:'#ef4444', turbidity:'#eab308' };
  const col = colors[currentParam] || '#00b4d8';

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: currentParam.replace('_',' '),
        data: vals,
        borderColor: col,
        backgroundColor: col + '18',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(30,64,96,.4)' }, ticks: { color: '#7fb3d3', maxTicksLimit: 8, font:{size:10} } },
        y: { grid: { color: 'rgba(30,64,96,.4)' }, ticks: { color: '#7fb3d3', font:{size:10} } },
      },
    }
  };

  if (trendChart) { trendChart.destroy(); }
  trendChart = new Chart(document.getElementById('trendChart'), cfg);
}

// ─── Ponds ──────────────────────────────────────────────────
async function loadPonds() {
  const grid = document.getElementById('ponds-grid');
  grid.innerHTML = '<div class="spinner"></div>';
  const ponds = await fetch(`${API}/api/dashboard/ponds`).then(r => r.json());
  const stratColor = { STOP:'var(--red)', REDUCE:'var(--orange)', NORMAL:'var(--green)', INCREASE:'var(--blue)' };
  grid.innerHTML = ponds.map(p => `
    <div class="pond-card">
      <div class="pond-name">
        🏊 ${p.name}
        <span class="badge badge-${p.strategy==='NORMAL'?'green':p.strategy==='REDUCE'?'orange':p.strategy==='STOP'?'red':'blue'}">${p.strategy}</span>
      </div>
      <div class="param-row"><span class="param-name">🐠 Population</span><span class="param-val">${p.population} fish</span></div>
      <div class="param-row"><span class="param-name">⚖️ Avg Weight</span><span class="param-val">${p.avg_weight_g} g</span></div>
      <div class="param-row"><span class="param-name">🌡️ Temperature</span><span class="param-val" style="color:${paramColor('temperature',p.temperature)}">${p.temperature.toFixed(1)} °C</span></div>
      <div class="param-row"><span class="param-name">💨 Dissolved O₂</span><span class="param-val" style="color:${paramColor('dissolved_oxygen',p.dissolved_oxygen)}">${p.dissolved_oxygen.toFixed(1)} mg/L</span></div>
      <div class="param-row"><span class="param-name">⚗️ pH</span><span class="param-val" style="color:${paramColor('ph',p.ph)}">${p.ph.toFixed(2)}</span></div>
      <div class="param-row"><span class="param-name">💧 WQI</span><span class="param-val text-teal">${p.wqi.toFixed(1)} — ${p.wqi_category}</span></div>
    </div>`).join('');
}

// ─── Prediction ─────────────────────────────────────────────
document.getElementById('predict-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    temperature:      parseFloat(document.getElementById('f-temp').value),
    dissolved_oxygen: parseFloat(document.getElementById('f-do').value),
    ph:               parseFloat(document.getElementById('f-ph').value),
    turbidity:        parseFloat(document.getElementById('f-turb').value),
    ammonia:          parseFloat(document.getElementById('f-ammo').value),
    nitrate:          parseFloat(document.getElementById('f-nit').value),
    fish_weight_g:    parseFloat(document.getElementById('f-fw').value),
    population:       parseInt(document.getElementById('f-pop').value),
    base_feed_kg:     parseFloat(document.getElementById('f-feed').value),
  };

  document.getElementById('predict-result').innerHTML = '<div class="spinner"></div>';

  try {
    const r = await fetch(`${API}/api/predict`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    }).then(r => r.json());

    const stratMap = {
      STOP:     { emoji:'⛔', border:'var(--red)',    bg:'rgba(239,68,68,.1)',    text:'var(--red)',    badge:'badge-red' },
      REDUCE:   { emoji:'⚠️', border:'var(--orange)', bg:'rgba(249,115,22,.1)', text:'var(--orange)', badge:'badge-orange' },
      NORMAL:   { emoji:'✅', border:'var(--green)',  bg:'rgba(34,197,94,.1)',   text:'var(--green)',  badge:'badge-green' },
      INCREASE: { emoji:'🆙', border:'var(--blue)',   bg:'rgba(59,130,246,.1)',  text:'var(--blue)',   badge:'badge-blue' },
    };
    const sm = stratMap[r.strategy] || stratMap.NORMAL;

    const alertsHtml = r.parameter_alerts.length === 0
      ? `<div class="alert alert-success"><span>✅</span><span>All parameters are within safe range.</span></div>`
      : r.parameter_alerts.map(a =>
          `<div class="alert ${alertClass(a.severity)}">
            <span>${a.severity==='critical'?'🚨':'⚠️'}</span>
            <div><strong>${a.param}</strong> (${a.value} ${a.unit}): ${a.message}</div>
          </div>`).join('');

    document.getElementById('predict-result').innerHTML = `
      <div class="result-banner" style="border-color:${sm.border};background:${sm.bg}">
        <div>
          <div class="strategy-label" style="color:var(--text-muted)">ML Recommendation</div>
          <div style="font-size:2rem;font-weight:800;color:${sm.text};margin:4px 0">${sm.emoji} ${r.strategy}</div>
          <div style="font-size:.85rem;margin-top:4px">${r.message}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.78rem;color:var(--text-muted)">Recommended Feed</div>
          <div class="feed-amount" style="color:${sm.text}">${r.recommended_feed_kg.toFixed(2)}</div>
          <div style="font-size:.9rem;color:var(--text-muted)">kg / day</div>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:16px">
        <div class="card">
          <div style="font-size:.75rem;color:var(--text-muted)">Water Quality Index</div>
          <div style="font-size:2rem;font-weight:700;color:var(--teal)">${r.water_quality_index}</div>
          ${wqiBadge(r.wqi_category)}
        </div>
        <div class="card">
          <div style="font-size:.75rem;color:var(--text-muted)">ML Prediction (per fish)</div>
          <div style="font-size:2rem;font-weight:700;color:var(--teal)">${r.ml_prediction_g ? r.ml_prediction_g.toFixed(2) : '—'}</div>
          <div style="font-size:.8rem;color:var(--text-muted)">g / fish / day</div>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:16px">
        <div class="card">
          <div style="font-size:.75rem;color:var(--text-muted)">Strategy Multiplier</div>
          <div style="font-size:2rem;font-weight:700;color:${sm.text}">×${r.multiplier}</div>
        </div>
        <div class="card">
          <div style="font-size:.75rem;color:var(--text-muted)">Confidence</div>
          <div style="font-size:2rem;font-weight:700;color:var(--teal)">${r.confidence}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">⚠️ Parameter Alerts</span></div>
        ${alertsHtml}
      </div>`;
  } catch(e) {
    document.getElementById('predict-result').innerHTML =
      `<div class="alert alert-critical"><span>❌</span><span>Error: ${e.message}. Make sure the backend is running.</span></div>`;
  }
});

function fillDemo() {
  const demos = [
    { temp:24.5, do:7.8, ph:7.2, turb:8,  ammo:0.003, nit:2.0, fw:80,  pop:300, feed:5 },
    { temp:30,   do:4.2, ph:7.0, turb:20, ammo:0.010, nit:5.0, fw:120, pop:400, feed:7 },
    { temp:11,   do:2.5, ph:5.8, turb:45, ammo:0.080, nit:12,  fw:50,  pop:200, feed:4 },
  ];
  const d = demos[Math.floor(Math.random() * demos.length)];
  document.getElementById('f-temp').value = d.temp;
  document.getElementById('f-do').value   = d.do;
  document.getElementById('f-ph').value   = d.ph;
  document.getElementById('f-turb').value = d.turb;
  document.getElementById('f-ammo').value = d.ammo;
  document.getElementById('f-nit').value  = d.nit;
  document.getElementById('f-fw').value   = d.fw;
  document.getElementById('f-pop').value  = d.pop;
  document.getElementById('f-feed').value = d.feed;
}

// ─── Analytics ──────────────────────────────────────────────
let analyticsCharts = {};

async function loadAnalytics() {
  const data = await fetch(`${API}/api/dashboard/history?hours=48`).then(r => r.json());
  const labels = data.map(r => r.timestamp.substring(11,16));

  const chartOpts = (col1, col2) => ({
    responsive:true,
    plugins:{ legend:{ labels:{ color:'#7fb3d3', font:{size:11} } } },
    scales:{
      x:{ grid:{color:'rgba(30,64,96,.4)'}, ticks:{color:'#7fb3d3', maxTicksLimit:8, font:{size:9}} },
      y:{ grid:{color:'rgba(30,64,96,.4)'}, ticks:{color:'#7fb3d3', font:{size:9}} }
    }
  });

  function mkChart(id, datasets, extra) {
    if (analyticsCharts[id]) analyticsCharts[id].destroy();
    analyticsCharts[id] = new Chart(document.getElementById(id), {
      type:'line',
      data:{ labels, datasets },
      options: chartOpts()
    });
  }

  mkChart('tempDoChart', [
    { label:'Temperature (°C)', data:data.map(r=>r.temperature), borderColor:'#f97316', backgroundColor:'#f9731618', borderWidth:2, pointRadius:0, fill:true, tension:.4 },
    { label:'Dissolved O₂ (mg/L)', data:data.map(r=>r.dissolved_oxygen), borderColor:'#00b4d8', backgroundColor:'#00b4d818', borderWidth:2, pointRadius:0, fill:true, tension:.4, yAxisID:'y2' },
  ]);

  mkChart('phChart', [
    { label:'pH', data:data.map(r=>r.ph), borderColor:'#8b5cf6', backgroundColor:'#8b5cf618', borderWidth:2, pointRadius:0, fill:true, tension:.4 },
  ]);

  mkChart('ammoChart', [
    { label:'Ammonia (mg/L)', data:data.map(r=>r.ammonia), borderColor:'#ef4444', backgroundColor:'#ef444418', borderWidth:2, pointRadius:0, fill:true, tension:.4 },
    { label:'Nitrate (mg/L)', data:data.map(r=>r.nitrate), borderColor:'#22c55e', backgroundColor:'#22c55e18', borderWidth:2, pointRadius:0, fill:true, tension:.4 },
  ]);

  mkChart('wqiHistChart', [
    { label:'WQI', data:data.map(r=>r.wqi), borderColor:'#00b4d8', backgroundColor:'#00b4d818', borderWidth:2, pointRadius:0, fill:true, tension:.4 },
  ]);

  loadModelInfo();
}

async function loadModelInfo() {
  try {
    const info = await fetch(`${API}/api/dashboard/stats`).then(r => r.json());
    document.getElementById('model-info').innerHTML = `
      <div class="grid-4" style="margin-bottom:16px">
        <div class="card"><div class="metric-label">Model</div><div style="font-weight:700;color:var(--teal);margin-top:6px;font-size:.9rem">${info.model_name}</div></div>
        <div class="card"><div class="metric-label">Task</div><div style="font-weight:700;color:var(--text);margin-top:6px;text-transform:capitalize">${info.task_type}</div></div>
        <div class="card"><div class="metric-label">Features</div><div class="metric-value" style="font-size:1.6rem">${info.features_count}</div></div>
        <div class="card"><div class="metric-label">Training Samples</div><div class="metric-value" style="font-size:1.6rem">${info.training_samples.toLocaleString()}</div></div>
      </div>
      ${info.note ? `<div class="alert alert-info"><span>ℹ️</span><span>${info.note}</span></div>` : ''}
      <div style="margin-top:12px">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">Feature list</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${(info.features||[]).map(f=>`<span class="badge badge-teal">${f}</span>`).join('')}
        </div>
      </div>`;
  } catch(e) {
    document.getElementById('model-info').innerHTML = `<div class="alert alert-warning"><span>⚠️</span><span>Could not load model info.</span></div>`;
  }
}

// ─── Chatbot ────────────────────────────────────────────────
function appendMessage(role, html, suggestions) {
  const msgs = document.getElementById('chat-messages');
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const formatted = html
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  let sugHtml = '';
  if (suggestions && suggestions.length) {
    sugHtml = `<div class="suggestions">${suggestions.map(s =>
      `<span class="suggestion-chip" onclick="sendSuggestion(this)">${s}</span>`
    ).join('')}</div>`;
  }

  div.innerHTML = `
    <div class="msg-avatar ${role}">${isUser ? '👤' : '🐟'}</div>
    <div>
      <div class="msg-bubble">${formatted}</div>
      ${sugHtml}
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'message bot';
  div.innerHTML = `<div class="msg-avatar bot">🐟</div><div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideTyping() {
  document.getElementById('typing-indicator')?.remove();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  input.value = '';
  showTyping();

  try {
    const r = await fetch(`${API}/api/chat`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: text })
    }).then(r => r.json());

    await new Promise(res => setTimeout(res, 600));
    hideTyping();
    appendMessage('bot', r.reply, r.suggestions);
  } catch(e) {
    hideTyping();
    appendMessage('bot', 'Connection error. Make sure the backend server is running.', []);
  }
}

function sendSuggestion(el) {
  document.getElementById('chat-input').value = el.textContent;
  sendChat();
}

// ─── Fisher Interface ────────────────────────────────────────
let _fiData = null;   // cached current reading

const FI_PARAMS = [
  { key:'temperature',      emoji:'🌡️',  label:'Water Temperature', unit:'°C',
    good:[20,28], ok:[15,32],
    goodMsg:'Perfect for your fish!', okMsg:'Acceptable — watch closely', badMsg:'Too extreme — act now!' },
  { key:'dissolved_oxygen', emoji:'💨',  label:'Oxygen in Water',   unit:'mg/L',
    good:[5,12],  ok:[3,12],
    goodMsg:'Fish can breathe fine', okMsg:'A little low — add aeration', badMsg:'Danger! Fish may die' },
  { key:'ph',               emoji:'⚗️',  label:'Water pH',          unit:'',
    good:[6.5,8.5], ok:[5.5,9.5],
    goodMsg:'Water balance is good', okMsg:'Slightly off — monitor', badMsg:'Water imbalanced — fix it!' },
  { key:'ammonia',          emoji:'☠️', label:'Ammonia Level',     unit:'mg/L',
    good:[0,.02], ok:[0,.06],
    goodMsg:'Safe — no ammonia risk', okMsg:'Elevated — reduce feeding', badMsg:'Toxic! Change water now!' },
];

function _fiStatus(cfg, val) {
  if (val >= cfg.good[0] && val <= cfg.good[1]) return { level:'good',  color:'#22c55e', icon:'✅', msg:cfg.goodMsg };
  if (val >= cfg.ok[0]   && val <= cfg.ok[1])   return { level:'ok',    color:'#eab308', icon:'⚠️', msg:cfg.okMsg };
  return                                                { level:'bad',   color:'#ef4444', icon:'🚨', msg:cfg.badMsg };
}

function _overallStatus(data) {
  const statuses = FI_PARAMS.map(p => _fiStatus(p, data[p.key]).level);
  if (statuses.includes('bad'))  return { label:'DANGER',  color:'#ef4444', bg:'rgba(239,68,68,.1)',  icon:'🚨', feed:'STOP' };
  if (statuses.includes('ok'))   return { label:'CAUTION', color:'#eab308', bg:'rgba(234,179,8,.1)',  icon:'⚠️', feed:'REDUCE' };
  return                                { label:'ALL GOOD', color:'#22c55e', bg:'rgba(34,197,94,.1)', icon:'✅', feed:'FEED' };
}

async function loadFisherInterface() {
  try {
    const data = await fetch(`${API}/api/dashboard/current`).then(r => r.json());
    _fiData = data;

    // Last check time
    const el = document.getElementById('fi-last-check');
    if (el) el.textContent = new Date(data.timestamp).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});

    // Water cards
    const grid = document.getElementById('fi-water-cards');
    if (grid) {
      grid.innerHTML = FI_PARAMS.map(p => {
        const val = data[p.key];
        const st  = _fiStatus(p, val);
        const disp = p.key === 'ammonia' ? val.toFixed(4) : parseFloat(val).toFixed(1);
        return `<div style="background:var(--ocean-card);border:2px solid ${st.color}33;border-radius:16px;padding:20px;text-align:center;position:relative;overflow:hidden;transition:all .25s">
          <div style="font-size:2rem;margin-bottom:6px">${p.emoji}</div>
          <div style="font-size:.78rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em">${p.label}</div>
          <div style="font-size:2.2rem;font-weight:800;color:${st.color};margin:8px 0;line-height:1">${disp}<span style="font-size:.9rem;font-weight:500"> ${p.unit}</span></div>
          <div style="font-size:1.4rem;margin-bottom:4px">${st.icon}</div>
          <div style="font-size:.78rem;color:${st.color};font-weight:600">${st.msg}</div>
        </div>`;
      }).join('');
    }

    // Feed answer
    const overall = _overallStatus(data);
    const feedEl  = document.getElementById('fi-feed-answer');
    if (feedEl) {
      const feedMsgs = {
        STOP:   { title:'❌ DO NOT FEED', desc:'Water conditions are dangerous right now. First fix the water, then feed your fish.', sub:'Your fish are stressed. Focus on improving water quality.' },
        REDUCE: { title:'⚠️ Feed Less Today', desc:'Water conditions are not perfect. Give your fish about half the normal amount.', sub:'Check which indicator is yellow or red and fix it.' },
        FEED:   { title:'✅ Yes! Feed Your Fish', desc:'Water conditions are great right now. This is a good time to feed.', sub:'Your fish are healthy and ready to eat.' },
      };
      const fm = feedMsgs[overall.feed];
      feedEl.innerHTML = `
        <div style="background:${overall.bg};border:3px solid ${overall.color};border-radius:18px;padding:28px 32px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
          <div style="font-size:4rem;line-height:1">${overall.icon}</div>
          <div style="flex:1">
            <div style="font-size:1.8rem;font-weight:800;color:${overall.color};margin-bottom:6px">${fm.title}</div>
            <div style="font-size:1rem;color:var(--text);margin-bottom:4px">${fm.desc}</div>
            <div style="font-size:.85rem;color:var(--text-muted)">${fm.sub}</div>
          </div>
          <div style="text-align:center;background:${overall.color}22;border-radius:12px;padding:14px 20px">
            <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:4px">Water Quality</div>
            <div style="font-size:2.5rem;font-weight:800;color:${overall.color}">${data.wqi.toFixed(0)}</div>
            <div style="font-size:.75rem;color:${overall.color};font-weight:700">${data.wqi_category || ''}</div>
          </div>
        </div>`;
    }

    // Tips
    renderFiTips(data, overall);

    // Ponds
    loadFiPonds();

  } catch(e) {
    const feedEl = document.getElementById('fi-feed-answer');
    if (feedEl) feedEl.innerHTML = `<div class="alert alert-critical"><span>❌</span><span>Could not load water data. Is the server running?</span></div>`;
  }
}

function renderFiTips(data, overall) {
  const tipsEl = document.getElementById('fi-tips');
  if (!tipsEl) return;

  const tips = [];

  // Time of day tip
  const h = new Date().getHours();
  if (h >= 6 && h <= 9)
    tips.push({ icon:'🌅', title:'Morning Feeding Time', body:'This is one of the best times to feed fish. Morning feeding is great for growth.', color:'#f97316' });
  else if (h >= 17 && h <= 20)
    tips.push({ icon:'🌇', title:'Evening Feeding Time', body:'Good time for your second feeding of the day. Do not overfeed.', color:'#8b5cf6' });
  else if (h >= 22 || h <= 5)
    tips.push({ icon:'🌙', title:'Night Time — No Feeding', body:'Fish are resting at night. Do not feed them now — uneaten food will dirty the water.', color:'#3b82f6' });
  else
    tips.push({ icon:'☀️', title:'Daytime', body:'Feed 2–3 times a day. Only give as much as fish eat in 5–10 minutes.', color:'#eab308' });

  // Water tips based on readings
  if (data.dissolved_oxygen < 5)
    tips.push({ icon:'🫧', title:'Low Oxygen — Add Aeration', body:'Turn on your aerator or air pump right now. Low oxygen harms fish quickly.', color:'#ef4444' });
  else if (data.dissolved_oxygen >= 7)
    tips.push({ icon:'💨', title:'Oxygen is Excellent', body:'Great oxygen levels! Your fish can breathe easily and grow well.', color:'#22c55e' });

  if (data.ammonia > 0.02)
    tips.push({ icon:'💧', title:'Change Some Water Today', body:'Ammonia is high. Remove 20–30% of the water and replace with clean water.', color:'#ef4444' });
  else
    tips.push({ icon:'✨', title:'Water Quality is Good', body:'Keep up the good work! Regular monitoring keeps your fish healthy.', color:'#22c55e' });

  if (data.turbidity > 30)
    tips.push({ icon:'🌫️', title:'Water is Cloudy', body:'Cloudy water blocks sunlight and oxygen. Reduce feeding and check your filter.', color:'#eab308' });
  else
    tips.push({ icon:'🔵', title:'Water is Clear', body:'Clear water means a healthy pond. Good visibility helps you spot problems early.', color:'#00b4d8' });

  tips.push({ icon:'📋', title:'Daily Checklist', body:'✔ Check water colour  ✔ Count fish  ✔ Watch fish behaviour  ✔ Clean uneaten food', color:'#7fb3d3' });

  tipsEl.innerHTML = tips.slice(0, 6).map(t => `
    <div style="background:var(--ocean-card);border-left:4px solid ${t.color};border-radius:14px;padding:18px 20px;border:1px solid var(--ocean-border);border-left:4px solid ${t.color}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:1.5rem">${t.icon}</span>
        <span style="font-weight:700;color:var(--text)">${t.title}</span>
      </div>
      <div style="font-size:.87rem;color:var(--text-muted);line-height:1.6">${t.body}</div>
    </div>`).join('');
}

async function loadFiPonds() {
  const el = document.getElementById('fi-ponds');
  if (!el) return;
  try {
    const ponds = await fetch(`${API}/api/dashboard/ponds`).then(r => r.json());
    const colMap = { STOP:'#ef4444', REDUCE:'#eab308', NORMAL:'#22c55e', INCREASE:'#3b82f6' };
    const emojiMap = { STOP:'🚨', REDUCE:'⚠️', NORMAL:'✅', INCREASE:'🌟' };
    const labelMap = { STOP:'DANGER — Don\'t feed', REDUCE:'Caution — Feed less', NORMAL:'All good — Feed normally', INCREASE:'Excellent — Feed a little more' };
    el.innerHTML = ponds.map(p => {
      const col = colMap[p.strategy] || '#22c55e';
      return `<div style="background:var(--ocean-card);border:2px solid ${col}44;border-radius:14px;padding:18px;cursor:pointer;transition:all .25s" onclick="navigate('ponds')">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="font-size:1rem;font-weight:700">🏊 ${p.name}</div>
          <div style="font-size:1.3rem">${emojiMap[p.strategy] || '✅'}</div>
        </div>
        <div style="font-size:.82rem;font-weight:700;color:${col};margin-bottom:12px">${labelMap[p.strategy] || ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.8rem">
          <div style="color:var(--text-muted)">🐠 Fish: <strong style="color:var(--text)">${p.population}</strong></div>
          <div style="color:var(--text-muted)">⚖️ Weight: <strong style="color:var(--text)">${p.avg_weight_g}g</strong></div>
          <div style="color:var(--text-muted)">🌡️ Temp: <strong style="color:var(--text)">${p.temperature.toFixed(1)}°C</strong></div>
          <div style="color:var(--text-muted)">💧 WQI: <strong style="color:${col}">${p.wqi.toFixed(0)}</strong></div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="text-muted small">Could not load ponds.</div>';
  }
}

function calcFeed() {
  const count  = parseInt(document.getElementById('fi-fish-count').value)  || 200;
  const weight = parseFloat(document.getElementById('fi-fish-weight').value) || 80;
  const resultEl = document.getElementById('fi-feed-result');
  const kgEl     = document.getElementById('fi-feed-kg');
  const noteEl   = document.getElementById('fi-feed-note');

  // Base rate: 3% of body weight
  let rate = 0.03;
  let mult = 1.0;
  let note = 'Based on 3% of total fish weight (standard daily feeding rate).';

  if (_fiData) {
    const overall = _overallStatus(_fiData);
    const multMap = { FEED:1.0, REDUCE:0.55, STOP:0 };
    mult = multMap[overall.feed] ?? 1.0;
    if (overall.feed === 'STOP')   note = '⛔ Do NOT feed — water conditions are dangerous right now.';
    if (overall.feed === 'REDUCE') note = '⚠️ Reduced amount because water conditions are not perfect.';
    if (overall.feed === 'FEED')   note = '✅ Full amount — water conditions are great!';
  }

  const totalWeightKg = (count * weight) / 1000;
  const feedKg = +(totalWeightKg * rate * mult).toFixed(2);

  kgEl.textContent    = feedKg.toFixed(2);
  noteEl.textContent  = note;
  resultEl.style.display = 'block';
}

async function fiAsk(question) {
  const answerEl = document.getElementById('fi-bot-answer');
  if (!answerEl) return;
  answerEl.style.display = 'block';
  answerEl.innerHTML = '<div style="color:var(--text-muted)">⏳ AquaBot is thinking…</div>';

  try {
    const r = await fetch(`${API}/api/chat`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: question })
    }).then(r => r.json());

    const formatted = r.reply
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--teal-light)">$1</strong>')
      .replace(/\n/g, '<br>');

    answerEl.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:1.4rem;flex-shrink:0">🐟</div>
        <div>${formatted}</div>
      </div>
      ${r.suggestions?.length ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        ${r.suggestions.map(s=>`<span class="suggestion-chip" onclick="fiAsk('${s.replace(/'/g,"\\'")}')"> ${s}</span>`).join('')}
      </div>` : ''}`;
  } catch(e) {
    answerEl.innerHTML = '<div style="color:var(--red)">Could not reach AquaBot. Is the server running?</div>';
  }
}

// ─── Federated Learning ──────────────────────────────────────
let flChart = null;
let flPollTimer = null;

async function startFL() {
  const btn = document.getElementById('fl-start-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Starting…';

  const body = {
    n_rounds: parseInt(document.getElementById('fl-rounds').value),
    n_ponds:  parseInt(document.getElementById('fl-ponds').value),
    dp_noise: parseFloat(document.getElementById('fl-dp').value),
  };

  try {
    const r = await fetch(`${API}/api/federated/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());

    if (r.started) {
      startFLPolling();
    } else {
      alert(r.message);
      btn.disabled = false;
      btn.textContent = '🚀 Start Federated Training';
    }
  } catch (e) {
    alert('Error: ' + e.message);
    btn.disabled = false;
    btn.textContent = '🚀 Start Federated Training';
  }
}

function startFLPolling() {
  if (flPollTimer) clearInterval(flPollTimer);
  flPollTimer = setInterval(async () => {
    const state = await loadFLStatus();
    if (state && state.status !== 'training') {
      clearInterval(flPollTimer);
      flPollTimer = null;
      const btn = document.getElementById('fl-start-btn');
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Start Federated Training'; }
    }
  }, 1500);
}

async function loadFLStatus() {
  try {
    const s = await fetch(`${API}/api/federated/status`).then(r => r.json());
    renderFLState(s);
    return s;
  } catch (e) {
    return null;
  }
}

function renderFLState(s) {
  // Badge
  const badgeMap = {
    idle:     ['badge-teal',   'Idle'],
    training: ['badge-yellow', '⚙️ Training…'],
    done:     ['badge-green',  '✅ Complete'],
    error:    ['badge-red',    '❌ Error'],
  };
  const [badgeCls, badgeTxt] = badgeMap[s.status] || ['badge-teal', s.status];
  const badge = document.getElementById('fl-status-badge');
  if (badge) { badge.className = `badge ${badgeCls}`; badge.textContent = badgeTxt; }

  // Progress bar
  const prog = document.getElementById('fl-progress-bar');
  if (prog) prog.style.width = s.progress_pct + '%';
  const rlabel = document.getElementById('fl-round-label');
  if (rlabel) rlabel.textContent = `${s.current_round} / ${s.total_rounds}`;

  // Metrics
  const rmseEl = document.getElementById('fl-rmse');
  const r2El   = document.getElementById('fl-r2');
  if (rmseEl) rmseEl.textContent = s.latest_rmse != null ? s.latest_rmse.toFixed(4) : '—';
  if (r2El)   r2El.textContent   = s.latest_r2   != null ? s.latest_r2.toFixed(4)   : '—';

  // Status panel
  const panel = document.getElementById('fl-status-panel');
  if (panel) {
    if (s.status === 'idle') {
      panel.innerHTML = `<div class="text-muted small" style="padding:8px 0">Configure and click <strong>Start Federated Training</strong>.</div>`;
    } else if (s.status === 'training') {
      panel.innerHTML = `
        <div class="alert alert-info" style="margin:0">
          <span>⚙️</span>
          <span>Round <strong>${s.current_round}</strong> of <strong>${s.total_rounds}</strong> in progress…
          <br>${s.n_clients} ponds collaborating privately.</span>
        </div>`;
    } else if (s.status === 'done') {
      panel.innerHTML = `
        <div class="alert alert-success" style="margin:0">
          <span>✅</span>
          <div>Training complete in <strong>${s.total_rounds}</strong> rounds across <strong>${s.n_clients}</strong> ponds.
          <br>Final RMSE: <strong>${s.latest_rmse?.toFixed(4) ?? '—'}</strong> &nbsp;|&nbsp; R²: <strong>${s.latest_r2?.toFixed(4) ?? '—'}</strong>
          ${s.model_saved ? '<br><span style="color:var(--green)">💾 Federated model saved.</span>' : ''}
          </div>
        </div>`;
    } else if (s.status === 'error') {
      panel.innerHTML = `<div class="alert alert-critical"><span>❌</span><span>${s.error}</span></div>`;
    }
  }

  // Rounds done badge
  const rdEl = document.getElementById('fl-rounds-done');
  if (rdEl) rdEl.textContent = `${s.current_round} rounds`;

  // Convergence chart
  if (s.rounds_history && s.rounds_history.length > 0) {
    renderFLChart(s.rounds_history);
    renderClientTable(s.rounds_history[s.rounds_history.length - 1]);
  }
}

function renderFLChart(history) {
  const labels = history.map(r => `R${r.round}`);
  const rmse   = history.map(r => r.avg_rmse);
  const r2     = history.map(r => r.avg_r2);

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Global RMSE',
          data: rmse,
          borderColor: '#00b4d8',
          backgroundColor: '#00b4d818',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#00b4d8',
          fill: true,
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          label: 'Global R²',
          data: r2,
          borderColor: '#22c55e',
          backgroundColor: '#22c55e18',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#22c55e',
          fill: false,
          tension: 0.35,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#7fb3d3', font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(4)}`
          }
        }
      },
      scales: {
        x:  { grid: { color: 'rgba(30,64,96,.4)' }, ticks: { color: '#7fb3d3', font: { size: 10 } } },
        y:  { position: 'left',  grid: { color: 'rgba(30,64,96,.4)' }, ticks: { color: '#00b4d8', font: { size: 10 } }, title: { display: true, text: 'RMSE', color: '#00b4d8' } },
        y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#22c55e', font: { size: 10 } }, title: { display: true, text: 'R²', color: '#22c55e' } },
      },
    },
  };

  if (flChart) { flChart.destroy(); }
  const canvas = document.getElementById('flConvergeChart');
  if (canvas) flChart = new Chart(canvas, cfg);
}

function renderClientTable(roundData) {
  if (!roundData || !roundData.clients) return;
  const clients  = roundData.clients;
  const totalN   = clients.reduce((s, c) => s + c.samples, 0);
  const maxLoss  = Math.max(...clients.map(c => c.local_loss));

  const tbody = document.getElementById('fl-client-tbody');
  if (!tbody) return;
  tbody.innerHTML = clients.map(c => {
    const pct      = Math.round(100 * c.samples / totalN);
    const lossPct  = maxLoss > 0 ? Math.round(100 * c.local_loss / maxLoss) : 0;
    const lossCol  = c.local_loss < 1 ? 'var(--green)' : c.local_loss < 5 ? 'var(--yellow)' : 'var(--orange)';
    return `<tr>
      <td><strong>${c.pond}</strong></td>
      <td>${c.samples.toLocaleString()}</td>
      <td style="color:${lossCol}">${c.local_loss.toFixed(4)}</td>
      <td style="min-width:140px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="progress-bar" style="flex:1;height:6px">
            <div class="progress-fill" style="width:${pct}%;background:var(--teal)"></div>
          </div>
          <span style="font-size:.75rem;color:var(--text-muted);min-width:30px">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─── Boot ────────────────────────────────────────────────────
async function boot() {
  await refreshDashboard();
  await loadTrend();
}

boot();
// Auto-refresh dashboard every 30 seconds
setInterval(() => {
  if (document.getElementById('page-dashboard').classList.contains('active')) {
    refreshDashboard();
  }
}, 30000);
