// Relais (monde isolé) : seul à pouvoir parler à chrome.runtime ; transmet entre le panneau latéral et le moteur de la page.
// Le moteur valide chaque action (liste blanche + bornes) : rien d'autre que les messages ci-dessous ne passe.
(() => {
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

  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.__wyp !== 1 || d.dir !== 'to-panel' || !port) return;
    try { port.postMessage(d.msg); } catch (err) { port = null; }
  });
})();
