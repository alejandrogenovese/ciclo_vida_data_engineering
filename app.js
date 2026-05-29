// ============================================================
// Ciclo de Vida del Desarrollo · Data & IA
// Modelo operativo interactivo
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

// ============ AUTH ============
const AUTH_USERS = {
  admin: { password: 'data2024', role: 'admin' },
  visor: { password: 'galicia',  role: 'visor'  },
};
const AUTH_KEY = 'cvd_session';

function authGetSession() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_KEY)); } catch { return null; }
}
function authSetSession(user, role) {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify({ user, role }));
}
function authClearSession() {
  sessionStorage.removeItem(AUTH_KEY);
}
function isAdmin() {
  const s = authGetSession();
  return s?.role === 'admin';
}

function initLogin() {
  const form    = document.getElementById('loginForm');
  const userIn  = document.getElementById('loginUser');
  const passIn  = document.getElementById('loginPass');
  const errDiv  = document.getElementById('loginError');
  const showBtn = document.getElementById('loginShowPass');
  const cover   = document.getElementById('cover-screen');

  if (!form) return;

  // Si ya hay sesión válida, saltar el cover/login directamente
  const existing = authGetSession();
  if (existing?.role) {
    cover?.remove();
    applyRoleUI(existing.role);
    return;
  }

  // Focus automático en el campo usuario
  setTimeout(() => userIn?.focus(), 100);

  // Mostrar/ocultar contraseña
  showBtn?.addEventListener('click', () => {
    const isText = passIn.type === 'text';
    passIn.type  = isText ? 'password' : 'text';
    showBtn.textContent = isText ? '👁' : '🙈';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const user  = userIn.value.trim().toLowerCase();
    const pass  = passIn.value;
    const match = AUTH_USERS[user];

    if (!match || match.password !== pass) {
      errDiv.textContent = 'Usuario o contraseña incorrectos.';
      passIn.value = '';
      passIn.focus();
      form.classList.add('login-shake');
      setTimeout(() => form.classList.remove('login-shake'), 400);
      return;
    }

    errDiv.textContent = '';
    authSetSession(user, match.role);

    // Dismiss del cover unificado
    cover?.classList.add('is-hiding');
    setTimeout(() => {
      cover?.remove();
      applyRoleUI(match.role);
    }, 500);
  });
}

function applyRoleUI(role) {
  const downloadBtn = document.getElementById('adminDownloadBtn');
  const logoutBtn   = document.getElementById('headerLogoutBtn');

  // Badge de rol en header-meta
  const meta = document.querySelector('.header-meta');
  if (meta && !document.getElementById('roleBadge')) {
    const badge = document.createElement('span');
    badge.id = 'roleBadge';
    badge.className = `header-role-badge ${role === 'admin' ? 'role-admin' : ''}`;
    badge.textContent = role;
    meta.insertBefore(badge, meta.firstChild);
  }

  // Botón descarga JSONs — solo admin
  if (downloadBtn) {
    downloadBtn.style.display = role === 'admin' ? '' : 'none';
    downloadBtn.addEventListener('click', exportChanges);
  }

  // Botón salir — siempre visible una vez logueado
  if (logoutBtn) {
    logoutBtn.style.display = '';
    logoutBtn.addEventListener('click', () => {
      authClearSession();
      location.reload();
    });
  }

  // Tab admin — solo para rol admin
  const adminTab = document.getElementById('tab-admin-usuarios');
  if (adminTab) adminTab.style.display = role === 'admin' ? '' : 'none';
}

// ============ STATE ============
const state = {
  diagrams: {},
  stages: {},
  actors: {},       // id → { id, label, color }
  actorsList: [],   // array ordenado para el editor
  cells: {},        // id → { id, label, color }
  cellsList: [],    // array ordenado de las 6 células
  editMode: false,  // true cuando el modo edición está activo
  editedStages: {}, // copia profunda de los stages editados: { 'ciclo-vida': {...}, 'architecture-platform': [...] }
  currentDiagram: 'ciclo-vida',
  diagram: null,
  current: 0,
  playing: false,
  playTimer: null,
  autoplayMs: 6500,
  baseVB: null,
  zoomVB: null,
  dragging: false,
  dragMoved: false,
  lastDragScreen: { x: 0, y: 0 },
  lastDragSVG: { x: 0, y: 0 },
  currentPath: null,
  currentPathId: null,
  currentOrigin: 'bs',
  currentArqSub: null,   // 'rt' | 'fact' — solo cuando origin === 'arq'
  currentSuffix: 'bau',  // 'bau' | 'dp' — último tipo de entrega elegido
};

// ============ ZOOM / PAN ============
function parseVB(str) {
  const [x, y, w, h] = str.split(' ').map(Number);
  return { x, y, w, h };
}

function applyVB(vb) {
  $('flowSvg').setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}

function clampVB({ x, y, w, h }) {
  const base = state.baseVB;

  // Zoom limits: entre 25% y 300% del tamaño base
  const minW = base.w * 0.25;
  const maxW = base.w * 3;
  w = Math.max(minW, Math.min(maxW, w));
  h = w * base.h / base.w;

  // Posición: siempre mantener el diagrama visible en el viewport.
  // Permite panoramizar hasta 60% del tamaño base fuera de bordes,
  // pero nunca perder el contenido completamente.
  const padX = base.w * 0.6;
  const padY = base.h * 0.6;
  x = Math.max(-padX, Math.min(base.w + padX - w * 0.15, x));
  y = Math.max(-padY, Math.min(base.h + padY - h * 0.15, y));

  return { x, y, w, h };
}

function screenToSVG(screenX, screenY) {
  const svg = $('flowSvg');
  const rect = svg.getBoundingClientRect();
  const vb = state.zoomVB;
  return {
    x: vb.x + (screenX - rect.left) / rect.width * vb.w,
    y: vb.y + (screenY - rect.top) / rect.height * vb.h,
  };
}

function zoomAtPoint(factor, svgX, svgY) {
  const vb = state.zoomVB;
  const newW = vb.w * factor;
  const newH = vb.h * factor;
  const x = svgX - (svgX - vb.x) * (newW / vb.w);
  const y = svgY - (svgY - vb.y) * (newH / vb.h);
  state.zoomVB = clampVB({ x, y, w: newW, h: newH });
  applyVB(state.zoomVB);
}

function resetZoom() {
  // Vuelve al zoom inicial definido en el diagrama, o al viewBox completo si no hay uno
  const initVBStr = state.diagram?.initialZoom || state.diagram?.viewBox;
  state.zoomVB = initVBStr ? parseVB(initVBStr) : { ...state.baseVB };
  applyVB(state.zoomVB);
}

function bindZoom() {
  const svg = $('flowSvg');

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.88;
    const pt = screenToSVG(e.clientX, e.clientY);
    zoomAtPoint(factor, pt.x, pt.y);
  }, { passive: false });

  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    state.dragging = true;
    state.dragMoved = false;
    state.lastDragScreen = { x: e.clientX, y: e.clientY };
    state.lastDragSVG = screenToSVG(e.clientX, e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - state.lastDragScreen.x;
    const dy = e.clientY - state.lastDragScreen.y;
    if (!state.dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      state.dragMoved = true;
      svg.classList.add('is-dragging');
    }
    if (state.dragMoved) {
      const cur = screenToSVG(e.clientX, e.clientY);
      const vb = state.zoomVB;
      state.zoomVB = clampVB({
        x: vb.x + (state.lastDragSVG.x - cur.x),
        y: vb.y + (state.lastDragSVG.y - cur.y),
        w: vb.w,
        h: vb.h,
      });
      applyVB(state.zoomVB);
      state.lastDragSVG = screenToSVG(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', () => {
    state.dragging = false;
    svg.classList.remove('is-dragging');
  });

  // Doble-click en el SVG: reset zoom (escape rápido si se pierde la vista)
  svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    resetZoom();
  });

  $('zoomInBtn').addEventListener('click', () => {
    const vb = state.zoomVB;
    zoomAtPoint(0.75, vb.x + vb.w / 2, vb.y + vb.h / 2);
  });
  $('zoomOutBtn').addEventListener('click', () => {
    const vb = state.zoomVB;
    zoomAtPoint(1.33, vb.x + vb.w / 2, vb.y + vb.h / 2);
  });
  $('zoomResetBtn').addEventListener('click', resetZoom);
}

// ============ HELPERS ============
function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child) node.appendChild(child);
  }
  return node;
}

function $(id) { return document.getElementById(id); }

// ============ ACTIVE STAGES ============
function getActiveStages() {
  // Siempre leer desde la copia editable
  const edited = state.editedStages[state.currentDiagram];
  if (state.currentDiagram === 'ciclo-vida' && state.currentPathId) {
    return edited?.paths?.[state.currentPathId]?.stages || [];
  }
  return edited || [];
}

// Devuelve la etapa actual de la copia editable (para editar in-place)
function getCurrentStageRef() {
  const edited = state.editedStages[state.currentDiagram];
  if (state.currentDiagram === 'ciclo-vida' && state.currentPathId) {
    return edited?.paths?.[state.currentPathId]?.stages?.[state.current];
  }
  return edited?.[state.current];
}

// Renderiza una pill desde un actor ID
function actorPill(actorId) {
  const actor = state.actors[actorId];
  if (!actor) return `<span class="pill">${actorId}</span>`;
  return `<span class="pill" data-actor-id="${actor.id}" style="border-color:${actor.color}20;background:${actor.color}12">${actor.label}</span>`;
}

// Renderiza una pill desde un cell ID
function cellPill(cellId) {
  const cell = state.cells[cellId];
  if (!cell) return `<span class="pill pill-cell">${cellId}</span>`;
  return `<span class="pill pill-cell" data-cell-id="${cell.id}" style="border-color:${cell.color}30;background:${cell.color}15;color:${cell.color}">${cell.label}</span>`;
}

// Convierte content/actors/cells de una sección a HTML
function sectionContentHTML(sec) {
  if (sec.actors && Array.isArray(sec.actors)) {
    return `<div class="pill-grid">${sec.actors.map(actorPill).join('')}</div>`;
  }
  if (sec.cells && Array.isArray(sec.cells)) {
    return `<div class="pill-grid">${sec.cells.map(cellPill).join('')}</div>`;
  }
  return sec.content || '';
}

// ============ LOAD DATA ============
async function loadData() {
  try {
    const [diagramRes, stagesRes, archDiagramRes, archStagesRes, actorsRes, cellsRes] = await Promise.all([
      fetch('data/diagram.json'),
      fetch('data/stages.json'),
      fetch('data/architecture-platform.json'),
      fetch('data/architecture-platform-stages.json'),
      fetch('data/actors.json'),
      fetch('data/cells.json'),
    ]);
    if (!diagramRes.ok || !stagesRes.ok || !archDiagramRes.ok || !archStagesRes.ok || !actorsRes.ok || !cellsRes.ok) {
      throw new Error('No se pudieron leer los JSON de data/');
    }
    state.diagrams['ciclo-vida'] = await diagramRes.json();
    state.stages['ciclo-vida'] = await stagesRes.json();
    state.diagrams['architecture-platform'] = await archDiagramRes.json();
    state.stages['architecture-platform'] = await archStagesRes.json();

    // Cargar actores como mapa id→actor
    const actorsData = await actorsRes.json();
    state.actors = {};
    for (const a of (actorsData.actors || [])) {
      state.actors[a.id] = a;
    }
    // Guardar lista ordenada para el editor
    state.actorsList = actorsData.actors || [];

    // Cargar células como mapa id→cell
    const cellsData = await cellsRes.json();
    state.cells = {};
    for (const c of (cellsData.cells || [])) {
      state.cells[c.id] = c;
    }
    state.cellsList = cellsData.cells || [];

    // Inicializar copias editables (deep clone)
    state.editedStages['ciclo-vida'] = JSON.parse(JSON.stringify(state.stages['ciclo-vida']));
    state.editedStages['architecture-platform'] = JSON.parse(JSON.stringify(state.stages['architecture-platform']));

    switchDiagram('ciclo-vida');
  } catch (err) {
    showError(err);
    throw err;
  }
}

// ============ SWITCH DIAGRAM ============
function switchDiagram(diagramName) {
  if (!state.diagrams[diagramName]) return;

  state.currentDiagram = diagramName;
  state.diagram = state.diagrams[diagramName];
  state.current = 0;
  state.playing = false;
  if (state.playTimer) clearInterval(state.playTimer);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('tab-active');
    if (btn.dataset.diagram === diagramName) btn.classList.add('tab-active');
  });

  ['svgTransverse', 'svgEdges', 'svgAnnotations', 'svgNodes'].forEach(id => {
    $(id).innerHTML = '';
  });

  if (state.diagram.config?.autoplayMs) state.autoplayMs = state.diagram.config.autoplayMs;

  // Show/hide flow selector
  const flowBar = $('flowSelectorBar');
  if (flowBar) flowBar.style.display = diagramName === 'ciclo-vida' ? 'flex' : 'none';

  applyBrandConfig();
  buildSvg();
  renderLegend();

  if (diagramName === 'ciclo-vida') {
    const pathsData = state.stages['ciclo-vida'];
    switchPath(pathsData.default || 'bs-bau');
  } else {
    state.currentPath = null;
    state.currentPathId = null;
    renderProgress();
    renderNarrative();
    updateDiagram();
    updateControls();
  }
}

// ============ SWITCH PATH (ciclo-vida only) ============
function switchPath(pathId) {
  // Usar copia editable como fuente de verdad
  const pathsData = state.editedStages['ciclo-vida'] || state.stages['ciclo-vida'];
  if (!pathsData?.paths?.[pathId]) return;

  if (state.playing) togglePlay();

  state.currentPathId = pathId;
  state.currentPath = pathsData.paths[pathId];
  state.current = 0;

  syncFlowSelectorUI(pathId);
  renderProgress();
  renderNarrative();
  updateDiagram();
  updateControls();
}

// Sync the four-level selector to reflect a given pathId
// Nivel 1 = header tabs (Ciclo de Vida / Arquitectura ↔ Plataforma)
// Nivel 2 = equipo solicitante (origin buttons): bs | triage | arq | ext
// Nivel 3 = interacción (solo arq): rt | fact
// Nivel 4 = tipo de entrega: bau | dp  (oculto para arq-fact)
//
// pathId formats:
//   bs-bau | bs-dp | triage-bau | triage-dp
//   arq-rt-bau | arq-rt-dp | arq-fact
//   ext-bau | ext-dp
function syncFlowSelectorUI(pathId) {
  let origin, arqSub, suffix;

  if (pathId.startsWith('arq-rt-')) {
    origin  = 'arq';
    arqSub  = 'rt';
    suffix  = pathId.slice(7);           // 'bau' or 'dp'
  } else if (pathId.startsWith('arq-fact-')) {
    origin  = 'arq';
    arqSub  = 'fact';
    suffix  = pathId.slice(9);           // 'bau' or 'dp'
  } else if (pathId.startsWith('ext-')) {
    origin  = 'ext';
    arqSub  = null;
    suffix  = pathId.slice(4);           // 'bau' or 'dp'
  } else {
    // bs-bau | triage-dp | etc.
    const parts = pathId.split('-');
    suffix = parts[parts.length - 1];
    origin = parts.slice(0, -1).join('-');
    arqSub = null;
  }

  state.currentOrigin  = origin;
  state.currentArqSub  = arqSub;
  if (suffix) state.currentSuffix = suffix;

  // ── Nivel 2: origin buttons ──────────────────────────────────────────────
  document.querySelectorAll('.flow-origin-btn').forEach(btn =>
    btn.classList.toggle('flow-origin-active', btn.dataset.origin === origin));

  // ── Nivel 3: arq sub-row ─────────────────────────────────────────────────
  const arqSubRow = $('flowArqSubRow');
  if (arqSubRow) {
    if (origin === 'arq') {
      arqSubRow.style.display = 'flex';
      document.querySelectorAll('.flow-arqsub-btn').forEach(btn =>
        btn.classList.toggle('flow-arqsub-active', btn.dataset.arqsub === arqSub));
    } else {
      arqSubRow.style.display = 'none';
    }
  }

  // ── Nivel 4: tipo de entrega (visible para todos los paths) ─────────────
  const typeRow = $('flowTypeRow');
  if (typeRow) {
    typeRow.style.display = 'flex';
    document.querySelectorAll('.flow-type-btn').forEach(btn =>
      btn.classList.toggle('flow-type-active', btn.dataset.suffix === suffix));
  }
}

function showError(err) {
  const narrative = $('narrative');
  narrative.innerHTML = `
    <div class="error-banner">
      <strong>Error al cargar el modelo:</strong><br>
      ${err.message}<br><br>
      Recordá que esta versión necesita servirse desde un servidor HTTP
      (no funciona abriendo el index.html con doble click — fetch falla por CORS).<br><br>
      Probá: <code>python3 -m http.server 8080</code>
    </div>
  `;
}

// ============ APPLY BRAND CONFIG ============
function applyBrandConfig() {
  const cfg = state.diagram.config?.brand;
  if (!cfg) return;
  if (cfg.mark) $('brand-mark').textContent = cfg.mark;
  if (cfg.title) $('brand-title').innerHTML = cfg.title;
  if (cfg.org) $('brand-org').textContent = cfg.org;
}

// ============ BUILD SVG ============
function buildSvg() {
  const svg = $('flowSvg');
  state.baseVB = parseVB(state.diagram.viewBox);
  // Si el diagrama define un zoom inicial, arranca con ese; si no, usa el viewBox completo
  const initVBStr = state.diagram.initialZoom || state.diagram.viewBox;
  state.zoomVB = parseVB(initVBStr);
  applyVB(state.zoomVB);

  // Transversal bracket
  if (state.diagram.transverse?.enabled) {
    const t = state.diagram.transverse;
    const g = $('svgTransverse');
    g.setAttribute('opacity', '0.6');
    g.appendChild(el('path', { class: 'transverse-bracket', d: t.bracket }));
    if (t.labelPos && t.label) {
      const text = el('text', {
        class: 'transverse-label',
        x: t.labelPos.x,
        y: t.labelPos.y,
        transform: `rotate(${t.labelPos.rotate || 0} ${t.labelPos.x} ${t.labelPos.y})`,
        'text-anchor': 'middle',
      });
      text.textContent = t.label;
      g.appendChild(text);
    }
  }

  // Edges
  const edgesG = $('svgEdges');
  for (const edge of state.diagram.edges) {
    edgesG.appendChild(el('path', { class: 'edge', id: edge.id, d: edge.d }));
  }

  // Annotations
  const annotG = $('svgAnnotations');
  for (const ann of (state.diagram.annotations || [])) {
    const t = el('text', {
      class: 'edge-label',
      id: ann.id,
      x: ann.x,
      y: ann.y,
      'text-anchor': ann.anchor || 'middle',
    });
    t.textContent = ann.text;
    annotG.appendChild(t);
  }

  // Nodes
  const nodesG = $('svgNodes');
  for (const node of state.diagram.nodes) {
    nodesG.appendChild(buildNode(node));
  }
}

function buildNode(node) {
  const g = el('g', {
    class: 'node',
    'data-stage': node.stageIndex,
    'data-node-id': node.id,
    style: `--node-color: var(${node.colorVar})`,
  });

  // Pulse ring
  if (node.pulse) {
    g.appendChild(el('circle', {
      class: 'pulse-ring',
      cx: node.pulse.cx,
      cy: node.pulse.cy,
      r: node.pulse.r,
    }));
  }

  // Shape
  let shape;
  if (node.shape === 'rect' || node.shape === 'pill') {
    shape = el('rect', {
      class: 'node-rect',
      x: node.geom.x,
      y: node.geom.y,
      width: node.geom.w,
      height: node.geom.h,
      rx: node.geom.rx || 4,
    });
  } else if (node.shape === 'hexagon') {
    shape = el('polygon', { class: 'node-rect', points: node.geom.points });
  } else {
    shape = el('rect', { class: 'node-rect', x: 0, y: 0, width: 100, height: 50 });
  }
  g.appendChild(shape);

  // Colored accent strip (top of node)
  if (node.geom.x !== undefined && node.colorVar) {
    g.appendChild(el('rect', {
      class: 'node-accent',
      x: node.geom.x + 8,
      y: node.geom.y + 5,
      width: node.geom.w - 16,
      height: 3,
      rx: 1.5,
      style: `fill: var(${node.colorVar})`,
    }));
  }

  const cx = node.pulse?.cx || (node.geom.x + (node.geom.w || 0) / 2);

  const numText = el('text', { class: 'node-num', x: cx, y: node.labelPos.numY });
  numText.textContent = node.num;
  g.appendChild(numText);

  const labelText = el('text', { class: 'node-label', x: cx, y: node.labelPos.labelY });
  if (node.labelWeight === 'bold') labelText.style.fontWeight = '600';
  labelText.textContent = node.label;
  g.appendChild(labelText);

  if (node.sublabel && node.labelPos.sublabelY) {
    const subText = el('text', { class: 'node-sublabel', x: cx, y: node.labelPos.sublabelY });
    subText.textContent = node.sublabel;
    g.appendChild(subText);
  }

  // Click handler — path-aware
  g.addEventListener('click', () => {
    if (state.dragMoved) return;
    if (state.currentDiagram === 'ciclo-vida' && state.currentPath) {
      const idx = state.currentPath.nodeSequence.indexOf(node.id);
      if (idx >= 0) goTo(idx);
    } else {
      goTo(node.stageIndex);
    }
  });

  return g;
}

// ============ RENDER NARRATIVE ============
function buildPathCrumb() {
  if (state.currentDiagram !== 'ciclo-vida' || !state.currentPath) return '';

  const p = state.currentPath;
  const total = p.stages.length;
  const stepNum = String(state.current + 1).padStart(2, '0');
  const totalStr = String(total).padStart(2, '0');

  // Label del camino: origen + tipo
  const pathLabel = p.label || '';
  const subLabel  = p.sublabel ? ` · ${p.sublabel}` : '';

  return `
    <div class="narrative-path-crumb">
      <span>${pathLabel}</span>
      <span class="crumb-sep">›</span>
      <span>${subLabel.replace(' · ', '')}</span>
      <span class="crumb-sep">›</span>
      <span class="crumb-active">Paso ${stepNum} / ${totalStr}</span>
    </div>
    <div class="narrative-step-badge">Etapa ${stepNum}</div>
  `;
}

function renderNarrative() {
  const narrative = $('narrative');
  const stages = getActiveStages();
  const s = stages[state.current];
  if (!s) {
    narrative.innerHTML = '<div class="error-banner">Etapa no encontrada</div>';
    return;
  }

  narrative.style.setProperty('--stage-color', s.color.primary);
  narrative.style.setProperty('--stage-color-soft', s.color.soft);

  const sectionsHTML = (s.sections || []).map(sec =>
    `<div class="stage-section">
      <div class="stage-section-label">${sec.label}</div>
      <div class="stage-section-content">${sectionContentHTML(sec)}</div>
    </div>`
  ).join('');

  const editBtnHTML = isAdmin() ? `
    <button class="btn edit-stage-btn ${state.editMode ? 'edit-active' : ''}" id="editStageBtn" title="Editar esta etapa">
      ${state.editMode ? '✕ Cerrar editor' : '✎ Editar'}
    </button>` : '';

  narrative.innerHTML = `
    <div class="narrative-accent-bar"></div>
    <div class="narrative-header">
      ${buildPathCrumb()}
      ${editBtnHTML}
    </div>
    <div class="narrative-content">
      <div class="stage-eyebrow">
        <span class="stage-dot"></span>
        ${s.eyebrow}
      </div>
      <h2 class="stage-title">${s.title}</h2>
      <p class="stage-lead">${s.lead}</p>
      ${sectionsHTML}
      ${s.callout ? `<div class="stage-callout">${s.callout}</div>` : ''}
    </div>
    ${state.editMode ? buildEditorPanel(s) : ''}
  `;

  // Bind edit button
  const editBtn = document.getElementById('editStageBtn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      state.editMode = !state.editMode;
      renderNarrative();
    });
  }

  // Bind editor si está abierto
  if (state.editMode) bindEditorEvents();

  narrative.querySelectorAll('.narrative-content > *').forEach(el => {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
  });
}

// ============ EDITOR PANEL ============
function buildEditorPanel(s) {
  const allActors = state.actorsList || [];

  const sectionsEditorHTML = (s.sections || []).map((sec, sIdx) => {
    let actorsEditorHTML = '';
    if (sec.actors && Array.isArray(sec.actors)) {
      // Muestra actores actuales con botón para eliminar
      const currentActors = sec.actors.map(id => {
        const a = state.actors[id] || { id, label: id, color: '#888' };
        return `<span class="editor-pill" data-sec="${sIdx}" data-actor="${id}" style="border-color:${a.color}40;background:${a.color}15">
          ${a.label}
          <button class="editor-pill-remove" data-sec="${sIdx}" data-actor="${id}" title="Quitar">×</button>
        </span>`;
      }).join('');

      // Dropdown para agregar actores
      const available = allActors.filter(a => !sec.actors.includes(a.id));
      const optionsHTML = available.map(a => `<option value="${a.id}">${a.label}</option>`).join('');
      const addBtn = available.length > 0 ? `
        <div class="editor-add-actor">
          <select class="editor-actor-select" data-sec="${sIdx}">
            <option value="">— Agregar actor —</option>
            ${optionsHTML}
          </select>
          <button class="btn editor-add-btn" data-sec="${sIdx}">+ Agregar</button>
        </div>` : '';

      actorsEditorHTML = `
        <div class="editor-actors-list">${currentActors}</div>
        ${addBtn}`;
    }

    const contentField = (!sec.actors)
      ? `<textarea class="editor-textarea" data-field="sec-content" data-sec="${sIdx}" rows="3">${sec.content || ''}</textarea>`
      : actorsEditorHTML;

    return `
      <div class="editor-section-block">
        <label class="editor-label">Sección "${sec.label}" — label</label>
        <input class="editor-input" type="text" data-field="sec-label" data-sec="${sIdx}" value="${escHtml(sec.label)}">
        <label class="editor-label">${sec.actors ? 'Actores' : 'Contenido'}</label>
        ${contentField}
      </div>`;
  }).join('');

  return `
    <div class="editor-panel" id="editorPanel">
      <div class="editor-panel-header">
        <span class="editor-panel-title">✎ Editar etapa ${state.current + 1}</span>
        <button class="btn editor-export-btn" id="exportChangesBtn">⬇ Exportar cambios</button>
      </div>

      <label class="editor-label">Eyebrow</label>
      <input class="editor-input" type="text" data-field="eyebrow" value="${escHtml(s.eyebrow)}">

      <label class="editor-label">Título (acepta HTML con &lt;span class="italic"&gt;)</label>
      <input class="editor-input" type="text" data-field="title" value="${escAttr(s.title)}">

      <label class="editor-label">Lead (párrafo introductorio)</label>
      <textarea class="editor-textarea" data-field="lead" rows="3">${escHtml(s.lead)}</textarea>

      <div class="editor-sections-header">Secciones</div>
      ${sectionsEditorHTML}

      <label class="editor-label">Callout (acepta HTML con &lt;strong&gt;)</label>
      <textarea class="editor-textarea" data-field="callout" rows="2">${escHtml(s.callout || '')}</textarea>

      <div class="editor-actions">
        <button class="btn btn-primary editor-save-btn" id="editorSaveBtn">✓ Aplicar cambios</button>
        <button class="btn editor-reset-btn" id="editorResetBtn">↺ Restaurar original</button>
      </div>
    </div>`;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

function bindEditorEvents() {
  const panel = document.getElementById('editorPanel');
  if (!panel) return;

  // Quitar actor
  panel.querySelectorAll('.editor-pill-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const secIdx = parseInt(btn.dataset.sec);
      const actorId = btn.dataset.actor;
      const stage = getCurrentStageRef();
      if (stage?.sections?.[secIdx]?.actors) {
        stage.sections[secIdx].actors = stage.sections[secIdx].actors.filter(a => a !== actorId);
        renderNarrative();
      }
    });
  });

  // Agregar actor
  panel.querySelectorAll('.editor-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const secIdx = parseInt(btn.dataset.sec);
      const select = panel.querySelector(`.editor-actor-select[data-sec="${secIdx}"]`);
      const actorId = select?.value;
      if (!actorId) return;
      const stage = getCurrentStageRef();
      if (stage?.sections?.[secIdx]) {
        if (!stage.sections[secIdx].actors) stage.sections[secIdx].actors = [];
        if (!stage.sections[secIdx].actors.includes(actorId)) {
          stage.sections[secIdx].actors.push(actorId);
          renderNarrative();
        }
      }
    });
  });

  // Guardar cambios al hacer click en "Aplicar"
  const saveBtn = document.getElementById('editorSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const stage = getCurrentStageRef();
      if (!stage) return;

      // Leer todos los campos del formulario
      panel.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        const secIdx = input.dataset.sec !== undefined ? parseInt(input.dataset.sec) : null;
        const value = input.value;

        if (field === 'eyebrow')  stage.eyebrow = value;
        if (field === 'title')    stage.title   = value;
        if (field === 'lead')     stage.lead    = value;
        if (field === 'callout')  stage.callout = value;
        if (field === 'sec-label'   && secIdx !== null && stage.sections?.[secIdx]) stage.sections[secIdx].label   = value;
        if (field === 'sec-content' && secIdx !== null && stage.sections?.[secIdx]) stage.sections[secIdx].content = value;
      });

      // Volver al modo lectura y re-renderizar
      state.editMode = false;
      renderNarrative();
    });
  }

  // Restaurar original
  const resetBtn = document.getElementById('editorResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const original = getOriginalStageRef();
      const edited = getCurrentStageRef();
      if (original && edited) {
        Object.assign(edited, JSON.parse(JSON.stringify(original)));
        // Restaurar secciones individualmente
        edited.sections = JSON.parse(JSON.stringify(original.sections));
        renderNarrative();
      }
    });
  }

  // Exportar cambios
  const exportBtn = document.getElementById('exportChangesBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportChanges);
  }
}

function getOriginalStageRef() {
  // Lee desde los datos originales (no editados)
  const original = state.stages[state.currentDiagram];
  if (state.currentDiagram === 'ciclo-vida' && state.currentPathId) {
    return original?.paths?.[state.currentPathId]?.stages?.[state.current];
  }
  return original?.[state.current];
}

// ============ EXPORT CHANGES ============
function exportChanges() {
  const stagesEdited  = state.editedStages['ciclo-vida'];
  const archEdited    = state.editedStages['architecture-platform'];

  // Crear ZIP simulado: descarga ambos archivos uno por uno
  downloadJSON(stagesEdited, 'stages.json');
  setTimeout(() => downloadJSON(archEdited, 'architecture-platform-stages.json'), 300);
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ UPDATE DIAGRAM STATE ============
function updateDiagram() {
  const current = state.current;
  const isPathMode = state.currentDiagram === 'ciclo-vida' && state.currentPath;
  const nodeSequence = isPathMode ? state.currentPath.nodeSequence : null;

  document.querySelectorAll('.node').forEach(node => {
    const nodeId = node.dataset.nodeId;

    if (isPathMode) {
      // Find all positions of this nodeId in the sequence
      const indices = nodeSequence.reduce((acc, id, i) => id === nodeId ? [...acc, i] : acc, []);

      if (indices.length === 0) {
        node.dataset.state = 'inactive';
      } else if (indices.includes(current)) {
        node.dataset.state = 'current';
      } else if (indices.every(i => i < current)) {
        node.dataset.state = 'past';
      } else if (indices.every(i => i > current)) {
        node.dataset.state = 'future';
      } else {
        // Appears both before and after current — mark as past (already visited)
        node.dataset.state = 'past';
      }
    } else {
      const idx = parseInt(node.dataset.stage);
      node.dataset.state = idx < current ? 'past' : idx === current ? 'current' : 'future';
    }
  });

  // Edges
  document.querySelectorAll('.edge').forEach(e => e.classList.remove('active', 'past', 'inactive'));

  state.diagram.edges.forEach(edgeDef => {
    const e = document.getElementById(edgeDef.id);
    if (!e) return;

    if (isPathMode) {
      if (!edgeDef.connects) return;
      const [from, to] = edgeDef.connects;
      const seq = nodeSequence;
      let isActive = false;
      let isPast = false;

      for (let i = 0; i < seq.length - 1; i++) {
        if (seq[i] === from && seq[i + 1] === to) {
          if (current === i + 1) isActive = true;
          else if (current > i + 1) isPast = true;
        }
      }

      if (isActive) e.classList.add('active');
      else if (isPast) e.classList.add('past');
      else e.classList.add('inactive');
    } else {
      const isPast = edgeDef.pastFrom !== undefined && current > edgeDef.pastFrom;
      const isActive = (edgeDef.activeAt || []).includes(current);
      if (isPast) e.classList.add('past');
      if (isActive) { e.classList.remove('past'); e.classList.add('active'); }
    }
  });

  // Annotations (only used by architecture-platform)
  document.querySelectorAll('.edge-label').forEach(a => a.classList.remove('active'));
  (state.diagram.annotations || []).forEach(ann => {
    const a = document.getElementById(ann.id);
    if (!a) return;
    if ((ann.activeAt || []).includes(current)) a.classList.add('active');
  });
}

// ============ UPDATE CONTROLS ============
function updateControls() {
  const stagesCount = getActiveStages().length;
  $('prevBtn').disabled = state.current === 0;
  $('nextBtn').disabled = state.current === stagesCount - 1;
  const num = String(state.current + 1).padStart(2, '0');
  const total = String(stagesCount).padStart(2, '0');
  $('counter-current').textContent = num;
  $('counter-total').textContent = total;
  $('meta-stage-counter').textContent = `Etapa ${num} / ${total}`;
}

// ============ PROGRESS STRIP ============
function renderProgress() {
  const strip = $('progressStrip');
  strip.innerHTML = '';
  const stagesCount = getActiveStages().length;
  for (let i = 0; i < stagesCount; i++) {
    const dot = document.createElement('button');
    dot.className = 'progress-dot';
    dot.setAttribute('aria-label', `Ir a etapa ${i + 1}`);
    if (i < state.current) dot.classList.add('past');
    if (i === state.current) dot.classList.add('current');
    dot.addEventListener('click', () => goTo(i));
    strip.appendChild(dot);
  }
}

// ============ LEGEND ============
function renderLegend() {
  const list = $('legendRoles');
  const roles = state.diagram.roles || [];
  list.innerHTML = roles.map(r =>
    `<div class="legend-item">
      <span class="legend-swatch" style="background:${r.color}"></span>${r.name}
    </div>`
  ).join('');
}

// ============ NAVIGATION ============
// Desplaza el viewport para centrar el nodo activo, conservando el zoom actual
function panToActiveNode() {
  const current = state.current;
  const nodes = state.diagram.nodes || [];
  const isPathMode = state.currentDiagram === 'ciclo-vida' && state.currentPath;
  const nodeSequence = isPathMode ? state.currentPath.nodeSequence : null;

  // Encontrar el nodo que corresponde a la etapa actual
  let targetNode = null;
  if (isPathMode && nodeSequence) {
    const activeNodeId = nodeSequence[current];
    targetNode = nodes.find(n => n.id === activeNodeId);
  } else {
    // architecture-platform: buscar por stageIndex
    targetNode = nodes.find(n => n.stageIndex === current);
  }

  if (!targetNode?.geom) return;

  const g = targetNode.geom;
  // Centro del nodo (funciona con rect y polygon — para polygon usamos el bbox aproximado)
  let cx, cy;
  if (g.x !== undefined) {
    cx = g.x + g.w / 2;
    cy = g.y + g.h / 2;
  } else if (g.points) {
    // polygon: calcular centroide de los puntos
    const pts = g.points.split(' ').map(p => p.split(',').map(Number));
    cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  } else {
    return;
  }

  // Mantener el mismo ancho/alto del viewport (mismo zoom), solo mover x,y
  const vb = state.zoomVB;
  const targetX = cx - vb.w / 2;
  const targetY = cy - vb.h / 2;
  const newVB = clampVB({ x: targetX, y: targetY, w: vb.w, h: vb.h });

  // Animación suave via requestAnimationFrame
  const startVB = { ...state.zoomVB };
  const duration = 380; // ms
  const startTime = performance.now();

  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    // ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    state.zoomVB = {
      x: startVB.x + (newVB.x - startVB.x) * ease,
      y: startVB.y + (newVB.y - startVB.y) * ease,
      w: newVB.w,
      h: newVB.h,
    };
    applyVB(state.zoomVB);
    if (t < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function goTo(idx) {
  const stagesCount = getActiveStages().length;
  if (idx < 0 || idx >= stagesCount) return;
  state.editMode = false; // cerrar editor al navegar
  state.current = idx;
  renderProgress();
  renderNarrative();
  updateDiagram();
  updateControls();
  panToActiveNode();
}

function next() {
  const stagesCount = getActiveStages().length;
  if (state.current < stagesCount - 1) {
    goTo(state.current + 1);
  } else if (state.playing) {
    togglePlay();
  }
}

function prev() { goTo(state.current - 1); }

function togglePlay() {
  const stagesCount = getActiveStages().length;
  state.playing = !state.playing;
  const playBtn = $('playBtn');
  if (state.playing) {
    playBtn.textContent = '❚❚ Pausar';
    if (state.current === stagesCount - 1) state.current = -1;
    state.playTimer = setInterval(() => {
      if (state.current < stagesCount - 1) {
        next();
      } else {
        togglePlay();
      }
    }, state.autoplayMs);
    next();
  } else {
    playBtn.textContent = '▶ Auto-play';
    clearInterval(state.playTimer);
  }
}

function reset() {
  if (state.playing) togglePlay();
  goTo(0);
}

// ============ EVENTS ============
function bindEvents() {
  $('prevBtn').addEventListener('click', prev);
  $('nextBtn').addEventListener('click', next);
  $('playBtn').addEventListener('click', togglePlay);
  $('resetBtn').addEventListener('click', reset);

  // Main tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchDiagram(btn.dataset.diagram));
  });

  // ── Nivel 2: equipo solicitante ──────────────────────────────────────────
  document.querySelectorAll('.flow-origin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currentDiagram !== 'ciclo-vida') return;
      const origin = btn.dataset.origin;
      if (origin === 'arq') {
        // Default: Robustez Técnica + BAU
        switchPath('arq-rt-bau');
      } else if (origin === 'ext') {
        switchPath(`ext-${state.currentSuffix || 'bau'}`);
      } else {
        switchPath(`${origin}-${state.currentSuffix || 'bau'}`);
      }
    });
  });

  // ── Nivel 3: interacción (solo arq) ──────────────────────────────────────
  document.querySelectorAll('.flow-arqsub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currentDiagram !== 'ciclo-vida') return;
      const sub = btn.dataset.arqsub;
      const suffix = state.currentSuffix || 'bau';
      if (sub === 'fact') {
        switchPath(`arq-fact-${suffix}`);
      } else {
        switchPath(`arq-rt-${suffix}`);
      }
    });
  });

  // ── Nivel 4: tipo de entrega ──────────────────────────────────────────────
  document.querySelectorAll('.flow-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currentDiagram !== 'ciclo-vida') return;
      const suffix = btn.dataset.suffix;
      const origin = state.currentOrigin;
      const arqSub = state.currentArqSub;
      if (origin === 'arq') {
        switchPath(`arq-${arqSub || 'rt'}-${suffix}`);
      } else if (origin === 'ext') {
        switchPath(`ext-${suffix}`);
      } else if (origin && origin !== 'arq') {
        switchPath(`${origin}-${suffix}`);
      }
    });
  });

  // Legend
  const legendBtn = $('legendBtn');
  const legendPanel = $('legendPanel');
  legendBtn.addEventListener('click', () => legendPanel.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!legendBtn.contains(e.target) && !legendPanel.contains(e.target)) {
      legendPanel.classList.remove('open');
    }
  });

  // Diagrama de referencia — modal
  const refBtn = $('refBtn');
  const refModal = $('refModal');
  const refModalClose = $('refModalClose');
  const refModalBackdrop = $('refModalBackdrop');

  function openRefModal() {
    refModal.classList.add('open');
    refModal.setAttribute('aria-hidden', 'false');
  }

  function closeRefModal() {
    refModal.classList.remove('open');
    refModal.setAttribute('aria-hidden', 'true');
  }

  if (refBtn) refBtn.addEventListener('click', openRefModal);
  if (refModalClose) refModalClose.addEventListener('click', closeRefModal);
  if (refModalBackdrop) refModalBackdrop.addEventListener('click', closeRefModal);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeRefModal(); return; }
    if (refModal.classList.contains('open')) return; // block nav keys when modal open
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reset(); }
    if (e.key === '0') { e.preventDefault(); resetZoom(); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); const vb = state.zoomVB; zoomAtPoint(0.75, vb.x + vb.w / 2, vb.y + vb.h / 2); }
    if (e.key === '-') { e.preventDefault(); const vb = state.zoomVB; zoomAtPoint(1.33, vb.x + vb.w / 2, vb.y + vb.h / 2); }
  });

  bindZoom();
}

// ============ COVER SCREEN ============
function initCover() {}

// ============================================================
// GESTIÓN DE VISTAS (diagrama / seguimiento / admin)
// ============================================================
const DIAGRAM_PANELS = ['ciclo-vida', 'architecture-platform'];
const SPECIAL_PANELS = {
  'seguimiento':    'panel-seguimiento',
  'admin-usuarios': 'panel-admin-usuarios',
};

function showPanel(diagramName) {
  // Ocultar main content (SVG + narrative + flowbar)
  const diagramPane  = document.querySelector('.diagram-pane');
  const narrativeEl  = document.getElementById('narrative');
  const flowBar      = document.getElementById('flowSelectorBar');
  const footer       = document.querySelector('footer');

  const isSpecial = diagramName in SPECIAL_PANELS;

  if (diagramPane)  diagramPane.style.display  = isSpecial ? 'none' : '';
  if (narrativeEl)  narrativeEl.style.display   = isSpecial ? 'none' : '';
  if (flowBar)      flowBar.style.display       = isSpecial ? 'none' : (diagramName === 'ciclo-vida' ? 'flex' : 'none');
  if (footer)       footer.style.display        = isSpecial ? 'none' : '';

  // Ocultar todos los paneles especiales
  Object.values(SPECIAL_PANELS).forEach(panelId => {
    const el = document.getElementById(panelId);
    if (el) el.style.display = 'none';
  });

  // Mostrar el panel correcto
  if (isSpecial) {
    const panelId = SPECIAL_PANELS[diagramName];
    const panel = document.getElementById(panelId);
    if (panel) panel.style.display = 'flex';
  }

  // Actualizar tabs activos
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('tab-active', btn.dataset.diagram === diagramName);
  });
}

// Override de switchDiagram para interceptar los paneles especiales
const _originalSwitchDiagram = switchDiagram;
function switchDiagramWithPanels(diagramName) {
  if (diagramName in SPECIAL_PANELS) {
    showPanel(diagramName);
    if (diagramName === 'seguimiento') renderSeguimiento();
    if (diagramName === 'admin-usuarios') renderUsuarios();
    return;
  }
  showPanel(diagramName);
  _originalSwitchDiagram(diagramName);
}

// ============================================================
// MÓDULO: SEGUIMIENTO DE DATA PRODUCTS
// Muestra cada DP posicionado en el SVG del ciclo de vida (path bs-dp)
// ============================================================

const SEG_STORAGE_KEY = 'cvd_seguimiento';
const SEG_PATH_ID     = 'bs-dp';   // path del CVD que usan todos los DPs

function segLoad() {
  try {
    const raw = localStorage.getItem(SEG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : getDefaultDataProducts();
  } catch { return getDefaultDataProducts(); }
}

function segSave(data) {
  localStorage.setItem(SEG_STORAGE_KEY, JSON.stringify(data));
}

function getDefaultDataProducts() {
  return [
    {
      id: 'dp-001',
      nombre: 'Flujo de créditos hipotecarios',
      descripcion: 'Data product para analítica del ciclo de vida de créditos hipotecarios.',
      stageIndex: 2,   // índice dentro del path bs-dp (0-based)
      equipo: 'Ingeniería de Datos',
      responsable: 'Diego Martínez',
      snowTicket: '',
      fechaCreacion: '2026-03-10',
      notas: '',
    },
    {
      id: 'dp-002',
      nombre: 'Segmentación de clientes retail',
      descripcion: 'Modelos de segmentación para campañas retail.',
      stageIndex: 5,
      equipo: 'Modelado',
      responsable: 'Walter López',
      snowTicket: 'CHG0012345',
      fechaCreacion: '2026-02-20',
      notas: 'Vinculado a release Q2.',
    },
    {
      id: 'dp-003',
      nombre: 'Dashboard ejecutivo de rentabilidad',
      descripcion: 'Vista agregada de rentabilidad por segmento.',
      stageIndex: 0,
      equipo: 'Arquitectura',
      responsable: 'Alejandro Genovese',
      snowTicket: '',
      fechaCreacion: '2026-05-01',
      notas: '',
    },
  ];
}

// Estado del módulo
let segState = {
  data: [],
  search: '',
  selectedId: null,
  svgBuilt: false,
};

// ── Helpers de path ──────────────────────────────────────────────────────────

function segGetPath() {
  // Lee del estado editado (mismo que usa el CVD principal)
  return state.editedStages?.[SEG_DIAGRAM_ID]?.paths?.[SEG_PATH_ID];
}

const SEG_DIAGRAM_ID = 'ciclo-vida';

function segGetStageLabel(stageIndex) {
  const path = segGetPath();
  if (!path) return `Etapa ${stageIndex + 1}`;
  const s = path.stages?.[stageIndex];
  return s ? (s.eyebrow || s.title?.replace(/<[^>]+>/g, '') || `Etapa ${stageIndex + 1}`) : `Etapa ${stageIndex + 1}`;
}

function segGetStageCount() {
  return segGetPath()?.stages?.length || 8;
}

// ── Renderizado principal ────────────────────────────────────────────────────

function renderSeguimiento() {
  segState.data = segLoad();
  _buildSegDpList();
  // Seleccionar el primero por defecto si no hay selección
  if (!segState.selectedId && segState.data.length > 0) {
    segSelectDp(segState.data[0].id);
  } else if (segState.selectedId) {
    segSelectDp(segState.selectedId);
  }
}

// ── Lista lateral ────────────────────────────────────────────────────────────

function _buildSegDpList() {
  const list   = document.getElementById('segDpList');
  if (!list) return;
  const search = segState.search.toLowerCase();
  const items  = segState.data.filter(dp =>
    !search ||
    dp.nombre.toLowerCase().includes(search) ||
    (dp.responsable || '').toLowerCase().includes(search)
  );

  if (items.length === 0) {
    list.innerHTML = '<p class="seg-list-empty">Sin resultados</p>';
    return;
  }

  list.innerHTML = items.map(dp => {
    const stageCount = segGetStageCount();
    const pct = stageCount > 1 ? Math.round((dp.stageIndex / (stageCount - 1)) * 100) : 0;
    const stageLabel = segGetStageLabel(dp.stageIndex);
    const isSelected = dp.id === segState.selectedId;
    return `
      <div class="seg-dp-row ${isSelected ? 'seg-dp-row-active' : ''}" data-dpid="${dp.id}">
        <div class="seg-dp-row-name">${escHtml(dp.nombre)}</div>
        <div class="seg-dp-row-meta">
          <span class="seg-dp-row-resp">${escHtml(dp.responsable)}</span>
          ${dp.snowTicket ? `<span class="seg-snow-chip">${escHtml(dp.snowTicket)}</span>` : ''}
        </div>
        <div class="seg-dp-row-stage">
          <span class="seg-dp-row-stage-label">${escHtml(stageLabel)}</span>
          <div class="seg-dp-progress-bar">
            <div class="seg-dp-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.seg-dp-row').forEach(row => {
    row.addEventListener('click', () => segSelectDp(row.dataset.dpid));
  });
}

// ── Selección y renderizado del detalle ──────────────────────────────────────

function segSelectDp(id) {
  segState.selectedId = id;
  const dp = segState.data.find(d => d.id === id);

  // Actualizar lista (resaltado activo)
  _buildSegDpList();

  const emptyEl  = document.getElementById('segEmpty');
  const detailEl = document.getElementById('segDetail');
  if (!dp) {
    if (emptyEl)  emptyEl.style.display  = '';
    if (detailEl) detailEl.style.display = 'none';
    return;
  }

  if (emptyEl)  emptyEl.style.display  = 'none';
  if (detailEl) detailEl.style.display = '';

  // Header del detalle
  const titleEl   = document.getElementById('segDetailTitle');
  const metaEl    = document.getElementById('segDetailMeta');
  const actionsEl = document.getElementById('segDetailActions');

  if (titleEl) titleEl.textContent = dp.nombre;

  const snowLink = dp.snowTicket
    ? `<a class="dp-snow-link" href="https://bancogalicia.service-now.com/nav_to.do?uri=change_request.do?sysparm_query=number=${dp.snowTicket}" target="_blank" rel="noopener">${dp.snowTicket} ↗</a>`
    : '';

  if (metaEl) metaEl.innerHTML = `
    <span class="seg-meta-chip">${escHtml(dp.equipo)}</span>
    <span class="seg-meta-chip">${escHtml(dp.responsable)}</span>
    ${snowLink ? `<span class="seg-meta-snow">${snowLink}</span>` : ''}
    <span class="seg-meta-fecha">desde ${dp.fechaCreacion || '—'}</span>
  `;

  if (actionsEl) {
    actionsEl.innerHTML = isAdmin() ? `
      <button class="btn" id="segBtnPrev" title="Etapa anterior" ${dp.stageIndex === 0 ? 'disabled' : ''}>← Anterior</button>
      <button class="btn btn-primary" id="segBtnNext" title="Etapa siguiente" ${dp.stageIndex >= segGetStageCount() - 1 ? 'disabled' : ''}>Siguiente →</button>
      <button class="btn" id="segBtnEdit" title="Editar datos del DP">✎ Editar</button>
      <button class="btn" id="segBtnDelete" title="Eliminar DP" style="color:#c0392b;border-color:#c0392b">✕</button>
    ` : '';

    if (isAdmin()) {
      document.getElementById('segBtnPrev')?.addEventListener('click', () => segMoveStage(id, -1));
      document.getElementById('segBtnNext')?.addEventListener('click', () => segMoveStage(id,  1));
      document.getElementById('segBtnEdit')?.addEventListener('click', () => openEditDpModal(id));
      document.getElementById('segBtnDelete')?.addEventListener('click', () => segDeleteDp(id));
    }
  }

  // Construir / actualizar el SVG de seguimiento
  _buildSegSvg();
  _updateSegSvg(dp.stageIndex);

  // Mostrar narrative de la etapa actual
  _renderSegNarrative(dp.stageIndex);
}

// ── SVG del ciclo de vida para Seguimiento ───────────────────────────────────
// Reutiliza los mismos datos de diagram.json pero en el SVG #segSvg

function _buildSegSvg() {
  if (segState.svgBuilt) return;
  segState.svgBuilt = true;

  const diagram = state.diagrams[SEG_DIAGRAM_ID];
  if (!diagram) return;

  const svg = document.getElementById('segSvg');
  if (!svg) return;

  // ViewBox
  const vb = diagram.viewBox;
  svg.setAttribute('viewBox', vb);

  // Transversal
  const transG = document.getElementById('segSvgTransverse');
  if (diagram.transverse?.enabled) {
    const t = diagram.transverse;
    transG.setAttribute('opacity', '0.6');
    const bracketEl = document.createElementNS(SVG_NS, 'path');
    bracketEl.setAttribute('class', 'transverse-bracket');
    bracketEl.setAttribute('d', t.bracket);
    transG.appendChild(bracketEl);
    if (t.labelPos && t.label) {
      const textEl = document.createElementNS(SVG_NS, 'text');
      textEl.setAttribute('class', 'transverse-label');
      textEl.setAttribute('x', t.labelPos.x);
      textEl.setAttribute('y', t.labelPos.y);
      textEl.setAttribute('transform', `rotate(${t.labelPos.rotate || 0} ${t.labelPos.x} ${t.labelPos.y})`);
      textEl.setAttribute('text-anchor', 'middle');
      textEl.textContent = t.label;
      transG.appendChild(textEl);
    }
  }

  // Edges
  const edgesG = document.getElementById('segSvgEdges');
  diagram.edges.forEach(edge => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('class', 'edge');
    p.setAttribute('id', 'seg-edge-' + edge.id);
    p.setAttribute('d', edge.d);
    // Apuntar al marker local
    if (edge.d) p.setAttribute('marker-end', 'url(#seg-arrow)');
    edgesG.appendChild(p);
  });

  // Nodes
  const nodesG = document.getElementById('segSvgNodes');
  diagram.nodes.forEach(node => {
    const g = buildNode(node);
    g.setAttribute('id', 'seg-node-' + node.id);
    // Quitar click handler — en seguimiento los nodos no navegan
    g.style.cursor = 'default';
    g.replaceWith(g.cloneNode(true));   // remove event listeners
    const gClean = g.cloneNode(true);
    nodesG.appendChild(gClean);
  });
}

function _updateSegSvg(stageIndex) {
  const diagram = state.diagrams[SEG_DIAGRAM_ID];
  if (!diagram) return;

  const path = segGetPath();
  if (!path) return;

  const nodeSequence = path.nodeSequence;
  const activeNodeId = nodeSequence[stageIndex];

  // Colorear nodos
  document.querySelectorAll('#segSvgNodes .node').forEach(nodeEl => {
    const nodeId = nodeEl.dataset.nodeId;
    const indices = nodeSequence.reduce((acc, id, i) => id === nodeId ? [...acc, i] : acc, []);
    if (indices.length === 0) {
      nodeEl.dataset.state = 'inactive';
    } else if (indices.includes(stageIndex)) {
      nodeEl.dataset.state = 'current';
    } else if (indices.every(i => i < stageIndex)) {
      nodeEl.dataset.state = 'past';
    } else {
      nodeEl.dataset.state = 'future';
    }
  });

  // Colorear edges
  document.querySelectorAll('#segSvgEdges .edge').forEach(e => {
    e.classList.remove('active', 'past', 'inactive');
  });
  diagram.edges.forEach(edgeDef => {
    const e = document.getElementById('seg-edge-' + edgeDef.id);
    if (!e || !edgeDef.connects) return;
    const [from, to] = edgeDef.connects;
    let isActive = false, isPast = false;
    for (let i = 0; i < nodeSequence.length - 1; i++) {
      if (nodeSequence[i] === from && nodeSequence[i + 1] === to) {
        if (stageIndex === i + 1) isActive = true;
        else if (stageIndex > i + 1) isPast = true;
      }
    }
    if (isActive) e.classList.add('active');
    else if (isPast) e.classList.add('past');
    else e.classList.add('inactive');
  });

  // Pan automático al nodo activo
  _segPanToNode(activeNodeId, diagram);
}

function _segPanToNode(nodeId, diagram) {
  const svg   = document.getElementById('segSvg');
  if (!svg) return;
  const node  = diagram.nodes.find(n => n.id === nodeId);
  if (!node?.geom) return;

  const g = node.geom;
  const cx = g.x !== undefined ? g.x + g.w / 2 : 0;
  const cy = g.y !== undefined ? g.y + g.h / 2 : 0;

  // Usar el viewBox del diagrama para calcular el viewport centrado en el nodo
  const baseVB = parseVB(diagram.initialZoom || diagram.viewBox);
  const targetX = cx - baseVB.w / 2;
  const targetY = cy - baseVB.h / 2;
  const newVBStr = `${targetX} ${targetY} ${baseVB.w} ${baseVB.h}`;
  svg.setAttribute('viewBox', newVBStr);
}

// ── Narrative de etapa ───────────────────────────────────────────────────────

function _renderSegNarrative(stageIndex) {
  const narEl = document.getElementById('segNarrative');
  if (!narEl) return;

  const path = segGetPath();
  const s    = path?.stages?.[stageIndex];
  if (!s) { narEl.innerHTML = ''; return; }

  narEl.style.setProperty('--stage-color', s.color?.primary || '#1F3864');
  narEl.style.setProperty('--stage-color-soft', s.color?.soft || '#E8EDFB');

  const sectionsHTML = (s.sections || []).map(sec =>
    `<div class="stage-section">
      <div class="stage-section-label">${sec.label}</div>
      <div class="stage-section-content">${sectionContentHTML(sec)}</div>
    </div>`
  ).join('');

  narEl.innerHTML = `
    <div class="narrative-accent-bar"></div>
    <div class="narrative-content" style="padding:20px 28px">
      <div class="stage-eyebrow"><span class="stage-dot"></span>${s.eyebrow}</div>
      <h2 class="stage-title">${s.title}</h2>
      <p class="stage-lead">${s.lead}</p>
      ${sectionsHTML}
      ${s.callout ? `<div class="stage-callout">${s.callout}</div>` : ''}
    </div>
  `;
}

// ── Mover etapa ──────────────────────────────────────────────────────────────

function segMoveStage(id, dir) {
  const dp = segState.data.find(d => d.id === id);
  if (!dp) return;
  const total = segGetStageCount();
  const newIdx = dp.stageIndex + dir;
  if (newIdx < 0 || newIdx >= total) return;
  dp.stageIndex = newIdx;
  segSave(segState.data);
  segSelectDp(id);
}

function segDeleteDp(id) {
  if (!confirm('¿Eliminar este data product?')) return;
  segState.data = segState.data.filter(d => d.id !== id);
  segSave(segState.data);
  segState.selectedId = segState.data[0]?.id || null;
  _buildSegDpList();
  if (segState.selectedId) {
    segSelectDp(segState.selectedId);
  } else {
    document.getElementById('segEmpty').style.display  = '';
    document.getElementById('segDetail').style.display = 'none';
  }
}

// ── Modales nuevo / editar DP ────────────────────────────────────────────────

function openNewDpModal() {
  const backdrop = document.getElementById('dpModalBackdrop');
  const title    = document.getElementById('dpModalTitle');
  const body     = document.getElementById('dpModalBody');

  title.textContent = 'Nuevo Data Product';
  body.innerHTML = _dpFormHTML(null);
  _bindDpForm(null);
  backdrop.style.display = 'flex';
}

function openEditDpModal(id) {
  const dp       = segState.data.find(d => d.id === id);
  if (!dp) return;
  const backdrop = document.getElementById('dpModalBackdrop');
  const title    = document.getElementById('dpModalTitle');
  const body     = document.getElementById('dpModalBody');

  title.textContent = 'Editar Data Product';
  body.innerHTML = _dpFormHTML(dp);
  _bindDpForm(dp);
  backdrop.style.display = 'flex';
}

function _dpFormHTML(dp) {
  return `
    <form id="dpForm">
      <div class="form-field">
        <label class="form-label">Nombre *</label>
        <input class="form-input" id="dpFNombre" type="text" value="${escAttr(dp?.nombre || '')}" placeholder="Nombre del data product">
      </div>
      <div class="form-field">
        <label class="form-label">Descripción</label>
        <textarea class="form-input" id="dpFDesc" rows="2">${escHtml(dp?.descripcion || '')}</textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Equipo</label>
        <input class="form-input" id="dpFEquipo" type="text" value="${escAttr(dp?.equipo || '')}" placeholder="Ingeniería de Datos">
      </div>
      <div class="form-field">
        <label class="form-label">Responsable</label>
        <input class="form-input" id="dpFResp" type="text" value="${escAttr(dp?.responsable || '')}" placeholder="Nombre y apellido">
      </div>
      <div class="form-field">
        <label class="form-label">Ticket ServiceNow</label>
        <input class="form-input" id="dpFSnow" type="text" value="${escAttr(dp?.snowTicket || '')}" placeholder="CHG0012345 (pendiente integración API)">
      </div>
      <div class="form-error" id="dpFError"></div>
      <div class="form-actions">
        <button type="button" class="btn" id="dpFCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>
  `;
}

function _bindDpForm(existingDp) {
  document.getElementById('dpFCancel')?.addEventListener('click', closeDpModal);
  document.getElementById('dpForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = document.getElementById('dpFNombre').value.trim();
    if (!nombre) { document.getElementById('dpFError').textContent = 'El nombre es obligatorio.'; return; }

    if (existingDp) {
      existingDp.nombre      = nombre;
      existingDp.descripcion = document.getElementById('dpFDesc').value.trim();
      existingDp.equipo      = document.getElementById('dpFEquipo').value.trim();
      existingDp.responsable = document.getElementById('dpFResp').value.trim();
      existingDp.snowTicket  = document.getElementById('dpFSnow').value.trim();
    } else {
      segState.data.push({
        id: 'dp-' + Date.now(),
        nombre,
        descripcion: document.getElementById('dpFDesc').value.trim(),
        stageIndex:  0,
        equipo:      document.getElementById('dpFEquipo').value.trim(),
        responsable: document.getElementById('dpFResp').value.trim(),
        snowTicket:  document.getElementById('dpFSnow').value.trim(),
        fechaCreacion: new Date().toISOString().slice(0, 10),
        notas: '',
      });
    }
    segSave(segState.data);
    closeDpModal();
    const selId = existingDp ? existingDp.id : segState.data[segState.data.length - 1].id;
    segState.selectedId = selId;
    _buildSegDpList();
    segSelectDp(selId);
  });
}

function closeDpModal() {
  const backdrop = document.getElementById('dpModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initSeguimiento() {
  document.getElementById('nuevoDataProductBtn')?.addEventListener('click', openNewDpModal);

  document.getElementById('seguimientoSearch')?.addEventListener('input', (e) => {
    segState.search = e.target.value;
    _buildSegDpList();
  });

  document.getElementById('dpModalClose')?.addEventListener('click', closeDpModal);
  document.getElementById('dpModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDpModal();
  });
}

// ============================================================
// MÓDULO: ADMINISTRACIÓN DE USUARIOS
// ============================================================

const USERS_STORAGE_KEY = 'cvd_users';

// Usuarios de arranque (admin y visor de AUTH_USERS más los que se agreguen)
function usersLoad() {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // Seed inicial
    const seed = [
      { id: 'u-admin', username: 'admin', nombre: 'Administrador', password: 'data2024', rol: 'admin', estado: 'activo', fechaCreacion: '2026-01-01' },
      { id: 'u-visor', username: 'visor', nombre: 'Usuario Visor',  password: 'galicia',  rol: 'visor', estado: 'activo', fechaCreacion: '2026-01-01' },
    ];
    usersSave(seed);
    return seed;
  } catch { return []; }
}

function usersSave(data) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(data));
  // Sincronizar AUTH_USERS en memoria para que el login funcione con usuarios nuevos
  data.forEach(u => {
    if (u.estado === 'activo') {
      AUTH_USERS[u.username] = { password: u.password, role: u.rol };
    } else {
      delete AUTH_USERS[u.username];
    }
  });
}

let usersState = { data: [] };

function renderUsuarios() {
  usersState.data = usersLoad();
  _buildUsuariosTable();
}

function _buildUsuariosTable() {
  const tbody = document.getElementById('usuariosTbody');
  if (!tbody) return;

  tbody.innerHTML = usersState.data.map(u => `
    <tr>
      <td><code>${escHtml(u.username)}</code></td>
      <td>${escHtml(u.nombre)}</td>
      <td><span class="rol-badge rol-${u.rol}">${u.rol}</span></td>
      <td><span class="estado-badge estado-${u.estado}">${u.estado}</span></td>
      <td>${u.fechaCreacion}</td>
      <td>
        <button class="dp-btn dp-btn-detail" data-uid="${u.id}" title="Editar">Editar</button>
        ${u.username !== 'admin' ? `<button class="dp-btn dp-btn-delete" data-uid="${u.id}" title="Eliminar">✕</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.dp-btn-detail').forEach(btn => {
    btn.addEventListener('click', () => openUsuarioModal(btn.dataset.uid));
  });
  tbody.querySelectorAll('.dp-btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteUsuario(btn.dataset.uid));
  });
}

function openUsuarioModal(uid) {
  const u = uid ? usersState.data.find(x => x.id === uid) : null;
  const isEdit = !!u;

  document.getElementById('usuarioModalTitle').textContent = isEdit ? `Editar: ${u.username}` : 'Nuevo usuario';
  document.getElementById('usuarioFormId').value       = u?.id || '';
  document.getElementById('usuarioFormUsername').value = u?.username || '';
  document.getElementById('usuarioFormNombre').value   = u?.nombre || '';
  document.getElementById('usuarioFormPassword').value = '';
  document.getElementById('usuarioFormRol').value      = u?.rol || 'visor';
  document.getElementById('usuarioFormEstado').value   = u?.estado || 'activo';
  document.getElementById('usuarioFormError').textContent = '';

  // El campo password es requerido solo en creación
  document.getElementById('usuarioFormPassword').placeholder = isEdit ? '(dejar vacío para no cambiar)' : '••••••••';

  document.getElementById('usuarioModalBackdrop').style.display = 'flex';
  document.getElementById('usuarioFormUsername').focus();
}

function closeUsuarioModal() {
  document.getElementById('usuarioModalBackdrop').style.display = 'none';
}

function deleteUsuario(uid) {
  const u = usersState.data.find(x => x.id === uid);
  if (!u) return;
  if (!confirm(`¿Eliminar el usuario "${u.username}"?`)) return;
  usersState.data = usersState.data.filter(x => x.id !== uid);
  usersSave(usersState.data);
  _buildUsuariosTable();
}

function initAdminUsuarios() {
  document.getElementById('nuevoUsuarioBtn')?.addEventListener('click', () => openUsuarioModal(null));
  document.getElementById('usuarioModalClose')?.addEventListener('click', closeUsuarioModal);
  document.getElementById('usuarioFormCancel')?.addEventListener('click', closeUsuarioModal);
  document.getElementById('usuarioModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeUsuarioModal();
  });

  document.getElementById('usuarioForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl    = document.getElementById('usuarioFormError');
    const id       = document.getElementById('usuarioFormId').value;
    const username = document.getElementById('usuarioFormUsername').value.trim().toLowerCase();
    const nombre   = document.getElementById('usuarioFormNombre').value.trim();
    const password = document.getElementById('usuarioFormPassword').value;
    const rol      = document.getElementById('usuarioFormRol').value;
    const estado   = document.getElementById('usuarioFormEstado').value;

    if (!username || !nombre) { errEl.textContent = 'Usuario y nombre son obligatorios.'; return; }

    const existente = usersState.data.find(u => u.username === username && u.id !== id);
    if (existente) { errEl.textContent = 'Ese nombre de usuario ya existe.'; return; }

    if (id) {
      // Edición
      const u = usersState.data.find(x => x.id === id);
      if (u) {
        u.username = username;
        u.nombre   = nombre;
        u.rol      = rol;
        u.estado   = estado;
        if (password) u.password = password;
      }
    } else {
      // Creación
      if (!password) { errEl.textContent = 'La contraseña es obligatoria para usuarios nuevos.'; return; }
      usersState.data.push({
        id: 'u-' + Date.now(),
        username, nombre, password, rol, estado,
        fechaCreacion: new Date().toISOString().slice(0, 10),
      });
    }

    usersSave(usersState.data);
    closeUsuarioModal();
    _buildUsuariosTable();
  });
}

// ============ INIT ============
async function init() {
  try {
    initLogin();   // login primero — puede redirigir o continuar
    await loadData();
    bindEvents();
    initCover();

    // Reemplazar listeners de tabs con la versión extendida (soporta paneles especiales)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      clone.addEventListener('click', () => switchDiagramWithPanels(clone.dataset.diagram));
    });

    showPanel('ciclo-vida');

    initSeguimiento();
    initAdminUsuarios();

    // Sync usuarios en memoria para que el login funcione con cuentas guardadas
    usersSave(usersLoad());

    // Mostrar tab admin si la sesión actual es admin
    const session = authGetSession();
    if (session?.role === 'admin') {
      const adminTab = document.getElementById('tab-admin-usuarios');
      if (adminTab) adminTab.style.display = '';
    }
  } catch (err) {
    console.error('Init falló:', err);
  }
}

init();
