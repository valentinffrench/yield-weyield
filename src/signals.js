// Signaux prix × volume : verdict par règles (gratuit, instantané) et par Jev (TypeSafe System One), journal 👍/👎.
// Logique pure, sans DOM : testable sous Node (test/signals.test.js). Le code MESURE (écarts relatifs) et décide de ce qu'il sait
// décider (données fragiles) ; Jev JUGE ce qui demande du bon sens (prix trop bas ? trop haut ?) ; le code combine et explique.
// Rien de ce module n'envoie de € ni de CA : uniquement des écarts relatifs, des délais et des libellés.
(function (root) {
  const WY = (root.__WYP = root.__WYP || {});
  const D = 86400000;
  const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

  // Hypothèses de départ, à recalibrer avec le journal (👍/👎).
  const T = { paceMild: 7, paceStrong: 20, priceMild: 3, priceStrong: 8, minCoverage: 0.6, thinVol: 0.25, jevHi: 0.6, jevLo: 0.4 };

  const ACTIONS = {
    raise: { label: 'Relever', glyph: '▲' },
    lower: { label: 'Baisser', glyph: '▼' },
    hold: { label: 'Tenir', glyph: '●' },
    review: { label: 'Voir', glyph: '?' },
  };
  const DIRECT = ['hold', 'raise', 'lower']; // options du choix direct ; « hold » en tête : le modèle penche vers la première, autant que ce soit la prudente
  // Deux lectures du volume selon la page : « rythme » (Évolution : réservations captées sur la fenêtre 7/14/21/28 j) ou
  // « portefeuille » (Réservations : OnRent déjà acquis à la même date).
  const KIND_LABEL = { pace: 'Rythme', book: 'Portefeuille' };
  // Le rythme dépend de la fenêtre choisie sous le graphique (1 à 7, 7/14/21/28 ou 30/60/90/120 jours) : on l'affiche.
  const kindLabel = (kind, windowDays) => (kind === 'pace' ? (windowDays ? `Rythme · ${windowDays} j` : 'Rythme') : KIND_LABEL.book);

  const round1 = n => Math.round(n * 10) / 10;
  const sp = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))} %`;
  const median = a => { const s = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  // ---------- caractéristiques par période ----------
  // Périodes concernées : numérotées, pas encore terminées, avec des données chargées.
  const eligible = (row, ref) => row.p.num >= 1 && row.to >= ref && row.nDays > 0;
  const context = (rows, ref, kind, windowDays) => ({ kind: kind || 'book', windowDays: windowDays || null, medianVol: median(rows.filter(r => eligible(r, ref)).map(r => r.ly && r.ly.days)) });
  function features(row, ref, ctx) {
    return {
      k: row.p.k, label: row.p.label, kind: (ctx && ctx.kind) || 'book', windowDays: (ctx && ctx.windowDays) || null, leadDays: Math.round((row.from - ref) / D),
      pricePct: row.dLy, priceFinalPct: row.dLyf, pacePct: row.dVol,
      coverage: row.full ? row.nDays / row.full : 0,
      volRel: ctx && ctx.medianVol > 0 && row.ly && row.ly.days != null ? row.ly.days / ctx.medianVol : null,
    };
  }
  const key = f => [f.leadDays, f.pricePct, f.priceFinalPct, f.pacePct, f.coverage, f.volRel].map(v => (v == null ? '' : Math.round(v * 10))).join('/') + '|w' + (f.windowDays || '');
  const usable = f => f.pricePct != null && f.pacePct != null;
  const fragile = f => f.coverage < T.minCoverage || (f.volRel != null && f.volRel < T.thinVol);
  const volName = f => (f.kind === 'pace' ? 'rythme' : 'portefeuille');

  // ---------- verdict par règles ----------
  function rules(f) {
    if (!usable(f)) return { action: 'review', strength: 0, why: 'Prix ou volume absents de cet affichage : rien à comparer.' };
    const p = f.pacePct, q = f.pricePct, tag = `${volName(f)} ${sp(p)}, prix ${sp(q)} vs N-1`;
    if (fragile(f)) return { action: 'review', strength: 0, why: `Données partielles ou volume faible (${tag}) : à regarder à la main.` };
    const fast = p >= T.paceMild, slow = p <= -T.paceMild, sF = p >= T.paceStrong, sS = p <= -T.paceStrong;
    const dear = q >= T.priceMild, cheap = q <= -T.priceMild, vdear = q >= T.priceStrong, vcheap = q <= -T.priceStrong;
    const s = Math.min(1, Math.abs(p) / 30);
    if ((fast && !dear) || (sF && !vdear)) return { action: 'raise', strength: s, why: `${tag} : le volume suit sans prix plus élevé, marge pour relever.` };
    if ((slow && !cheap) || (sS && !vcheap)) return { action: 'lower', strength: s, why: `${tag} : le volume recule alors que le prix n'est pas plus bas, il freine probablement.` };
    if (fast) return { action: 'hold', strength: 0.4, why: `${tag} : le volume tient malgré un prix plus haut, rien à corriger.` };
    if (slow) return { action: 'review', strength: 0.4, why: `${tag} : volume faible même à prix plus bas, le prix n'est sans doute pas le levier.` };
    return { action: 'hold', strength: 0.3, why: `${tag} : cohérent avec N-1.` };
  }

  // ---------- verdict par Jev ----------
  const paceWord = p => (p == null ? 'unknown' : p <= -T.paceStrong ? 'much slower' : p <= -T.paceMild ? 'slower' : p < T.paceMild ? 'about the same' : p < T.paceStrong ? 'faster' : 'much faster');
  const bookWord = p => (p == null ? 'unknown' : p <= -T.paceStrong ? 'far behind' : p <= -T.paceMild ? 'behind' : p < T.paceMild ? 'about level' : p < T.paceStrong ? 'ahead' : 'far ahead');
  const priceWord = q => (q == null ? 'unknown' : q <= -T.priceStrong ? 'much lower' : q <= -T.priceMild ? 'lower' : q < T.priceMild ? 'about the same' : q < T.priceStrong ? 'higher' : 'much higher');
  const when = d => (d <= 0 ? 'is under way' : d < 14 ? `starts in ${d} days` : `starts in ${Math.round(d / 7)} weeks`);

  // Corps de requête : un État par période, 5 questions indépendantes évaluées en parallèle par Jev.
  // Questions, niveaux et clés d'état en anglais (langue d'entraînement principale de Jev).
  // Les champs inconnus sont OMIS (jamais « not available » : Jev y lit « données manquantes » et répond « à voir » partout).
  function jevBody(f) {
    const book = f.kind === 'book', vk = book ? 'bookings_on_the_books_vs_last_year' : 'booking_pace_vs_last_year', vw = book ? bookWord : paceWord;
    const state = { period: f.label, timing: when(f.leadDays) };
    if (!book && f.windowDays) state.window_days = f.windowDays;   // champ inconnu = champ omis
    state[vk] = { change_percent: round1(f.pacePct), summary: vw(f.pacePct) };
    state.price_vs_last_year_same_date = { change_percent: round1(f.pricePct), summary: priceWord(f.pricePct) };
    if (f.priceFinalPct != null) state.price_vs_last_year_final = { change_percent: round1(f.priceFinalPct), summary: priceWord(f.priceFinalPct) };
    state.situation = book
      ? `Rental period ${f.label} ${when(f.leadDays)}. Bookings already on the books are ${vw(f.pacePct)} compared with last year at the same date (${sp(f.pacePct)}). Our average price is ${priceWord(f.pricePct)} than last year (${sp(f.pricePct)}).`
      : `Rental period ${f.label} ${when(f.leadDays)}. New bookings ${f.windowDays ? `over the last ${f.windowDays} days ` : ''}are coming in at a pace that is ${vw(f.pacePct)} than last year (${sp(f.pacePct)}). Our average price is ${priceWord(f.pricePct)} than last year (${sp(f.pricePct)}).`;
    const ref = `\`${vk}\` together with \`price_vs_last_year_same_date\`${f.priceFinalPct != null ? ' and `price_vs_last_year_final`' : ''}`;
    return {
      state,
      questions: {
        pace: { type: 'score', instructions: book ? `How does the volume of bookings already on the books for this rental period compare with last year at the same date? Look at \`${vk}\`.` : `How fast are bookings coming in${f.windowDays ? ` over the last ${f.windowDays} days` : ''} for this rental period compared with last year? Look at \`${vk}\`.`,
          criteria: book
            ? ['Far fewer bookings than last year at this date', 'Somewhat fewer bookings than last year', 'About as many bookings as last year', 'Somewhat more bookings than last year', 'Far more bookings than last year']
            : ['Bookings are coming in much slower than last year', 'Bookings are somewhat slower than last year', 'Bookings are coming in at about the same pace as last year', 'Bookings are somewhat faster than last year', 'Bookings are coming in much faster than last year'] },
        price: { type: 'score', instructions: 'How does our price for this rental period compare with last year? Look at `price_vs_last_year_same_date`.',
          criteria: ['Our price is much lower than last year', 'Our price is somewhat lower than last year', 'Our price is about the same as last year', 'Our price is somewhat higher than last year', 'Our price is much higher than last year'] },
        underpriced: { type: 'noul', instructions: `Our price for this rental period is probably too low: demand is strong enough that we could charge more without losing bookings. Weigh ${ref}.`,
          criteria: { true: 'Bookings are about level with or ahead of last year while our price is the same as or lower than last year, so we sell as much for less', false: 'Bookings are behind last year, or our price is already clearly higher than last year, or demand does not justify a higher price' } },
        overpriced: { type: 'noul', instructions: `Our price for this rental period is probably too high: it is likely holding bookings back. Weigh ${ref}.`,
          criteria: { true: 'Bookings are behind last year while our price is the same as or higher than last year, so price is probably the obstacle', false: 'Bookings keep up with last year, or our price is already clearly lower than last year, or price is probably not the obstacle' } },
        action: { type: 'choice', instructions: 'What would an experienced car-rental revenue manager do first for this rental period?',
          criteria: {
            hold: 'Keep the price as it is: bookings and price are consistent with last year, or demand holds up at a higher price',
            raise: 'Raise the price: bookings are level with or ahead of last year and our price is not higher, so there is room to charge more',
            lower: 'Lower the price: bookings are behind last year and our price is not lower, so price is probably holding demand back',
          } },
      },
    };
  }
  // Décode la réponse (formats documentés : noul → { noul }, choice → { choice, confidence, probabilities }, score → { score 0-indexé }).
  // Verdict COMPOSÉ des deux oui/non (graduels, pondérables) ; le choix direct est gardé à côté pour comparer.
  function parseJev(res) {
    const a = res && res.answers;
    if (!a || !a.underpriced || !a.overpriced || typeof a.underpriced.noul !== 'number' || typeof a.overpriced.noul !== 'number') throw new Error('Réponse Jev inattendue (réponses « underpriced » / « overpriced » absentes)');
    const U = a.underpriced.noul, O = a.overpriced.noul;
    const out = { under: U, over: O, choice: a.action && DIRECT.includes(a.action.choice) ? a.action.choice : null, choiceConf: a.action && a.action.confidence, probs: (a.action && a.action.probabilities) || {},
      pace: a.pace && typeof a.pace.score === 'number' ? a.pace.score - 2 : null, price: a.price && typeof a.price.score === 'number' ? a.price.score - 2 : null, note: '' };
    if (U >= T.jevHi && O < T.jevLo) { out.action = 'raise'; out.conf = U; }
    else if (O >= T.jevHi && U < T.jevLo) { out.action = 'lower'; out.conf = O; }
    else if (U < T.jevLo && O < T.jevLo) { out.action = 'hold'; out.conf = 1 - Math.max(U, O); }
    else { out.action = 'review'; out.conf = 0.5; out.note = U >= T.jevLo && O >= T.jevLo ? 'signaux contradictoires' : 'signal hésitant'; }
    return out;
  }
  // Pas besoin de Jev quand le code sait déjà conclure (données fragiles ou absentes).
  const skipJev = f => !usable(f) || fragile(f);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function jevCall({ apiKey, model, body, fetchImpl }) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ model }, body)) });
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status === 529) && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
      const e = new Error(`HTTP ${res.status}`); e.status = res.status; e.body = (await res.text().catch(() => '')).slice(0, 300); throw e;
    }
  }
  async function pool(items, n, fn) {
    let i = 0; const worker = async () => { while (i < items.length) { const x = items[i++]; await fn(x); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  }

  // ---------- journal 👍/👎 et tableau de bord « Jev vs règles » ----------
  // Étiquette : 👍 → le verdict affiché ; 👎 avec correction → la correction ; 👎 seul → inconnue (on sait juste que l'affiché est faux).
  const labelOf = e => (e.vote === 'up' ? e.shown : e.vote === 'down' ? e.fix || null : null);
  function scoreboard(journal) {
    const sb = { rated: journal.length, labelled: 0, rules: 0, jev: 0, jevN: 0, choice: 0, choiceN: 0 };
    journal.forEach(e => {
      const l = labelOf(e); if (!l) return;
      sb.labelled++;
      if (e.rules && e.rules.action === l) sb.rules++;
      if (e.jev) { sb.jevN++; if (e.jev.action === l) sb.jev++; if (e.jev.choice) { sb.choiceN++; if (e.jev.choice === l) sb.choice++; } }
    });
    return sb;
  }
  const CSV_COLS = ['date', 'periode', 'nature', 'fenetre_j', 'delai_j', 'prix_vs_n1_pct', 'prix_vs_final_pct', 'ecart_volume_vs_n1_pct', 'regles', 'jev', 'jev_confiance', 'jev_sous_tarif', 'jev_sur_tarif', 'jev_choix', 'affiche', 'source', 'vote', 'correction'];
  const cell = v => (v == null ? '' : String(v).replace('.', ',').replace(/[\t\n]/g, ' '));
  const toCSV = journal => [CSV_COLS.join('\t')].concat(journal.map(e => [e.t, e.period, e.kind, e.window, e.lead, e.pricePct == null ? null : round1(e.pricePct), e.priceFinalPct == null ? null : round1(e.priceFinalPct),
    e.pacePct == null ? null : round1(e.pacePct), e.rules && e.rules.action, e.jev && e.jev.action, e.jev && e.jev.conf, e.jev && e.jev.under, e.jev && e.jev.over, e.jev && e.jev.choice, e.shown, e.source, e.vote, e.fix].map(cell).join('\t'))).join('\n');

  WY.sig = { T, ACTIONS, DIRECT, KIND_LABEL, kindLabel, ENDPOINT, eligible, context, features, key, usable, fragile, skipJev, rules, paceWord, bookWord, priceWord, jevBody, parseJev, jevCall, pool, labelOf, scoreboard, toCSV, CSV_COLS };
})(typeof window !== 'undefined' ? window : globalThis);
