// Moteur (monde MAIN, dans la page WeYield ou Rentway) : état, calcul du modèle, dessin.
// Aucune interface ici : le panneau latéral reçoit des instantanés (snapshot) et renvoie des actions,
// via relay.js (monde isolé) qui fait le pont avec chrome.runtime.
// Le site est vu à travers WY.src : graphiques Highcharts de WeYield (chart.js) ou balance de flotte Rentway (pivot.js).
(() => {
  const WY = window.__WYP;
  if (!WY || !WY.src || WY.started) return;
  WY.started = true;
  const SRC = WY.src;

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

  // Seules ces clés, avec ces bornes, peuvent être modifiées depuis le panneau (liste blanche dans core.js).
  const int = WY.clampInt, sanitize = WY.sanitizePatch;

  // Période choisie, repérée par son jour de début (et non par son numéro) : elle reste juste d'un site à l'autre même si la
  // « période en cours » n'y est pas calculée pareil (WeYield : date de référence ; Rentway : aujourd'hui). null = période en cours.
  let selDay = null;
  let hot = {};                // élément survolé dans le panneau : { zone, period }
  let model = null, view = null, plan = null;
  let signalItems = [];        // verdicts par période envoyés par le panneau : [{ k, kind, alpha }]
  let list = [], painted = [];  // graphiques de la page ; graphiques sur lesquels on a dessiné
  let drawnSig = '', drawnCount = 0, sentNoChart = false;

  // ---------- modèle ----------
  function compute(data) {
    const ckey = SRC.chartKey(data.chart);
    const S = SRC.readSeries(data.chart, state.maps[ckey]);
    const ref = SRC.chartRefDay(data.chart);
    const stats = (from, to) => SRC.zoneStats(S, from, to, state);
    const grid = WY.makeGrid(state, ref);
    const periods = grid.inRange(S.range[0], S.range[1]);
    const k = grid.indexAt(selDay != null ? selDay : ref);
    const selP = grid.at(k);
    const j0 = WY.j0Of(selP, state.offset);
    const zones = WY.tierZones(j0, state.tierList).map(z => Object.assign(z, stats(z.from, z.to)));
    return {
      // vue sérialisable envoyée au panneau (pas de fonctions) ; S.extra : champs propres à la source (balance de flotte)
      view: Object.assign({
        source: SRC.kind, selP, isAuto: selDay == null, j0, offset: state.offset, ref,
        grid: { auto: grid.auto, p1: grid.p1, len: grid.len },
        has: { rpd: !!S.cur, ly: !!S.ly, lyf: !!S.lyf }, kind: S.kind, windowDays: S.windowDays, metric: S.metric, metricBlocked: S.metricBlocked, invalid: S.invalid,
        charts: list.map(c => ({ i: c.i, title: c.title, score: SRC.roleScore(c.chart, state.maps[SRC.chartKey(c.chart)]) })), dataIdx: data.i, dataAuto: state.dataIdx == null,
        series: S.series, roles: S.roles, autoRoles: S.auto, mapped: state.maps[ckey] || {}, ckey,
        selStats: stats(selP.from, selP.to),
        zones,
        cumZones: SRC.cumZones(S, zones, state),
        periodRows: periods.map(p => Object.assign({ p }, stats(p.from, p.to))),
      }, S.extra || {}),
      plan: { showPeriods: state.periods, showTiers: state.tiers, periods, selK: selP.k, j0, zones },
      grid,
    };
  }
  const signature = data => [state.periods, state.tiers, JSON.stringify(state.tierList), state.gridDate, state.gridNum, state.gridLen, state.gridUnit, state.offset, state.dataIdx, JSON.stringify(state.maps), JSON.stringify(state.occTh), selDay,
    list.map(c => c.chart.__wypId).join(), SRC.dataSignature(data.chart)].join('|');

  // ---------- pont vers le panneau ----------
  const post = msg => window.postMessage({ __wyp: 1, dir: 'to-panel', msg }, location.origin);
  // Vers le relais (monde isolé) : réglages communs aux deux sites, enregistrés dans chrome.storage par le relais.
  const toRelay = msg => window.postMessage({ __wyp: 1, dir: 'to-relay', msg }, location.origin);
  const report = cfgChanged => toRelay({ type: 'report', site: SRC.kind, cfgChanged: !!cfgChanged, cfg: WY.pickShared(state), sel: { from: selDay, offset: state.offset } });
  const snapshot = () => post({ type: 'snapshot', state, view });

  // Les périodes et les paliers sont dessinés sur tous les graphiques de la page : ils partagent le même axe des dates.
  // Sur new-bookings/*, WeYield dessine des « ? » dans les premiers pixels du tracé : nos libellés descendent d'autant (valeur à confirmer à l'œil).
  const labelDy = c => (c.host && c.host.closest && c.host.closest('app-new-bookings-chart, app-new-bookings-variation-chart') ? 16 : 0);
  const paintAll = () => { painted = list.map(c => c.chart); drawnCount = plan ? list.reduce((n, c) => n + SRC.paint(c.chart, Object.assign({}, plan, { hot, signals: state.signals ? signalItems : [], labelDy: labelDy(c) })), 0) : 0; };
  function unpaint(charts) { charts.forEach(ch => { try { SRC.clearOverlay(ch); } catch (e) {} }); }

  function refresh() {
    list = SRC.findCharts();
    const data = SRC.pickData(list, state.dataIdx, state.maps, state.dataKey);
    unpaint(painted.filter(ch => !list.some(c => c.chart === ch)));
    drawnSig = '';
    if (!data) { painted = []; view = null; plan = null; snapshot(); return; }
    const m = compute(data);
    view = m.view; plan = m.plan; model = m;
    paintAll();
    list.forEach(c => SRC.bindPick(c.chart, day => { if (!state.periods) return; selDay = model.grid.at(model.grid.indexAt(day)).from; refresh(); report(false); }));
    drawnSig = signature(data);
    sentNoChart = false;
    snapshot();
  }
  // Changement fait ici (panneau, clic) : enregistré, redessiné, puis signalé au relais pour l'autre site.
  const sharedSig = () => JSON.stringify(WY.pickShared(state));
  const changed = before => { save(); refresh(); report(before != null && before !== sharedSig()); };
  // Changement venu de l'autre site (via le relais) : appliqué sans être renvoyé (pas de boucle).
  function applyShared(m) {
    const sh = WY.cleanShared(m.shared);
    let dirty = false, gridMoved = false;
    if (sh.cfg) WY.SHARED_KEYS.forEach(k => {
      if (JSON.stringify(state[k]) === JSON.stringify(sh.cfg[k])) return;
      state[k] = sh.cfg[k]; dirty = true; if (k !== 'tierList') gridMoved = true;
    });
    if (m.withSel && sh.sync && sh.sel) {
      if (sh.sel.from !== selDay) { selDay = sh.sel.from; dirty = true; }
      if (sh.sel.offset !== state.offset) { state.offset = sh.sel.offset; dirty = true; }
    } else if (gridMoved) selDay = null;   // même règle qu'un réglage local de la grille : retour à la période en cours
    if (dirty) { save(); refresh(); }
  }

  // ---------- actions venant du panneau ----------
  function handle(m) {
    switch (m && m.op) {
      case 'hello': return snapshot();
      case 'signals': signalItems = (Array.isArray(m.items) ? m.items : []).slice(0, 400).filter(i => i && Number.isInteger(i.k) && ['raise', 'lower', 'hold', 'review'].includes(i.kind))
        .map(i => ({ k: i.k, kind: i.kind, alpha: Math.min(1, Math.max(0, +i.alpha || 0)) })); paintAll(); return;
      case 'shared': return applyShared(m);
      case 'toggle': if (m.name === 'periods' || m.name === 'tiers' || m.name === 'signals') { state[m.name] = !state[m.name]; changed(); } return;
      case 'step': if (view && model) { selDay = model.grid.at(view.selP.k + (m.d > 0 ? 1 : -1)).from; changed(); } return;
      case 'auto': selDay = null; changed(); return;
      case 'select': if (model) { selDay = model.grid.at(int(m.k, -2000, 2000, 0)).from; changed(); } return;
      case 'config': {
        const patch = sanitize(m.patch || {}), before = sharedSig();
        Object.assign(state, patch);
        if ('dataIdx' in patch) state.dataKey = patch.dataIdx != null && list[patch.dataIdx] ? SRC.chartKey(list[patch.dataIdx].chart) : null;
        if (['gridDate', 'gridNum', 'gridLen', 'gridUnit'].some(k => k in patch)) selDay = null;
        changed(before); return;
      }
      case 'map': {   // rôle d'une série : { role, key } ; key = clé de série | 'none' | null (retour à l'automatique)
        if (!view || !WY.ROLES.includes(m.role)) return;
        const cur = Object.assign({}, state.maps[view.ckey]);
        if (m.key == null || m.key === 'auto') delete cur[m.role]; else if (typeof m.key === 'string' && m.key.length < 160) cur[m.role] = m.key;
        const maps = Object.assign({}, state.maps); if (Object.keys(cur).length) maps[view.ckey] = cur; else delete maps[view.ckey];
        const keys = Object.keys(maps); if (keys.length > 20) delete maps[keys[0]];
        state.maps = maps; changed(); return;
      }
      case 'hover': hot = { zone: Number.isInteger(m.zone) ? m.zone : null, period: Number.isInteger(m.period) ? m.period : null, cum: m.cum === true }; paintAll(); return;
      case 'bye': hot = {}; paintAll(); return;
      case 'diag': { list = SRC.findCharts(); const d = SRC.pickData(list, state.dataIdx, state.maps, state.dataKey); return post({ type: 'diag', data: SRC.diagnose(list, d ? d.i : null, state.maps) }); }
    }
  }
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.__wyp !== 1 || d.dir !== 'to-page') return;
    try { handle(d.msg); } catch (err) { console.warn('[Yield] action ignorée', err); }
  });
  // Au démarrage : le relais répond avec les réglages communs (ou les amorce avec ceux de cette page s'il n'y en a pas encore).
  toRelay({ type: 'ready', site: SRC.kind, cfg: WY.pickShared(state), sel: { from: null, offset: state.offset } });

  // ---------- synchro avec la SPA (graphiques recréés après « Appliquer » ; tableau Rentway reconstruit à chaque recherche) ----------
  let warned = false;
  setInterval(() => {
    try {
      const cur = SRC.findCharts();
      const data = SRC.pickData(cur, state.dataIdx, state.maps, state.dataKey);
      if (!data) { if (!sentNoChart) { sentNoChart = true; unpaint(painted); painted = []; view = null; snapshot(); } return; }
      list = cur;
      const wiped = drawnCount > 0 && list.some(c => !SRC.hasOverlay(c.chart));
      if (wiped || signature(data) !== drawnSig) refresh();
    } catch (e) {
      if (!warned) { warned = true; console.warn('[Yield] erreur, nouvel essai à la prochaine seconde', e); }
    }
  }, 1000);
})();
