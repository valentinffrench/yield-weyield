// Génère la capture Rentway du README (docs/img/rentway-vue-ensemble.png) à partir de la maquette de la Balance de flotte :
// données SYNTHÉTIQUES (21 catégories, flottes et disponibilités fictives), aucune donnée Rentway réelle.
// Lancer :  cd test/browser && npm install && npm run screenshots:rentway
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../..');
const OUT = path.join(EXT, 'docs', 'img'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rwshot-img-'));
const CHROME = process.env.CHROME_PATH || os.homedir() + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const mock = fs.readFileSync(path.join(__dirname, 'rentway-mock.html'));

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'rwshot-')), {
    executablePath: CHROME, headless: false, deviceScaleFactor: 2, timezoneId: 'America/Guadeloupe', locale: 'fr-FR',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1100, height: 1000 } });
  await ctx.route('https://rentwayv1.emotionmobility.com/**', r => r.fulfill({ body: mock, contentType: 'text/html' }));
  const R = await ctx.newPage();
  await R.clock.setFixedTime(new Date('2026-12-05T10:00:00-04:00'));
  await R.addInitScript(() => localStorage.setItem('wyYield3', JSON.stringify({ v: 3, rolesSchema: 2, gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w', offset: 0, periods: true, tiers: true, signals: true,
    tierList: [[1, 2], [3, 6], [7, 13], [14, 20], [21, 30], [31, 60]], maps: {}, dataIdx: null, dataKey: null, occTh: [81, 86, 87] })));
  await R.goto('https://rentwayv1.emotionmobility.com/?full');
  await R.waitForFunction(() => window.__mock && document.querySelector('#pivotgrid table'));
  await R.addStyleTag({ content: ':root{--cw:800px;--gw:1040px}.container{padding:0}' });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host, tab = (await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://rentwayv1.emotionmobility.com/*' })).map(t => t.id)))[0];
  const P = await ctx.newPage();
  // panneau à la hauteur du tableau (21 catégories + 2 totaux), pour une vue d'ensemble sans coupure
  const cardH = Math.ceil(await R.locator('.v-card').evaluate(e => e.getBoundingClientRect().height));
  await P.setViewportSize({ width: 400, height: cardH });
  await P.goto(`chrome-extension://${id}/src/panel/panel.html?tab=${tab}`); await P.waitForSelector('#app[data-conn=ok]');
  const settle = () => P.waitForTimeout(600);

  // P31 (18 → 24 déc.) : les paliers couvrent la pointe de Noël ; vue Catégories, pic par palier
  await P.click('[data-op=next]'); await settle(); await P.click('[data-op=next]'); await settle();
  await P.click('[data-tab=cats]'); await P.click('[data-cum="0"]'); await settle();
  await P.screenshot({ path: path.join(TMP, 'panel.png') });
  // tableau : de la veille de J0 jusqu'aux paliers longs
  await R.evaluate(() => { const el = document.getElementById('pivotgrid'), td = [...el.querySelectorAll('.dx-area-column-cell td')].find(t => t.innerText.replace(/\s/g, '') === '16-12');
    const c = el.querySelector('.dx-area-data-cell .dx-scrollable-container'); c.scrollLeft = td.offsetLeft; c.dispatchEvent(new Event('scroll')); });
  await R.waitForTimeout(1500);
  await R.locator('.v-card').screenshot({ path: path.join(TMP, 'tableau.png') });

  // vue d'ensemble : tableau à gauche, panneau à droite (comme dans Chrome)
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(path.join(TMP, f)).toString('base64');
  const C = await ctx.newPage(); await C.setViewportSize({ width: 1500, height: cardH + 28 });
  await C.setContent(`<body style="margin:0;background:#dfe5ec;display:flex;align-items:flex-start">
    <img src="${b64('tableau.png')}" style="width:1040px;margin:14px 0 14px 14px;border-radius:8px;box-shadow:0 2px 10px #0003">
    <img src="${b64('panel.png')}" style="width:400px;margin:14px 14px 14px 14px;border-radius:8px;box-shadow:0 2px 10px #0003"></body>`);
  await C.waitForTimeout(400);
  await C.locator('body').screenshot({ path: path.join(OUT, 'rentway-vue-ensemble.png') });
  await ctx.close();
  console.log(path.join(OUT, 'rentway-vue-ensemble.png'));
})().catch(e => { console.error(e); process.exit(1); });
