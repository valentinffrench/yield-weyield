// Tests de la détection des séries (rôles N / N-1 / N-1 final, prix / volume).  Lancer :  node --test test/chart.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis; globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
require('../src/core.js');
require('../src/chart.js');
const WY = globalThis.__WYP, D = WY.D;
const t0 = Date.UTC(2026, 9, 1);
const ser = (name, o = {}) => ({ name, options: Object.assign({ id: o.id }, o.dash ? { dashStyle: o.dash } : {}), xData: Array.from({ length: 5 }, (_, i) => t0 + i * D), yData: [1, 2, 3, 4, 5].map(v => v * (o.k || 1)) });
const chart = series => ({ series, xAxis: [{ min: t0, max: t0 + 4 * D, options: { plotBands: [] } }] });
const rolesOf = (...s) => WY.readSeries(chart(s));

test('page Réservations (noms internes) : current / lastyear / lastyearFinal', () => {
  const r = rolesOf(ser('current'), ser('lastyear'), ser('lastyearFinal'), ser('currentRpd'), ser('lastyearRpd'), ser('lastyearFinalRpd'), ser('fleet'));
  assert.deepEqual(r.roles, { curRpd: 'currentRpd', curVol: 'current', lyRpd: 'lastyearRpd', lyVol: 'lastyear', lyfRpd: 'lastyearFinalRpd', lyfVol: 'lastyearFinal' });
  assert.equal(r.kind, 'book');
  assert.ok(r.cur && r.ly && r.lyf);
});

test('page Réservations, onglet En portefeuille : pas de N-1 final → rôle vide, pas d\'erreur', () => {
  const r = rolesOf(ser('current'), ser('lastyear'), ser('currentRpd'), ser('lastyearRpd'));
  assert.equal(r.lyf, null); assert.ok(r.cur && r.ly);
});

test('page Évolution (noms affichés) : « OnRent net » / « Revenu par jour », N-1 = la série pointillée', () => {
  const r = rolesOf(ser('OnRent net', { k: 1 }), ser('OnRent net', { k: 2, dash: 'Dash' }), ser('Revenu par jour', { k: 10 }), ser('Revenu par jour', { k: 20, dash: 'ShortDash' }));
  assert.deepEqual(r.roles, { curRpd: 'Revenu par jour', curVol: 'OnRent net', lyRpd: 'Revenu par jour#2', lyVol: 'OnRent net#2', lyfRpd: null, lyfVol: null });
  assert.equal(r.kind, 'pace');
  assert.equal(r.cur.rpd.get(t0), 10); assert.equal(r.ly.rpd.get(t0), 20); assert.equal(r.cur.vol.get(t0), 1); assert.equal(r.ly.vol.get(t0), 2);
});

test('même graphique, N-1 listée AVANT N et pointillée : la pleine reste N', () => {
  const r = rolesOf(ser('OnRent net', { k: 2, dash: 'Dash' }), ser('OnRent net', { k: 1 }), ser('Revenu par jour', { k: 20, dash: 'Dash' }), ser('Revenu par jour', { k: 10 }));
  assert.equal(r.cur.rpd.get(t0), 10); assert.equal(r.ly.rpd.get(t0), 20);
});

test('graphique empilé (OnRent depuis 7 jours…, Flotte totale) : aucun RPJ → score trop bas pour être lu', () => {
  const c = chart([ser('Flotte totale'), ser('OnRent (jours)'), ser('OnRent depuis 7 jours'), ser('OnRent depuis 14 jours')]);
  assert.equal(WY.readSeries(c).cur, null);
  assert.ok(WY.roleScore(c, null) <= 3);
});

test('choix du graphique : celui qui a un RPJ N, pas le premier', () => {
  const stack = chart([ser('Flotte totale'), ser('OnRent (jours)')]);
  const evo = chart([ser('OnRent net'), ser('OnRent net', { dash: 'Dash' }), ser('Revenu par jour'), ser('Revenu par jour', { dash: 'Dash' })]);
  const list = [{ i: 0, chart: stack }, { i: 1, chart: evo }];
  assert.equal(WY.pickData(list, null, {}).i, 1);
  assert.equal(WY.pickData(list, 0, {}, WY.chartKey(stack)).i, 0, 'le choix manuel prime (fait sur ce graphique)');
  assert.equal(WY.pickData([{ i: 0, chart: stack }], null, {}).i, 0, 'à défaut, le premier');
});

test('réglage manuel : une série libre est acceptée, « none » vide, clé inconnue → auto, un conflit est écarté et signalé', () => {
  const c = chart([ser('OnRent net', { k: 1 }), ser('OnRent net', { k: 2, dash: 'Dash' }), ser('Revenu par jour', { k: 10 }), ser('Revenu par jour', { k: 20, dash: 'Dash' }), ser('Revenu par jour', { k: 30, dash: 'Dash', id: 'alt' })]);
  assert.equal(WY.readSeries(c, { lyRpd: 'alt' }).ly.rpd.get(t0), 30, 'série libre acceptée');
  assert.equal(WY.readSeries(c, { lyRpd: 'none' }).ly, null);
  assert.equal(WY.readSeries(c, { lyRpd: 'inexistante' }).ly.rpd.get(t0), 20, 'clé inconnue → automatique');
  const clash = WY.readSeries(c, { lyRpd: 'Revenu par jour' });          // la même série que RPJ N : un conflit
  assert.equal(clash.ly.rpd.get(t0), 20, 'conflit écarté, retour à l\'automatique');
  assert.deepEqual(clash.invalid, ['lyRpd']);
});

test('clé de disposition : stable pour le même graphique, différente pour un autre', () => {
  const a = chart([ser('current'), ser('currentRpd')]), b = chart([ser('currentRpd'), ser('current')]), c = chart([ser('OnRent net')]);
  assert.equal(WY.chartKey(a), WY.chartKey(b));
  assert.notEqual(WY.chartKey(a), WY.chartKey(c));
});

test('séries à lister dans le panneau : libellé lisible, pointillé signalé, nombre de points', () => {
  const r = rolesOf(ser('OnRent net'), ser('OnRent net', { dash: 'Dash' }));
  assert.equal(r.series.length, 2);
  assert.match(r.series[1].label, /pointillé/);
  assert.equal(r.series[0].n, 5);
});
