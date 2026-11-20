// Balance de flotte Rentway : lecture du PivotGrid DevExtreme (app Vue 2) et calques Périodes / Paliers posés sur le tableau.
// Structure observée sur le vrai Rentway le 20/11/2026 : voir docs/rentway-layout.md.
// Tourne dans le monde MAIN : l'instance DevExtreme n'est accessible que par el.__vue__.instance.
// Même interface que l'adaptateur WeYield (chart.js), exposée dans WY.src : le moteur (engine.js) ne sait pas sur quel site il tourne.
(function (root) {
  const WY = root.__WYP;
  const LAYER = 'wyp-layer';   // classe de tout ce que l'extension ajoute au tableau (retrait propre)
  let seq = 0;

  // ---------- accès au tableau ----------
  const instOf = el => { const v = el && el.__vue__, i = v && v.instance; return i && typeof i.getDataSource === 'function' && typeof i.option === 'function' ? i : null; };
  const ctlOf = el => { const c = el && el.closest && el.closest('.component'); return (c && c.__vue__) || null; };
  // Enregistrements bruts : la source du PivotGrid ({ fields, store: [...] }), sinon le résultat gardé par le composant Rentway (fbResult).
  function records(el) {
    const i = instOf(el); if (!i) return null;
    let ds = null; try { ds = i.option('dataSource'); } catch (e) {}
    let arr = ds && (Array.isArray(ds.store) ? ds.store : Array.isArray(ds) ? ds : null);
    if (!arr) { const c = ctlOf(el), fb = c && c.fbResult; if (fb && Array.isArray(fb.store)) arr = fb.store; }
    return arr && arr.length && arr[0] && 'availableVehicles' in arr[0] ? arr : null;
  }
  // contentReady : DevExtreme a reconstruit le tableau (nouvelle recherche, filtre…) → positions à recalculer (cf. dataSignature).
  function watch(el) {
    if (el.__wypWatched) return;
    const i = instOf(el); if (!i || typeof i.on !== 'function') return;
    el.__wypWatched = true; el.__wypRenders = 0;
    i.on('contentReady', () => { el.__wypRenders++; });
  }
  // « chart » = l'élément racine du PivotGrid : stable tant que la page Balance de flotte reste ouverte (l'URL ne change jamais).
  function findCharts() {
    const out = [];
    document.querySelectorAll('.dx-pivotgrid').forEach(el => {
      if (!records(el)) return;
      if (!el.__wypId) el.__wypId = ++seq;
      watch(el);
      out.push({ i: out.length, host: el, chart: el, title: 'Balance de flotte' });
    });
    return out;
  }
  const pickData = list => list.reduce((best, c) => (!best || (records(c.chart) || []).length > (records(best.chart) || []).length ? c : best), null);
  const chartKey = () => 'rentway-fleet';
  const roleScore = () => 0;
  // Pas de date de référence dans la balance : aujourd'hui, en date locale (Rentway et les dates du tableau sont en heure locale).
  const chartRefDay = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); };

  function filtersOf(el) {
    const c = ctlOf(el); if (!c) return null;
    const ids = a => (Array.isArray(a) ? a.map(x => x && x.id).filter(Boolean) : []);
    return { du: c.startDate, au: c.endDate, vue: c.btnStationZoneCountry, lignes: c.btnGroupsSegments, stations: ids(c.selectedStations), types: ids(c.selectedFleetTypes), groupes: ids(c.selectedGroups).length };
  }

  // ---------- lecture ----------
  const EMPTY_F = { all: new Map(), cats: new Map(), order: [], catField: null, locField: null, locs: 0, n: 0, bad: 0 };
  function readSeries(el) {
    const F = WY.fleetFromRecords(records(el)) || Object.assign({}, EMPTY_F, { range: [chartRefDay(), chartRefDay()] });
    return Object.assign(F, { kind: 'fleet', cur: null, ly: null, lyf: null, roles: {}, auto: {}, invalid: [], series: [], windowDays: null, metric: null, metricBlocked: false,
      extra: { fleet: { catField: F.catField, locs: F.locs, n: F.n, cats: F.order.length, bad: F.bad, from: F.n ? F.range[0] : null, to: F.n ? F.range[1] : null } } });
  }
  // Empreinte : données (nombre, somme, bornes), nombre de rendus DevExtreme et largeur du tableau (redimensionnement).
  function dataSignature(el) {
    const r = records(el) || []; let s = 0;
    for (const x of r) s += (+x.availableVehicles || 0) + (+x.totalVehicles || 0) / 1000;
    const hc = content(el, 'column');
    return [r.length, s.toFixed(3), r[0] && r[0].date, r.length && r[r.length - 1].date, el.__wypRenders || 0, hc ? hc.scrollWidth + 'x' + hc.offsetHeight : '-', el.offsetWidth].join('|');
  }

  // ---------- géométrie ----------
  const content = (el, area) => el.querySelector(`.dx-area-${area}-cell .dx-scrollable-content`);
  // Jours des colonnes, dans l'ordre des <td> d'en-tête : feuilles de l'arbre des colonnes (pas de total de colonne chez Rentway).
  // Les valeurs sont des Date à minuit LOCAL → jour UTC construit sur les champs locaux.
  function columnDays(el) {
    const i = instOf(el); let cols = [];
    try { cols = i.getDataSource().getData().columns || []; } catch (e) {}
    const out = [];
    (function walk(list) { list.forEach(c => { if (c.children && c.children.length) walk(c.children); else out.push(c.value instanceof Date ? Date.UTC(c.value.getFullYear(), c.value.getMonth(), c.value.getDate()) : NaN); }); })(cols);
    return out;
  }
  // Positions mesurées (les colonnes n'ont pas toutes la même largeur : 41 à 48 px observés), relatives au contenu défilant.
  function cellsX(contentEl, cells) {
    const base = contentEl.getBoundingClientRect().left;
    return cells.map(td => { const r = td.getBoundingClientRect(); return [r.left - base, r.width]; });
  }
  function geometry(el) {
    const hc = content(el, 'column'), dc = content(el, 'data');
    if (!hc || !dc) return null;
    const rows = hc.querySelectorAll('table tr'), tr = rows[rows.length - 1];
    if (!tr) return null;
    const tds = [...tr.cells], days = columnDays(el);
    if (!tds.length || tds.length !== days.length || days.some(d => !Number.isFinite(d))) return null;
    const hx = cellsX(hc, tds);
    if (!hx.some(x => x[1] > 0)) return null;   // tableau masqué : rien de mesurable
    const dRow = dc.querySelector('table tr');
    const dx = dRow && dRow.cells.length === tds.length ? cellsX(dc, [...dRow.cells]) : hx;
    // Haut de la zone libre de l'en-tête : sous le texte de la date (td : padding 7 px + 2 lignes de 18 px observés → ~46 px sur 86).
    let top = 0;
    try { const t0 = tds[0], tr0 = t0.getBoundingClientRect(), sp = t0.querySelector('span'), sr = sp && sp.getBoundingClientRect(); top = sr ? Math.ceil(sr.bottom - tr0.top) + 2 : 46; } catch (e) { top = 46; }
    const hh = hc.offsetHeight;
    top = Math.max(0, Math.min(top, hh - 40));
    return { hc, dc, tds, days, hx, dx, hh, dh: dc.offsetHeight, top };
  }
  // Colonnes couvertes par [from, to] (jours UTC) : { l, w } en px, ou null si la zone est hors du tableau.
  function span(g, xs, from, to) {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < g.days.length; i++) { if (g.days[i] >= from && g.days[i] <= to) { if (i0 < 0) i0 = i; i1 = i; } }
    if (i0 < 0) return null;
    return { l: xs[i0][0], w: xs[i1][0] + xs[i1][1] - xs[i0][0], startsHere: g.days[i0] === from, endsHere: g.days[i1] === to };
  }

  // ---------- calques ----------
  function layer(c, h) {
    if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
    const L = document.createElement('div');
    L.className = LAYER; L.setAttribute('aria-hidden', 'true');
    // pointer-events:none : les clics atteignent les cellules (le clic sur une valeur ouvre le détail Rentway).
    L.style.cssText = `position:absolute;left:0;top:0;width:${c.scrollWidth}px;height:${h}px;pointer-events:none;z-index:3;overflow:hidden`;
    c.appendChild(L);
    return L;
  }
  function box(L, css, text) {
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;box-sizing:border-box;' + css;
    if (text) b.textContent = text;
    L.appendChild(b);
    return b;
  }
  const LABEL = 'height:13px;line-height:13px;font:700 10px/13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;';
  const hasOverlay = el => !!(el && el.querySelector('.' + LAYER));
  function clearOverlay(el) { if (el) el.querySelectorAll('.' + LAYER).forEach(x => x.remove()); }

  // plan : { showPeriods, showTiers, periods:[{k,num,from,to,label}], selK, j0, zones:[{label,b,from,to,ci}], hot:{zone,period,cum} }
  // En-tête : sous le texte des dates, une rangée de périodes puis deux rangées de paliers (alternées). Tableau : séparateurs de
  // périodes, teinte de la période choisie, cadres des paliers. hot = élément survolé dans le panneau : il ressort, le reste s'estompe.
  function paint(el, plan) {
    clearOverlay(el);
    const g = geometry(el); if (!g) return 0;
    const hot = plan.hot || {};
    const H = layer(g.hc, g.hh), T = layer(g.dc, g.dh);
    const rowP = g.top, rowT = g.top + 14;
    let n = 0;
    if (plan.showPeriods) {
      plan.periods.forEach(p => {
        const hs = span(g, g.hx, p.from, p.to), ds = span(g, g.dx, p.from, p.to);
        if (!hs || !ds) return;
        const sel = p.k === plan.selK, on = hot.period === p.k;
        if (sel || on) box(T, `left:${ds.l}px;width:${ds.w}px;top:0;bottom:0;background:${on ? 'rgba(61,90,128,.20)' : 'rgba(36,52,71,.07)'}`);
        if (ds.startsHere) box(T, `left:${ds.l - (sel ? 1 : 0)}px;width:0;top:0;bottom:0;border-left:${sel ? '2px solid #243447' : '1px dashed rgba(36,52,71,.6)'}`);
        if (sel && ds.endsHere) box(T, `left:${ds.l + ds.w - 1}px;width:0;top:0;bottom:0;border-left:2px solid #243447`);
        if (p.num >= 1) box(H, `${LABEL}left:${hs.l}px;width:${hs.w}px;top:${rowP}px;border-left:1px solid #fff;`
          + (sel || on ? `background:${on ? '#3d5a80' : '#243447'};color:#fff;` : 'background:rgba(36,52,71,.12);color:#243447;'), p.label);
        n++;
      });
    }
    if (plan.showTiers && plan.j0 != null) {
      const dim = hot.zone != null, hz = dim ? plan.zones[hot.zone] : null;
      plan.zones.forEach((z, i) => {
        const hs = span(g, g.hx, z.from, z.to), ds = span(g, g.dx, z.from, z.to);
        if (!hs || !ds) return;
        const c = WY.PALETTE[z.ci % WY.PALETTE.length], on = hot.zone === i || !!(hot.cum && hz && z.b <= hz.b);
        box(T, `left:${ds.l}px;width:${ds.w}px;top:0;bottom:0;background:rgba(${c},${on ? .22 : dim ? 0 : .06});box-shadow:inset 0 0 0 ${on ? 3 : 2}px rgba(${c},${on ? 1 : dim ? .3 : .85})`);
        box(H, `${LABEL}left:${hs.l}px;width:${hs.w}px;top:${rowT + (i % 2) * 13}px;color:rgb(${c});background:rgba(${c},${on ? .32 : .14});border-left:1px solid #fff;`, z.label);
        n++;
      });
      const hs = span(g, g.hx, plan.j0, plan.j0), ds = span(g, g.dx, plan.j0, plan.j0);
      if (hs && ds) {
        box(T, `left:${ds.l}px;width:${ds.w}px;top:0;bottom:0;border-left:2px dashed #111;border-right:2px dashed #111`);
        box(H, `${LABEL}left:${hs.l}px;width:${hs.w}px;top:${rowT}px;background:#111;color:#fff;`, 'J0');
        n++;
      }
    }
    if (!n) clearOverlay(el);
    return n;
  }

  // Clic sur une date de l'en-tête → sélection de la période (les cellules de valeurs gardent leur clic Rentway : détail du jour).
  function bindPick(el, onPick) {
    el.__wyOnPick = onPick;
    if (el.__wyPickBound) return;
    el.__wyPickBound = true;
    el.addEventListener('click', e => {
      try {
        const td = e.target && e.target.closest && e.target.closest('td');
        if (!td || td.classList.contains('dx-area-column-cell') || !td.closest('.dx-area-column-cell')) return;
        const rows = td.closest('table').rows, tr = td.parentElement;
        if (tr !== rows[rows.length - 1]) return;
        const d = columnDays(el)[td.cellIndex];
        if (Number.isFinite(d) && el.__wyOnPick) el.__wyOnPick(d);
      } catch (err) { /* un clic ne doit jamais casser le tableau */ }
    });
  }

  // Diagnostic copiable : structure lue, sans données client (ni immatriculations, ni réservations).
  function diagnose(list, picked) {
    const iso = t => (Number.isFinite(t) ? WY.isoDay(t) : null);
    return { page: location.origin + location.pathname, le: new Date().toISOString(), source: 'rentway', grille_lue: picked, grilles: list.map(c => {
      const el = c.chart, r = records(el) || [], F = WY.fleetFromRecords(r), g = geometry(el);
      let cols = null; try { cols = instOf(el).getDataSource().getData().columns.length; } catch (e) {}
      return { i: c.i, id: el.id, enregistrements: r.length, champs: r[0] ? Object.keys(r[0]) : [], champ_categorie: F && F.catField, stations: F && F.locs,
        categories: F ? F.order : [], du: F && iso(F.range[0]), au: F && iso(F.range[1]), illisibles: F && F.bad, colonnes: cols, entetes: g ? g.tds.length : null,
        geometrie: !!g, haut_libre: g && g.top, rendus: el.__wypRenders || 0, filtres: filtersOf(el) };
    }) };
  }

  WY.src = { kind: 'fleet', findCharts, pickData, roleScore, chartKey, readSeries, chartRefDay, dataSignature, hasOverlay, clearOverlay, paint, bindPick, diagnose,
    zoneStats: WY.fleetZoneStats, cumZones: WY.fleetCumZones };
  Object.assign(WY, { rwRecords: records, rwGeometry: geometry, rwColumnDays: columnDays });
})(typeof window !== 'undefined' ? window : globalThis);
