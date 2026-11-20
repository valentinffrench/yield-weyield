// Logique pure : dates, paliers (cost-breaks), grille de périodes, agrégation du RPJ.
// Aucune dépendance au DOM ni à Highcharts → testable sous Node (cf. test/core.test.js).
(function (root) {
  const WY = (root.__WYP = root.__WYP || {});

  const D = 86400000;
  const DEFAULT_TIERS = '1-2, 3-6, 7-13, 14-20, 21-30, 31-60';
  // Rôles de séries lus par l'extension (partagés avec le panneau) : prix (RPJ) et volume × N, N-1 (même date), N-1 final.
  const ROLES = ['curRpd', 'curVol', 'lyRpd', 'lyVol', 'lyfRpd', 'lyfVol'];
  const ROLE_LABEL = { curRpd: 'RPJ N', curVol: 'Volume N', lyRpd: 'RPJ N-1', lyVol: 'Volume N-1', lyfRpd: 'RPJ N-1 final', lyfVol: 'Volume N-1 final' };
  const PALETTE = ['231,76,60', '230,126,34', '201,162,11', '39,174,96', '41,128,185', '142,68,173', '22,160,133', '127,140,141', '192,57,43', '44,62,80'];

  // ---------- dates (tout en jours UTC, comme les séries Highcharts) ----------
  const utcDay = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const isoDay = t => new Date(t).toISOString().slice(0, 10);
  const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const mondayOf = t => utcDay(t) - ((new Date(t).getUTCDay() + 6) % 7) * D;
  const fmtDM = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtDMY = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  // ---------- paliers : "1-2, 3-6, 7-13" → [[1,2],[3,6],[7,13]] ----------
  function parseTiers(txt) {
    const tiers = [], bad = [];
    String(txt).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).forEach(s => {
      const m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m && +m[2] >= +m[1]) tiers.push([+m[1], +m[2]]); else bad.push(s);
    });
    return { tiers, bad };
  }
  // J0 = premier jour de la période, décalé de `offset` jours (négatif = avant le début).
  const j0Of = (period, offset) => period.from + (Math.round(+offset) || 0) * D;
  const tiersToText = tiers => tiers.map(([a, b]) => `${a}-${b}`).join(', ');
  // Une location de a à b jours au départ de J0 revient entre J0+a et J0+b : c'est la zone du palier.
  const tierZones = (j0, tiers) => tiers.map(([a, b], i) => ({ label: `${a}-${b}j`, a, b, ci: i, from: j0 + a * D, to: j0 + b * D }));

  // ---------- grille de périodes ----------
  // cfg : { gridDate:'YYYY-MM-DD'|'', gridNum, gridLen, gridUnit:'d'|'w' }
  // « La période n° gridNum commence le gridDate ». Sans date : P1 = lundi de la semaine de référence.
  const gridLenDays = cfg => Math.max(1, Math.round(+cfg.gridLen || 1)) * (cfg.gridUnit === 'd' ? 1 : 7);
  function makeGrid(cfg, refDay) {
    const len = gridLenDays(cfg);
    const given = parseISO(cfg.gridDate);
    const auto = isNaN(given);
    const anchor = auto ? mondayOf(refDay) : given;
    const num0 = auto ? 1 : (Math.round(+cfg.gridNum) || 1);
    const at = k => { const from = anchor + k * len * D; return { k, num: num0 + k, from, to: from + (len - 1) * D, label: 'P' + (num0 + k) }; };
    const indexAt = t => Math.floor((utcDay(t) - anchor) / (len * D));
    const inRange = (lo, hi) => { const out = []; for (let k = indexAt(lo), k1 = indexAt(hi); k <= k1 && out.length < 400; k++) out.push(at(k)); return out; };
    return { len, anchor, num0, auto, at, indexAt, inRange, p1: anchor - (num0 - 1) * len * D };
  }

  // ---------- RPJ : CA ÷ jours loués (moyenne pondérée par OnRent) ----------
  // vol : Map jour→voitures louées ; rpd : Map jour→revenu par jour (la série « Revenu par jour » du graphique)
  function agg(vol, rpd, s, e) {
    if (!rpd) return null;
    let rev = 0, days = 0, sum = 0, n = 0;
    for (let t = s; t <= e; t += D) {
      // WeYield stocke NaN (0/0) et ±Infinity (x/0) les jours sans volume net (new-bookings/1-day) : jamais dans une moyenne.
      const p = rpd.get(t); if (p == null || !Number.isFinite(p)) continue;
      sum += p; n++;
      const v = vol && vol.get(t); if (v != null && Number.isFinite(v)) { rev += v * p; days += v; }
    }
    if (!n) return null;
    // Moyenne pondérée par le volume. Sur le rythme (volumes NETS : annulations > réservations), `days` peut être nul ou négatif :
    // on retombe alors, volontairement, sur la moyenne simple des RPJ finis du jour.
    return { rpd: days > 0 ? rev / days : sum / n, rev, days };
  }
  const pct = (a, b) => (a && b && a.rpd && b.rpd ? (a.rpd / b.rpd - 1) * 100 : null);
  // Écart de volume (jours loués / réservations captées dans la fenêtre affichée) : le « rythme » vs N-1.
  const vpct = (a, b) => (a && b && a.days != null && b.days > 0 ? (a.days / b.days - 1) * 100 : null);

  // S : { cur, ly, lyf : {vol, rpd}|null, range:[lo,hi] }  (cur = N, ly = N-1 même date, lyf = N-1 final)
  function zoneStats(S, from, to) {
    const [lo, hi] = S.range;
    const s = Math.max(from, lo), e = Math.min(to, hi);
    const nDays = e >= s ? Math.round((e - s) / D) + 1 : 0;
    const full = Math.round((to - from) / D) + 1;
    const one = ser => (nDays && ser ? agg(ser.vol, ser.rpd, s, e) : null);
    const cur = one(S.cur), ly = one(S.ly), lyf = one(S.lyf);
    return { from, to, nDays, full, cur, ly, lyf, dLy: pct(cur, ly), dLyf: pct(cur, lyf), dVol: vpct(cur, ly), dVolF: vpct(cur, lyf) };
  }

  // Palier cumulé : du début du plus court palier jusqu'à la fin de celui-ci, CA ÷ jours loués sur toute la plage.
  // Le RPJ d'une date mêle toutes les locations en cours ce jour-là : la zone 21-30j de P13 contient aussi les départs P14 en 14-20j, P15 en 7-13j…
  // Le cumulé lit donc d'un bloc les jours qu'une location partie à J0 traverse. Paliers « jusqu'à lui » = ceux qui finissent au plus tard avec lui.
  const cumZones = (S, zones) => zones.map(z => Object.assign({ label: z.label, a: z.a, b: z.b, ci: z.ci },
    zoneStats(S, Math.min(...zones.filter(o => o.b <= z.b).map(o => o.from)), z.to)));

  // ---------- balance de flotte (Rentway) : occupation par zone de dates ----------
  // Enregistrements bruts du PivotGrid Rentway (cf. docs/rentway-layout.md) :
  // { locationID, locationName, groupID, date:'2026-12-02T00:00:00', availableVehicles, totalVehicles }.
  // Occupation d'un jour = 1 − dispo ÷ flotte (la règle des couleurs de Rentway). Sur une zone : jours-véhicules additionnés.
  // Seuils de référence yield (formation du 16/04/2026) : 81-82 % confortable, 86 % limite, 87 % pic.
  const OCC_TH = [81, 86, 87];
  const OCC_LEVELS = ['Marge', 'Confortable', 'Limite', 'Pic', 'Surbooking'];
  const FLEET_SKIP = new Set(['date', 'availableVehicles', 'totalVehicles', 'locationID', 'locationName']);
  // La date est lue sur le texte (« 2026-12-02T00:00:00 », heure locale de Rentway) : jamais via new Date(), qui dépend du fuseau du poste.
  const rwDay = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  function fleetFromRecords(recs) {
    if (!Array.isArray(recs) || !recs.length || !recs[0]) return null;
    const r0 = recs[0];
    // Ligne « catégorie » : groupID (vue Groupes) ou segmentID (vue Segments, non observée), sinon le premier champ de ligne inconnu.
    const catField = ['groupID', 'segmentID'].find(k => k in r0) || Object.keys(r0).find(k => !FLEET_SKIP.has(k)) || null;
    const locField = 'locationName' in r0 ? 'locationName' : 'locationID' in r0 ? 'locationID' : null;
    const all = new Map(), cats = new Map(), locs = new Set();
    const add = (m, d, a, t) => { const x = m.get(d); if (x) { x.a += a; x.t += t; } else m.set(d, { a, t }); };
    let lo = Infinity, hi = -Infinity, bad = 0;
    for (const r of recs) {
      const d = rwDay(r && r.date), a = +(r && r.availableVehicles), t = +(r && r.totalVehicles);
      if (!Number.isFinite(d) || !Number.isFinite(a)) { bad++; continue; }
      const tt = Number.isFinite(t) ? t : 0, c = catField ? String(r[catField]) : '–';
      if (locField) locs.add(String(r[locField]));
      add(all, d, a, tt);
      if (!cats.has(c)) cats.set(c, new Map());
      add(cats.get(c), d, a, tt);
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    if (!all.size) return null;
    return { all, cats, order: [...cats.keys()], catField, locField, locs: locs.size, range: [lo, hi], n: recs.length, bad };
  }
  // m : Map jour → { a: dispo, t: flotte }. Jours sans donnée ignorés ; une flotte nulle (catégorie vide) ne donne pas d'occupation.
  function fleetAgg(m, s, e) {
    if (!m) return null;
    let a = 0, t = 0, n = 0, fleet = 0, over = 0, minAvail = null, minDay = null, peak = null, peakDay = null;
    for (let d = s; d <= e; d += D) {
      const x = m.get(d); if (!x) continue;
      n++; a += x.a; t += x.t; if (x.t > fleet) fleet = x.t;
      if (x.a < 0) over++;
      if (minAvail == null || x.a < minAvail) { minAvail = x.a; minDay = d; }
      const o = x.t > 0 ? 1 - x.a / x.t : null;
      if (o != null && (peak == null || o > peak)) { peak = o; peakDay = d; }
    }
    if (!n) return null;
    return { days: n, avail: a, fleetDays: t, fleet, occ: t > 0 ? 1 - a / t : null, peak, peakDay, minAvail, minDay, overDays: over };
  }
  const occThOf = o => (o && Array.isArray(o.occTh) && o.occTh.length === 3 ? o.occTh : OCC_TH);
  // Niveau d'une occupation (fraction) : -1 sans flotte, 0 marge, 1 confortable, 2 limite, 3 pic, 4 surbooking (dispo négative).
  function occLevel(v, th, overDays) {
    if (overDays > 0) return 4;
    if (v == null || !Number.isFinite(v)) return -1;
    const p = v * 100, T = th || OCC_TH;
    return p >= T[2] ? 3 : p >= T[1] ? 2 : p >= T[0] ? 1 : 0;
  }
  // Une catégorie est « en tension » sur une zone si son jour le plus chargé atteint la limite (ou si elle est en surbooking).
  function fleetZoneStats(F, from, to, opts) {
    const th = occThOf(opts), [lo, hi] = F.range;
    const s = Math.max(from, lo), e = Math.min(to, hi);
    const nDays = e >= s ? Math.round((e - s) / D) + 1 : 0, full = Math.round((to - from) / D) + 1;
    const all = nDays ? fleetAgg(F.all, s, e) : null;
    const cats = F.order.map(c => Object.assign({ cat: c }, (nDays && fleetAgg(F.cats.get(c), s, e)) || {}));
    const tense = cats.filter(c => occLevel(c.peak, th, c.overDays) >= 2).map(c => c.cat);
    return { from, to, nDays, full, all, cats, tense };
  }
  // Cumulé : du premier palier jusqu'à la fin de celui-ci → le jour le plus chargé que traverse une location de cette durée (le goulot).
  const fleetCumZones = (F, zones, opts) => zones.map(z => Object.assign({ label: z.label, a: z.a, b: z.b, ci: z.ci },
    fleetZoneStats(F, Math.min(...zones.filter(o => o.b <= z.b).map(o => o.from)), z.to, opts)));

  // ---------- état persistant : valeurs par défaut et mise à niveau (pures, testées sous Node) ----------
  // rolesSchema : les réglages de séries (maps) et le graphique forcé (dataIdx) enregistrés avant que les dispositions réelles de WeYield
  // soient connues étaient faux (des volumes servaient de prix). Quand le schéma change, on les remet à zéro UNE fois : ne pas toucher à `v`,
  // sinon l'état repasserait par la migration v1/v2 et perdrait grille et paliers.
  const ROLES_SCHEMA = 2;
  const stateDefaults = () => ({ v: 3, rolesSchema: ROLES_SCHEMA, periods: true, tiers: true, signals: true, tierList: parseTiers(DEFAULT_TIERS).tiers.map(t => t.slice()),
    gridDate: '', gridNum: 1, gridLen: 1, gridUnit: 'w', offset: 0, dataIdx: null, dataKey: null, maps: {}, occTh: OCC_TH.slice() });
  function upgradeState(raw) {
    const s = Object.assign(stateDefaults(), raw);
    if (raw.rolesSchema !== ROLES_SCHEMA) { s.maps = {}; s.dataIdx = null; s.dataKey = null; s.rolesSchema = ROLES_SCHEMA; }
    const th = s.occTh;
    if (!Array.isArray(th) || th.length !== 3 || !th.every(Number.isFinite) || th[0] > th[1] || th[1] > th[2]) s.occTh = OCC_TH.slice();
    return s;
  }

  // ---------- export tableur (TSV, virgule décimale) ----------
  const num2 = v => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
  function toTSV(rows) {
    const head = ['Zone', 'Début', 'Fin', 'Jours visibles', 'RPJ N', 'CA N', 'Jours loués N', 'RPJ N-1', 'CA N-1', 'Jours loués N-1',
      'RPJ N-1 final', 'CA N-1 final', 'Jours loués N-1 final', 'Δ RPJ vs N-1 %', 'Δ RPJ vs N-1 final %'];
    const lines = [head.join('\t')];
    rows.forEach(r => lines.push([r.label, isoDay(r.from), isoDay(r.to), r.nDays,
      num2(r.cur && r.cur.rpd), num2(r.cur && r.cur.rev), num2(r.cur && r.cur.days),
      num2(r.ly && r.ly.rpd), num2(r.ly && r.ly.rev), num2(r.ly && r.ly.days),
      num2(r.lyf && r.lyf.rpd), num2(r.lyf && r.lyf.rev), num2(r.lyf && r.lyf.days),
      num2(r.dLy), num2(r.dLyf)].join('\t')));
    return lines.join('\n');
  }
  // Balance de flotte : une ligne par zone (station entière), puis la matrice catégories × zones (pic d'occupation).
  const pc2 = v => (v == null ? '' : num2(v * 100));
  const day2 = t => (t == null ? '' : isoDay(t));
  function fleetTSV(rows) {
    const head = ['Zone', 'Début', 'Fin', 'Jours visibles', 'Occupation moy. %', 'Pic %', 'Jour du pic', 'Dispo min', 'Jour dispo min', 'Jours en surbooking', 'Catégories en tension'];
    const lines = [head.join('\t')];
    rows.forEach(r => { const a = r.all || {}; lines.push([r.label, isoDay(r.from), isoDay(r.to), r.nDays, pc2(a.occ), pc2(a.peak), day2(a.peakDay),
      a.minAvail == null ? '' : a.minAvail, day2(a.minDay), a.overDays == null ? '' : a.overDays, (r.tense || []).join(' ')].join('\t')); });
    return lines.join('\n');
  }
  function fleetCatsTSV(zones) {
    const cats = zones.length ? zones[0].cats.map(c => c.cat) : [];
    const lines = [['Catégorie (pic %)'].concat(zones.map(z => `${z.label} (${isoDay(z.from)} → ${isoDay(z.to)})`)).join('\t')];
    cats.forEach((c, i) => lines.push([c].concat(zones.map(z => pc2(z.cats[i] && z.cats[i].peak))).join('\t')));
    return lines.join('\n');
  }

  Object.assign(WY, { D, DEFAULT_TIERS, ROLES, ROLE_LABEL, ROLES_SCHEMA, stateDefaults, upgradeState, PALETTE, utcDay, isoDay, parseISO, mondayOf, fmtDM, fmtDMY,
    parseTiers, tiersToText, j0Of, tierZones, gridLenDays, makeGrid, agg, pct, zoneStats, cumZones, toTSV,
    OCC_TH, OCC_LEVELS, rwDay, fleetFromRecords, fleetAgg, occLevel, fleetZoneStats, fleetCumZones, fleetTSV, fleetCatsTSV });
})(typeof window !== 'undefined' ? window : globalThis);
