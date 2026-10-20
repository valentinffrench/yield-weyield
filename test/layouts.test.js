// Dispositions RÉELLES de WeYield (observées le 20/10/2026, cf. docs/weyield-layout.md) : rôles, nature, valeurs non finies, réglages.
// Lancer :  node --test test/layouts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/weyield-layouts.js');

// DOM minimal, remplaçable test par test (chart.js ne touche à document que lorsqu'on appelle ses fonctions)
let DOC = {};
globalThis.window = globalThis;
globalThis.document = { querySelector: s => (DOC.querySelector ? DOC.querySelector(s) : null), querySelectorAll: s => (DOC.querySelectorAll ? DOC.querySelectorAll(s) : []) };
globalThis.getComputedStyle = el => ({ visibility: el._hidden ? 'hidden' : 'visible', display: 'block' });
globalThis.location = { pathname: '/fr/app/test/operation/new-bookings/1-day' };
require('../src/core.js');
require('../src/chart.js');
const WY = globalThis.__WYP, ms = WY.D;
const day = iso => WY.parseISO(iso);
const rolesOf = (c, map) => WY.readSeries(c, map);
const NULLS = { curVol: null, lyVol: null, lyfVol: null, curRpd: null, lyRpd: null, lyfRpd: null };

test('T1 · bookings/lastyear : rôles exacts, helpers et flottes ignorés', () => {
  assert.deepEqual(WY.autoRoles(WY.describe(F.bookingsLastyear())), Object.assign({}, NULLS, { curVol: 'current', lyVol: 'lastyear', curRpd: 'currentRpd', lyRpd: 'lastyearRpd' }));
});

test('T2 · bookings/final : `lastyear` sans point ignoré ; N-1 final seul', () => {
  const c = F.bookingsFinal();
  assert.equal(c.series.find(s => s.name === 'lastyear').xData.length, 0);
  assert.deepEqual(WY.autoRoles(WY.describe(c)), Object.assign({}, NULLS, { curVol: 'current', curRpd: 'currentRpd', lyfVol: 'lastyearFinal', lyfRpd: 'lastyearFinalRpd' }));
});

test('T3 · new-bookings : second graphique = thisyear / lastyear / revenue / ly_revenue ; premier = current seul', () => {
  assert.deepEqual(WY.autoRoles(WY.describe(F.newBookingsSecond())), Object.assign({}, NULLS, { curVol: 'thisyear', lyVol: 'lastyear', curRpd: 'revenue', lyRpd: 'ly_revenue' }));
  for (const route of ['1-day', '7-days', '30-days']) {
    assert.deepEqual(WY.autoRoles(WY.describe(F.newBookingsFirst(route))), Object.assign({}, NULLS, { curVol: 'current' }), route);
  }
});

test('T3b · les séries `delta`, `fleet`, `availableFleet` et « Series N » ne servent jamais de rôle ; clés delta, delta#2…', () => {
  const first = F.newBookingsFirst('1-day');
  assert.equal(first.series.length, 25);
  const keys = WY.describe(first).map(d => d.key);
  assert.ok(keys.includes('delta') && keys.includes('delta#7') && !keys.includes('delta#8'));
  const used = Object.values(WY.autoRoles(WY.describe(first))).filter(Boolean);
  assert.deepEqual(used, ['current']);
});

test('T4 · score 8 contre 2, et le bon graphique est choisi seul', () => {
  const first = F.newBookingsFirst(), second = F.newBookingsSecond();
  assert.equal(WY.roleScore(second, {}), 8);
  assert.equal(WY.roleScore(first, {}), 2);
  assert.equal(WY.pickData([{ i: 0, chart: first }, { i: 1, chart: second }], null, {}).i, 1);
});

test('T5 · nature : rythme pour le second graphique new-bookings, portefeuille partout ailleurs', () => {
  assert.equal(rolesOf(F.newBookingsSecond()).kind, 'pace');
  assert.equal(rolesOf(F.bookingsLastyear()).kind, 'book');
  assert.equal(rolesOf(F.bookingsFinal()).kind, 'book');
  assert.equal(rolesOf(F.newBookingsFirst()).kind, 'book');
});

test('T6 · présence : lastyear = cur+ly ; final = cur+lyf ; second graphique = cur+ly', () => {
  const flags = c => { const r = rolesOf(c); return [!!r.cur, !!r.ly, !!r.lyf].join(); };
  assert.equal(flags(F.bookingsLastyear()), 'true,true,false');
  assert.equal(flags(F.bookingsFinal()), 'true,false,true');
  assert.equal(flags(F.newBookingsSecond()), 'true,true,false');
});

test('T7 · valeurs repères identiques aux info-bulles ; N et N-1 sur les mêmes 188 jours', () => {
  const r = rolesOf(F.bookingsLastyear()), d = day('2027-04-04');
  assert.equal(r.cur.vol.get(d), 30); assert.equal(r.ly.vol.get(d), 38); assert.equal(r.cur.rpd.get(d), 40); assert.equal(r.ly.rpd.get(d), 39);
  assert.equal(r.cur.vol.size, 188); assert.deepEqual([...r.ly.vol.keys()], [...r.cur.vol.keys()]);
  const e = rolesOf(F.newBookingsSecond()), d2 = day('2026-12-18');
  assert.equal(e.cur.vol.get(d2), 2); assert.equal(e.ly.vol.get(d2), 4); assert.equal(e.cur.rpd.get(d2), 25); assert.equal(e.ly.rpd.get(d2), 26);
  assert.deepEqual([...e.ly.rpd.keys()], [...e.cur.rpd.keys()]);
});

test('T8 · agg : ni NaN ni ±Infinity ; volume net ≤ 0 → moyenne simple des RPJ finis', () => {
  const m = (...v) => new Map(v.map((x, i) => [day('2026-10-13') + i * ms, x]));
  const agg = (vol, rpd) => WY.agg(m(...vol), m(...rpd), day('2026-10-13'), day('2026-10-13') + (vol.length - 1) * ms);
  assert.equal(agg([1, 0, 2], [10, NaN, Infinity]).rpd, 10);
  assert.equal(agg([1, 1], [NaN, -Infinity]), null);
  assert.equal(agg([-2, 0.5], [20, 30]).rpd, 25);
  assert.equal(agg([1, 3], [10, 20]).rpd, 17.5);               // cas normal : moyenne pondérée inchangée
  assert.equal(agg([1, NaN, Infinity], [10, 20, 30]).rpd, 10);  // volumes non finis ignorés : seul le jour au volume fini (1) pondère
});

test('T9 · new-bookings/1-day : 20–26/10 donne un RPJ et un écart FINIS malgré +Infinity et NaN', () => {
  const c = F.newBookingsSecond('1-day'), r = rolesOf(c);
  assert.equal(r.cur.rpd.get(day('2026-10-21')), Infinity);       // la donnée brute est bien non finie
  const z = WY.zoneStats(r, day('2026-10-20'), day('2026-10-26'));
  for (const v of [z.cur.rpd, z.cur.rev, z.cur.days, z.ly.rpd, z.dLy, z.dVol]) assert.ok(Number.isFinite(v), String(v));
  assert.ok(Math.abs(z.cur.days - (-1.4)) < 1e-9, 'volume net N de la semaine = −1,4 j');
  assert.ok(Math.abs(z.ly.days - 23.8) < 1e-9, 'volume net N-1 = 23,8 j');
  const finite = [20.5, 21.4, 22.1, 23.0, 19.8];
  assert.ok(Math.abs(z.cur.rpd - finite.reduce((a, b) => a + b) / finite.length) < 1e-9, 'repli : moyenne simple des RPJ finis');
});

test('T9b · données brutes de new-bookings/1-day conformes à la spec (39 non finis par série, négatifs)', () => {
  const c = F.newBookingsSecond('1-day'), by = n => c.series.find(s => s.name === n).yData;
  const cnt = y => ({ nan: y.filter(Number.isNaN).length, inf: y.filter(v => v === Infinity).length });
  assert.deepEqual(cnt(by('revenue')), { nan: 38, inf: 1 });
  assert.deepEqual(cnt(by('ly_revenue')), { nan: 34, inf: 5 });
  assert.equal(by('thisyear').filter(v => v < 0).length, 8); assert.equal(by('lastyear').filter(v => v < 0).length, 1);
  assert.equal(by('revenue').filter(v => v < 0).length, 5);
  assert.equal(by('thisyear').filter(v => v === 0).length, 39);
  assert.equal(c.series.find(s => s.name === 'lastyear').options.dashStyle, 'Dash');
});

test('T10 · réglages enregistrés avant la spec : rôles rétablis et signalés (invalid)', () => {
  const descs = WY.describe(F.newBookingsSecond());
  const saved = { curVol: 'thisyear', lyVol: 'lastyear', curRpd: 'thisyear', lyRpd: 'lastyear', lyfVol: 'ly_revenue' };
  const r = WY.resolveRoles(descs, saved);
  assert.deepEqual(r.roles, Object.assign({}, NULLS, { curVol: 'thisyear', lyVol: 'lastyear', curRpd: 'revenue', lyRpd: 'ly_revenue' }));
  assert.deepEqual([...r.invalid].sort(), ['curRpd', 'lyRpd', 'lyfVol']);
  // et la lecture est correcte (plus de volume pris pour un prix)
  const z = WY.zoneStats(rolesOf(F.newBookingsSecond('7-days'), saved), day('2026-10-27'), day('2026-11-02'));
  assert.ok(z.cur.rpd > 15 && z.cur.rpd < 40, `RPJ N ${z.cur.rpd}`);
});

test('T11 · une permutation volontaire (aucun conflit) est acceptée', () => {
  const r = WY.resolveRoles(WY.describe(F.newBookingsSecond()), { curVol: 'revenue', curRpd: 'thisyear' });
  assert.equal(r.roles.curVol, 'revenue'); assert.equal(r.roles.curRpd, 'thisyear'); assert.deepEqual(r.invalid, []);
});

test('T11b · une surcharge sur une série libre est acceptée, « none » vide un rôle', () => {
  const r = WY.resolveRoles(WY.describe(F.bookingsFinal()), { lyfRpd: 'none' });
  assert.equal(r.roles.lyfRpd, null); assert.deepEqual(r.invalid, []);
});

test('T12 · mise à niveau de l\'état : réglages de séries remis à zéro UNE fois, le reste conservé', () => {
  const old = { v: 3, dataIdx: 1, maps: { fu2an: { curVol: 'thisyear' } }, gridDate: '2026-07-24', gridNum: 10, tierList: [[1, 5]], periods: false, offset: 2 };
  const up = WY.upgradeState(old);
  assert.deepEqual(up.maps, {}); assert.equal(up.dataIdx, null); assert.equal(up.dataKey, null); assert.equal(up.rolesSchema, 2);
  assert.equal(up.v, 3); assert.equal(up.gridDate, '2026-07-24'); assert.equal(up.gridNum, 10); assert.deepEqual(up.tierList, [[1, 5]]); assert.equal(up.periods, false); assert.equal(up.offset, 2);
  const again = WY.upgradeState(Object.assign({}, up, { maps: { fu2an: { curVol: 'thisyear' } }, dataIdx: 1, dataKey: 'fu2an' }));
  assert.deepEqual(again.maps, { fu2an: { curVol: 'thisyear' } }); assert.equal(again.dataIdx, 1);
});

test('T13 · chartKey du second graphique = fu2an ; un choix manuel n\'est honoré que sur SON graphique', () => {
  const first = F.newBookingsFirst(), second = F.newBookingsSecond();
  assert.equal(WY.chartKey(second), 'fu2an');
  const list = [{ i: 0, chart: first }, { i: 1, chart: second }];
  assert.equal(WY.pickData(list, 0, {}, WY.chartKey(first)).i, 0, 'choix fait sur ce graphique');
  assert.equal(WY.pickData(list, 0, {}, WY.chartKey(second)).i, 1, 'index hérité d\'une autre page : ignoré');
  assert.equal(WY.pickData(list, 0, {}, null).i, 1, 'sans dataKey : automatique');
});

// ----- DOM (doublures minimales) -----
test('T14 · fenêtre : bouton radio coché → N jours ; rien de coché → null', () => {
  DOC = { querySelector: s => (/radiogroup/.test(s) && /:checked/.test(s) ? { value: '14' } : null) };
  assert.equal(WY.windowDays(), 14);
  DOC = { querySelector: () => null }; assert.equal(WY.windowDays(), null);
  DOC = { querySelector: () => ({ value: 'abc' }) }; assert.equal(WY.windowDays(), null);
});

test('T14b · la fenêtre n\'est lue que pour le rythme', () => {
  DOC = { querySelector: () => ({ value: '7' }), querySelectorAll: () => [] };
  assert.equal(rolesOf(F.newBookingsSecond()).windowDays, 7);
  assert.equal(rolesOf(F.bookingsLastyear()).windowDays, null);
  DOC = {};
});

test('T15 · « Avancé (RevCar) » : RPJ non fiable, lecture vide ; « Revenu par jour » et absence de menu : fiables', () => {
  const dd = t => ({ querySelectorAll: s => (s === 'a.dropdown-toggle' ? [{ textContent: 'Évolution' }, { textContent: `  ${t}  ` }] : []), querySelector: () => null });
  DOC = dd('Avancé (Revenu par jour)'); assert.equal(WY.metricLabel(), 'Revenu par jour'); assert.equal(WY.rpdTrusted(), true); assert.ok(rolesOf(F.bookingsLastyear()).cur);
  DOC = dd('Avancé (RevCar)'); assert.equal(WY.metricLabel(), 'RevCar'); assert.equal(WY.rpdTrusted(), false);
  const r = rolesOf(F.bookingsLastyear()); assert.equal(r.cur, null); assert.equal(r.ly, null); assert.equal(r.metricBlocked, true);
  DOC = { querySelectorAll: () => [] }; assert.equal(WY.metricLabel(), null); assert.equal(WY.rpdTrusted(), true);
  DOC = {};
});

test('T16 · titre : l\'en-tête visible l\'emporte sur un « chargement » masqué plus proche', () => {
  const el = (tag, text, o = {}) => Object.assign({ tagName: tag, innerText: text, parentElement: null, previousElementSibling: null, querySelectorAll: () => [], getClientRects: () => (o._hidden ? [] : [{}]) }, o);
  const visible = el('H2', 'Évolution des réservations'), hidden = el('H3', 'Données en cours de chargement, merci de patienter quelques secondes..', { _hidden: true });
  const host = el('APP-CHART', 'novembre 2026\ndécembre 2026'), wrap = el('DIV', '');
  host.previousElementSibling = hidden; hidden.previousElementSibling = visible; host.parentElement = wrap;
  assert.equal(WY.titleOf(host), 'Évolution des réservations');
  hidden.previousElementSibling = null;                            // seul le masqué reste
  assert.equal(WY.titleOf(host), 'Graphique', 'jamais le texte masqué ; repli neutre plutôt que « novembre 2026 »');
  const loadingVisible = el('H3', 'Loading…'); host.previousElementSibling = loadingVisible;
  assert.equal(WY.titleOf(host), 'Graphique');
});

test('T17 · jour de référence : `past-band` en priorité', () => {
  const ref = day('2026-10-19'), other = day('2026-11-30');
  const c = bands => ({ xAxis: [{ options: { plotBands: bands } }] });
  assert.equal(WY.chartRefDay(c([{ id: 'other', to: other }, { id: 'past-band', to: ref }])), ref);
  assert.equal(WY.chartRefDay(c([{ id: 'other', to: other }])), other, 'sans past-band : première bande étrangère');
  assert.equal(WY.chartRefDay(F.bookingsLastyear()), ref);
});

test('T19 · diagnostic : nouveaux champs présents, clés historiques inchangées, NaN / Infinity comptés', () => {
  DOC = { querySelector: () => ({ value: '1' }), querySelectorAll: () => [] };
  const host = { tagName: 'APP-CHART', parentElement: { tagName: 'APP-NEW-BOOKINGS-VARIATION-CHART' } };
  const list = [{ i: 0, host, chart: F.newBookingsFirst(), title: 'a' }, { i: 1, host, chart: F.newBookingsSecond('1-day'), title: 'b' }];
  const d = WY.diagnose(list, 1, {});
  for (const k of ['page', 'le', 'graphique_lu', 'graphiques']) assert.ok(k in d, k);
  const g = d.graphiques[1];
  for (const k of ['roles', 'axeX', 'axesY', 'bandes']) assert.ok(k in g, k);
  for (const k of ['debut', 'milieu']) assert.ok(k in g.series[0], k);
  assert.equal(g.hote, 'app-chart'); assert.equal(g.parent, 'app-new-bookings-variation-chart'); assert.equal(g.fenetre_jours, 1); assert.deepEqual(g.roles_invalides, []);
  const rev = g.series.find(s => s.nom === 'revenue'), lrev = g.series.find(s => s.nom === 'ly_revenue');
  assert.deepEqual([rev.nan, rev.inf_plus], [38, 1]); assert.deepEqual([lrev.nan, lrev.inf_plus], [34, 5]);
  assert.equal(g.bandes[0].id, 'past-band');
  DOC = {};
});

test('T19b · diagnostic : les réglages écartés sont rapportés', () => {
  const list = [{ i: 0, host: {}, chart: F.newBookingsSecond(), title: 'b' }];
  const d = WY.diagnose(list, 0, { fu2an: { curRpd: 'thisyear' } });
  assert.deepEqual(d.graphiques[0].roles_invalides, ['curRpd']);
});

test('R10 · libellés décalés de labelDy sur new-bookings/*, intacts sinon', () => {
  const calls = []; const ax = { plotLinesAndBands: [], addPlotBand: b => calls.push(b), addPlotLine: () => {}, removePlotBand: () => {}, removePlotLine: () => {} };
  const ch = { xAxis: [ax] };
  const periods = [{ k: 0, num: 1, label: 'P1', from: day('2026-10-19'), to: day('2026-10-25') }];
  const plan = { showPeriods: true, showTiers: true, periods, selK: 0, j0: day('2026-10-19'), zones: [{ ci: 0, label: '1-2j', from: day('2026-10-20'), to: day('2026-10-21') }], signals: [{ k: 0, kind: 'raise', alpha: 1 }] };
  const ys = p => { calls.length = 0; WY.paint(ch, p); return calls.filter(b => b.label && b.label.verticalAlign === 'top').map(b => b.label.y).sort((a, b) => a - b); };
  assert.deepEqual(ys(plan), [12, 26]);
  assert.deepEqual(ys(Object.assign({}, plan, { labelDy: 16 })), [28, 42]);
  assert.deepEqual(ys(Object.assign({}, plan, { showPeriods: false, labelDy: 16 })), [29, 42], 'pictogramme seul : 13 + 16');
});
