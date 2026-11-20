// Banc Rentway : l'extension telle quelle (Chrome for Testing) sur une maquette de la Balance de flotte (rentway-mock.html, servie en
// https://rentwayv1.emotionmobility.com/), avec le panneau latéral ouvert sur cet onglet, plus la maquette WeYield pour la recopie des réglages.
// Prérequis : cd test/browser && npm install && npm run test:rentway   (CHROME_PATH=… si Chrome for Testing n'est pas dans le cache Playwright)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || os.homedir() + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const mockRW = fs.readFileSync(path.join(__dirname, 'rentway-mock.html'));
const mockWY = fs.readFileSync(path.join(__dirname, 'mock.html'));
const hc = fs.readFileSync(path.join(__dirname, 'node_modules/highcharts/highcharts.js'));
const RW = 'https://rentwayv1.emotionmobility.com/?subscription=banc';

const results = [];
const ok = (name, cond, extra) => results.push([cond ? 'OK ' : 'KO ', name, extra === undefined ? '' : String(extra)]);
// premier nombre d'une cellule (« 92 11 déc. » → 92 ; « 51 % pic 62 % » → 51 ; « −3 » → -3)
const num = s => parseFloat(String(s).trim().replace(/\u2212/g, '-').split(/\s+/)[0].replace(',', '.'));

// Calcul indépendant (dans la page, à partir des enregistrements de la maquette) : occupation, pic, dispo min, catégories en tension.
const EXPECT = `(([from, to, lim]) => {
  const D = 86400000, s = Date.parse(from + 'T00:00:00Z'), e = Date.parse(to + 'T00:00:00Z');
  const recs = window.__mock.records().filter(r => { const t = Date.parse(r.date.slice(0, 10) + 'T00:00:00Z'); return t >= s && t <= e; });
  const byDay = {}, byCat = {};
  recs.forEach(r => { const d = r.date.slice(0, 10); (byDay[d] = byDay[d] || { a: 0, t: 0 }); byDay[d].a += r.availableVehicles; byDay[d].t += r.totalVehicles;
    (byCat[r.groupID] = byCat[r.groupID] || []).push(r); });
  const days = Object.values(byDay), A = days.reduce((x, d) => x + d.a, 0), T = days.reduce((x, d) => x + d.t, 0);
  const peakOf = rs => Math.max(...rs.filter(r => r.totalVehicles > 0).map(r => 1 - r.availableVehicles / r.totalVehicles));
  const tense = Object.keys(byCat).filter(g => byCat[g].some(r => r.availableVehicles < 0) || (byCat[g].some(r => r.totalVehicles > 0) && peakOf(byCat[g]) * 100 >= lim));
  const cats = {}; Object.keys(byCat).forEach(g => { cats[g] = byCat[g].some(r => r.totalVehicles > 0) ? peakOf(byCat[g]) : null; });
  return { occ: 1 - A / T, peak: Math.max(...days.filter(d => d.t > 0).map(d => 1 - d.a / d.t)), minAvail: Math.min(...days.map(d => d.a)), tense, cats, n: days.length };
})`;

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyext-rw-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROME, headless: false, timezoneId: 'America/Guadeloupe', locale: 'fr-FR',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,1000'],
    viewport: { width: 1360, height: 900 },
  });
  await ctx.route('https://apps.weyield.io/**', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/highcharts.js') return r.fulfill({ body: hc, contentType: 'text/javascript' });
    return r.fulfill({ body: mockWY, contentType: 'text/html' });
  });
  await ctx.route('https://rentwayv1.emotionmobility.com/**', r => r.fulfill({ body: mockRW, contentType: 'text/html' }));
  await ctx.route('https://api.typesafe.ai/**', r => r.fulfill({ status: 500, body: '' }));
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(`[${tag}] ${e}`)); p.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/accessibility/.test(m.text()))) errors.push(`[${tag}] ${m.text()}`); }); };
  const fakeClipboard = () => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; };

  // --- 1. WeYield d'abord (« la période 10 commence le 24/07 ») : il amorce les réglages communs
  const A = await ctx.newPage(); watch(A, 'wy');
  await A.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('wyYield3', JSON.stringify({ v: 3, gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w', offset: 0, periods: true, tiers: true, tierList: [[1, 2], [3, 6], [7, 13], [14, 20], [21, 30], [31, 60]] })); sessionStorage.setItem('seeded', '1'); } });
  await A.goto('https://apps.weyield.io/reservations');
  await A.waitForFunction(() => window.Highcharts && Highcharts.charts[0]);
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const tabOf = u => sw.evaluate(async u => (await chrome.tabs.query({ url: u })).map(t => t.id)[0], u);
  const panelUrl = (t, q = '') => `chrome-extension://${extId}/src/panel/panel.html?tab=${t}${q}`;
  const tabA = await tabOf('https://apps.weyield.io/*');
  const PA = await ctx.newPage(); watch(PA, 'panel-wy'); await PA.addInitScript(fakeClipboard); await PA.setViewportSize({ width: 400, height: 900 });
  await PA.goto(panelUrl(tabA)); await PA.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
  const sharedNow = () => sw.evaluate(() => new Promise(r => chrome.storage.local.get('wypShared', o => r(o.wypShared || null))));
  const untilP = async (page, fn, ms = 4000) => { const t = Date.now(); for (;;) { try { if (await fn()) return true; } catch (e) {} if (Date.now() - t > ms) return false; await page.waitForTimeout(100); } };
  ok('WeYield : panneau en mode prix, réglages communs amorcés (P10 = 24/07)', (await PA.getAttribute('#app', 'data-source')) === 'rpd'
    && await untilP(PA, async () => { const s = await sharedNow(); return s && s.from === 'rpd' && s.cfg.gridDate === '2026-07-24'; }), JSON.stringify(await sharedNow()));

  // --- 2. Rentway vierge, horloge fixée au 05/12/2026 (Guadeloupe) : P29 = 4 → 10 déc.
  const R = await ctx.newPage(); watch(R, 'rw');
  await R.clock.setFixedTime(new Date('2026-12-05T10:00:00-04:00'));
  await R.goto(RW); await R.waitForFunction(() => window.__mock && document.querySelector('#pivotgrid table'));
  const tabR = await tabOf('https://rentwayv1.emotionmobility.com/*');
  const P = await ctx.newPage(); watch(P, 'panel-rw'); await P.addInitScript(fakeClipboard); await P.setViewportSize({ width: 400, height: 900 });
  await P.goto(panelUrl(tabR)); await P.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
  const txt = async sel => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const wait = ms => P.waitForTimeout(ms);
  const until = (fn, ms) => untilP(P, fn, ms);
  ok('Rentway : panneau connecté en mode balance de flotte', (await P.getAttribute('#app', 'data-source')) === 'fleet' && /Connecté/.test(await txt('#statusTxt')));
  ok('réglages recopiés de WeYield vers Rentway (P10 = 24/07)', await until(async () => (await R.evaluate(() => JSON.parse(localStorage.getItem('wyYield3') || '{}').gridDate)) === '2026-07-24'));
  ok('période en cours = P29, 4 → 10 déc.', await until(async () => (await txt('#pkn')) === 'P29') && /4 → 10 déc/.test(await txt('#pkd')), `${await txt('#pkn')} ${await txt('#pkd')}`);
  ok('onglets : Catégories à la place de Signaux, pas de calque Signaux', await P.locator('[data-tab=cats]').isVisible() && !(await P.locator('[data-tab=signals]').isVisible()) && !(await P.locator('[data-layer=signals]').isVisible()));

  // --- 3. calques dans le tableau
  const geo = () => R.evaluate(() => {
    const el = document.getElementById('pivotgrid'), H = el.querySelector('.dx-area-column-cell .wyp-layer'), T = el.querySelector('.dx-area-data-cell .wyp-layer');
    const tds = [...el.querySelectorAll('.dx-area-column-cell .dx-scrollable-content table tr:last-child td')];
    const td = k => tds.find(t => t.innerText.replace(/\s/g, '') === k);
    const lab = t => H && [...H.children].find(c => c.textContent === t);
    const R = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const j0 = lab('J0'), t713 = lab('7-13j'), p29 = lab('P29');
    return { layers: el.querySelectorAll('.wyp-layer').length, labels: H ? [...H.children].map(c => c.textContent).filter(Boolean) : [],
      j0: R(j0), td04: R(td('04-12')), td06: R(td('06-12')), t713: R(t713), td11: R(td('11-12')), td17: R(td('17-12')), p29: R(p29), td10: R(td('10-12')),
      spanBottom: tds[0].querySelector('span').getBoundingClientRect().bottom, pointer: T && getComputedStyle(T).pointerEvents,
      boxes: T ? T.children.length : 0, shadows: T ? [...T.children].map(c => c.style.boxShadow).filter(Boolean) : [] };
  });
  let g = await geo();
  const close = (a, b) => Math.abs(a - b) < 1.01;
  ok('deux calques (en-tête + valeurs), clics laissés au tableau', g.layers === 2 && g.pointer === 'none', `${g.layers} · ${g.pointer}`);
  ok('étiquettes : périodes, J0 et les 6 paliers', ['P29', 'P30', 'J0', '1-2j', '3-6j', '7-13j', '14-20j', '21-30j', '31-60j'].every(l => g.labels.includes(l)), g.labels.join(' '));
  ok('J0 posé sur la colonne du 04-12 (largeurs variables)', g.j0 && close(g.j0.l, g.td04.l) && close(g.j0.r, g.td04.r), JSON.stringify([g.j0, g.td04]));
  ok('palier 7-13j : du 11-12 au 17-12', g.t713 && close(g.t713.l, g.td11.l) && close(g.t713.r, g.td17.r));
  ok('P29 couvre 04-12 → 10-12, sous le texte des dates', g.p29 && close(g.p29.l, g.td04.l) && close(g.p29.r, g.td10.r) && g.p29.t >= g.spanBottom, JSON.stringify([g.p29, g.spanBottom]));

  // --- 4. chiffres vs calcul indépendant
  const exp = (a, b, lim = 86) => R.evaluate(`${EXPECT}(${JSON.stringify([a, b, lim])})`);
  let e29 = await exp('2026-12-04', '2026-12-10');
  const pc = x => Math.round(x * 100);
  ok('synthèse P29 : occupation, pic et dispo min exacts', num(await txt('#hero .big')) === pc(e29.occ) && new RegExp(`pic ${pc(e29.peak)} %`).test(await txt('#hero')) && new RegExp(`dispo min ${e29.minAvail}\\b`).test(await txt('#hero')),
    `${await txt('#hero')} | attendu ${pc(e29.occ)} / ${pc(e29.peak)} / ${e29.minAvail}`);
  await P.click('[data-tab=zones]'); await P.click('[data-cum="0"]'); await wait(200);
  const row = async sel => P.locator(sel).first().evaluate(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim()));
  const e713 = await exp('2026-12-11', '2026-12-17');
  const r713 = await row('tr[data-z="2"]');
  ok('palier 7-13j : occupation, pic, dispo min, tension exacts', num(r713[1]) === pc(e713.occ) && new RegExp(`pic ${pc(e713.peak)} %`).test(r713[1]) && num(r713[2]) === e713.minAvail && num(r713[3] || '0') === e713.tense.length,
    `${r713.join(' | ')} | attendu ${pc(e713.occ)} ${pc(e713.peak)} ${e713.minAvail} ${e713.tense.join(' ')}`);
  ok('7 lignes : la période puis les 6 paliers', await P.locator('#tbl tbody tr').count() === 7);
  await P.click('[data-cum="1"]'); await wait(200);
  const eCum = await exp('2026-12-05', '2027-01-03');
  const rCum = await row('tr[data-z="4"]');
  ok('cumulé 21-30j = du 05/12 au 03/01 (goulot d’une location longue)', num(rCum[1]) === pc(eCum.occ) && num(rCum[2]) === eCum.minAvail && num(rCum[3] || '0') === eCum.tense.length, `${rCum.join(' | ')} | attendu ${pc(eCum.occ)} ${eCum.minAvail} ${eCum.tense.length}`);
  await P.screenshot({ path: path.join(OUT, 'rw-1-paliers.png'), fullPage: true });

  // --- 5. onglet Catégories (matrice des pics)
  await P.click('[data-tab=cats]'); await P.click('[data-cum="0"]'); await wait(200);
  const mat = await P.evaluate(() => [...document.querySelectorAll('#tbl tbody tr')].map(tr => [...tr.children].map(td => td.innerText.split('\n')[0].trim())));
  const iMB = mat.findIndex(r => r[0] === 'MBMR'), iIV = mat.findIndex(r => r[0] === 'IVMD');
  ok('Catégories : 6 lignes, 1 + 6 colonnes', mat.length === 6 && mat[0].length === 8, `${mat.length} × ${mat[0] && mat[0].length}`);
  ok('MBMR · 7-13j = pic exact', iMB >= 0 && num(mat[iMB][3]) === pc(e713.cats.MBMR), `${mat[iMB] && mat[iMB][3]} vs ${pc(e713.cats.MBMR)}`);
  ok('IVMD (sans flotte) : aucune valeur', iIV >= 0 && mat[iIV].slice(1).every(v => v === '·'), mat[iIV] && mat[iIV].join(' '));
  const negRecs = await R.evaluate(() => window.__mock.records().filter(r => r.availableVehicles < 0 && r.date >= '2026-12-25' && r.date <= '2027-01-03T').length);
  const negCell = await P.evaluate(() => [...document.querySelectorAll('#tbl td.lv4')].map(td => td.innerText.trim()));
  ok('surbooking : la maquette en a, la matrice l’affiche (dispo négative)', negRecs > 0 && negCell.length > 0 && negCell.every(v => num(v) < 0), `${negRecs} jours · ${negCell.join(' ')}`);
  await P.screenshot({ path: path.join(OUT, 'rw-2-categories.png'), fullPage: true });
  await P.click('[data-tab=zones]'); await wait(150);

  // --- 6. survol d'un palier → il ressort dans le tableau
  await P.hover('tr[data-z="2"]'); await wait(250);
  g = await geo();
  ok('survol 7-13j : cadre épais dans le tableau', g.shadows.filter(s => /3px/.test(s)).length === 1, g.shadows.filter(s => /3px/.test(s)).length);
  await P.mouse.move(5, 5); await P.hover('#pkn'); await wait(250);
  g = await geo();
  ok('fin du survol : plus de cadre épais', g.shadows.every(s => !/3px/.test(s)));

  // --- 7. clic sur une valeur couverte par le calque : le détail Rentway s'ouvre quand même
  await R.bringToFront();
  const cell = R.locator('#pivotgrid .dx-area-data-cell tr[data-g="MBMR"] td[data-date="2026-12-12"]');
  await cell.scrollIntoViewIfNeeded(); const box = await cell.boundingBox();
  await R.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await R.waitForTimeout(150);
  const clicks = await R.evaluate(() => window.__mock.clicks.slice(-1)[0]);
  ok('clic sur une valeur sous le calque → détail Rentway', clicks && clicks.g === 'MBMR' && clicks.date === '2026-12-12', JSON.stringify(clicks));

  // --- 8. clic sur une date d'en-tête → la période change ; le calque suit le défilement
  const hd = R.locator('#pivotgrid .dx-area-column-cell td', { hasText: '18-12' });
  await hd.scrollIntoViewIfNeeded(); await hd.click();
  ok('clic sur 18-12 dans l’en-tête → P31', await until(async () => (await txt('#pkn')) === 'P31'), await txt('#pkn'));
  await R.evaluate(() => { const c = document.querySelector('#pivotgrid .dx-area-data-cell .dx-scrollable-container'); c.scrollLeft = 300; c.dispatchEvent(new Event('scroll')); });
  await R.waitForTimeout(200);
  const al = await R.evaluate(() => { const el = document.getElementById('pivotgrid'); const H = el.querySelector('.dx-area-column-cell .wyp-layer');
    const j0 = [...H.children].find(c => c.textContent === 'J0'), td = [...el.querySelectorAll('.dx-area-column-cell td')].find(t => t.innerText.replace(/\s/g, '') === '18-12');
    return [j0.getBoundingClientRect().left, td.getBoundingClientRect().left, el.querySelector('.dx-area-column-cell .dx-scrollable-container').scrollLeft]; });
  ok('défilement : J0 reste sur sa colonne', close(al[0], al[1]) && al[2] > 0, al.map(Math.round).join(' / '));
  await R.screenshot({ path: path.join(OUT, 'rw-3-tableau.png') });

  // --- 9. nouvelle recherche Rentway (dates et valeurs changées) → recalcul et redessin
  await P.click('[data-op=auto]');
  await R.evaluate(() => window.__mock.search({ start: '2026-12-06', days: 60, seed: 7 }));
  const e29b = await exp('2026-12-06', '2026-12-10');
  ok('nouvelle recherche : P29 partielle (5/7 j) recalculée', await until(async () => num(await txt('#hero .big')) === pc(e29b.occ) && /5\/7 j chargés/.test(await txt('#tbl'))), `${await txt('#hero .big')} vs ${pc(e29b.occ)}`);
  g = await geo();
  ok('nouvelle recherche : calques redessinés, P29 commence au 06-12, J0 (04/12) hors tableau', g.layers === 2 && !g.td04 && g.p29 && g.td06 && close(g.p29.l, g.td06.l) && !g.j0, g.labels.join(' '));

  // --- 10. seuils d'occupation
  await P.click('#settings summary'); await wait(100);
  const nTense = async () => { const m = /(\d+) catégories? en tension/.exec(await txt('#hero')); return m ? +m[1] : 0; };
  const before = await nTense();
  await P.fill('#th1', '40'); await P.fill('#th0', '30'); await P.press('#th1', 'Tab'); await P.dispatchEvent('#occset', 'change');
  ok('seuil « limite » à 40 % → plus de catégories en tension', await until(async () => (await nTense()) > before), `${before} → ${await nTense()}`);
  await P.fill('#th0', '95'); await P.dispatchEvent('#occset', 'change'); await wait(300);
  const th = await R.evaluate(() => JSON.parse(localStorage.getItem('wyYield3')).occTh);
  ok('seuils incohérents refusés (message, état inchangé)', /incohérents/.test(await txt('#thhint')) && th[1] === 40, JSON.stringify(th));
  await P.click('#threset');
  ok('valeurs par défaut 81 / 86 / 87', await until(async () => JSON.stringify(await R.evaluate(() => JSON.parse(localStorage.getItem('wyYield3')).occTh)) === '[81,86,87]'));

  // --- 11. copie, diagnostic
  await P.click('[data-tab=zones]'); await P.click('#copy'); await wait(150);
  let copied = await P.evaluate(() => window.__copied || '');
  ok('copie Paliers : en-têtes d’occupation, 7 lignes', /^Zone\tDébut\tFin\tJours visibles\tOccupation moy\. %/.test(copied) && copied.split('\n').length === 8, copied.split('\n')[0]);
  await P.click('[data-tab=cats]'); await P.click('#copy'); await wait(150);
  copied = await P.evaluate(() => window.__copied || '');
  ok('copie Catégories : matrice des pics', /^Catégorie \(pic %\)/.test(copied) && copied.split('\n').length === 7, copied.split('\n')[0].slice(0, 60));
  await P.click('#diag'); await wait(300);
  const diag = JSON.parse(await P.evaluate(() => window.__copied || '{}'));
  ok('diagnostic : source Rentway, géométrie lue', diag.source === 'rentway' && diag.grilles[0].enregistrements === 360 && diag.grilles[0].geometrie === true && diag.grilles[0].champ_categorie === 'groupID', JSON.stringify(diag.grilles && diag.grilles[0]).slice(0, 160));

  // --- 12. calques activables
  await P.click('[data-layer=tiers]'); await wait(300);
  g = await geo();
  ok('calque Paliers coupé : ni paliers ni J0', !g.labels.some(l => /j$/.test(l) || l === 'J0') && g.labels.includes('P29'), g.labels.join(' '));
  await P.click('[data-layer=periods]'); await wait(300);
  ok('les deux calques coupés : tableau intact', (await geo()).layers === 0);
  await P.click('[data-layer=periods]'); await P.click('[data-layer=tiers]'); await wait(300);

  // --- 13. un réglage fait sur Rentway repart vers WeYield
  await P.click('#tiers [data-del="5"]');
  ok('Rentway : palier 31-60 supprimé', await until(async () => (await R.evaluate(() => JSON.parse(localStorage.getItem('wyYield3')).tierList.length)) === 5));
  ok('réglages communs mis à jour depuis Rentway', await until(async () => { const s = await sharedNow(); return s.from === 'fleet' && s.cfg.tierList.length === 5; }));
  await PA.goto(panelUrl(tabA)); await PA.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
  ok('WeYield reçoit les 5 paliers à la reconnexion du panneau', await untilP(PA, async () => (await A.evaluate(() => JSON.parse(localStorage.getItem('wyYield3')).tierList.length)) === 5));

  // --- 14. sombre, étroit, page sans tableau
  await P.click('[data-tab=cats]'); await P.emulateMedia({ colorScheme: 'dark' }); await wait(200);
  await P.screenshot({ path: path.join(OUT, 'rw-4-sombre.png'), fullPage: true });
  await P.emulateMedia({ colorScheme: 'light' });
  await P.setViewportSize({ width: 320, height: 900 }); await wait(200);
  ok('320 px : la matrice tient dans son cadre', await P.evaluate(() => { const w = document.querySelector('#tbl'); return w.scrollWidth <= w.clientWidth + 1; }), await P.evaluate(() => `${document.querySelector('#tbl').scrollWidth} / ${document.querySelector('#tbl').clientWidth}`));
  await P.screenshot({ path: path.join(OUT, 'rw-5-etroit.png'), fullPage: true });
  await R.evaluate(() => window.__mock.remove());
  ok('page sans tableau → « Aucune balance de flotte »', await until(async () => /Aucune balance de flotte/.test(await P.locator('#emptyTitle').innerText()), 5000));

  console.log(results.map(r => r.join('  ')).join('\n'));
  console.log('\nErreurs console/page :', errors.length ? errors : 'aucune');
  const ko = results.filter(r => r[0] === 'KO ').length + (errors.length ? 1 : 0);
  console.log(`\n${results.length - results.filter(r => r[0] === 'KO ').length}/${results.length} OK`);
  await ctx.close();
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ÉCHEC DU BANC', e); process.exit(2); });
