// ============================================================
// Ciclo de Vida del Desarrollo · Data & IA — servidor
//
// Sirve los archivos estáticos del front (igual que antes) y además
// expone una pequeña API:
//
//   GET /api/slo            → métricas/SLOs por etapa del ciclo de vida.
//                             En PROD consulta la API de ServiceNow.
//                             Si no hay credenciales, devuelve datos MOCK
//                             con la misma forma (front 100% funcional).
//   GET /api/health         → healthcheck simple.
//
// Variables de entorno (todas opcionales — sin ellas corre en modo mock):
//   PORT                    → puerto (default 3000)
//   SNOW_INSTANCE           → https://<instancia>.service-now.com
//   SNOW_USER / SNOW_PASS   → credenciales básicas (o usar SNOW_TOKEN)
//   SNOW_TOKEN              → Bearer token OAuth (alternativa a user/pass)
//   SNOW_TABLE              → tabla a consultar (default: sn_kanban_task)
//   SNOW_MAP_BY             → 'tag' | 'id'  → cómo se asocia la tarjeta a la
//                             etapa del ciclo (default: 'tag')
//   SNOW_QUERY             → encoded query opcional (sysparm_query)
// ============================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ---------- Config ServiceNow (desde env) ----------
const SNOW = {
  instance: process.env.SNOW_INSTANCE || '',
  user: process.env.SNOW_USER || '',
  pass: process.env.SNOW_PASS || '',
  token: process.env.SNOW_TOKEN || '',
  table: process.env.SNOW_TABLE || 'sn_kanban_task',
  mapBy: (process.env.SNOW_MAP_BY || 'tag').toLowerCase(), // 'tag' | 'id'
  query: process.env.SNOW_QUERY || '',
};

function snowConfigured() {
  return Boolean(SNOW.instance && (SNOW.token || (SNOW.user && SNOW.pass)));
}

// ============================================================
// MAPEO tarjeta ServiceNow → etapa (nodeId) del ciclo de vida
//
// Los nodeId provienen de data/stages.json. Soporta dos estrategias,
// elegidas por SNOW_MAP_BY:
//   'tag' → la tarjeta lleva una etiqueta que matchea STAGE_TAGS.
//   'id'  → la tarjeta lleva un campo (u_stage / correlation_id) con el nodeId.
//
// Editá STAGE_TAGS si en ServiceNow nombrás las etiquetas distinto.
// ============================================================
const STAGE_TAGS = {
  'business-solution': ['origen', 'business-solution', 'demanda'],
  'clasificador': ['clasificacion', 'clasificador', 'triage'],
  'factibilidad': ['factibilidad', 'feasibility'],
  'hub': ['hub', 'orquestacion'],
  'sincronizacion': ['sincronizacion', 'sync'],
  'dinamica': ['dinamica', 'refinamiento'],
  'camino-bau': ['bau', 'camino-bau'],
  'camino-dp': ['data-product', 'dp', 'modelado'],
  'producto': ['producto', 'entrega', 'release'],
};

// Estados ServiceNow → categoría kanban (para agrupar)
const STATE_LABELS = {
  '1': 'Nuevo',
  '2': 'En curso',
  '3': 'En revisión',
  '6': 'Resuelto',
  '7': 'Cerrado',
};
const OPEN_STATES = ['1', '2', '3'];
const DONE_STATES = ['6', '7'];

// ---------- Mock realista (forma idéntica a la respuesta SNow normalizada) ----------
function buildMockCards() {
  // Tarjetas de ejemplo distribuidas por etapa. Replican la forma que
  // tendría sn_kanban_task tras normalizar.
  const now = Date.now();
  const d = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString().slice(0, 10);
  return [
    { number: 'KAN0010234', short_description: 'Métrica de churn minorista', state: '2', stage: 'business-solution', assigned_to: 'F. Bertinatti', cell: 'minorista', opened_at: d(12), updated_at: d(1), priority: '2' },
    { number: 'KAN0010235', short_description: 'Dashboard riesgo crediticio', state: '2', stage: 'clasificador', assigned_to: 'S. Vergara', cell: 'riesgos', opened_at: d(9), updated_at: d(2), priority: '2' },
    { number: 'KAN0010236', short_description: 'Feasibility: ingesta open banking', state: '3', stage: 'factibilidad', assigned_to: 'A. Genovese', cell: 'digital', opened_at: d(7), updated_at: d(1), priority: '1' },
    { number: 'KAN0010237', short_description: 'Orquestación pipeline clientes', state: '2', stage: 'hub', assigned_to: 'L. Carvallo', cell: 'clientes', opened_at: d(15), updated_at: d(3), priority: '3' },
    { number: 'KAN0010238', short_description: 'Sync CDC core → Redshift', state: '2', stage: 'sincronizacion', assigned_to: 'S. Wilwerth', cell: 'mayorista', opened_at: d(20), updated_at: d(2), priority: '2' },
    { number: 'KAN0010239', short_description: 'Refinamiento modelo dimensional', state: '3', stage: 'dinamica', assigned_to: 'D. Wajsberg', cell: 'financiera', opened_at: d(11), updated_at: d(4), priority: '2' },
    { number: 'KAN0010240', short_description: 'Automatización reporte BAU diario', state: '6', stage: 'camino-bau', assigned_to: 'S. Vargas', cell: 'minorista', opened_at: d(25), updated_at: d(5), priority: '3' },
    { number: 'KAN0010241', short_description: 'Data Product: 360 cliente', state: '2', stage: 'camino-dp', assigned_to: 'L. Carvallo', cell: 'clientes', opened_at: d(30), updated_at: d(1), priority: '1' },
    { number: 'KAN0010242', short_description: 'Release métrica NPS', state: '7', stage: 'producto', assigned_to: 'F. Bertinatti', cell: 'digital', opened_at: d(40), updated_at: d(8), priority: '2' },
    { number: 'KAN0010243', short_description: 'Modelo propensión mayorista', state: '1', stage: 'business-solution', assigned_to: 'Sin asignar', cell: 'mayorista', opened_at: d(3), updated_at: d(0), priority: '3' },
    { number: 'KAN0010244', short_description: 'Calidad de datos: contracts riesgos', state: '2', stage: 'factibilidad', assigned_to: 'A. Genovese', cell: 'riesgos', opened_at: d(6), updated_at: d(1), priority: '1' },
    { number: 'KAN0010245', short_description: 'Entrega tablero financiera Q2', state: '6', stage: 'producto', assigned_to: 'S. Vergara', cell: 'financiera', opened_at: d(35), updated_at: d(6), priority: '2' },
  ];
}

// ---------- Normalización + agregación por etapa ----------
function daysBetween(a, b) {
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}

function aggregateByStage(cards) {
  // Devuelve { nodeId: {...metrics, cards:[...] } }
  const byStage = {};
  for (const c of cards) {
    const stage = c.stage;
    if (!stage) continue;
    if (!byStage[stage]) {
      byStage[stage] = { open: 0, done: 0, total: 0, leadTimes: [], cards: [] };
    }
    const g = byStage[stage];
    g.total += 1;
    if (OPEN_STATES.includes(String(c.state))) g.open += 1;
    if (DONE_STATES.includes(String(c.state))) {
      g.done += 1;
      if (c.opened_at && c.updated_at) g.leadTimes.push(daysBetween(c.opened_at, c.updated_at));
    }
    g.cards.push({
      number: c.number,
      title: c.short_description,
      state: c.state,
      stateLabel: STATE_LABELS[String(c.state)] || c.state,
      assigned_to: c.assigned_to,
      cell: c.cell,
      priority: c.priority,
      ageDays: c.opened_at ? daysBetween(c.opened_at, new Date().toISOString()) : null,
    });
  }
  // Métricas derivadas
  const stages = {};
  for (const [nodeId, g] of Object.entries(byStage)) {
    const avgLead = g.leadTimes.length
      ? Math.round(g.leadTimes.reduce((a, b) => a + b, 0) / g.leadTimes.length)
      : null;
    stages[nodeId] = {
      open: g.open,
      done: g.done,
      total: g.total,
      avgLeadTimeDays: avgLead,
      cards: g.cards.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)).slice(0, 8),
    };
  }
  return stages;
}

// Resumen global + cortes (por etapa, por célula) para la vista Status general
function buildSummary(cards) {
  let open = 0, done = 0, total = 0;
  const leadTimes = [];
  const byCell = {};       // cell → { open, done, total }
  const byStageCount = {}; // nodeId → { open, done, total }
  const recent = [];

  for (const c of cards) {
    total += 1;
    const isOpen = OPEN_STATES.includes(String(c.state));
    const isDone = DONE_STATES.includes(String(c.state));
    if (isOpen) open += 1;
    if (isDone) {
      done += 1;
      if (c.opened_at && c.updated_at) leadTimes.push(daysBetween(c.opened_at, c.updated_at));
    }
    // por célula
    const cell = c.cell || 'sin-celula';
    if (!byCell[cell]) byCell[cell] = { open: 0, done: 0, total: 0 };
    byCell[cell].total += 1;
    if (isOpen) byCell[cell].open += 1;
    if (isDone) byCell[cell].done += 1;
    // por etapa (conteo simple)
    if (c.stage) {
      if (!byStageCount[c.stage]) byStageCount[c.stage] = { open: 0, done: 0, total: 0 };
      byStageCount[c.stage].total += 1;
      if (isOpen) byStageCount[c.stage].open += 1;
      if (isDone) byStageCount[c.stage].done += 1;
    }
    recent.push({
      number: c.number,
      title: c.short_description,
      state: c.state,
      stateLabel: STATE_LABELS[String(c.state)] || c.state,
      stage: c.stage,
      cell: c.cell,
      updated_at: c.updated_at,
      ageDays: c.opened_at ? daysBetween(c.opened_at, new Date().toISOString()) : null,
    });
  }

  const avgLead = leadTimes.length
    ? Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length)
    : null;

  return {
    totals: { open, done, total, avgLeadTimeDays: avgLead },
    byCell,
    byStage: byStageCount,
    recent: recent.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 10),
  };
}

// ---------- Cliente ServiceNow (Table API) ----------
function fetchServiceNow() {
  return new Promise((resolve, reject) => {
    const base = SNOW.instance.replace(/\/$/, '');
    const fields = 'number,short_description,state,assigned_to,opened_at,sys_updated_on,priority,u_stage,u_cell,sys_tags';
    const q = SNOW.query ? `&sysparm_query=${encodeURIComponent(SNOW.query)}` : '';
    const url = `${base}/api/now/table/${encodeURIComponent(SNOW.table)}?sysparm_limit=200&sysparm_display_value=true&sysparm_fields=${fields}${q}`;

    const headers = { Accept: 'application/json' };
    if (SNOW.token) {
      headers.Authorization = `Bearer ${SNOW.token}`;
    } else {
      const basic = Buffer.from(`${SNOW.user}:${SNOW.pass}`).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }

    https.get(url, { headers, timeout: 10000 }, (r) => {
      let body = '';
      r.on('data', (chunk) => (body += chunk));
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return reject(new Error(`ServiceNow HTTP ${r.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          const json = JSON.parse(body);
          resolve(normalizeSnow(json.result || []));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('ServiceNow timeout')); });
  });
}

// Normaliza un registro crudo de SNow a la forma interna { stage, ... }
function normalizeSnow(records) {
  return records.map((rec) => {
    let stage = null;
    if (SNOW.mapBy === 'id') {
      // El nodeId viene directo en un campo
      stage = (rec.u_stage && rec.u_stage.value) || rec.u_stage || rec.correlation_id || null;
    } else {
      // Mapeo por tag: buscar qué etapa matchea alguna etiqueta de la tarjeta
      const tags = String(rec.sys_tags || '').toLowerCase();
      for (const [nodeId, aliases] of Object.entries(STAGE_TAGS)) {
        if (aliases.some((a) => tags.includes(a.toLowerCase()))) { stage = nodeId; break; }
      }
    }
    const val = (f) => (rec[f] && rec[f].display_value) || (rec[f] && rec[f].value) || rec[f] || '';
    return {
      number: val('number'),
      short_description: val('short_description'),
      state: val('state'),
      assigned_to: val('assigned_to'),
      cell: val('u_cell'),
      priority: val('priority'),
      opened_at: (val('opened_at') || '').slice(0, 10),
      updated_at: (val('sys_updated_on') || '').slice(0, 10),
      stage,
    };
  });
}

// ---------- Handler /api/slo ----------
async function handleSlo(res) {
  let cards, source;
  try {
    if (snowConfigured()) {
      cards = await fetchServiceNow();
      source = 'servicenow';
    } else {
      cards = buildMockCards();
      source = 'mock';
    }
  } catch (err) {
    // Si SNow falla, degradar a mock para no romper el front (y avisar en meta)
    cards = buildMockCards();
    source = 'mock-fallback';
    console.error('[slo] ServiceNow falló, usando mock:', err.message);
  }

  const stages = aggregateByStage(cards);
  const summary = buildSummary(cards);
  const payload = {
    meta: {
      source,                 // 'servicenow' | 'mock' | 'mock-fallback'
      mapBy: SNOW.mapBy,
      table: SNOW.table,
      generatedAt: new Date().toISOString(),
      totalCards: cards.length,
    },
    summary,                  // { totals, byCell, byStage, recent } — para la vista Status general
    stages,                   // detalle por etapa (se mantiene por compatibilidad)
  };
  sendJson(res, 200, payload);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// ============================================================
// Servidor HTTP — API primero, luego estáticos
// ============================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // ---- API ----
  if (url === '/api/health') {
    return sendJson(res, 200, { ok: true, snow: snowConfigured() ? 'configured' : 'mock' });
  }
  if (url === '/api/slo') {
    return handleSlo(res);
  }

  // ---- Estáticos (con guardia anti directory-traversal) ----
  let filePath = url === '/' ? '/index.html' : url;
  filePath = path.join(__dirname, filePath);
  const realPath = path.resolve(filePath);
  const baseDir = path.resolve(__dirname);
  if (!realPath.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      const code = err.code === 'ENOENT' ? 404 : 500;
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      return res.end(code === 404 ? '404 Not Found' : '500 Internal Server Error');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`📁 Estáticos desde: ${__dirname}`);
  console.log(`🔌 ServiceNow: ${snowConfigured() ? 'configurado (' + SNOW.instance + ')' : 'modo MOCK (sin credenciales)'}`);
});
