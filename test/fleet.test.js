// Balance de flotte Rentway : lecture des enregistrements bruts et occupation par zone (logique pure de core.js).
// Données synthétiques ; seuls les noms de champs et le format des dates viennent du vrai Rentway (docs/rentway-layout.md).
// Lancer :  node --test test/fleet.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
const WY = globalThis.__WYP, D = WY.D;
const day = s => WY.parseISO(s);

// Une station, deux catégories (+ une catégorie sans flotte, comme IVMD), du 01/12 au 10/12/2026.
// A : flotte 10, dispo 5 puis 1 le 05/12, -1 le 06/12 (surbooking). B : flotte 20, dispo 10 tous les jours.
function records(extra = {}) {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const date = `2026-12-${String(i).padStart(2, '0')}T00:00:00`;
    const a = i === 5 ? 1 : i === 6 ? -1 : 5;
    out.push(Object.assign({ locationID: 'APT', locationName: 'PTP /AEROPORT DE PTP', groupID: 'A', date, availableVehicles: a, totalVehicles: 10 }, extra));
    out.push(Object.assign({ locationID: 'APT', locationName: 'PTP /AEROPORT DE PTP', groupID: 'B', date, availableVehicles: 10, totalVehicles: 20 }, extra));
    out.push(Object.assign({ locationID: 'APT', locationName: 'PTP /AEROPORT DE PTP', groupID: 'Z', date, availableVehicles: 0, totalVehicles: 0 }, extra));
  }
  return out;
}

test('rwDay : date lue sur le texte, sans dépendre du fuseau', () => {
  assert.equal(WY.isoDay(WY.rwDay('2026-12-02T00:00:00')), '2026-12-02');
  assert.equal(WY.isoDay(WY.rwDay('2026-12-31T23:59:59')), '2026-12-31');
  assert.ok(Number.isNaN(WY.rwDay('02-12')));
  assert.ok(Number.isNaN(WY.rwDay(null)));
});

test('fleetFromRecords : catégories dans l’ordre Rentway, totaux par jour, bornes', () => {
  const F = WY.fleetFromRecords(records());
  assert.equal(F.catField, 'groupID');
  assert.equal(F.locField, 'locationName');
  assert.deepEqual(F.order, ['A', 'B', 'Z']);
  assert.equal(F.locs, 1);
  assert.equal(WY.isoDay(F.range[0]), '2026-12-01');
  assert.equal(WY.isoDay(F.range[1]), '2026-12-10');
  assert.deepEqual(F.all.get(day('2026-12-05')), { a: 11, t: 30 });
  assert.deepEqual(F.cats.get('A').get(day('2026-12-06')), { a: -1, t: 10 });
});

test('fleetFromRecords : vue Segments, plusieurs stations, lignes illisibles', () => {
  const recs = records().map(r => { const o = Object.assign({}, r, { segmentID: r.groupID }); delete o.groupID; return o; });
  recs.push(Object.assign({}, recs[0], { locationName: 'BASSE-TERRE' }));
  recs.push({ locationName: 'X', segmentID: 'A', date: 'n/a', availableVehicles: 3, totalVehicles: 3 });
  const F = WY.fleetFromRecords(recs);
  assert.equal(F.catField, 'segmentID');
  assert.equal(F.locs, 2, 'les stations sont comptées (la ligne illisible est écartée), leurs chiffres additionnés');
  assert.equal(F.bad, 1);
  assert.deepEqual(F.all.get(day('2026-12-01')), { a: 20, t: 40 });
  assert.equal(WY.fleetFromRecords([]), null);
  assert.equal(WY.fleetFromRecords(null), null);
});

test('fleetAgg : occupation pondérée, pic, dispo minimale, surbooking', () => {
  const F = WY.fleetFromRecords(records());
  const a = WY.fleetAgg(F.cats.get('A'), day('2026-12-04'), day('2026-12-07'));
  assert.equal(a.days, 4);
  assert.equal(a.avail, 5 + 1 - 1 + 5);
  assert.equal(a.fleetDays, 40);
  assert.ok(Math.abs(a.occ - (1 - 10 / 40)) < 1e-9);
  assert.ok(Math.abs(a.peak - 1.1) < 1e-9, 'dispo -1 sur 10 : 110 %');
  assert.equal(WY.isoDay(a.peakDay), '2026-12-06');
  assert.equal(a.minAvail, -1);
  assert.equal(a.overDays, 1);
  assert.equal(a.fleet, 10);
  // Catégorie sans flotte : pas d'occupation (ni 0 %, ni 100 %)
  const z = WY.fleetAgg(F.cats.get('Z'), day('2026-12-01'), day('2026-12-10'));
  assert.equal(z.occ, null); assert.equal(z.peak, null); assert.equal(z.overDays, 0);
  // Hors des données
  assert.equal(WY.fleetAgg(F.cats.get('A'), day('2027-01-01'), day('2027-01-05')), null);
});

test('occLevel : seuils de référence 81 / 86 / 87 %, surbooking prioritaire', () => {
  const L = v => WY.occLevel(v, WY.OCC_TH, 0);
  assert.equal(L(0.80), 0); assert.equal(L(0.81), 1); assert.equal(L(0.859), 1);
  assert.equal(L(0.86), 2); assert.equal(L(0.869), 2); assert.equal(L(0.87), 3); assert.equal(L(1), 3);
  assert.equal(WY.occLevel(0.5, WY.OCC_TH, 2), 4);
  assert.equal(WY.occLevel(null, WY.OCC_TH, 0), -1);
  assert.equal(WY.occLevel(0.9, [90, 95, 99], 0), 1, 'seuils réglés');
  assert.deepEqual(WY.OCC_LEVELS, ['Marge', 'Confortable', 'Limite', 'Pic', 'Surbooking']);
});

test('fleetZoneStats : zone partielle, catégories en tension, seuils de l’état', () => {
  const F = WY.fleetFromRecords(records());
  const s = WY.fleetZoneStats(F, day('2026-11-28'), day('2026-12-03'), {});
  assert.equal(s.nDays, 3); assert.equal(s.full, 6);
  assert.deepEqual(s.cats.map(c => c.cat), ['A', 'B', 'Z']);
  assert.deepEqual(s.tense, [], 'A à 50 %, B à 50 % : pas de tension');
  const t = WY.fleetZoneStats(F, day('2026-12-05'), day('2026-12-05'), {});
  assert.deepEqual(t.tense, ['A'], 'A à 90 % le 05/12 : pic');
  assert.ok(Math.abs(t.all.occ - (1 - 11 / 30)) < 1e-9);
  const relaxed = WY.fleetZoneStats(F, day('2026-12-05'), day('2026-12-05'), { occTh: [92, 95, 99] });
  assert.deepEqual(relaxed.tense, [], 'avec des seuils plus hauts, 90 % n’est plus en tension');
  const out = WY.fleetZoneStats(F, day('2027-02-01'), day('2027-02-07'), {});
  assert.equal(out.nDays, 0); assert.equal(out.all, null); assert.deepEqual(out.tense, []);
});

test('fleetCumZones : du premier palier à la fin de chacun (le goulot d’une location longue)', () => {
  const F = WY.fleetFromRecords(records());
  const zones = WY.tierZones(day('2026-12-01'), [[1, 2], [3, 6]]);
  const cum = WY.fleetCumZones(F, zones, {});
  assert.equal(WY.isoDay(cum[0].from), '2026-12-02'); assert.equal(WY.isoDay(cum[0].to), '2026-12-03');
  assert.equal(WY.isoDay(cum[1].from), '2026-12-02'); assert.equal(WY.isoDay(cum[1].to), '2026-12-07');
  assert.deepEqual(cum[0].tense, []);
  assert.deepEqual(cum[1].tense, ['A'], 'la location de 3 à 6 jours traverse le surbooking du 06/12');
  assert.equal(cum[1].all.minAvail, 9);
  assert.equal(cum[1].label, '3-6j'); assert.equal(cum[1].ci, 1);
});

test('fleetTSV / fleetCatsTSV : export tableur, virgule décimale', () => {
  const F = WY.fleetFromRecords(records());
  const z = Object.assign({ label: 'P1 période' }, WY.fleetZoneStats(F, day('2026-12-04'), day('2026-12-07'), {}));
  const lines = WY.fleetTSV([z]).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Zone\tDébut\tFin\tJours visibles\tOccupation moy\. %/);
  const c = lines[1].split('\t');
  assert.equal(c[0], 'P1 période'); assert.equal(c[1], '2026-12-04'); assert.equal(c[3], '4');
  assert.equal(c[7], '9', 'dispo min station : 9 le 06/12'); assert.equal(c[10], 'A');
  const m = WY.fleetCatsTSV([z]).split('\n');
  assert.equal(m.length, 4);
  assert.equal(m[1], 'A\t110');
  assert.equal(m[3], 'Z\t');
});

test('état : seuils par défaut, seuils incohérents remis à zéro', () => {
  assert.deepEqual(WY.stateDefaults().occTh, [81, 86, 87]);
  assert.deepEqual(WY.upgradeState({ v: 3, rolesSchema: WY.ROLES_SCHEMA, occTh: [90, 80, 95] }).occTh, [81, 86, 87]);
  assert.deepEqual(WY.upgradeState({ v: 3, rolesSchema: WY.ROLES_SCHEMA, occTh: [80, 85, 90] }).occTh, [80, 85, 90]);
  assert.deepEqual(WY.upgradeState({ v: 3, rolesSchema: WY.ROLES_SCHEMA }).occTh, [81, 86, 87], 'état antérieur à Rentway');
});
