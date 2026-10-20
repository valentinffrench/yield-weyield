// Génère les captures du README (docs/img/) à partir de la maquette : données SYNTHÉTIQUES, aucune donnée réelle.
// Lancer :  cd test/browser && npm install && npm run screenshots
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../..');
const OUT = path.join(EXT, 'docs', 'img'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || os.homedir() + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const mock = fs.readFileSync(path.join(__dirname, 'mock.html'));
const hc = fs.readFileSync(path.join(__dirname, 'node_modules/highcharts/highcharts.js'));

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wyshot-')), {
    executablePath: CHROME, headless: false, deviceScaleFactor: 2,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1000, height: 760 } });
  await ctx.route('https://apps.weyield.io/**', r => r.fulfill(new URL(r.request().url()).pathname === '/highcharts.js' ? { body: hc, contentType: 'text/javascript' } : { body: mock, contentType: 'text/html' }));
  const A = await ctx.newPage();
  await A.addInitScript(() => localStorage.setItem('wyYield3', JSON.stringify({ v: 3, rolesSchema: 2, gridDate: '2026-07-24', gridNum: 10, gridLen: 1, gridUnit: 'w', offset: 0, periods: true, tiers: true, signals: true,
    tierList: [[1, 2], [3, 6], [7, 13], [14, 20], [21, 30], [31, 60]], maps: {}, dataIdx: null, dataKey: null })));
  await A.goto('https://apps.weyield.io/reservations?layout=lastyear&clean=1');
  await A.waitForFunction(() => window.Highcharts && Highcharts.charts[0]); await A.waitForTimeout(1500);
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host, tab = (await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://apps.weyield.io/*' })).map(t => t.id)))[0];
  const P = await ctx.newPage(); await P.setViewportSize({ width: 400, height: 860 });
  await P.goto(`chrome-extension://${id}/src/panel/panel.html?tab=${tab}`); await P.waitForSelector('#app[data-conn=ok]');
  const settle = () => P.waitForTimeout(500);

  await P.click('[data-op=next]'); await settle(); await P.click('[data-off="1"]'); await settle(); await P.click('[data-off="1"]'); await settle();
  await P.click('[data-tab=zones]'); await settle();
  await P.screenshot({ path: path.join(OUT, 'panel-paliers.png') });
  await P.click('[data-tab=signals]'); await P.click('[data-src=rules]'); await settle();
  await P.screenshot({ path: path.join(OUT, 'panel-signaux.png') });
  await A.locator('#hostwrap').screenshot({ path: path.join(OUT, 'chart-signaux.png') });
  await P.click('[data-tab=zones]'); await settle();
  if (!(await P.locator('#settings').evaluate(d => d.open))) await P.click('#settings summary');
  await P.locator('#settings').scrollIntoViewIfNeeded(); await settle();
  await P.locator('#settings').screenshot({ path: path.join(OUT, 'reglages.png') });
  await P.evaluate(() => window.scrollTo(0, 0));
  await P.emulateMedia({ colorScheme: 'dark' }); await P.click('#settings summary'); await settle();
  await P.screenshot({ path: path.join(OUT, 'panel-sombre.png') });
  await P.emulateMedia({ colorScheme: 'light' }); await settle();

  // vue d'ensemble : graphique à gauche, panneau à droite (comme dans Chrome)
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, f)).toString('base64');
  const C = await ctx.newPage(); await C.setViewportSize({ width: 1500, height: 700 });
  await C.setContent(`<body style="margin:0;background:#dfe5ec;display:flex;gap:0;align-items:flex-start;font-family:system-ui">
    <img src="${b64('chart-signaux.png')}" style="width:1040px;margin:14px 0 0 14px;border-radius:8px;box-shadow:0 2px 10px #0003">
    <img src="${b64('panel-paliers.png')}" style="width:400px;margin:14px 14px 0 14px;border-radius:8px;box-shadow:0 2px 10px #0003"></body>`);
  await C.waitForTimeout(400);
  await C.locator('body').screenshot({ path: path.join(OUT, 'vue-ensemble.png') });
  await ctx.close();
  console.log(fs.readdirSync(OUT).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
