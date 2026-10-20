// Accès aux graphiques Highcharts de WeYield : lecture des séries (par rôle) et dessin de l'overlay.
// Dispositions observées sur le vrai WeYield le 20/10/2026 : voir docs/weyield-layout.md.
// Tourne dans le monde MAIN pour atteindre l'instance via __ngContext__ d'Angular.
(function (root) {
  const WY = root.__WYP;
  const { D, utcDay } = WY;
  const SIGNAL_STYLE = { raise: { rgb: '23,112,63', glyph: '▲' }, lower: { rgb: '194,65,12', glyph: '▼' }, hold: { rgb: '102,119,137', glyph: '●' }, review: { rgb: '109,74,168', glyph: '?' } };
  const PID = 'wyp'; // préfixe d'id de tout ce que l'extension dessine (pour pouvoir le retirer proprement)

  // ---------- accès aux graphiques ----------
  // Highcharts ≤ 12 : series.xData / yData ; versions récentes : series.getColumn('x' | 'y').
  const X = s => s.xData || (s.getColumn && s.getColumn('x')) || [];
  const Y = s => s.yData || (s.getColumn && s.getColumn('y')) || [];

  function findChart(host) {
    let chart = null; const seen = new Set();
    (function scan(o, d) {
      if (!o || typeof o !== 'object' || seen.has(o) || d > 4 || chart) return;
      seen.add(o);
      if (o.renderer && o.xAxis && o.series && o.container) { chart = o; return; }
      for (const k in o) { try { scan(o[k], d + 1); } catch (e) {} if (chart) return; }
    })(host.__ngContext__, 0);
    return chart;
  }
  // La page porte plusieurs graphiques (bookings/* : un seul ; new-bookings/* : l'évolution du stock, puis le rythme 2026 vs 2025) : on les liste tous.
  // Titre : en-tête VISIBLE voisin du graphique. Les <h3> « Données en cours de chargement… » restent dans le DOM, masqués
  // (visibility:hidden), plus proches du graphique que le vrai titre : on les écarte. Le contenu du graphique commence par les mois de l'axe.
  const shown = el => { const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none' && el.getClientRects().length > 0; };
  function headingText(sib) {
    const hs = /^H[1-4]$/.test(sib.tagName) ? [sib] : (sib.querySelectorAll ? [...sib.querySelectorAll('h1,h2,h3,h4')] : []);
    for (const h of hs) {
      const t = (h.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && shown(h) && !/chargement|loading/i.test(t)) return t;
    }
    return '';
  }
  const AXIS_LABEL = /^(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\S*\s+\d{4}$/i;
  function titleOf(host) {
    for (let el = host, up = 0; el && up < 5; el = el.parentElement, up++) {
      for (let sib = el.previousElementSibling, hop = 0; sib && hop < 6; sib = sib.previousElementSibling, hop++) {
        const t = headingText(sib);
        if (t) return t.slice(0, 70);
      }
    }
    const first = ((host.innerText || '').split('\n').map(t => t.trim()).filter(Boolean)[0] || '').slice(0, 70);
    return first && !AXIS_LABEL.test(first) ? first : 'Graphique';
  }
  let seq = 0;
  function findCharts() {
    const out = [];
    document.querySelectorAll('app-chart').forEach(host => {
      const chart = findChart(host);
      if (!chart || !chart.xAxis || !chart.xAxis[0] || chart.xAxis[0].options.type !== 'datetime') return;
      if (!chart.__wypId) chart.__wypId = ++seq;
      out.push({ i: out.length, host, chart, title: titleOf(host) });
    });
    return out;
  }

  // ---------- rôles des séries ----------
  // Un graphique utile porte : un volume et un prix (RPJ) pour N, pour N-1 (même date) et éventuellement N-1 final.
  // Noms OBSERVÉS (docs/weyield-layout.md) : bookings/* → current, lastyear, lastyearFinal, currentRpd, lastyearRpd, lastyearFinalRpd ;
  // new-bookings/* (graphique du rythme) → thisyear, lastyear (pointillé), revenue, ly_revenue (pointillé).
  // Les libellés d'info-bulle (« OnRent net », « Revenu par jour ») ne sont PAS des noms de séries. Les séries anonymes « Series N »
  // et les flottes (fleet, availableFleet, lastYear…Fleet) ne sont jamais des rôles.
  // Détection automatique par nom / identifiant / pointillé, avec réglage manuel mémorisé par disposition de graphique.
  const { ROLES } = WY;
  const RE = {
    price: /rpd|revenu par jour|revenue per day|revenu\/j|^(ly_)?revenue$/i,
    vol: /onrent|on rent|^current$|^(this|last)year(final)?$|réservations?|reservations?|jours? loués?/i,
    notVol: /flotte|fleet|avail|dispo|refer|total|capacit/i,
    final: /final/i,
    prev: /last ?year|n-?1|prev|précéd|comparé|^ly_/i,
  };
  // Clé stable d'une série : identifiant (sinon nom), suffixée « #2 » quand plusieurs séries se ressemblent.
  function describe(chart) {
    const seen = {};
    return chart.series.map((s, i) => {
      const id = String((s.options && s.options.id) || ''), name = String(s.name || '');
      const base = id || name || '#' + i;
      seen[base] = (seen[base] || 0) + 1;
      const ds = s.options && s.options.dashStyle;
      return { i, s, key: seen[base] > 1 ? `${base}#${seen[base]}` : base, name, id, dash: ds && !/^solid$/i.test(ds) ? String(ds) : '', n: X(s).length };
    });
  }
  const chartKey = chart => { const t = describe(chart).map(d => d.key).sort().join('|'); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function autoRoles(descs) {
    const out = {}, has = (re, d) => re.test(d.name) || re.test(d.id);
    const cls = d => {
      const kind = has(RE.price, d) ? 'Rpd' : (has(RE.vol, d) && !has(RE.notVol, d) ? 'Vol' : null);
      const prev = has(RE.prev, d);
      return { kind, year: prev && has(RE.final, d) ? 'lyf' : prev ? 'ly' : 'cur' };
    };
    const byKind = { Rpd: [], Vol: [] };
    descs.filter(d => d.n > 0).forEach(d => { const c = cls(d); if (c.kind) byKind[c.kind].push(Object.assign({ d }, c)); });
    ['Rpd', 'Vol'].forEach(kind => {
      const list = byKind[kind], pick = year => { const m = list.find(x => x.year === year); return m && m.d.key; };
      let cur = pick('cur'), ly = pick('ly'), lyf = pick('lyf');
      // Deux séries au même nom (« OnRent net » pour N et N-1) : la pointillée est N-1, sinon la seconde.
      const twins = list.filter(x => x.year === 'cur');
      if (twins.length > 1) {
        const dashed = twins.find(x => x.d.dash), plain = twins.find(x => !x.d.dash);
        cur = (plain || twins[0]).d.key;
        if (!ly) ly = (dashed && dashed.d.key !== cur ? dashed : twins.find(x => x.d.key !== cur)).d.key;
      }
      Object.assign(out, { ['cur' + kind]: cur, ['ly' + kind]: ly, ['lyf' + kind]: lyf });
    });
    ROLES.forEach(r => { if (!out[r]) out[r] = null; });
    return out;
  }
  // map : surcharges manuelles { rôle : clé de série | 'none' } ; sinon rôle automatique.
  // Une série ne peut pas servir deux rôles : une surcharge qui en crée un conflit est écartée (retour à l'automatique) et signalée
  // dans `invalid`. On répète jusqu'à stabilité : revenir sur un rôle peut en créer un autre (ex. lyfVol → ly_revenue une fois lyRpd rétabli).
  function resolveRoles(descs, map) {
    const auto = autoRoles(descs), roles = {}, invalid = [];
    ROLES.forEach(r => { const m = map && map[r]; roles[r] = m === 'none' ? null : m && descs.some(d => d.key === m) ? m : auto[r]; });
    for (let again = true, guard = 0; again && guard < ROLES.length; guard++) {
      again = false; const users = {};
      ROLES.forEach(r => { if (roles[r]) (users[roles[r]] = users[roles[r]] || []).push(r); });
      Object.keys(users).forEach(k => { if (users[k].length > 1) users[k].forEach(r => {
        if (roles[r] !== auto[r]) { roles[r] = auto[r]; if (!invalid.includes(r)) invalid.push(r); again = true; }
      }); });
    }
    return { auto, roles, invalid };
  }
  const roleScore = (chart, map) => { const r = resolveRoles(describe(chart), map).roles; return (r.curRpd ? 4 : 0) + (r.curVol ? 2 : 0) + (r.lyRpd ? 1 : 0) + (r.lyVol ? 1 : 0) + (r.lyfRpd ? 0.5 : 0); };
  // Graphique dont on lit les séries : celui qui a le plus de rôles reconnus (il faut au moins un RPJ N), sinon le premier.
  // Un choix manuel (forced) n'est honoré que s'il a été fait sur CE graphique (dataKey = chartKey au moment du choix) : sans cela,
  // l'index choisi sur une page s'appliquait silencieusement à une autre disposition.
  function pickData(list, forced, maps, dataKey) {
    if (forced != null && list[forced] && dataKey && chartKey(list[forced].chart) === dataKey) return list[forced];
    let best = null, bs = 3;
    list.forEach(c => { const sc = roleScore(c.chart, maps && maps[chartKey(c.chart)]); if (sc > bs) { best = c; bs = sc; } });
    return best || list[0] || null;
  }

  // ---------- séries ----------
  function mapOf(s) {
    const ys = Y(s), m = new Map(); X(s).forEach((x, i) => { const y = ys[i]; m.set(utcDay(x), Array.isArray(y) ? y[0] : y); });
    return m;
  }
  // « rythme » (new-bookings/* : réservations nettes captées sur la fenêtre choisie) ou « portefeuille » (bookings/* : OnRent acquis).
  // Test sur la série, pas sur l'adresse : le premier graphique des mêmes pages est un stock (`current`) et reste « portefeuille ».
  const PACE_RE = /net|depuis|derniers|pickup|since|captur|^thisyear$/i;

  // Fenêtre « N derniers jours » de new-bookings/* : les boutons radio sont hors du composant du graphique.
  function windowDays() {
    const r = document.querySelector('[role="radiogroup"] input[type="radio"]:checked');
    const n = r ? parseInt(r.value, 10) : NaN;
    return n > 0 ? n : null;
  }
  // Menu « Avancé (…) » de bookings/* : « Revenu par jour » ou « RevCar » ; absent sur new-bookings/*.
  function metricLabel() {
    for (const a of document.querySelectorAll('a.dropdown-toggle')) {
      const m = /^Avancé \((.+)\)$/.exec((a.textContent || '').trim().replace(/\s+/g, ' '));
      if (m) return m[1];
    }
    return null;
  }
  // En mode RevCar on ignore ce que contiennent les séries (non observé) : pas de RPJ affiché plutôt qu'un RPJ faux.
  const rpdTrusted = () => { const m = metricLabel(); return m == null || /revenu par jour/i.test(m); };

  function readSeries(chart, map) {
    const descs = describe(chart), { auto, roles, invalid } = resolveRoles(descs, map);
    const byKey = {}; descs.forEach(d => { byKey[d.key] = d; });
    const get = r => (roles[r] && byKey[roles[r]] ? mapOf(byKey[roles[r]].s) : null);
    const pair = (v, p) => { const rpd = get(p); return rpd ? { vol: get(v), rpd } : null; };
    const first = descs.find(d => d.n > 0);
    const fx = first && X(first.s);
    const range = first ? [utcDay(fx[0]), utcDay(fx[fx.length - 1])] : [chart.xAxis[0].min, chart.xAxis[0].max];
    const cv = roles.curVol && byKey[roles.curVol];
    const kind = cv && (PACE_RE.test(cv.name) || PACE_RE.test(cv.id)) ? 'pace' : 'book';
    const trusted = rpdTrusted();
    return { cur: trusted ? pair('curVol', 'curRpd') : null, ly: trusted ? pair('lyVol', 'lyRpd') : null, lyf: trusted ? pair('lyfVol', 'lyfRpd') : null,
      range, roles, auto, invalid, kind, windowDays: kind === 'pace' ? windowDays() : null, metric: metricLabel(), metricBlocked: !trusted,
      series: descs.map(d => ({ key: d.key, label: `${d.name || d.id}${d.id && d.name && d.id !== d.name ? ` (${d.id})` : ''}${d.dash ? ' · pointillé' : ''}`, n: d.n })) };
  }

  // Diagnostic copiable : tous les graphiques, leurs séries et un échantillon de valeurs (pour recaler les noms de séries).
  // Clés historiques conservées ; ajouts : hote, parent, fenetre_jours, metrique, roles_invalides, et par série nan / inf_plus / inf_moins.
  function diagnose(list, picked, maps) {
    const iso = t => (typeof t === 'number' && isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null);
    const nonFinite = y => { let nan = 0, pos = 0, neg = 0; y.forEach(v => { const x = Array.isArray(v) ? v[0] : v; if (typeof x !== 'number') return; if (Number.isNaN(x)) nan++; else if (x === Infinity) pos++; else if (x === -Infinity) neg++; }); return { nan, inf_plus: pos, inf_moins: neg }; };
    const tag = el => (el && el.tagName ? String(el.tagName).toLowerCase() : null);
    return { page: location.pathname, le: new Date().toISOString(), graphique_lu: picked, graphiques: list.map(c => ({
      i: c.i, titre: c.title, hote: tag(c.host), parent: tag(c.host && c.host.parentElement), fenetre_jours: windowDays(), metrique: metricLabel(),
      roles: resolveRoles(describe(c.chart), null).auto, roles_invalides: resolveRoles(describe(c.chart), maps && maps[chartKey(c.chart)]).invalid,
      axeX: { min: iso(c.chart.xAxis[0].min), max: iso(c.chart.xAxis[0].max) },
      axesY: c.chart.yAxis.map(a => ({ titre: a.options.title && a.options.title.text, min: a.min, max: a.max })),
      bandes: (c.chart.xAxis[0].options.plotBands || []).filter(b => !String(b.id || '').startsWith(PID)).map(b => ({ id: b.id, du: iso(b.from), au: iso(b.to) })),
      series: c.chart.series.map(s => { const x = X(s), y = Y(s), m = Math.floor(y.length / 2); return Object.assign({ nom: s.name, id: s.options && s.options.id, type: s.type, visible: s.visible, axeY: s.yAxis && s.yAxis.options.index,
        n: x.length, du: iso(x[0]), au: iso(x[x.length - 1]), debut: y.slice(0, 5), milieu: y.slice(m, m + 5) }, nonFinite(y)); }) })) };
  }

  // Jour de référence du graphique : fin de la bande native `past-band` de WeYield (de 1970 à la date de référence), sinon la première
  // bande qui n'est pas la nôtre, sinon aujourd'hui.
  function chartRefDay(chart) {
    const bands = chart.xAxis[0].options.plotBands || [];
    const pb = bands.find(b => b.id === 'past-band') || bands.find(b => !String(b.id || '').startsWith(PID));
    return pb && pb.to > 0 ? utcDay(pb.to) : utcDay(Date.now());
  }

  // Empreinte de toutes les séries (prix ET volumes : le rythme en dépend) : détecte l'arrivée tardive ou le changement des données N / N-1.
  function dataSignature(chart) {
    return chart.series.filter(s => Y(s).length)
      .map(s => s.name + ':' + Y(s).length + ':' + Y(s).reduce((a, y) => a + (+(Array.isArray(y) ? y[0] : y) || 0), 0).toFixed(2)).join(',')
      + '|' + chart.xAxis[0].min + '|' + chart.xAxis[0].max + '|w' + windowDays() + '|m' + metricLabel();
  }

  // ---------- overlay ----------
  const ours = b => String(b.id || '').startsWith(PID);
  // Highcharts ≤ 12 expose axis.plotLinesAndBands ; les versions récentes séparent plotBands et plotLines.
  const overlayItems = ax => (ax.plotLinesAndBands || [...(ax.plotBands || []), ...(ax.plotLines || [])]).filter(ours);
  const hasOverlay = chart => overlayItems(chart.xAxis[0]).length > 0;
  function clearOverlay(chart) {
    if (!chart) return;
    const ax = chart.xAxis[0];
    overlayItems(ax).map(b => b.id).forEach(id => { ax.removePlotBand(id); ax.removePlotLine(id); });
  }

  // plan : { showPeriods, showTiers, periods:[{k,num,from,to,label}], selK, j0, zones:[{label,from,to,ci}], hot:{zone,period} }
  // Rangées de libellés en haut : périodes (y=12), puis paliers décalés sur 3 rangées ; « J0 » en bas.
  // hot = élément survolé dans le panneau : il ressort, le reste s'estompe.
  function paint(chart, plan) {
    clearOverlay(chart);
    const ax = chart.xAxis[0];
    const hot = plan.hot || {}, dy = plan.labelDy || 0;   // dy : WeYield dessine des « ? » dans les ~12 premiers px des graphiques new-bookings/*
    const sigOf = {}; (plan.signals || []).forEach(g => { if (SIGNAL_STYLE[g.kind] && g.kind !== 'hold') sigOf[g.k] = SIGNAL_STYLE[g.kind]; });
    let n = 0;
    if (plan.showPeriods) {
      plan.periods.forEach(p => {
        const sel = p.k === plan.selK, on = hot.period === p.k;
        const x0 = p.from - 0.5 * D, x1 = p.to + 0.5 * D;
        const band = { id: `${PID}-pb${p.k}`, from: x0, to: x1, zIndex: 1,
          color: on ? 'rgba(61,90,128,.20)' : sel ? 'rgba(36,52,71,.09)' : (p.num % 2 ? 'rgba(90,110,133,.05)' : 'rgba(0,0,0,0)') };
        const sg = sigOf[p.k];
        if (p.num >= 1) band.label = { text: sg ? `${p.label} <span style="color:rgb(${sg.rgb});font-size:13px">${sg.glyph}</span>` : p.label, useHTML: !!sg, align: 'center', verticalAlign: 'top', y: 12 + dy,
          style: { color: sel || on ? '#243447' : '#5f6f82', fontSize: '11px', fontWeight: sel || on ? '800' : '600', whiteSpace: 'nowrap' } };
        ax.addPlotBand(band); n++;
        ax.addPlotLine({ id: `${PID}-pl${p.k}`, value: x0, color: sel ? '#243447' : '#9aa7b6', width: sel ? 2 : 1, dashStyle: sel ? 'Solid' : 'ShortDash', zIndex: 3 });
        if (sel) ax.addPlotLine({ id: `${PID}-pe${p.k}`, value: x1, color: '#243447', width: 2, zIndex: 3 });
      });
    }
    // Bande de signaux : seules les exceptions s'affichent (« tenir » = silence). Teinte de la période (opacité = confiance) ;
    // le pictogramme se loge dans l'étiquette de période, ou seul en haut si le calque Périodes est masqué.
    (plan.signals || []).forEach(g => {
      const p = plan.periods.find(x => x.k === g.k), st = SIGNAL_STYLE[g.kind];
      if (!p || !st || g.kind === 'hold') return;
      const band = { id: `${PID}-s${g.k}`, from: p.from - 0.5 * D, to: p.to + 0.5 * D, zIndex: 0, color: `rgba(${st.rgb},${(0.06 + 0.14 * g.alpha).toFixed(3)})` };
      if (!plan.showPeriods) band.label = { text: st.glyph, align: 'center', verticalAlign: 'top', y: 13 + dy, style: { color: `rgb(${st.rgb})`, fontSize: '14px', fontWeight: 'bold', textOverflow: 'none' } };
      ax.addPlotBand(band); n++;
    });
    if (plan.showTiers && plan.j0 != null) {
      const dim = hot.zone != null;
      plan.zones.forEach((z, i) => {
        const c = WY.PALETTE[z.ci % WY.PALETTE.length], on = hot.zone === i;
        ax.addPlotBand({ id: `${PID}-t${i}`, from: z.from - 0.5 * D, to: z.to + 0.5 * D, zIndex: 1,
          color: `rgba(${c},${on ? .34 : dim ? .06 : .14})`, borderColor: `rgb(${c})`, borderWidth: on ? 2 : 1,
          label: { text: z.label, align: 'center', verticalAlign: 'top', y: 26 + (i % 3) * 13 + dy,
            style: { color: `rgb(${c})`, fontSize: on ? '12px' : '10px', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'none' } } });
        n++;
      });
      ax.addPlotBand({ id: `${PID}-j0`, from: plan.j0 - 0.5 * D, to: plan.j0 + 0.5 * D, zIndex: 1,
        color: 'rgba(0,0,0,.06)', borderColor: '#333', borderWidth: 1,
        label: { text: 'J0', align: 'center', verticalAlign: 'bottom', y: -4, style: { fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap' } } });
      n++;
    }
    return n;
  }

  // Clic dans la zone de tracé → jour cliqué (sélection de la période). Ignoré si c'est un glisser (zoom).
  function bindPick(chart, onPick) {
    chart.__wyOnPick = onPick;
    if (chart.__wyPickBound) return;
    chart.__wyPickBound = true;
    let down = null;
    chart.container.addEventListener('mousedown', e => { down = [e.clientX, e.clientY]; });
    chart.container.addEventListener('click', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      try {
        const ev = chart.pointer.normalize(e);
        if (!chart.isInsidePlot(ev.chartX - chart.plotLeft, ev.chartY - chart.plotTop)) return;
        const c = chart.pointer.getCoordinates(ev);
        const t = c && c.xAxis && c.xAxis[0] && c.xAxis[0].value;
        if (typeof t === 'number' && chart.__wyOnPick) chart.__wyOnPick(utcDay(t));
      } catch (err) { /* un clic ne doit jamais casser le graphique */ }
    });
  }

  Object.assign(WY, { findCharts, titleOf, pickData, roleScore, chartKey, describe, autoRoles, resolveRoles, windowDays, metricLabel, rpdTrusted, diagnose, readSeries, chartRefDay, dataSignature, hasOverlay, clearOverlay, paint, bindPick });
})(typeof window !== 'undefined' ? window : globalThis);
