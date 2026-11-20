// Réglages communs à WeYield et Rentway (v3.5.1) : nettoyage, format enregistré, fraîcheur de la période synchronisée.
// Lancer :  node --test test/shared.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
const WY = globalThis.__WYP;
const day = s => WY.parseISO(s);
const CFG = { gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w', tierList: [[1, 2], [3, 6], [7, 13]] };

test('sanitizePatch : liste blanche et bornes (déplacée du moteur vers core.js)', () => {
  assert.deepEqual(WY.sanitizePatch({ gridNum: 0, gridLen: 999, offset: -99, gridUnit: 'x', tierList: [[3, 1], [1, 2], ['a', 9]], evil: 1, occTh: [90, 80, 95] }),
    { gridNum: 1, gridLen: 366, offset: -60, tierList: [[1, 2], [0, 9]] });
  assert.deepEqual(WY.sanitizePatch({ gridDate: 'demain' }), {});
  assert.deepEqual(WY.sanitizePatch({ gridDate: '' }), { gridDate: '' });
  assert.deepEqual(WY.sanitizePatch(null), {});
  assert.deepEqual(WY.sanitizePatch({ occTh: [80, 85, 90], dataIdx: null }), { occTh: [80, 85, 90], dataIdx: null });
});

test('cleanShared : valeurs par défaut (synchro active, rien d’enregistré)', () => {
  assert.deepEqual(WY.cleanShared(undefined), { v: 2, cfg: null, from: null, sync: true, sel: null, selT: 0 });
  assert.deepEqual(WY.cleanShared({ sync: false }).sync, false);
});

test('cleanShared : relit le format v3.5.0 du panneau ({ from, cfg })', () => {
  const sh = WY.cleanShared({ from: 'rpd', cfg: CFG });
  assert.deepEqual(sh.cfg, CFG);
  assert.equal(sh.from, 'rpd');
  assert.equal(sh.sync, true);
  assert.equal(sh.sel, null);
});

test('cleanShared : réglages incomplets ou faux écartés, sélection ramenée au jour', () => {
  assert.equal(WY.cleanShared({ cfg: { gridNum: 3 } }).cfg, null, 'un réglage partiel n’écrase jamais les autres');
  const sh = WY.cleanShared({ cfg: Object.assign({}, CFG, { tierList: [[5, 1]], hack: 1 }), from: 'evil', sel: { from: day('2026-12-18') + 3600e3, offset: 99 }, selT: 'x' });
  assert.deepEqual(sh.cfg.tierList, []);
  assert.equal(sh.cfg.hack, undefined);
  assert.equal(sh.from, null);
  assert.equal(WY.isoDay(sh.sel.from), '2026-12-18');
  assert.equal(sh.sel.offset, 60);
  assert.equal(sh.selT, 0);
  assert.deepEqual(WY.cleanShared({ sel: { from: null, offset: 2 } }).sel, { from: null, offset: 2 }, 'null = période en cours');
});

test('selFresh : la période synchronisée n’est reprise à l’ouverture que pendant 12 h', () => {
  const now = Date.UTC(2026, 11, 5, 15);
  const sh = t => WY.cleanShared({ cfg: CFG, sel: { from: day('2026-12-18'), offset: 0 }, selT: t });
  assert.equal(WY.selFresh(sh(now - 3600e3), now), true);
  assert.equal(WY.selFresh(sh(now - 13 * 3600e3), now), false);
  assert.equal(WY.selFresh(WY.cleanShared({ cfg: CFG }), now), false, 'aucune sélection enregistrée');
});

test('pickShared : copie des seuls réglages communs, sans partage de référence', () => {
  const st = Object.assign(WY.stateDefaults(), CFG, { offset: 3, occTh: [80, 85, 90] });
  const p = WY.pickShared(st);
  assert.deepEqual(Object.keys(p).sort(), WY.SHARED_KEYS.slice().sort());
  p.tierList[0][0] = 99;
  assert.equal(st.tierList[0][0], 1);
});
