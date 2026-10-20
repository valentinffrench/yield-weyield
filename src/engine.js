// Moteur (monde MAIN, dans la page WeYield) : état, calcul du modèle, dessin des graphiques.
// Aucune interface ici : le panneau latéral reçoit des instantanés (snapshot) et renvoie des actions,
// via relay.js (monde isolé) qui fait le pont avec chrome.runtime.
(() => {
  const WY = window.__WYP;
  if (!WY || WY.started) return;
  WY.started = true;

  const KEY = 'wyYield3';

  // ---------- état persistant (localStorage de la page) ----------
  // Reprend les réglages de la v1 (« wyPaliers » : tiers en texte, gridStart) et de la v2 (tiersTxt, gridDate).
  function loadState() {
    try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw && raw.v === 3) return WY.upgradeState(raw); } catch (e) {}
    let old = {}; try { old = JSON.parse(localStorage.getItem('wyPaliers')) || {}; } catch (e) {}
    const txt = old.v === 2 ? old.tiersTxt : old.tiers;
    const tiers = typeof txt === 'string' ? WY.parseTiers(txt).tiers : [];
    const d = WY.stateDefaults();
    return Object.assign(d, {
      tierList: tiers.length ? tiers : d.tierList,
      gridDate: (old.v === 2 ? old.gridDate : old.gridStart) || '',
      gridNum: old.gridNum || 1, gridLen: old.gridLen || 1, gridUnit: old.gridUnit === 'd' ? 'd' : 'w',
      periods: typeof old.periods === 'boolean' ? old.periods : true,
      tiers: typeof old.tiers === 'boolean' ? old.tiers : true,
    });
  }
  const state = loadState();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  save();   // persiste d'emblée la mise à niveau (rolesSchema) : un état ancien n'est pas remis à zéro à chaque chargement

  // Seules ces clés, avec ces bornes, peuvent être modifiées depuis le panneau.
  const int = (v, lo, hi, dflt) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };
  function sanitize(p) {
    const o = {};
    if (typeof p.periods === 'boolean') o.periods = p.periods;
    if (typeof p.tiers === 'boolean') o.tiers = p.tiers;
    if (typeof p.signals === 'boolean') o.signals = p.signals;
    if (Array.isArray(p.tierList)) o.tierList = p.tierList.slice(0, 12).map(t => [int(t && t[0], 0, 366, 0), int(t && t[1], 0, 366, 0)]).filter(([a, b]) => b >= a && b >= 1);
    if (typeof p.gridDate === 'string' && (p.gridDate === '' || !isNaN(WY.parseISO(p.gridDate)))) o.gridDate = p.gridDate;
    if ('gridNum' in p) o.gridNum = int(p.gridNum, 1, 999, 1);
    if ('gridLen' in p) o.gridLen = int(p.gridLen, 1, 366, 1);
    if (p.gridUnit === 'd' || p.gridUnit === 'w') o.gridUnit = p.gridUnit;
    if ('offset' in p) o.offset = int(p.offset, -60, 60, 0);
    if ('dataIdx' in p) o.dataIdx = p.dataIdx === null ? null : int(p.dataIdx, 0, 9, 0);
    return o;
  }

  let sel = null;              // période choisie (index k) ; null = période contenant la date de référence
  let hot = {};                // élément survolé dans le panneau : { zone, period }
  let model = null, view = null, plan = null;
  let signalItems = [];        // verdicts par période envoyés par le panneau : [{ k, kind, alpha }]
  let list = [], painted = [];  // graphiques de la page ; graphiques sur lesquels on a dessiné
  let drawnSig = '', drawnCount = 0, sentNoChart = false;

  // ---------- modèle ----------
  function compute(data) {
    const ckey = WY.chartKey(data.chart);
    const S = WY.readSeries(data.chart, state.maps[ckey]);
    const ref = WY.chartRefDay(data.chart);
    const grid = WY.makeGrid(state, ref);
    const periods = grid.inRange(S.range[0], S.range[1]);
    const k = sel != null ? sel : grid.indexAt(ref);
    const selP = grid.at(k);
    const j0 = WY.j0Of(selP, state.offset);
    const zones = WY.tierZones(j0, state.tierList).map(z => Object.assign(z, WY.zoneStats(S, z.from, z.to)));
    return {
      // vue sérialisable envoyée au panneau (pas de fonctions)
      view: {
        selP, isAuto: sel == null, j0, offset: state.offset, ref,
        grid: { auto: grid.auto, p1: grid.p1, len: grid.len },
        has: { rpd: !!S.cur, ly: !!S.ly, lyf: !!S.lyf }, kind: S.kind, windowDays: S.windowDays, metric: S.metric, metricBlocked: S.metricBlocked, invalid: S.invalid,
        charts: list.map(c => ({ i: c.i, title: c.title, score: WY.roleScore(c.chart, state.maps[WY.chartKey(c.chart)]) })), dataIdx: data.i, dataAuto: state.dataIdx == null,
        series: S.series, roles: S.roles, autoRoles: S.auto, mapped: state.maps[ckey] || {}, ckey,
        selStats: WY.zoneStats(S, selP.from, selP.to),
        zones,
        periodRows: periods.map(p => Object.assign({ p }, WY.zoneStats(S, p.from, p.to))),
      },
      plan: { showPeriods: state.periods, showTiers: state.tiers, periods, selK: selP.k, j0, zones },
      grid,
    };
  }
  const signature = data => [state.periods, state.tiers, JSON.stringify(state.tierList), state.gridDate, state.gridNum, state.gridLen, state.gridUnit, state.offset, state.dataIdx, JSON.stringify(state.maps), sel,
    list.map(c => c.chart.__wypId).join(), WY.dataSignature(data.chart)].join('|');

  // ---------- pont vers le panneau ----------
  const post = msg => window.postMessage({ __wyp: 1, dir: 'to-panel', msg }, location.origin);
  const snapshot = () => post({ type: 'snapshot', state, view });

  // Les périodes et les paliers sont dessinés sur tous les graphiques de la page : ils partagent le même axe des dates.
  // Sur new-bookings/*, WeYield dessine des « ? » dans les premiers pixels du tracé : nos libellés descendent d'autant (valeur à confirmer à l'œil).
  const labelDy = c => (c.host && c.host.closest && c.host.closest('app-new-bookings-chart, app-new-bookings-variation-chart') ? 16 : 0);
  const paintAll = () => { painted = list.map(c => c.chart); drawnCount = plan ? list.reduce((n, c) => n + WY.paint(c.chart, Object.assign({}, plan, { hot, signals: state.signals ? signalItems : [], labelDy: labelDy(c) })), 0) : 0; };
  function unpaint(charts) { charts.forEach(ch => { try { WY.clearOverlay(ch); } catch (e) {} }); }

  function refresh() {
    list = WY.findCharts();
    const data = WY.pickData(list, state.dataIdx, state.maps, state.dataKey);
    unpaint(painted.filter(ch => !list.some(c => c.chart === ch)));
    drawnSig = '';
    if (!data) { painted = []; view = null; plan = null; snapshot(); return; }
    const m = compute(data);
    view = m.view; plan = m.plan; model = m;
    paintAll();
    list.forEach(c => WY.bindPick(c.chart, day => { if (!state.periods) return; sel = model.grid.indexAt(day); refresh(); }));
    drawnSig = signature(data);
    sentNoChart = false;
    snapshot();
  }
  const changed = () => { save(); refresh(); };

  // ---------- actions venant du panneau ----------
  function handle(m) {
    switch (m && m.op) {
      case 'hello': return snapshot();
      case 'signals': signalItems = (Array.isArray(m.items) ? m.items : []).slice(0, 400).filter(i => i && Number.isInteger(i.k) && ['raise', 'lower', 'hold', 'review'].includes(i.kind))
        .map(i => ({ k: i.k, kind: i.kind, alpha: Math.min(1, Math.max(0, +i.alpha || 0)) })); paintAll(); return;
      case 'toggle': if (m.name === 'periods' || m.name === 'tiers' || m.name === 'signals') { state[m.name] = !state[m.name]; changed(); } return;
      case 'step': if (view) { sel = view.selP.k + (m.d > 0 ? 1 : -1); changed(); } return;
      case 'auto': sel = null; changed(); return;
      case 'select': sel = int(m.k, -2000, 2000, 0); changed(); return;
      case 'config': {
        const patch = sanitize(m.patch || {});
        Object.assign(state, patch);
        if ('dataIdx' in patch) state.dataKey = patch.dataIdx != null && list[patch.dataIdx] ? WY.chartKey(list[patch.dataIdx].chart) : null;
        if (['gridDate', 'gridNum', 'gridLen', 'gridUnit'].some(k => k in patch)) sel = null;
        changed(); return;
      }
      case 'map': {   // rôle d'une série : { role, key } ; key = clé de série | 'none' | null (retour à l'automatique)
        if (!view || !WY.ROLES.includes(m.role)) return;
        const cur = Object.assign({}, state.maps[view.ckey]);
        if (m.key == null || m.key === 'auto') delete cur[m.role]; else if (typeof m.key === 'string' && m.key.length < 160) cur[m.role] = m.key;
        const maps = Object.assign({}, state.maps); if (Object.keys(cur).length) maps[view.ckey] = cur; else delete maps[view.ckey];
        const keys = Object.keys(maps); if (keys.length > 20) delete maps[keys[0]];
        state.maps = maps; changed(); return;
      }
      case 'hover': hot = { zone: Number.isInteger(m.zone) ? m.zone : null, period: Number.isInteger(m.period) ? m.period : null }; paintAll(); return;
      case 'bye': hot = {}; paintAll(); return;
      case 'diag': { list = WY.findCharts(); const d = WY.pickData(list, state.dataIdx, state.maps, state.dataKey); return post({ type: 'diag', data: WY.diagnose(list, d ? d.i : null, state.maps) }); }
    }
  }
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.__wyp !== 1 || d.dir !== 'to-page') return;
    try { handle(d.msg); } catch (err) { console.warn('[Yield WeYield] action ignorée', err); }
  });

  // ---------- synchro avec la SPA (les graphiques sont recréés après « Appliquer », en navigant…) ----------
  let warned = false;
  setInterval(() => {
    try {
      const cur = WY.findCharts();
      const data = WY.pickData(cur, state.dataIdx, state.maps, state.dataKey);
      if (!data) { if (!sentNoChart) { sentNoChart = true; unpaint(painted); painted = []; view = null; snapshot(); } return; }
      list = cur;
      const wiped = drawnCount > 0 && list.some(c => !WY.hasOverlay(c.chart));
      if (wiped || signature(data) !== drawnSig) refresh();
    } catch (e) {
      if (!warned) { warned = true; console.warn('[Yield WeYield] erreur, nouvel essai à la prochaine seconde', e); }
    }
  }, 1000);
})();
