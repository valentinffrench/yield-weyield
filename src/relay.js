// Relais (monde isolé) : seul à pouvoir parler à chrome.runtime et chrome.storage.
// 1. Pont entre le panneau latéral et le moteur de la page. Le moteur valide chaque action (liste blanche + bornes).
// 2. Réglages communs à WeYield et Rentway (chrome.storage.local, clé « wypShared », format dans core.js : cleanShared) :
//    découpage en périodes et paliers réglés une seule fois ; si la synchronisation est active, période choisie et décalage de J0.
//    Chaque onglet ouvert reçoit les changements en direct (chrome.storage.onChanged), panneau ouvert ou non.
(() => {
  const WY = window.__WYP;
  let port = null;
  const toPage = msg => window.postMessage({ __wyp: 1, dir: 'to-page', msg }, location.origin);

  chrome.runtime.onConnect.addListener(p => {
    if (p.name !== 'wyp-panel') return;
    if (port) { try { port.disconnect(); } catch (e) {} }
    port = p;
    p.onMessage.addListener(m => { if (m && typeof m === 'object') toPage(m); });
    p.onDisconnect.addListener(() => { if (port === p) { port = null; toPage({ op: 'bye' }); } });
    toPage({ op: 'hello' });
  });

  // ---------- réglages communs ----------
  const KEY = 'wypShared';
  const read = () => new Promise(r => { try { chrome.storage.local.get(KEY, o => r(o && o[KEY] ? WY.cleanShared(o[KEY]) : null)); } catch (e) { r(null); } });
  const write = v => { try { chrome.storage.local.set({ [KEY]: v }); } catch (e) {} };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let queue = Promise.resolve();   // lectures-écritures l'une après l'autre (pas de réglage perdu entre deux messages rapprochés)

  async function fromEngine(m) {
    const cur = await read(), site = m.site === 'fleet' ? 'fleet' : 'rpd';
    const mine = WY.cleanShared({ cfg: m.cfg, sel: m.sel });
    if (m.type === 'ready') {
      // Rien d'enregistré : WeYield amorce avec ses réglages ; une page Rentway encore vierge n'amorce rien (ses valeurs par défaut
      // écraseraient les réglages WeYield). Sinon, la page reçoit les réglages communs (et la période, si elle date de moins de 12 h).
      if (!cur || !cur.cfg) { if (site === 'rpd' && mine.cfg) write(Object.assign(cur || WY.cleanShared({}), { cfg: mine.cfg, from: site })); return; }
      toPage({ op: 'shared', shared: cur, withSel: cur.sync && WY.selFresh(cur, Date.now()) });
      return;
    }
    if (m.type !== 'report') return;
    const next = Object.assign({}, cur || WY.cleanShared({}));
    if (m.cfgChanged && mine.cfg) { next.cfg = mine.cfg; next.from = site; }   // réglé ici : vaut pour les deux sites
    if (next.sync && mine.sel) { next.sel = mine.sel; next.selT = Date.now(); }
    if (!same(next, cur)) write(next);
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch[KEY] || !ch[KEY].newValue) return;
    const sh = WY.cleanShared(ch[KEY].newValue);
    if (sh.cfg) toPage({ op: 'shared', shared: sh, withSel: sh.sync && !!sh.sel });
  });

  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.__wyp !== 1) return;
    if (d.dir === 'to-relay') { const m = d.msg; if (m && typeof m === 'object') queue = queue.then(() => fromEngine(m)).catch(() => {}); return; }
    if (d.dir !== 'to-panel' || !port) return;
    try { port.postMessage(d.msg); } catch (err) { port = null; }
  });
})();
