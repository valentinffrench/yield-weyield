// Tests des signaux prix × volume.  Lancer :  node --test test/signals.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/signals.js');
const WY = globalThis.__WYP, S = WY.sig;
const day = s => WY.parseISO(s);

// ligne de période minimale, comme celles envoyées par le moteur
const row = (o = {}) => Object.assign({ p: { k: 4, num: 14, label: 'P14' }, from: day('2026-11-27'), to: day('2026-12-03'), nDays: 7, full: 7,
  cur: { rpd: 33, rev: 0, days: 70 }, ly: { rpd: 31, rev: 0, days: 100 }, lyf: { rpd: 32, rev: 0, days: 120 }, dLy: 6, dLyf: 3, dVol: -30, dVolF: -40 }, o);
const REF = day('2026-10-18');
const feat = (o, ctx = { medianVol: 100, kind: 'pace' }) => S.features(row(o), REF, ctx);

test('features : délai en jours, couverture, volume relatif, nature, sans aucun montant en €', () => {
  const f = feat();
  assert.equal(f.leadDays, 40); assert.equal(f.kind, 'pace');
  assert.equal(f.pacePct, -30); assert.equal(f.pricePct, 6); assert.equal(f.coverage, 1); assert.equal(f.volRel, 1);
  assert.ok(!JSON.stringify(f).includes('rev'));
  assert.equal(S.features(row(), REF, { medianVol: 100 }).kind, 'book');
});

test('eligible : écarte le passé, « Avant P1 » et les périodes sans donnée', () => {
  assert.equal(S.eligible(row(), REF), true);
  assert.equal(S.eligible(row({ to: day('2026-10-10') }), REF), false);
  assert.equal(S.eligible(row({ p: { k: -3, num: -2, label: 'P-2' } }), REF), false);
  assert.equal(S.eligible(row({ nDays: 0 }), REF), false);
});

test('règles : les cas de base', () => {
  const a = (pace, price, extra) => S.rules(feat(Object.assign({ dVol: pace, dLy: price }, extra))).action;
  assert.equal(a(15, 0), 'raise');
  assert.equal(a(25, 6), 'raise');
  assert.equal(a(25, 12), 'hold');
  assert.equal(a(12, 5), 'hold');
  assert.equal(a(-15, 1), 'lower');
  assert.equal(a(-30, -4), 'lower');
  assert.equal(a(-30, -12), 'review');
  assert.equal(a(-12, -6), 'review');
  assert.equal(a(2, 1), 'hold');
});

test('règles : données fragiles ou absentes → « voir » ; le texte nomme la bonne lecture du volume', () => {
  assert.equal(S.rules(feat({ nDays: 3 })).action, 'review');
  assert.equal(S.rules(feat({ ly: { rpd: 31, days: 10 } })).action, 'review');
  assert.equal(S.rules(feat({ dVol: null })).action, 'review');
  assert.match(S.rules(feat({ dVol: null })).why, /absents/);
  assert.match(S.rules(feat({ dVol: 15, dLy: 0 }, { medianVol: 100, kind: 'pace' })).why, /^rythme/);
  assert.match(S.rules(feat({ dVol: 15, dLy: 0 }, { medianVol: 100, kind: 'book' })).why, /^portefeuille/);
});

test('clé de caractéristiques : stable, change quand un écart change', () => {
  assert.equal(S.key(feat()), S.key(feat()));
  assert.notEqual(S.key(feat()), S.key(feat({ dVol: -29 })));
});

test('requête Jev : 5 questions, choix direct à 3 options SANS « voir », aucun € ni CA', () => {
  const b = S.jevBody(feat());
  assert.deepEqual(Object.keys(b.questions).sort(), ['action', 'overpriced', 'pace', 'price', 'underpriced']);
  assert.equal(b.questions.pace.criteria.length, 5);
  assert.deepEqual(Object.keys(b.questions.action.criteria), ['hold', 'raise', 'lower']);
  assert.equal(b.state.booking_pace_vs_last_year.summary, 'much slower');
  assert.equal(b.state.price_vs_last_year_same_date.summary, 'higher');
  assert.match(b.state.situation, /^Rental period P14 starts in 6 weeks\./);
  const txt = JSON.stringify(b);
  assert.ok(!/€|\beur\b|\bCA\b|"rev"|"rpd"|"days"/i.test(txt), 'aucun montant ne doit partir');
  assert.ok(b.questions.pace.instructions.includes('`booking_pace_vs_last_year`'));
});

test('requête Jev : un champ inconnu est OMIS (jamais « not available », que Jev lit comme « à voir »)', () => {
  const b = S.jevBody(feat({ dLyf: null }));
  assert.ok(!('price_vs_last_year_final' in b.state));
  assert.ok(!/not available|unknown|null|NaN/.test(JSON.stringify(b)));
  assert.ok(!b.questions.underpriced.instructions.includes('price_vs_last_year_final'));
  assert.ok(S.jevBody(feat()).questions.underpriced.instructions.includes('price_vs_last_year_final'));
});

test('requête Jev : page Réservations (portefeuille) ≠ page Évolution (rythme)', () => {
  const book = S.jevBody(feat({ dVol: 15 }, { medianVol: 100, kind: 'book' }));
  assert.ok('bookings_on_the_books_vs_last_year' in book.state && !('booking_pace_vs_last_year' in book.state));
  assert.equal(book.state.bookings_on_the_books_vs_last_year.summary, 'ahead');
  assert.match(book.state.situation, /already on the books/);
  assert.match(book.questions.pace.instructions, /on the books/);
  const pace = S.jevBody(feat({ dVol: 15 }));
  assert.equal(pace.state.booking_pace_vs_last_year.summary, 'faster');
  assert.match(pace.state.situation, /New bookings are coming in/);
});

test('Jev n\'est pas appelé quand le code sait déjà conclure', () => {
  assert.equal(S.skipJev(feat()), false);
  assert.equal(S.skipJev(feat({ nDays: 2 })), true);
  assert.equal(S.skipJev(feat({ dVol: null })), true);
});

const RES = (under, over, choice = 'hold') => ({ model: 'jev-1.13.0', answers: {
  action: { type: 'choice', choice, confidence: 0.7, probabilities: { [choice]: 0.7 } },
  underpriced: { type: 'noul', noul: under }, overpriced: { type: 'noul', noul: over },
  pace: { type: 'score', score: 0.6, confidence: 0.7, probabilities: {} }, price: { type: 'score', score: 3.1, confidence: 0.7, probabilities: {} },
}, usage: { input_tokens: 400, output_tokens: 20 } });

test('décodage Jev : verdict COMPOSÉ des deux oui/non, choix direct gardé à côté', () => {
  const lower = S.parseJev(RES(0.1, 0.85, 'lower'));
  assert.equal(lower.action, 'lower'); assert.equal(lower.conf, 0.85); assert.equal(lower.choice, 'lower');
  assert.ok(Math.abs(lower.pace - (0.6 - 2)) < 1e-9); assert.ok(Math.abs(lower.price - 1.1) < 1e-9);
  assert.equal(S.parseJev(RES(0.9, 0.05, 'hold')).action, 'raise');
  assert.equal(S.parseJev(RES(0.9, 0.05, 'hold')).choice, 'hold');          // le désaccord composé / direct reste visible
  const hold = S.parseJev(RES(0.1, 0.2)); assert.equal(hold.action, 'hold'); assert.ok(Math.abs(hold.conf - 0.8) < 1e-9);
});

test('décodage Jev : contradiction ou hésitation → « voir » avec la raison', () => {
  assert.equal(S.parseJev(RES(0.7, 0.7)).action, 'review');
  assert.equal(S.parseJev(RES(0.7, 0.7)).note, 'signaux contradictoires');
  const hes = S.parseJev(RES(0.5, 0.2)); assert.equal(hes.action, 'review'); assert.equal(hes.note, 'signal hésitant');
});

test('décodage Jev : réponse inattendue → erreur lisible', () => {
  assert.throws(() => S.parseJev({ answers: {} }), /inattendue/);
  assert.throws(() => S.parseJev(null), /inattendue/);
  assert.throws(() => S.parseJev({ answers: { underpriced: { noul: 'x' }, overpriced: { noul: 0.1 } } }), /inattendue/);
});

test('jevCall : en-têtes, nouvel essai sur 429, erreur 401 explicite', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? { ok: false, status: 429, text: async () => '' } : { ok: true, status: 200, json: async () => RES(0.1, 0.1) }; };
  const res = await S.jevCall({ apiKey: 'k-123', model: 'jev-latest', body: { state: 'x', questions: {} }, fetchImpl });
  assert.equal(res.answers.underpriced.noul, 0.1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k-123');
  assert.equal(JSON.parse(calls[0].init.body).model, 'jev-latest');
  await assert.rejects(S.jevCall({ apiKey: 'bad', model: 'm', body: {}, fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid key"}' }) }), e => e.status === 401 && /invalid/.test(e.body));
});

test('pool : respecte la concurrence maximale', async () => {
  let run = 0, max = 0;
  await S.pool([1, 2, 3, 4, 5, 6, 7], 3, async () => { run++; max = Math.max(max, run); await new Promise(r => setTimeout(r, 5)); run--; });
  assert.equal(max, 3);
});

test('tableau de bord : étiquettes 👍/👎, score règles / Jev composé / Jev choix direct', () => {
  const J = [
    { shown: 'lower', vote: 'up', rules: { action: 'lower' }, jev: { action: 'lower', choice: 'hold' } },
    { shown: 'lower', vote: 'down', fix: 'hold', rules: { action: 'lower' }, jev: { action: 'hold', choice: 'hold' } },
    { shown: 'raise', vote: 'down', rules: { action: 'raise' }, jev: { action: 'raise', choice: 'raise' } },
    { shown: 'hold', vote: 'up', rules: { action: 'hold' }, jev: null },
  ];
  assert.deepEqual(S.scoreboard(J), { rated: 4, labelled: 3, rules: 2, jev: 2, jevN: 2, choice: 1, choiceN: 2 });
});

test('export CSV : en-têtes, virgule décimale, aucun montant', () => {
  const csv = S.toCSV([{ t: '2026-10-19T10:00:00Z', period: 'P14', kind: 'pace', window: 7, lead: 40, pricePct: 6.04, priceFinalPct: 3, pacePct: -30.2, shown: 'lower', source: 'jev', vote: 'up', rules: { action: 'lower' }, jev: { action: 'lower', conf: 0.82, under: 0.1, over: 0.8, choice: 'hold' } }]);
  const [h, r] = csv.split('\n').map(l => l.split('\t'));
  assert.equal(h.length, r.length);
  assert.equal(r[2], 'pace'); assert.equal(r[3], '7'); assert.equal(r[5], '6'); assert.equal(r[7], '-30,2'); assert.equal(r[10], '0,82'); assert.equal(r[13], 'hold');
  assert.ok(!/€|rev|ca_/i.test(csv));
});

const featW = (w, o) => S.features(row(o), REF, { medianVol: 100, kind: 'pace', windowDays: w });

test('T18 · fenêtre du rythme : étiquette, requête Jev, clé de péremption', () => {
  assert.equal(S.kindLabel('pace', 7), 'Rythme · 7 j'); assert.equal(S.kindLabel('pace', null), 'Rythme'); assert.equal(S.kindLabel('book', 7), 'Portefeuille');
  const b = S.jevBody(featW(7));
  assert.equal(b.state.window_days, 7);
  assert.match(b.state.situation, /over the last 7 days/);
  assert.match(b.questions.pace.instructions, /over the last 7 days/);
  const none = S.jevBody(featW(null));
  assert.ok(!('window_days' in none.state), 'fenêtre inconnue : champ omis');
  assert.ok(!/last \d+ days/.test(JSON.stringify(none)), 'ni dans le texte');
  assert.notEqual(S.key(featW(7)), S.key(featW(14)), 'changer de fenêtre périme le résultat Jev');
  assert.equal(S.key(featW(7)), S.key(featW(7)));
  const bk = S.jevBody(S.features(row(), REF, { medianVol: 100, kind: 'book', windowDays: 7 }));
  assert.ok(!('window_days' in bk.state), 'le portefeuille n\'a pas de fenêtre');
});
