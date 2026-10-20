// Fixtures : les dispositions réelles de WeYield observées le 20/10/2026 (docs/weyield-layout.md), sous forme d'objets « façon Highcharts »
// avec ce que src/chart.js lit. Chaque graphique : 188 jours à minuit UTC du 13/10/2026 au 18/04/2027, bande native `past-band` jusqu'au 19/10/2026.
// Les N-1 partagent les x de N (WeYield aligne à 364 jours). Valeurs déterministes ; valeurs repères posées explicitement.
const D = 86400000, T0 = Date.UTC(2026, 9, 13), N = 188, REF = Date.UTC(2026, 9, 19);
const xs = () => Array.from({ length: N }, (_, i) => T0 + i * D);
const idx = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - T0) / D);
const fill = f => Array.from({ length: N }, (_, i) => f(i));
const wave = (base, amp, seed) => i => +(base + amp * Math.sin(i / 9 + seed)).toFixed(2);

// dash : 'dash' sur bookings/*, 'Dash' sur new-bookings/* ; undefined = trait plein
const S = (name, type, axis, dash, y) => ({ name, type, visible: true, options: { dashStyle: dash }, yAxis: { options: { index: axis } }, xData: y.length ? xs() : [], yData: y });
const range = f => fill(i => [+(f(i) * 0.9).toFixed(1), +(f(i) * 1.1).toFixed(1)]);     // arearange : paires [bas, haut]
const anon = (from, count, axis) => Array.from({ length: count }, (_, k) => S('Series ' + (from + k), 'line', axis, undefined, fill(wave(30 + k, 5, k))));

function chart(series) {
  return { renderer: {}, container: {}, series,
    xAxis: [{ min: T0, max: T0 + (N - 1) * D, options: { type: 'datetime', plotBands: [{ id: 'past-band', from: 0, to: REF }] } }],
    yAxis: [{ options: { index: 0 } }, { options: { index: 1 } }] };
}
const at = (y, iso, v) => { y[idx(iso)] = v; return y; };

// ---------- bookings/lastyear (onglet « En portefeuille ») ----------
function bookingsLastyear() {
  const s = [
    S('Series 1', 'line', 0, undefined, at(fill(wave(300, 60, 0)), '2027-04-04', 400)),
    S('Series 2', 'area', 0, undefined, at(fill(wave(40, 10, 1)), '2027-04-04', 30)),           // copie de `current` (remplissage gris)
    S('lastyear', 'area', 0, undefined, at(fill(wave(45, 10, 2)), '2027-04-04', 38)),
    S('current', 'line', 0, undefined, at(fill(wave(40, 10, 1)), '2027-04-04', 30)),
    S('fleet', 'line', 0, undefined, at(fill(() => 500), '2027-04-04', 500)),
    S('availableFleet', 'arearange', 0, undefined, range(() => 300)),
    S('lastYearReferenceFleet', 'line', 0, 'dash', at(fill(() => 440), '2027-04-04', 450)),
    S('lastYearAvailableReferenceFleet', 'arearange', 0, 'dash', range(() => 280)),
    S('Series 9', 'line', 1, undefined, at(fill(wave(36, 3, 3)), '2027-04-04', 35)),
    S('currentRpd', 'line', 1, undefined, at(fill(wave(38, 4, 4)), '2027-04-04', 40)),
    S('lastyearRpd', 'line', 1, 'dash', at(fill(wave(37, 4, 5)), '2027-04-04', 39)),
  ];
  return chart(s);
}

// ---------- bookings/final (onglet « Final ») : `lastyear` existe mais sans aucun point ----------
function bookingsFinal() {
  const s = [
    S('lastyear', 'line', 0, undefined, []),
    S('lastyearFinal', 'area', 0, 'dash', fill(i => +(300 + (450 - 300) * i / (N - 1)).toFixed(1))),
    ...anon(1, 2, 0),
    S('current', 'line', 0, undefined, fill(i => +(20 + (350 - 20) * i / (N - 1)).toFixed(1))),
    S('fleet', 'line', 0, undefined, fill(i => 500 + Math.round(10 * i / (N - 1)))),
    S('availableFleet', 'arearange', 0, undefined, range(() => 300)),
    S('lastYearFleet', 'line', 0, 'dash', fill(i => 400 + Math.round(120 * i / (N - 1)))),
    S('lastYearAvailableFleet', 'arearange', 0, 'dash', range(() => 280)),
    ...anon(3, 2, 1),
    S('currentRpd', 'line', 1, undefined, fill(i => +(18 + (48 - 18) * i / (N - 1)).toFixed(2))),
    S('lastyearFinalRpd', 'line', 1, 'dash', fill(i => +(18 + (50 - 18) * i / (N - 1)).toFixed(2))),
  ];
  return chart(s);
}

// ---------- new-bookings/*, premier graphique (« Évolution des réservations ») : stock empilé, aucun RPJ, aucun N-1 ----------
function newBookingsFirst(route = '1-day') {
  const big = route === '1-day', nAnon = big ? 15 : 9, nDelta = big ? 7 : 4;
  const s = [
    ...anon(1, nAnon, 0),
    ...Array.from({ length: nDelta }, () => S('delta', 'area', 0, undefined, fill(wave(20, 6, 7)))),
    S('current', 'line', 0, undefined, fill(wave(150, 40, 8))),
    S('fleet', 'line', 0, undefined, fill(() => 500)),
    S('availableFleet', 'area', 0, undefined, fill(() => 300)),
  ];
  return chart(s);
}

// ---------- new-bookings/*, second chart (« Évolution des réservations en 2026 vs 2025 ») : rythme net sur la fenêtre choisie ----------
// 1-day : les jours à volume net nul ont un RPJ NaN (0/0) ou +Infinity (x/0) ; volumes et RPJ parfois négatifs.
function newBookingsSecond(route = '1-day') {
  const ty = fill(i => 2 + (i % 4)), ly = fill(i => 3 + (i % 3)), rev = fill(i => +(20 + (i % 7) + 0.5).toFixed(2)), lrev = fill(i => +(19 + (i % 6) + 0.5).toFixed(2));
  if (route === '1-day') {
    const week = (a, from) => a.forEach((v, k) => { ty[from + k] = v; });
    week([0.4, 0, 0, -1.1, -1.9, 0.7, 0.5], idx('2026-10-20'));                                 // 20–26/10 : net N = −1,4 j
    [2.9, 3.8, 4.6, 3.1, 3.9, 2.8, 2.7].forEach((v, k) => { ly[idx('2026-10-20') + k] = v; });   // net N-1 = 23,8 j
    // 39 jours à volume net nul de chaque côté
    const z1 = new Set([8, 9, 16, 18]); for (let i = 15; i < N && z1.size < 39; i += 5) z1.add(i);
    const z2 = new Set([119, 120, 121, 122, 123]);
    for (const start of [23, 22]) for (let i = start; i < N && z2.size < 39; i += 5) z2.add(i);
    z1.forEach(i => { ty[i] = 0; rev[i] = NaN; }); rev[idx('2026-10-21')] = Infinity;            // +Infinity le 21/10 ; 38 NaN
    z2.forEach(i => { ly[i] = 0; lrev[i] = NaN; }); for (let i = 119; i <= 123; i++) lrev[i] = Infinity;   // 5 Infinity dès le 09/02 ; 34 NaN
    [10, 11, 51, 52, 53, 54, 56, 57].forEach(i => { if (ty[i] > 0) ty[i] = -(ty[i] / 2); });      // 8 jours de volume net négatif (N)
    ly[60] = -1;                                                                                   // 1 jour négatif (N-1)
    [41, 42, 43, 44, 46].forEach(i => { rev[i] = -Math.abs(rev[i]); });                            // 5 RPJ négatifs
    // 20–26/10 : RPJ finis sauf aux deux jours à volume nul
    [20.5, 0, 0, 21.4, 22.1, 23.0, 19.8].forEach((v, k) => { const i = idx('2026-10-20') + k; if (!z1.has(i)) rev[i] = v; });
  }
  at(ty, '2026-12-18', 2); at(ly, '2026-12-18', 4); at(rev, '2026-12-18', 25); at(lrev, '2026-12-18', 26);
  return chart([S('thisyear', 'area', 0, undefined, ty), S('lastyear', 'area', 0, 'Dash', ly), S('revenue', 'line', 1, undefined, rev), S('ly_revenue', 'line', 1, 'Dash', lrev)]);
}

module.exports = { T0, N, REF, D, idx, bookingsLastyear, bookingsFinal, newBookingsFirst, newBookingsSecond };
