// Banc de test navigateur : charge l'extension telle quelle (Chrome for Testing) avec une maquette WeYield servie en https://apps.weyield.io/
// et le panneau latéral ouvert sur cet onglet (chrome-extension://…/panel.html?tab=<id> : même code que le vrai panneau).
// Prérequis : cd test/browser && npm install && npm test   (CHROME_PATH=… si Chrome for Testing n'est pas dans le cache Playwright)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || os.homedir() + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const mock = fs.readFileSync(path.join(__dirname, 'mock.html'));
const hc = fs.readFileSync(path.join(__dirname, 'node_modules/highcharts/highcharts.js'));

// éléments dessinés par l'extension sur l'axe X (Highcharts ≤ 12 : plotLinesAndBands ; ≥ 13 : plotBands + plotLines)
const BANDS = `(c => { const a = c.xAxis[0]; return (a.plotLinesAndBands || [...(a.plotBands||[]), ...(a.plotLines||[])]).filter(b => String(b.id).startsWith('wyp')).map(b => ({ id: String(b.id), from: b.options.from, to: b.options.to, bw: b.options.borderWidth })); })`;
const results = [];
const ok = (name, cond, extra) => results.push([cond ? 'OK ' : 'KO ', name, extra === undefined ? '' : String(extra)]);
const num = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
const near = (a, b, e = 0.06) => Math.abs(a - b) < e;

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyext-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROME, headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,1000'],
    viewport: { width: 1360, height: 900 },
  });
  await ctx.route('https://apps.weyield.io/**', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/highcharts.js') return r.fulfill({ body: hc, contentType: 'text/javascript' });
    if (u.pathname === '/empty') return r.fulfill({ body: '<!doctype html><title>WeYield</title><h1>Accueil</h1>', contentType: 'text/html' });
    return r.fulfill({ body: mock, contentType: 'text/html' });
  });
  // Fausse API TypeSafe (formats de la doc : noul / choice / score). Teste le branchement, pas la qualité de Jev.
  const api = { calls: [], mode: 'ok' };
  await ctx.route('https://api.typesafe.ai/**', async route => {
    const req = route.request(), body = req.postData() || '', headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    api.calls.push({ auth: req.headers()['authorization'], body });
    if (api.mode === '401') return route.fulfill({ status: 401, headers, contentType: 'application/json', body: '{"error":"invalid api key"}' });
    const b = JSON.parse(body), s = b.state || {};
    if (typeof s === 'string') return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ model: 'jev-1.13.0', answers: { greeting: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 31, output_tokens: 1 } }) });
    const bp = s.booking_pace_vs_last_year || s.bookings_on_the_books_vs_last_year || {}, pr = s.price_vs_last_year_same_date || {};
    const fast = /faster|ahead/.test(bp.summary || ''), slow = /slower|behind/.test(bp.summary || ''), dear = /higher/.test(pr.summary || ''), cheap = /lower/.test(pr.summary || '');
    const action = fast && !dear ? 'raise' : slow && !cheap ? 'lower' : 'hold';
    const mixed = s.period === 'P13';                       // P13 : le faux Jev est partagé → verdict composé « voir »
    const under = mixed ? 0.5 : action === 'raise' ? 0.85 : 0.1, over = mixed ? 0.5 : action === 'lower' ? 0.85 : 0.1;
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ model: 'jev-1.13.0', usage: { input_tokens: 420, output_tokens: 60 }, answers: {
      action: { type: 'choice', choice: action, confidence: 0.8, probabilities: { [action]: 0.8 } },
      underpriced: { type: 'noul', noul: under }, overpriced: { type: 'noul', noul: over },
      pace: { type: 'score', score: fast ? 3.2 : slow ? 0.8 : 2, confidence: 0.7, probabilities: {}, legend: {} }, price: { type: 'score', score: dear ? 3 : cheap ? 1 : 2, confidence: 0.7, probabilities: {}, legend: {} } } }) });
  });
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(`[${tag}] ${e}`)); p.on('console', m => { if ((m.type() === 'error' && !/status of 401/.test(m.text())) || (m.type() === 'warning' && !/accessibility/.test(m.text()))) errors.push(`[${tag}] ${m.text()}`); }); };

  // --- onglet WeYield (maquette) avec config de départ : « la période 10 commence le 24/07 »
  const A = await ctx.newPage(); watch(A, 'wy');
  await A.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('wyYield3', JSON.stringify({ v: 3, gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w', offset: 0, periods: true, tiers: true, tierList: [[1, 2], [3, 6], [7, 13], [14, 20], [21, 30], [31, 60]] })); sessionStorage.setItem('seeded', '1'); } });
  await A.goto('https://apps.weyield.io/reservations');
  await A.waitForFunction(() => window.Highcharts && Highcharts.charts[0]);

  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const tabs = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://apps.weyield.io/*' })).map(t => t.id));
  const tabId = tabs[0];
  ok('service worker actif, onglet WeYield trouvé', !!extId && tabId != null, `${extId.slice(0, 8)}… tab ${tabId}`);

  // --- panneau
  const panelUrl = (t, q = '') => `chrome-extension://${extId}/src/panel/panel.html?tab=${t}${q}`;
  const P = await ctx.newPage(); watch(P, 'panel');
  await P.addInitScript(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await P.setViewportSize({ width: 400, height: 900 });
  await P.goto(panelUrl(tabId));
  await P.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
  const txt = async sel => (await P.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const wait = ms => P.waitForTimeout(ms);
  // attente conditionnelle : l'action traverse page → relais → moteur → panneau, quelques ms à vide, davantage sous charge
  const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { try { if (await fn()) return true; } catch (e) {} if (Date.now() - t > ms) return false; await P.waitForTimeout(100); } };
  const bands = () => A.evaluate(`${BANDS}(Highcharts.charts.filter(Boolean).slice(-1)[0])`);

  // 1. connexion + période en cours
  ok('panneau connecté, statut « Connecté »', /Connecté/.test(await txt('#statusTxt')));
  ok('période en cours = P11 (réf. 04/08)', await until(async () => (await txt('#pkn')) === 'P11'), await txt('#pkd'));
  ok('aucun élément ajouté dans la page WeYield', await A.evaluate(() => !document.getElementById('wy-yield-bar') && !document.getElementById('wy-yield-drawer')));
  let ids = (await bands()).map(b => b.id);
  ok('graphique : périodes ET paliers dessinés', ids.some(i => i.startsWith('wyp-pb')) && ids.some(i => /^wyp-t\d/.test(i)) && ids.includes('wyp-j0'), ids.length + ' éléments');
  await P.screenshot({ path: path.join(OUT, 'shot-1-panel.png'), fullPage: true });

  // 2. navigation › et clavier
  await P.click('[data-op=next]'); await wait(300);
  ok('› → P12, dates 7 → 13 août', await until(async () => (await txt('#pkn')) === 'P12') && /7 → 13 août/.test(await txt('#pkd')), await txt('#pkd'));
  ok('« Période en cours » apparaît', await P.locator('#today').isVisible());
  ids = (await bands()).map(b => b.id);
  ok('graphique : P12 est la période sélectionnée (k=2)', ids.includes('wyp-pe2'), ids.filter(i => i.startsWith('wyp-pe')).join());
  await P.keyboard.press('ArrowRight'); await wait(300);
  ok('flèche → du clavier : P13', await until(async () => (await txt('#pkn')) === 'P13'));
  await P.keyboard.press('ArrowLeft'); await wait(300);
  ok('flèche ← du clavier : P12', await until(async () => (await txt('#pkn')) === 'P12'));

  // 3. chiffres vs calcul indépendant (J0 = 7 août)
  const expect = (j0iso, a, b) => A.evaluate(([j0iso, a, b]) => {
    const M = window.__mock, D = 86400000, J0 = Date.parse(j0iso + 'T00:00:00Z');
    const m = x => new Map(x.map(([t, v]) => [t, v]));
    const [cur, rc, ly, rl, lf, rf] = [M.cur, M.rcur, M.ly, M.rly, M.lyf, M.rlyf].map(m);
    const w = (v, r, s, e) => { let rev = 0, d = 0; for (let t = s; t <= e; t += D) { rev += v.get(t) * r.get(t); d += v.get(t); } return rev / d; };
    const s = J0 + a * D, e = J0 + b * D;
    return [w(cur, rc, s, e), w(ly, rl, s, e), w(lf, rf, s, e)];
  }, [j0iso, a, b]);
  const row = async sel => P.locator(sel).first().evaluate(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim()));
  let dep = await expect('2026-08-07', 0, 6), z36 = await expect('2026-08-07', 3, 6);
  let rHead = await row('tr.head'), r36 = await row('tr[data-z="1"]');
  ok('P12 départs : RPJ N / N-1 / N-1 final exacts', near(num(rHead[1]), dep[0]) && near(num(rHead[2]), dep[1]) && near(num(rHead[3]), dep[2]), rHead.slice(0, 4).join(' | '));
  ok('palier 3-6j : 10 → 13 août, valeurs exactes', /10 → 13 août/.test(r36[0]) && near(num(r36[1]), z36[0]) && near(num(r36[2]), z36[1]) && near(num(r36[3]), z36[2]), r36.slice(0, 4).join(' | '));
  const heroBig = num(await txt('#hero .big'));
  ok('synthèse = ligne départs', near(heroBig, dep[0]), heroBig);
  const dN1 = (dep[0] / dep[1] - 1) * 100;
  ok('Δ N-1 de la synthèse cohérent', near(Math.abs(num((await txt('#hero .cmpr:nth-child(1) .pill')).replace(/[▲▼+−\s%]/g, ''))), Math.abs(dN1)), dN1.toFixed(2));
  await P.screenshot({ path: path.join(OUT, 'shot-2-p12.png'), fullPage: true });

  // 4. DÉCALAGE de J0
  await P.click('[data-off="1"]'); await wait(200); await P.click('[data-off="1"]'); await wait(350);
  ok('décalage +2 j affiché', (await txt('#off')) === '+2 j' && /9 août/.test(await txt('#j0d')), `${await txt('#j0d')} · ${await txt('#off')}`);
  const bj = (await bands()).find(b => b.id === 'wyp-j0');
  ok('graphique : la bande J0 est passée au 9 août', bj && new Date(bj.from + 0.5 * 86400000).toISOString().slice(0, 10) === '2026-08-09', bj && new Date(bj.from + 43200000).toISOString().slice(0, 10));
  dep = await expect('2026-08-07', 0, 6); z36 = await expect('2026-08-09', 3, 6);
  r36 = await row('tr[data-z="1"]'); rHead = await row('tr.head');
  ok('palier 3-6j décalé : 12 → 15 août, valeurs exactes', /12 → 15 août/.test(r36[0]) && near(num(r36[1]), z36[0]) && near(num(r36[2]), z36[1]) && near(num(r36[3]), z36[2]), r36.slice(0, 4).join(' | '));
  ok('ligne « départs » inchangée par le décalage', near(num(rHead[1]), dep[0]));
  await P.screenshot({ path: path.join(OUT, 'shot-3-offset.png'), fullPage: true });
  await P.click('#offReset'); await wait(300);
  ok('↺ remet le décalage à 0', (await txt('#off')) === '0 j' && await P.locator('#offReset').isHidden());
  await P.click('[data-off="-1"]'); await wait(300);
  ok('décalage négatif : −1 j → J0 = 6 août', (await txt('#off')) === '−1 j' && /6 août/.test(await txt('#j0d')));
  await P.click('#offReset'); await wait(250);

  // 5. survol : lien tableau ↔ graphique
  await P.hover('tr[data-z="2"]'); await wait(300);
  let hb = await bands();
  ok('survol du palier 7-13j : bande renforcée sur le graphique', hb.find(b => b.id === 'wyp-t2').bw === 2 && hb.find(b => b.id === 'wyp-t0').bw === 1, hb.filter(b => /^wyp-t\d/.test(b.id)).map(b => b.bw).join());
  await P.mouse.move(380, 20); await wait(300);
  hb = await bands();
  ok('fin du survol : retour à la normale', hb.find(b => b.id === 'wyp-t2').bw === 1);

  // 6. clic sur le graphique → le panneau suit
  const pos = await A.evaluate(() => { const c = Highcharts.charts[0], r = c.container.getBoundingClientRect(); return { x: r.left + c.xAxis[0].toPixels(Date.parse('2026-08-16T00:00:00Z'), false), y: r.top + c.plotTop + c.plotHeight / 2 }; });
  await A.bringToFront(); await A.mouse.click(pos.x, pos.y); await wait(400);
  ok('clic sur le 16/08 dans WeYield → panneau sur P13', await until(async () => (await txt('#pkn')) === 'P13'), await txt('#pkn'));
  const box = await A.evaluate(() => { const c = Highcharts.charts[0], r = c.container.getBoundingClientRect(); return { x: r.left + c.plotLeft, y: r.top + c.plotTop + 60, w: c.plotWidth }; });
  await A.mouse.move(box.x + box.w * 0.7, box.y); await A.mouse.down(); await A.mouse.move(box.x + box.w * 0.9, box.y, { steps: 5 }); await A.mouse.up(); await wait(300);
  ok('glisser-zoomer ne change pas la période', await until(async () => (await txt('#pkn')) === 'P13'));
  await A.evaluate(() => Highcharts.charts[0].zoomOut()); await P.bringToFront();

  // 7. calques indépendants
  await P.click('[data-layer=tiers]'); await wait(300);
  ids = (await bands()).map(b => b.id);
  ok('Paliers off → périodes seules, J0 estompé', ids.some(i => i.startsWith('wyp-pb')) && !ids.some(i => /^wyp-t\d|j0/.test(i)) && await P.locator('#j0box.dim').count() === 1);
  await P.click('[data-layer=periods]'); await P.click('[data-layer=tiers]'); await wait(300);
  ids = (await bands()).map(b => b.id);
  ok('Périodes off + Paliers on → paliers seuls', !ids.some(i => i.startsWith('wyp-pb')) && ids.some(i => /^wyp-t\d/.test(i)));
  await P.click('[data-layer=periods]'); await wait(300);

  // 8. onglet « Toutes les périodes » + sélection par clic de ligne
  await P.click('[data-tab=periods]'); await wait(200);
  const nrows = await P.locator('tr[data-k]').count();
  ok('vue périodes : ≥ 10 lignes', nrows >= 10, nrows);
  await P.locator('tr[data-k]', { hasText: 'P15' }).first().click(); await wait(300);
  ok('clic sur la ligne P15 → P15 sélectionnée', await until(async () => (await txt('#pkn')) === 'P15'));
  await P.locator('tr[data-k]', { hasText: 'P14' }).first().focus(); await P.keyboard.press('Enter'); await wait(300);
  ok('clavier (Entrée) sur la ligne P14 → P14', await until(async () => (await txt('#pkn')) === 'P14'));
  await P.screenshot({ path: path.join(OUT, 'shot-4-periods.png'), fullPage: true });
  await P.click('[data-tab=zones]'); await P.click('[data-op=auto]'); await wait(300);
  ok('« Période en cours » → retour à P11', await until(async () => (await txt('#pkn')) === 'P11') && await P.locator('#today').isHidden());

  // 9. réglages
  await P.click('#settings summary'); await wait(150);
  ok('réglages : résumé lisible', /P10 = 24 juil\. · 1 sem\. · 6 paliers/.test(await txt('#setSum')), await txt('#setSum'));
  ok('réglages : « Soit P1 = 22 mai 2026 »', /22 mai 2026/.test(await txt('#ghint')), await txt('#ghint'));
  await P.fill('#glen', '2'); await P.press('#glen', 'Tab'); await P.waitForFunction(() => /· 2 sem\. ·/.test(document.querySelector('#setSum').textContent), null, { timeout: 4000 }).catch(() => {}); await wait(200);
  ok('durée 2 semaines → périodes de 14 jours', /· 2 sem\. ·/.test(await txt('#setSum')) && /→/.test(await txt('#pkd')), `${await txt('#pkn')} ${await txt('#pkd')}`);
  await P.fill('#glen', '1'); await P.press('#glen', 'Tab'); await wait(300);
  await P.click('#tadd'); await wait(400);
  ok('+ Ajouter un palier → 7 lignes, 61-67', await P.locator('#tiers .trow').count() === 7 && (await P.locator('#tiers .trow').last().locator('.ta').inputValue()) === '61', await P.locator('#tiers .trow').count());
  ok('légende du tableau : 7 paliers', await P.locator('tr[data-z]').count() === 7);
  await P.locator('#tiers .trow').last().locator('[data-del]').click(); await wait(300);
  ok('suppression → 6 paliers', await P.locator('#tiers .trow').count() === 6);
  // palier incohérent (b < a) corrigé
  await P.locator('#tiers .trow').first().locator('.tb').fill('0'); await P.locator('#tiers .trow').first().locator('.tb').press('Tab'); await wait(300);
  ok('palier « 1 à 0 » corrigé en « 1 à 1 »', (await P.locator('#tiers .trow').first().locator('.tb').inputValue()) === '1', await P.locator('#tiers .trow').first().locator('.tb').inputValue());
  await P.locator('#tiers .trow').first().locator('.tb').fill('2'); await P.locator('#tiers .trow').first().locator('.tb').press('Tab'); await wait(300);
  await P.screenshot({ path: path.join(OUT, 'shot-5-settings.png'), fullPage: true });
  await P.click('#gauto'); await wait(300);
  ok('Auto → « Auto : P1 = lundi… »', /Auto/.test(await txt('#ghint')), await txt('#ghint'));
  await P.fill('#gnum', '10'); await P.fill('#gdate', '2026-07-24'); await P.press('#gdate', 'Tab'); await wait(400);
  ok('« période 10 commence le 24/07 » → P11 en cours', await until(async () => (await txt('#pkn')) === 'P11') && /P10 = 24 juil/.test(await txt('#setSum')), await txt('#setSum'));

  // 10. copie
  await P.click('#copy'); await wait(200);
  const copied = await P.evaluate(() => window.__copied);
  const lines = (copied || '').split('\n');
  ok('copie TSV : 15 colonnes, départs + 6 paliers', lines.length === 8 && lines.every(l => l.split('\t').length === 15), lines.length + ' lignes');
  ok('retour visuel « Copié ✓ »', /Copié/.test(await txt('#live')));

  // 11. persistance + reconnexion après rechargement de la page WeYield
  await A.evaluate(() => localStorage.setItem('wyYield3', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('wyYield3')), { offset: 3 }))));
  await A.reload();
  await P.waitForSelector('#app[data-conn=ok]', { timeout: 10000 }); await wait(1500);
  ok('rechargement de la page : le panneau se reconnecte seul', (await txt('#statusTxt')) === 'Connecté');
  ok('config persistée (décalage +3 j, 6 paliers)', (await txt('#off')) === '+3 j' && await P.locator('tr[data-z]').count() === 6, await txt('#off'));
  await P.click('#offReset'); await wait(300);

  // 12. graphique recréé (« Appliquer ») : overlay redessiné et panneau à jour
  await A.evaluate(() => { document.querySelector('app-chart').innerHTML = '<div id="c2" style="height:430px"></div>';
    const M = window.__mock, c = Highcharts.chart('c2', { xAxis: { type: 'datetime', plotBands: [{ id: 'today', from: M.ref - 3 * 86400000, to: M.ref }] }, yAxis: [{}, { opposite: true }],
      series: [{ name: 'current', type: 'column', data: M.cur, yAxis: 0 }, { name: 'currentRpd', data: M.rcur, yAxis: 1 }] });
    document.querySelector('app-chart').__ngContext__ = [null, { cmp: { chart: c } }]; });
  await wait(1800);
  ok('graphique recréé → overlay redessiné', (await bands()).length > 0);
  ok('séries N-1 absentes → colonnes barrées + message', await P.locator('th.off').count() === 2 && /N-1, N-1 final/.test(await txt('#msgs')), await txt('#msgs'));
  await P.screenshot({ path: path.join(OUT, 'shot-6-missing.png'), fullPage: true });

  // 13. états sans page connectée
  const C = await ctx.newPage(); watch(C, 'vide');
  await C.goto('https://apps.weyield.io/empty');
  const ctab = (await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://apps.weyield.io/empty' })).map(t => t.id)))[0];
  const P2 = await ctx.newPage(); watch(P2, 'panel2'); await P2.setViewportSize({ width: 400, height: 700 });
  await P2.goto(panelUrl(ctab)); await P2.waitForSelector('#app[data-conn=nochart]', { timeout: 8000 });
  ok('page WeYield sans graphique → « Aucun graphique Réservations »', /Aucun graphique/.test(await P2.locator('#emptyTitle').innerText()));
  await P2.screenshot({ path: path.join(OUT, 'shot-7-nochart.png') });
  await P2.goto(panelUrl(999999)); await P2.waitForSelector('#app[data-conn=noscript]', { timeout: 8000 });
  ok('onglet inexistant → « Page non connectée » + bouton', await P2.locator('#emptyBtn').isVisible() && await P2.locator('#content').isHidden());

  // 13b. page à deux graphiques (comme la vraie) : le panneau lit celui qui porte le « Revenu par jour »
  const T = await ctx.newPage(); watch(T, 'deux'); await T.setViewportSize({ width: 1300, height: 1100 });
  await T.goto('https://apps.weyield.io/reservations?layout=two');
  await T.waitForFunction(() => window.Highcharts && Highcharts.charts.filter(Boolean).length === 2); await T.waitForTimeout(1500);
  const ttab = (await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://apps.weyield.io/reservations?layout=two' })).map(t => t.id)))[0];
  const P4 = await ctx.newPage(); watch(P4, 'panel4'); await P4.setViewportSize({ width: 400, height: 900 });
  await P4.addInitScript(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await P4.goto(panelUrl(ttab)); await P4.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
  const bigTxt = async () => (await P4.locator('#hero .big').innerText()).trim();
  ok('deux graphiques : le panneau lit celui du rythme (RPJ présent)', /€/.test(await bigTxt()), await bigTxt());
  const per = await T.evaluate(`(() => Highcharts.charts.filter(Boolean).map(c => (${BANDS})(c).length))()`);
  ok('périodes et paliers dessinés sur les deux graphiques', per.length === 2 && per.every(n => n > 20), per.join(' / '));
  if (!(await P4.locator('#settings').evaluate(d => d.open))) await P4.click('#settings summary');
  await P4.waitForTimeout(150);
  ok('réglages : choix du graphique visible (2 graphiques)', await P4.locator('#dataset').isVisible() && /Automatique \(graphique 2\)/.test(await P4.locator('#dsel option').first().innerText()));
  await P4.selectOption('#dsel', '0'); await P4.waitForTimeout(500);
  ok('graphique 1 forcé : avertissement « Revenu par jour » introuvable + lien diagnostic', /introuvable dans « Évolution des réservations »/.test(await P4.locator('#msgs').innerText()) && await P4.locator('#msgs [data-diag]').isVisible());
  await P4.screenshot({ path: path.join(OUT, 'shot-11-two-charts-forced.png'), fullPage: true });
  await P4.click('#msgs [data-diag]'); await P4.waitForTimeout(500);
  const diag = JSON.parse(await P4.evaluate(() => window.__copied));
  ok('diagnostic : 2 graphiques, séries RPJ listées, valeurs échantillon', diag.graphiques.length === 2 && diag.graphiques[1].series.some(s => s.nom === 'currentRpd' && s.debut.length === 5) && diag.graphiques[0].series.length === 3 && diag.graphique_lu === 0, diag.graphiques.map(g => g.series.length).join('/'));
  await P4.selectOption('#dsel', 'auto'); await P4.waitForTimeout(500);
  ok('retour en automatique : RPJ de nouveau lu', /€/.test(await bigTxt()));
  await T.screenshot({ path: path.join(OUT, 'shot-12-two-charts-page.png') });

  // 14. rendu : sombre, étroit
  await P.bringToFront(); await P.goto(panelUrl(tabId)); // A est maintenant le graphique recréé sans N-1 : on recharge pour un rendu complet
  await A.reload(); await P.waitForSelector('#app[data-conn=ok]', { timeout: 10000 }); await wait(1500);
  // 14a. régression « Voir partout » : sans N-1 final, aucune requête ne doit contenir de champ « absent » ; page Évolution : séries à noms d'affichage
  const E = await ctx.newPage(); watch(E, 'evo'); await E.setViewportSize({ width: 1300, height: 1000 });
  // État enregistré par les versions précédentes : réglages de séries FAUX (volumes pris pour des prix) et graphique forcé, sans rolesSchema
  await E.addInitScript(() => { if (!sessionStorage.getItem('legacy')) { sessionStorage.setItem('legacy', '1'); localStorage.setItem('wyYield3', JSON.stringify({ v: 3, dataIdx: 1, gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w', periods: true, tiers: true, signals: true, offset: 0,
    tierList: [[1, 2], [3, 6], [7, 13], [14, 20], [21, 30], [31, 60]], maps: { fu2an: { curVol: 'thisyear', lyVol: 'lastyear', curRpd: 'thisyear', lyRpd: 'lastyear', lyfVol: 'ly_revenue' } } })); } });
  await E.goto('https://apps.weyield.io/reservations?layout=evolution');
  await E.waitForFunction(() => window.Highcharts && Highcharts.charts.filter(Boolean).length === 2); await E.waitForTimeout(1500);
  const etab = (await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://apps.weyield.io/reservations?layout=evolution' })).map(t => t.id)))[0];
  const P6 = await ctx.newPage(); watch(P6, 'panel6'); await P6.setViewportSize({ width: 400, height: 1000 });
  await P6.addInitScript(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await P6.goto(panelUrl(etab)); await P6.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
  await P6.click('[data-tab=zones]'); await P6.waitForTimeout(300);
  ok('page Évolution : séries thisyear / revenue reconnues malgré un état hérité faux, RPJ lu', /€/.test(await P6.locator('#hero .big').innerText()), (await P6.locator('#hero .big').innerText()).trim());
  const expEvo = await E.evaluate(() => { const M = window.__mock, D = 86400000; const m = x => new Map(x.map(([t, v]) => [t, v])); const [cur, rc, ly, rl] = [M.cur, M.rcur, M.ly, M.rly].map(m);
    const sel = Date.UTC(2026, 7, 4); const k0 = Date.UTC(2026, 6, 31), k1 = Date.UTC(2026, 7, 6); const w = (v, r) => { let a = 0, d = 0; for (let t = k0; t <= k1; t += D) { a += v.get(t) * r.get(t); d += v.get(t); } return a / d; }; return [w(cur, rc), w(ly, rl)]; });
  const rHeadE = await P6.locator('tr.head').first().evaluate(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim()));
  ok('page Évolution : RPJ N et N-1 (série pointillée) exacts', near(num(rHeadE[1]), expEvo[0]) && near(num(rHeadE[2]), expEvo[1]), `${rHeadE.slice(0, 3).join(' | ')}  attendu ${expEvo.map(x => x.toFixed(1)).join('/')}`);
  ok('N-1 final absent → colonne barrée, pas d\'erreur', await P6.locator('th.off').count() === 1);
  if (!(await P6.locator('#settings').evaluate(d => d.open))) await P6.click('#settings summary');
  const dopts = await P6.locator('#dsel option').allInnerTexts();
  ok('titres des graphiques = en-têtes de la page (pas « novembre 2026 »)', dopts.some(t => /2\. Évolution des réservations en 2026 vs 2025 · séries reconnues/.test(t)) && dopts.some(t => /^1\. Évolution des réservations$/.test(t.trim())), dopts.join(' / ').slice(0, 120));
  ok('séries lues : 6 rôles, Auto affiche la série choisie', await P6.locator('#roles select').count() === 6 && /Auto : revenue$/.test((await P6.locator('#r-curRpd option').first().innerText()).trim()) && /Auto : thisyear$/.test((await P6.locator('#r-curVol option').first().innerText()).trim()) && /Auto : ly_revenue/.test((await P6.locator('#r-lyRpd option').first().innerText()).trim()), (await P6.locator('#r-lyRpd option').first().innerText()).trim());
  await P6.screenshot({ path: path.join(OUT, 'shot-17-evolution.png'), fullPage: true });
  await P6.selectOption('#r-lyRpd', 'none'); await P6.waitForTimeout(500);
  ok('réglage manuel « RPJ N-1 = aucune » : colonne N-1 barrée', await P6.locator('th.off').count() === 2);
  await P6.selectOption('#r-lyRpd', 'auto'); await P6.waitForTimeout(500);
  ok('retour à Auto : N-1 relue', await P6.locator('th.off').count() === 1);
  await P6.click('[data-tab=signals]'); await P6.waitForTimeout(400);
  ok('page Évolution : cartes en lecture « Rythme · 7 j » (fenêtre lue sur les boutons radio)', /Rythme · 7 j/.test(await P6.locator('.sigc').first().innerText()), (await P6.locator('.sigc').first().innerText()).split('\n')[1]);
  const stored = await E.evaluate(() => JSON.parse(localStorage.getItem('wyYield3')));
  ok('A5 · état hérité : rolesSchema 2, réglages de séries et graphique forcé remis à zéro, grille et paliers conservés', stored.rolesSchema === 2 && JSON.stringify(stored.maps) === '{}' && stored.dataIdx === null && stored.gridDate === '2026-07-24' && stored.gridNum === 10 && stored.tierList.length === 6, JSON.stringify({ s: stored.rolesSchema, m: stored.maps, d: stored.dataIdx }));
  ok('aucun « Réglage ignoré » après la remise à zéro', (await P6.locator('#msgs').innerText()).indexOf('Réglage ignoré') < 0);
  const yLab = await E.evaluate(`(() => Highcharts.charts.filter(Boolean).map(c => { const a = c.xAxis[0], all = a.plotLinesAndBands || [...(a.plotBands||[]), ...(a.plotLines||[])]; const b = all.find(x => /^wyp-pb\\d/.test(String(x.id)) && x.options.label); return b && b.options.label.y; }))()`);
  ok('R10 · libellés de période décalés de 16 px sur les deux graphiques new-bookings (12 + 16)', yLab.length === 2 && yLab.every(y => y === 28), yLab.join('/'));
  ok('titres des deux graphiques sans « chargement » (en-têtes masqués écartés)', !(await P6.locator('#dsel option').allInnerTexts()).some(t => /chargement/i.test(t)));
  await P6.click('[data-tab=zones]'); await P6.waitForTimeout(200);
  await P6.selectOption('#r-curRpd', 'thisyear'); await P6.waitForTimeout(500);
  ok('A9 · un réglage qui ferait servir une série à deux rôles est écarté et signalé', /Réglage ignoré : RPJ N/.test(await P6.locator('#msgs').innerText()) && /€/.test(await P6.locator('#hero .big').innerText()), (await P6.locator('#msgs').innerText()).replace(/\s+/g, ' ').slice(0, 90));
  ok('… et les chiffres ne changent pas', near(num(await P6.locator('#hero .big').innerText()), expEvo[0]));
  await P6.selectOption('#r-curRpd', 'auto'); await P6.waitForTimeout(400);
  await P6.click('[data-tab=signals]'); await P6.waitForTimeout(300);
  await P6.evaluate(() => new Promise(r => chrome.storage.local.set({ wypJevKey: 'sk-test-123' }, r))); await P6.reload(); await P6.waitForSelector('#app[data-conn=ok]'); await P6.waitForTimeout(600);
  await P6.click('[data-tab=signals]'); api.calls.length = 0; await P6.click('[data-sig=analyze]');
  await P6.waitForFunction(() => /périodes analysées/.test((document.querySelector('#sig .hint') || {}).textContent || ''), null, { timeout: 8000 });
  ok('sans N-1 final : aucun champ « absent » envoyé (cause du « Voir » partout)', api.calls.length > 5 && api.calls.every(c => !/not available|unknown|price_vs_last_year_final|"null"/.test(c.body)), `${api.calls.length} requêtes`);
  ok('la requête décrit un RYTHME (page Évolution), pas un portefeuille', api.calls.every(c => /booking_pace_vs_last_year/.test(c.body) && !/on_the_books/.test(c.body)));
  ok('avec des données exploitables, Jev ne répond pas « Voir » partout', (await P6.locator('.sigc .chips2 .vch.on:not(.review)').count()) >= (await P6.locator('.sigc').count()) - 2, `${await P6.locator('.sigc .vch.on.review').count()} « Voir » sur ${await P6.locator('.sigc').count()}`);
  ok('A3 · la requête porte la fenêtre (window_days 7, « over the last 7 days »)', api.calls.every(c => /"window_days":7/.test(c.body) && /over the last 7 days/.test(c.body)));
  await E.evaluate(() => { const rd = document.querySelector('#win input[value="14"]'); rd.checked = true; rd.dispatchEvent(new Event('change', { bubbles: true })); });
  ok('A3 · fenêtre 14 j : étiquette « Rythme · 14 j » et résultats Jev périmés', await (async () => { const t = Date.now(); for (;;) { if (/Rythme · 14 j/.test(await P6.locator('.sigc').first().innerText()) && (await P6.locator('.sigc .vch.stale').count()) > 0) return true; if (Date.now() - t > 6000) return false; await P6.waitForTimeout(150); } })());
  await P6.screenshot({ path: path.join(OUT, 'shot-18-evolution-signals.png'), fullPage: true });
  await P6.evaluate(() => new Promise(r => chrome.storage.local.remove('wypJevKey', r)));

  // 14c. dispositions RÉELLES bookings/lastyear et bookings/final (spec du 20/10/2026) : rôles, titre, bande native, mode RevCar
  const exp11 = pg => pg.evaluate(() => { const M = window.__mock, D = 86400000, m = x => new Map(x.map(([t, v]) => [t, v])); const [cur, rc, ly, rl, lf, rf] = [M.cur, M.rcur, M.ly, M.rly, M.lyf, M.rlyf].map(m);
    const k0 = Date.UTC(2026, 6, 31), k1 = Date.UTC(2026, 7, 6), w = (v, r) => { let a = 0, d = 0; for (let t = k0; t <= k1; t += D) { a += v.get(t) * r.get(t); d += v.get(t); } return a / d; }; return { n: w(cur, rc), ly: w(ly, rl), lyf: w(lf, rf) }; });
  const openFor = async (layout, tag) => {
    const pg = await ctx.newPage(); watch(pg, tag); await pg.setViewportSize({ width: 1300, height: 1000 });
    const url = `https://apps.weyield.io/reservations?layout=${layout}&t=${tag}`;
    await pg.goto(url); await pg.waitForFunction(() => window.Highcharts && Highcharts.charts.filter(Boolean).length >= 1); await pg.waitForTimeout(1500);
    const id = (await sw.evaluate(async u => (await chrome.tabs.query({ url: u })).map(t => t.id), url))[0];
    const pn = await ctx.newPage(); watch(pn, tag + '-panel'); await pn.setViewportSize({ width: 400, height: 1000 });
    await pn.addInitScript(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
    await pn.goto(panelUrl(id)); await pn.waitForSelector('#app[data-conn=ok]', { timeout: 8000 });
    await pn.click('[data-tab=zones]'); await pn.waitForTimeout(300);
    if (!(await pn.locator('#settings').evaluate(d => d.open))) await pn.click('#settings summary');
    return { pg, pn };
  };
  const autoOf = async (pn, role) => (await pn.locator(`#r-${role} option`).first().innerText()).trim();
  const headOf = pn => pn.locator('tr.head').first().evaluate(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim()));
  const untilOn = async (pn, fn, ms = 6000) => { const t = Date.now(); for (;;) { try { if (await fn()) return true; } catch (e) {} if (Date.now() - t > ms) return false; await pn.waitForTimeout(150); } };

  // --- bookings/lastyear ---
  { const { pg: Lp, pn: Lq } = await openFor('lastyear', 'ly');
    const roles = await Promise.all(['curVol', 'lyVol', 'curRpd', 'lyRpd', 'lyfVol', 'lyfRpd'].map(x => autoOf(Lq, x)));
    ok('A1 · bookings/lastyear : rôles current / lastyear / currentRpd / lastyearRpd, N-1 final « aucune »', roles.join('|') === 'Auto : current|Auto : lastyear|Auto : currentRpd|Auto : lastyearRpd · pointillé|Auto : aucune|Auto : aucune', roles.join('|'));
    ok('A1 · colonne N-1 final barrée, N-1 lue', (await Lq.locator('th.off').count()) === 1 && !/–/.test((await headOf(Lq))[2]));
    const e = await exp11(Lp), h = await headOf(Lq);
    ok('A1 · RPJ N et N-1 exacts (séries `current`/`currentRpd` et `lastyear`/`lastyearRpd`, malgré 4 séries anonymes et les flottes)', near(num(h[1]), e.n) && near(num(h[2]), e.ly), `${h.slice(0, 3).join(' | ')}  attendu ${e.n.toFixed(1)}/${e.ly.toFixed(1)}`);
    ok('bande native `past-band` (1970 → référence) : période en cours = P11', await untilOn(Lq, async () => (await Lq.locator('#pkn').innerText()).trim() === 'P11'));
    await Lq.click('#diag'); await Lq.waitForTimeout(400);
    const dg = JSON.parse(await Lq.evaluate(() => window.__copied)), g0 = dg.graphiques[0];
    ok('R8 · titre : jamais le « chargement » masqué, ni un libellé d\'axe', !/chargement|Chargement/.test(g0.titre) && !/^(janv|nov|déc)/i.test(g0.titre), g0.titre);
    ok('R11 · diagnostic : métrique « Revenu par jour », fenêtre absente, hôte, séries avec compteurs', g0.metrique === 'Revenu par jour' && g0.fenetre_jours === null && g0.hote === 'app-chart' && g0.series.every(s => 'nan' in s && 'inf_plus' in s) && g0.series.length === 11);
    const yl = await Lp.evaluate(`(() => { const c = Highcharts.charts.filter(Boolean)[0], a = c.xAxis[0], all = a.plotLinesAndBands || [...(a.plotBands||[]), ...(a.plotLines||[])]; const b = all.find(x => /^wyp-pb\\d/.test(String(x.id)) && x.options.label); return b && b.options.label.y; })()`);
    ok('R10 · bookings/* : libellés de période à leur place (y = 12, aucun décalage)', yl === 12, yl);
    await Lq.click('[data-tab=signals]'); await Lq.waitForTimeout(400);
    ok('bookings/* : cartes en lecture « Portefeuille »', /Portefeuille/.test(await Lq.locator('.sigc').first().innerText()));
    await Lq.click('[data-tab=zones]'); await Lq.waitForTimeout(200);
    // R7 / A6 : mode RevCar
    await Lp.evaluate(() => { document.getElementById('metric').textContent = 'Avancé (RevCar)'; });
    ok('A6 · « Avancé (RevCar) » : note RevCar, aucun RPJ affiché', await untilOn(Lq, async () => /RevCar/.test(await Lq.locator('#msgs').innerText()) && (await Lq.locator('#hero .big').innerText()).trim() === '–'), (await Lq.locator('#msgs').innerText()).replace(/\s+/g, ' ').slice(0, 80));
    await Lq.screenshot({ path: path.join(OUT, 'shot-19-revcar.png'), fullPage: true });
    await Lp.evaluate(() => { document.getElementById('metric').textContent = 'Avancé (Revenu par jour)'; });
    ok('A6 · retour à « Revenu par jour » : le RPJ revient', await untilOn(Lq, async () => /€/.test(await Lq.locator('#hero .big').innerText()) && !/RevCar/.test(await Lq.locator('#msgs').innerText())));
    await Lq.screenshot({ path: path.join(OUT, 'shot-20-lastyear.png'), fullPage: true });
  }
  // --- bookings/final ---
  { const { pg: Fp, pn: Fq } = await openFor('final', 'fi');
    const roles = await Promise.all(['curVol', 'lyVol', 'lyfVol', 'curRpd', 'lyRpd', 'lyfRpd'].map(x => autoOf(Fq, x)));
    ok('A2 · bookings/final : current / currentRpd / lastyearFinal / lastyearFinalRpd ; `lastyear` sans point ignoré', roles.join('|') === 'Auto : current|Auto : aucune|Auto : lastyearFinal · pointillé|Auto : currentRpd|Auto : aucune|Auto : lastyearFinalRpd · pointillé', roles.join('|'));
    const e = await exp11(Fp), h = await headOf(Fq);
    ok('A2 · colonne N-1 barrée, N-1 final lue et exacte', (await Fq.locator('th.off').count()) === 1 && (await Fq.locator('th.off').first().innerText()).trim() === 'N-1' && near(num(h[3]), e.lyf) && /–/.test(h[2]), `${h.slice(0, 4).join(' | ')}  attendu final ${e.lyf.toFixed(1)}`);
  }

  // 14b. signaux prix × rythme : règles, Jev (API simulée), bande sur le graphique, journal 👍/👎
  const SIGB = `(c => { const a = c.xAxis[0]; const all = (a.plotLinesAndBands || [...(a.plotBands||[]), ...(a.plotLines||[])]); return all.filter(b => /^wyp-(s|pb)/.test(String(b.id))).map(b => ({ id: String(b.id), t: (b.options.label && b.options.label.text) || '' })); })`;
  const cardsOn = () => P.locator('.sigc').evaluateAll(els => els.map(e => ({ k: +e.dataset.k, on: ((e.querySelector('.vch.on') || {}).textContent || '').trim() })));
  // concordance carte ↔ graphique : « tenir » = ni bande ni pictogramme ; sinon bande teintée + pictogramme dans l'étiquette de période
  const stripMatchesCards = async () => {
    const cs = await cardsOn(), g = await A.evaluate(`${SIGB}(Highcharts.charts[0])`);
    return cs.length > 0 && cs.every(c => {
      const tint = g.find(x => x.id === 'wyp-s' + c.k), lab = (g.find(x => x.id === 'wyp-pb' + c.k) || { t: '' }).t;
      const glyph = ['▲', '▼', '?'].find(x => c.on.includes(x));
      return glyph ? !!tint && lab.includes(glyph) : !tint && !/[▲▼?]/.test(lab);
    });
  };
  api.calls.length = 0;
  await P.click('[data-tab=signals]'); await wait(500);
  const nrow = await P.locator('.sigc').count();
  ok('signaux : une carte par période à venir', nrow >= 8, nrow);
  ok('sans clé : règles seules, Jev « — », aucun appel réseau', (await P.locator('.sigc .vch.none').count()) === nrow && api.calls.length === 0 && /Pas de clé/.test(await P.locator('#sig .hint').first().innerText()));
  ok('bande sur le graphique = verdict des règles (exceptions seulement)', await stripMatchesCards(), (await A.evaluate(`${SIGB}(Highcharts.charts[0])`)).filter(b => /^wyp-s/.test(b.id)).length + ' bande(s)');
  await P.screenshot({ path: path.join(OUT, 'shot-13-signals-rules.png'), fullPage: true });
  await P.click('[data-sig=analyze]'); await wait(300);
  ok('« Analyser » sans clé : message, toujours aucun appel', /Ajoutez d.abord une clé/.test(await P.locator('#sig .hint').first().innerText()) && api.calls.length === 0);
  if (!(await P.locator('#settings').evaluate(d => d.open))) await P.click('#settings summary');
  await P.fill('#jkey', 'sk-test-123'); await P.click('#jsave'); await wait(200);
  ok('clé enregistrée (champ vidé, placeholder masqué)', (await P.inputValue('#jkey')) === '' && /enregistrée/.test(await P.getAttribute('#jkey', 'placeholder')));
  await P.click('#jtest'); await P.waitForFunction(() => /Clé valide/.test(document.querySelector('#jstat').textContent), null, { timeout: 5000 });
  ok('test de clé : en-tête Authorization Bearer, modèle jev-latest', api.calls.length === 1 && api.calls[0].auth === 'Bearer sk-test-123' && JSON.parse(api.calls[0].body).model === 'jev-latest', await P.locator('#jstat').innerText());
  await P.click('[data-sig=analyze]');
  await P.waitForFunction(() => /périodes analysées/.test((document.querySelector('#sig .hint') || {}).textContent || ''), null, { timeout: 8000 });
  const statusAfter = await P.locator('#sig .hint').first().innerText();
  const nNa = await P.locator('.sigc .vch.none').count();
  const sent = api.calls.slice(1);
  ok('une requête par période exploitable (le code tranche seul les périodes fragiles), jamais de €', nNa >= 1 && sent.length === nrow - nNa && sent.every(c => c.auth === 'Bearer sk-test-123' && !/€|"rev"|"rpd"|\bCA\b/i.test(c.body) && /bookings_on_the_books_vs_last_year/.test(c.body)), `${sent.length} envoyées / ${nrow} périodes (${nNa} non envoyée)`);
  ok('5 questions par requête (score ×2, oui/non ×2, choix), choix direct sans « voir »', sent.every(c => { const q = JSON.parse(c.body).questions; return Object.keys(q).length === 5 && !('review' in q.action.criteria); }));
  ok('cartes : puce Jev renseignée avec confiance, « n/a » pour la période fragile', (await P.locator('.sigc .chips2 .vch:first-child:not(.none)').count()) === nrow - nNa && /%/.test(await P.locator('.sigc .chips2 .vch').first().innerText()) && /n\/a/.test(await P.locator('.sigc .chips2 .vch.none').first().innerText()));
  const cs = await cardsOn();
  ok('verdict affiché = Jev (puce encadrée), sauf période fragile (règles)', cs.filter(c => c.on.startsWith('Jev')).length === nrow - nNa && cs.filter(c => c.on.startsWith('Règles')).length === nNa, cs.map(c => c.on.slice(0, 12)).join(' | ').slice(0, 80));
  ok('bande sur le graphique suit Jev', await stripMatchesCards());
  await P.locator('.sigc[data-k="3"] .jd summary').click(); await wait(200);
  ok('P13 (oui/non partagés) → « Voir » avec sa raison dans le détail', (await P.locator('.sigc[data-k="3"] .vch.on').innerText()).includes('Voir') && /contradictoires/.test(await P.locator('.sigc[data-k="3"] .jdb').innerText()), (await P.locator('.sigc[data-k="3"] .vch.on').innerText()).replace(/\s+/g, ' '));
  ok('le détail reste ouvert après rafraîchissement du panneau', await P.locator('.sigc[data-k="3"] .jd').evaluate(d => d.open) && (await P.locator('.sigc[data-k="3"].sel').count()) === 0);
  ok('page Réservations : lecture « Portefeuille » (pas « Rythme »)', /Portefeuille/.test(await P.locator('.sigc').first().innerText()) && !/Rythme/.test(await P.locator('.sigc').first().innerText()));
  await P.locator('.sigc[data-k="4"] .jd summary').click(); await wait(150);
  ok('« Détail Jev » : probabilités brutes affichées', /Prix trop bas \? \d+ %/.test(await P.locator('.sigc[data-k="4"] .jdb').innerText()) && /Choix direct/.test(await P.locator('.sigc[data-k="4"] .jdb').innerText()), (await P.locator('.sigc[data-k="4"] .jdb').innerText()).replace(/\s+/g, ' ').slice(0, 90));
  await P.click('.sigc[data-k="4"] [data-raw]'); await wait(200);
  const rawCopy = await P.evaluate(() => window.__copied);
  ok('« Copier la requête et la réponse brutes » : JSON {request, response}', (() => { try { const o = JSON.parse(rawCopy); return !!o.request.questions && !!o.response.answers; } catch (e) { return false; } })());
  ok('statut : durée, tokens et périodes non envoyées', /\d+\/\d+ périodes analysées en [\d,]+ s · [\d\s\u202f\u00a0]+ tokens · \d+ non envoyée/.test(statusAfter), statusAfter);
  await P.screenshot({ path: path.join(OUT, 'shot-14-signals-jev.png'), fullPage: true });
  await A.screenshot({ path: path.join(OUT, 'shot-15-chart-strip.png') });
  await P.click('[data-src=rules]'); await wait(400);
  ok('bascule « Règles » : puce encadrée et bande suivent les règles', (await cardsOn()).every(c => c.on.startsWith('Règles')) && await stripMatchesCards());
  await P.click('[data-src=jev]'); await wait(300);
  // 👍 / 👎
  const k0 = (await cardsOn())[0].k, k1 = (await cardsOn())[1].k;
  await P.click(`.sigc[data-k="${k0}"] [data-vote=up]`); await wait(250);
  ok('👍 : « Noté 👍 », une ligne au journal (sans €)', /Noté 👍/.test(await P.locator(`.sigc[data-k="${k0}"] .vote`).innerText()) && (await P.evaluate(() => new Promise(r => chrome.storage.local.get('wypJournal', o => r((o.wypJournal || []).length))))) === 1);
  await P.click(`.sigc[data-k="${k1}"] [data-vote=ask]`); await wait(200);
  ok('👎 : propose les corrections', await P.locator(`.sigc[data-k="${k1}"] [data-fix]`).count() === 4);
  await P.click(`.sigc[data-k="${k1}"] [data-fix=lower]`); await wait(250);
  const jr = await P.evaluate(() => new Promise(r => chrome.storage.local.get('wypJournal', o => r(o.wypJournal))));
  ok('👎 + « Baisser » : étiquette enregistrée', jr.length === 2 && jr[1].vote === 'down' && jr[1].fix === 'lower' && jr[1].jev && jr[1].rules, JSON.stringify(jr[1]).slice(0, 90));
  ok('tableau de bord « Jev x/y · Règles z/w »', /Jev \d+\/\d+ · Règles \d+\/\d+/.test(await P.locator('.board').innerText()), (await P.locator('.board').innerText()).replace(/\s+/g, ' '));
  await P.click('#jcsv'); await wait(250);
  const csv = await P.evaluate(() => window.__copied);
  ok('journal CSV : en-têtes + 2 lignes, aucun montant', csv.split('\n').length === 3 && /^date\tperiode/.test(csv) && !/€/.test(csv), csv.split('\n')[0].slice(0, 60));
  ok('aucune requête n\'a contenu de € (toutes confondues)', api.calls.every(c => !/€|"rev"/.test(c.body)), api.calls.length + ' requêtes');
  // erreur 401
  api.mode = '401'; await P.fill('#jkey', 'sk-bad'); await P.click('#jsave'); await wait(150); await P.click('#jtest');
  await P.waitForFunction(() => /401/.test(document.querySelector('#jstat').textContent), null, { timeout: 5000 });
  ok('clé refusée (401) : message explicite au test', /Clé refusée/.test(await P.locator('#jstat').innerText()));
  await P.click('[data-sig=analyze]'); await P.waitForFunction(() => /Clé refusée/.test((document.querySelector('#sig .hint') || {}).textContent || ''), null, { timeout: 8000 });
  ok('clé refusée (401) : message explicite à l\'analyse', true);
  api.mode = 'ok'; await P.fill('#jkey', 'sk-test-123'); await P.click('#jsave'); await wait(150);
  await P.click('[data-sig=analyze]'); await P.waitForFunction(() => /périodes analysées/.test((document.querySelector('#sig .hint') || {}).textContent || ''), null, { timeout: 8000 });
  // résultats périmés quand les chiffres changent
  await A.evaluate(() => { const s = Highcharts.charts[0].series.find(x => x.name === 'current'); s.setData(window.__mock.cur.map(([t, v]) => [t, v * 0.6])); });
  await P.waitForFunction(() => document.querySelectorAll('.sigc .vch.stale').length > 0, null, { timeout: 8000 }).catch(() => {}); await wait(300);
  const nStale = await P.locator('.sigc .vch.stale').count(), onNow = (await cardsOn()).map(c => c.on.slice(0, 6)), stripOk = await stripMatchesCards();
  ok('chiffres modifiés : puces Jev « périmées », bande retombe sur les règles', nStale > 0 && onNow.every(x => x.startsWith('Règles')) && stripOk, `périmées=${nStale} · encadrées=${[...new Set(onNow)].join('/')} · bande=${stripOk}`);
  await P.screenshot({ path: path.join(OUT, 'shot-16-signals-stale.png'), fullPage: true });
  await P.click('#jclear'); await wait(200);
  ok('clé effacée : retour aux règles seules', /Aucune clé/.test(await P.locator('#jstat').innerText()));
  await A.reload(); await P.waitForSelector('#app[data-conn=ok]', { timeout: 10000 }); await wait(1500);

  await P.emulateMedia({ colorScheme: 'dark' }); await wait(200);
  await P.screenshot({ path: path.join(OUT, 'shot-8-dark.png'), fullPage: true });
  await P.emulateMedia({ colorScheme: 'light' });
  await P.setViewportSize({ width: 320, height: 900 }); await wait(200);
  ok('320 px : pas de défilement horizontal de la page', await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await P.screenshot({ path: path.join(OUT, 'shot-9-narrow.png'), fullPage: true });
  await A.bringToFront(); await A.screenshot({ path: path.join(OUT, 'shot-10-chart.png') });

  // 15. migration v1 / v2
  const M = await ctx.newPage(); watch(M, 'migr');
  await M.addInitScript(() => { localStorage.removeItem('wyYield3'); localStorage.setItem('wyPaliers', JSON.stringify({ v: 2, tiersTxt: '1-3, 4-9', gridDate: '2026-07-24', gridNum: 1, gridLen: 1, gridUnit: 'w', periods: false })); });
  await M.goto('https://apps.weyield.io/reservations?x=1');
  await M.waitForFunction(() => window.Highcharts && Highcharts.charts[0]); await M.waitForTimeout(1500);
  const mtab = (await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://apps.weyield.io/reservations?x=1' })).map(t => t.id)))[0];
  const P3 = await ctx.newPage(); watch(P3, 'panel3'); await P3.setViewportSize({ width: 400, height: 900 });
  await P3.goto(panelUrl(mtab)); await P3.waitForSelector('#app[data-conn=ok]', { timeout: 8000 }); await P3.click('[data-tab=zones]'); await P3.waitForTimeout(200);
  ok('migration v2 : paliers 1-3 et 4-9 repris, calque Périodes désactivé', await P3.locator('tr[data-z]').count() === 2 && (await P3.locator('[data-layer=periods]').getAttribute('aria-checked')) === 'false');

  console.log(results.map(r => r.join('  ')).join('\n'));
  console.log('\nErreurs console/page :', errors.length ? errors : 'aucune');
  const ko = results.filter(r => r[0] === 'KO ').length;
  console.log(`\n${results.length - ko}/${results.length} OK`);
  await ctx.close();
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ÉCHEC DU BANC', e); process.exit(2); });
