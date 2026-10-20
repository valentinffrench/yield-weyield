// Tests de la logique pure.  Lancer :  node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
const WY = globalThis.__WYP;
const D = WY.D;
const day = s => WY.parseISO(s);

test('parseTiers : accepte 1-2, 3–6 ; signale ce qui est ignoré', () => {
  const r = WY.parseTiers('1-2, 3–6;7-13\n14-20, abc, 9-3, 5');
  assert.deepEqual(r.tiers, [[1, 2], [3, 6], [7, 13], [14, 20]]);
  assert.deepEqual(r.bad, ['abc', '9-3', '5']);
});

test('j0Of : J0 = début de période + décalage (négatif possible)', () => {
  const p = { from: day('2026-08-07') };
  assert.equal(WY.isoDay(WY.j0Of(p, 0)), '2026-08-07');
  assert.equal(WY.isoDay(WY.j0Of(p, 2)), '2026-08-09');
  assert.equal(WY.isoDay(WY.j0Of(p, -3)), '2026-08-04');
  assert.equal(WY.isoDay(WY.j0Of(p, 'x')), '2026-08-07');
});

test('tiersToText : aller-retour avec parseTiers', () => {
  const t = [[1, 2], [3, 6], [14, 20]];
  assert.deepEqual(WY.parseTiers(WY.tiersToText(t)).tiers, t);
});

test('tierZones : une location de a à b jours revient entre J0+a et J0+b', () => {
  const [z] = WY.tierZones(day('2026-08-07'), [[3, 6]]);
  assert.equal(WY.isoDay(z.from), '2026-08-10');
  assert.equal(WY.isoDay(z.to), '2026-08-13');
  assert.equal(z.label, '3-6j');
});

test('makeGrid : « la période 10 commence le 24/07 » → P12 = 07→13/08, P1 = 22/05', () => {
  const g = WY.makeGrid({ gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w' }, day('2026-08-01'));
  const p12 = g.at(2);
  assert.equal(p12.label, 'P12');
  assert.equal(WY.isoDay(p12.from), '2026-08-07');
  assert.equal(WY.isoDay(p12.to), '2026-08-13');
  assert.equal(WY.isoDay(g.p1), '2026-05-22');
  assert.equal(g.indexAt(day('2026-08-10')), 2);
  assert.equal(g.indexAt(day('2026-08-13')), 2);
  assert.equal(g.indexAt(day('2026-08-14')), 3);
  assert.equal(g.indexAt(day('2026-07-23')), -1);
});

test('makeGrid : sans date → P1 = lundi de la semaine de référence', () => {
  const g = WY.makeGrid({ gridDate: '', gridNum: 7, gridLen: 1, gridUnit: 'w' }, day('2026-07-29')); // mercredi
  assert.equal(g.auto, true);
  assert.equal(WY.isoDay(g.at(0).from), '2026-07-27');
  assert.equal(g.at(0).label, 'P1');
});

test('makeGrid : durée en jours, inRange couvre la plage sans trou', () => {
  const g = WY.makeGrid({ gridDate: '2026-08-01', gridNum: 1, gridLen: 10, gridUnit: 'd' }, day('2026-08-01'));
  const ps = g.inRange(day('2026-07-25'), day('2026-08-25'));
  assert.deepEqual(ps.map(p => p.label), ['P0', 'P1', 'P2', 'P3']);
  for (let i = 1; i < ps.length; i++) assert.equal(ps[i].from - ps[i - 1].to, D);
});

const series = (obj) => new Map(Object.entries(obj).map(([k, v]) => [day(k), v]));

test('zoneStats : RPJ pondéré par les voitures louées, N-1 et N-1 final séparés', () => {
  const S = {
    range: [day('2026-08-01'), day('2026-08-05')],
    cur: { vol: series({ '2026-08-02': 10, '2026-08-03': 30 }), rpd: series({ '2026-08-02': 20, '2026-08-03': 40 }) },
    ly: { vol: series({ '2026-08-02': 10, '2026-08-03': 10 }), rpd: series({ '2026-08-02': 30, '2026-08-03': 30 }) },
    lyf: { vol: series({ '2026-08-02': 10, '2026-08-03': 10 }), rpd: series({ '2026-08-02': 35, '2026-08-03': 35 }) },
  };
  const z = WY.zoneStats(S, day('2026-08-02'), day('2026-08-03'));
  assert.equal(z.cur.rpd, (10 * 20 + 30 * 40) / 40); // 35, et non la moyenne simple 30
  assert.equal(z.cur.rev, 1400);
  assert.equal(z.ly.rpd, 30);
  assert.equal(z.lyf.rpd, 35);
  assert.ok(Math.abs(z.dLy - (35 / 30 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(z.dLyf) < 1e-9);
  assert.equal(z.nDays, 2);
  assert.equal(z.full, 2);
});

test('zoneStats : zone partiellement hors données, séries absentes', () => {
  const S = {
    range: [day('2026-08-01'), day('2026-08-05')],
    cur: { vol: series({ '2026-08-05': 10 }), rpd: series({ '2026-08-05': 25 }) },
    ly: null, lyf: null,
  };
  const z = WY.zoneStats(S, day('2026-08-04'), day('2026-08-09'));
  assert.equal(z.nDays, 2);
  assert.equal(z.full, 6);
  assert.equal(z.cur.rpd, 25);
  assert.equal(z.ly, null);
  assert.equal(z.dLy, null);
  const out = WY.zoneStats(S, day('2026-09-01'), day('2026-09-05'));
  assert.equal(out.nDays, 0);
  assert.equal(out.cur, null);
});

test('toTSV : autant de champs que d\'en-têtes, virgule décimale, séries absentes vides', () => {
  const S = { range: [day('2026-08-01'), day('2026-08-05')], cur: { vol: series({ '2026-08-02': 10 }), rpd: series({ '2026-08-02': 31.234 }) }, ly: null, lyf: null };
  const tsv = WY.toTSV([Object.assign({ label: 'P12 départs' }, WY.zoneStats(S, day('2026-08-02'), day('2026-08-02')))]);
  const [h, r] = tsv.split('\n').map(l => l.split('\t'));
  assert.equal(h.length, r.length);
  assert.equal(r[4], '31,23');
  assert.equal(r[7], '');
});
