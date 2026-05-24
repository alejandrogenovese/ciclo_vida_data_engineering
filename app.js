// ============================================================
// Ciclo de Vida del Desarrollo · Data & IA
// Modelo operativo interactivo
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

// ============ STATE ============
const state = {
  diagrams: {},
  stages: {},
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
  const minW = base.w * 0.2;
  const maxW = base.w * 4;
  w = Math.max(minW, Math.min(maxW, w));
  h = w * base.h / base.w;
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
  state.zoomVB = { ...state.baseVB };
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
      state.zoomVB = {
        x: vb.x + (state.lastDragSVG.x - cur.x),
        y: vb.y + (state.lastDragSVG.y - cur.y),
        w: vb.w,
        h: vb.h,
      };
      applyVB(state.zoomVB);
      state.lastDragSVG = screenToSVG(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', () => {
    state.dragging = false;
    svg.classList.remove('is-dragging');
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
  if (state.currentDiagram === 'ciclo-vida' && state.currentPath) {
    return state.currentPath.stages;
  }
  return state.stages[state.currentDiagram];
}

// ============ LOAD DATA ============
async function loadData() {
  try {
    const [diagramRes, stagesRes, archDiagramRes, archStagesRes] = await Promise.all([
      fetch('data/diagram.json'),
      fetch('data/stages.json'),
      fetch('data/architecture-platform.json'),
      fetch('data/architecture-platform-stages.json'),
    ]);
    if (!diagramRes.ok || !stagesRes.ok || !archDiagramRes.ok || !archStagesRes.ok) {
      throw new Error('No se pudieron leer los JSON de data/');
    }
    state.diagrams['ciclo-vida'] = await diagramRes.json();
    state.stages['ciclo-vida'] = await stagesRes.json();
    state.diagrams['architecture-platform'] = await archDiagramRes.json();
    state.stages['architecture-platform'] = await archStagesRes.json();

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
  const pathsData = state.stages['ciclo-vida'];
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

// Sync the two-level selector buttons to reflect a given pathId
function syncFlowSelectorUI(pathId) {
  let origin, suffix;
  if (pathId === 'arquitectura') {
    origin = 'arq';
    suffix = null;
  } else {
    // pathId format: "bs-bau", "triage-dp", "rt-bau", etc.
    const parts = pathId.split('-');
    suffix = parts[parts.length - 1];            // "bau" or "dp"
    origin = parts.slice(0, -1).join('-');        // "bs", "triage", "rt"
  }

  state.currentOrigin = origin;

  document.querySelectorAll('.flow-origin-btn').forEach(btn =>
    btn.classList.toggle('flow-origin-active', btn.dataset.origin === origin));

  const typeRow = $('flowTypeRow');
  const typeSep = $('flowTypeSep');

  if (origin === 'arq') {
    typeRow.style.display = 'none';
    typeSep.style.display = 'none';
  } else {
    typeRow.style.display = 'flex';
    typeSep.style.display = 'block';
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
  state.zoomVB = { ...state.baseVB };
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
      <div class="stage-section-content">${sec.content}</div>
    </div>`
  ).join('');

  narrative.innerHTML = `
    <div class="stage-eyebrow">
      <span class="stage-dot"></span>
      ${s.eyebrow}
    </div>
    <h2 class="stage-title">${s.title}</h2>
    <p class="stage-lead">${s.lead}</p>
    ${sectionsHTML}
    ${s.callout ? `<div class="stage-callout">${s.callout}</div>` : ''}
  `;

  narrative.querySelectorAll('*').forEach(el => {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
  });
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
function goTo(idx) {
  const stagesCount = getActiveStages().length;
  if (idx < 0 || idx >= stagesCount) return;
  state.current = idx;
  renderProgress();
  renderNarrative();
  updateDiagram();
  updateControls();
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

  // Flow origin selector (nivel 1)
  document.querySelectorAll('.flow-origin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currentDiagram !== 'ciclo-vida') return;
      const origin = btn.dataset.origin;
      if (origin === 'arq') {
        switchPath('arquitectura');
      } else {
        // Default to BAU when switching origin
        switchPath(`${origin}-bau`);
      }
    });
  });

  // Flow type selector (nivel 2 — BAU / Data Product)
  document.querySelectorAll('.flow-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currentDiagram !== 'ciclo-vida') return;
      const suffix = btn.dataset.suffix;
      const origin = state.currentOrigin;
      if (origin && origin !== 'arq') {
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

// ============ INIT ============
async function init() {
  try {
    await loadData();
    bindEvents();
  } catch (err) {
    console.error('Init falló:', err);
  }
}

init();
