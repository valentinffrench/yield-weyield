// Panneau latéral : vue de l'état envoyé par le moteur (engine.js) et émetteur d'actions.
// Les signaux (règles + Jev) et le journal 👍/👎 vivent ici ; le moteur ne reçoit que { période, verdict, opacité } à peindre.
(() => {
  'use strict';
  const WY = window.__WYP, SIG = WY.sig;
  const { fmtDM, fmtDMY, PALETTE } = WY;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const app = $('#app');
  const WEYIELD = 'https://apps.weyield.io/';
  const FORCED_TAB = new URLSearchParams(location.search).get('tab'); // banc de test : cible un onglet précis

  // ---------- préférences propres au panneau ----------
  const PREF_KEY = 'wypPanel';
  const prefs = Object.assign({ tab: 'zones', settings: false, source: 'jev' }, (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) { return null; } })());
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} };

  // ---------- formats ----------
  const nf = (v, d) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rpj = v => (v == null ? '–' : nf(v, 1) + ' €');
  const ca = v => (v == null ? '–' : nf(Math.round(v), 0) + ' €');
  const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + nf(Math.abs(n), 0) + ' %';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayNum = t => new Date(t).getUTCDate();
  const sameMonth = (a, b) => new Date(a).getUTCMonth() === new Date(b).getUTCMonth() && new Date(a).getUTCFullYear() === new Date(b).getUTCFullYear();
  const rng = (a, b) => (a === b ? fmtDM(a) : sameMonth(a, b) ? `${dayNum(a)} → ${fmtDM(b)}` : `${fmtDM(a)} → ${fmtDM(b)}`);
  const pLabel = p => (p.num >= 1 ? p.label : 'Avant P1');
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  function pill(d) {
    if (d == null) return '<span class="pill na">–</span>';
    if (Math.abs(d) < 0.05) return '<span class="pill na">= 0,0 %</span>';
    return `<span class="pill ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲ +' : '▼ −'}${nf(Math.abs(d), 1)} %</span>`;
  }

  // ---------- connexion à l'onglet WeYield actif ----------
  let port = null, tabId = null, st = null, view = null, conn = 'wait', gotSnap = false, lastHover = '', lastSig = '';
  const send = m => { if (port) { try { port.postMessage(m); } catch (e) {} } };

  const EMPTY = {
    wait: ['Connexion…', 'Recherche de la page WeYield.', null],
    notab: ['Ouvrez WeYield', 'Le panneau suit l’onglet actif. Ouvrez apps.weyield.io, page Réservations.', ['Ouvrir WeYield', () => chrome.tabs.create({ url: WEYIELD })]],
    noscript: ['Page non connectée', 'Rechargez l’onglet WeYield : l’extension vient d’être installée ou mise à jour.', ['Recharger l’onglet', () => chrome.tabs.reload(tabId)]],
    lost: ['Connexion perdue', 'La page WeYield a été rechargée. Reconnexion automatique…', ['Recharger l’onglet', () => chrome.tabs.reload(tabId)]],
    nochart: ['Aucun graphique Réservations', 'Ouvrez la page Réservations de WeYield et cliquez sur « Appliquer ».', null],
  };
  const STATUS = { wait: 'Connexion…', ok: 'Connecté', nochart: 'Pas de graphique', lost: 'Connexion perdue', noscript: 'Non connecté', notab: 'Hors WeYield' };
  let emptyAction = null;
  function setConn(c) {
    conn = c;
    app.dataset.conn = c;
    $('#statusTxt').textContent = STATUS[c];
    const ok = c === 'ok';
    $('#content').hidden = !ok;
    $('#empty').hidden = ok;
    if (!ok) {
      const [t, p, btn] = EMPTY[c];
      $('#emptyTitle').textContent = t; $('#emptyText').textContent = p;
      const b = $('#emptyBtn'); b.hidden = !btn; if (btn) { b.textContent = btn[0]; emptyAction = btn[1]; }
    }
  }
  $('#emptyBtn').addEventListener('click', () => emptyAction && emptyAction());

  async function pickTab() {
    if (FORCED_TAB) return +FORCED_TAB;
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t && t.url && t.url.startsWith(WEYIELD) ? t.id : null;
  }
  function disconnect() { const p = port; port = null; if (p) { try { p.disconnect(); } catch (e) {} } }
  async function sync() {
    const id = await pickTab();
    if (id === tabId && port) return;
    disconnect(); tabId = id; gotSnap = false; view = null; lastSig = '';
    if (id == null) return setConn('notab');
    setConn('wait');
    let p;
    try { p = chrome.tabs.connect(id, { name: 'wyp-panel' }); } catch (e) { return setConn('noscript'); }
    port = p;
    p.onMessage.addListener(m => { if (port === p) onMsg(m); });
    p.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === p) { port = null; setConn(gotSnap ? 'lost' : 'noscript'); } });
    send({ op: 'hello' });
  }
  function onMsg(m) {
    if (m && m.type === 'diag') return navigator.clipboard.writeText(JSON.stringify(m.data, null, 1)).then(() => flash('Diagnostic copié ✓'), () => flash('Copie impossible'));
    if (!m || m.type !== 'snapshot') return;
    gotSnap = true; st = m.state; view = m.view;
    if (!view) { setConn('nochart'); return; }
    if (conn !== 'ok') setConn('ok');
    render();
  }
  chrome.tabs.onActivated.addListener(sync);
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (conn !== 'ok' && conn !== 'nochart') sync(); }, 2000);
  sync();

  // ---------- Jev : clé, modèle, journal (chrome.storage.local, propres à ce navigateur) ----------
  const store = { get: k => new Promise(r => chrome.storage.local.get(k, r)), set: o => new Promise(r => chrome.storage.local.set(o, r)), del: k => new Promise(r => chrome.storage.local.remove(k, r)) };
  let jevKey = '', jevModel = 'jev-latest', journal = [];
  let jev = {};              // k → { fk, res } : résultats Jev en mémoire ; périmés dès que les écarts d'une période changent
  let analyzing = null, astat = '', fixing = null;
  store.get(['wypJevKey', 'wypJevModel', 'wypJournal']).then(o => { jevKey = o.wypJevKey || ''; jevModel = o.wypJevModel || 'jev-latest'; journal = o.wypJournal || []; syncJev(); if (view) render(); });

  // ---------- rendu ----------
  function render() {
    const v = view;
    $('#pkn').textContent = pLabel(v.selP);
    $('#pkd').textContent = rng(v.selP.from, v.selP.to);
    $('#today').hidden = v.isAuto;
    $$('.chip').forEach(b => b.setAttribute('aria-checked', String(!!st[b.dataset.layer])));

    $('#j0box').classList.toggle('dim', !st.tiers);
    $('#j0d').textContent = fmtDM(v.j0);
    $('#j0n').textContent = v.offset ? `début de ${pLabel(v.selP)} ${signed(v.offset)} j` : `début de ${pLabel(v.selP)}`;
    $('#off').textContent = v.offset ? `${signed(v.offset)} j` : '0 j';
    $('#offReset').hidden = !v.offset;

    const s = v.selStats, h = v.has;
    $('#hero').innerHTML = `
      <div><div class="lbl">RPJ N · ${pLabel(v.selP)}, départs</div>
        <div class="big">${h.rpd ? rpj(s.cur && s.cur.rpd) : '–'}</div>
        <div class="mut small">CA ${h.rpd ? ca(s.cur && s.cur.rev) : '–'}</div></div>
      <div class="cmp">
        <div class="cmpr">${h.ly ? pill(s.dLy) : '<span class="pill na">–</span>'}<span class="mut">vs N-1 <b>${h.ly ? rpj(s.ly && s.ly.rpd) : '–'}</b></span></div>
        <div class="cmpr">${h.lyf ? pill(s.dLyf) : '<span class="pill na">–</span>'}<span class="mut">vs final <b>${h.lyf ? rpj(s.lyf && s.lyf.rpd) : '–'}</b></span></div>
      </div>`;

    $$('.seg [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === prefs.tab)));
    $('#tabZones').textContent = 'Paliers';
    const sigTab = prefs.tab === 'signals';
    $('#tbl').hidden = sigTab; $('#tblfoot').hidden = sigTab; $('#sig').hidden = !sigTab;
    renderMsgs();
    if (sigTab) renderSignals(); else renderTable();
    syncSettings();
    sendSignals();
  }

  function renderMsgs() {
    const v = view, h = v.has;
    const missing = [!h.ly && 'N-1', !h.lyf && 'N-1 final'].filter(Boolean);
    const notes = [];
    if (v.metricBlocked) notes.push(`<div class="note warn">Affichage « ${esc(v.metric || '')} » : le RPJ n’est pas calculé. Repassez le menu « Avancé » sur « Revenu par jour ».</div>`);
    else if (!h.rpd) notes.push(`<div class="note warn">Série « Revenu par jour » introuvable dans « ${esc(v.charts[v.dataIdx] ? v.charts[v.dataIdx].title : 'ce graphique')} ».
          Séries vues : ${v.series.length ? v.series.map(x => esc(x.label)).join(', ') : 'aucune'}.<br>
          ${v.charts.length > 1 ? 'Essayez un autre graphique, ou ' : ''}Indiquez les séries à lire dans Réglages › Séries lues, ou <button class="link" data-diag>copiez le diagnostic</button>.</div>`);
    else if (missing.length) notes.push(`<div class="note">Absent de cet affichage WeYield : ${missing.join(', ')}.</div>`);
    if (v.invalid && v.invalid.length) notes.push(`<div class="note warn">Réglage ignoré : ${v.invalid.map(r => esc(WY.ROLE_LABEL[r])).join(', ')}. Une série ne peut pas servir deux rôles.</div>`);
    $('#msgs').innerHTML = notes.join('');
  }

  function cells(r) {
    const h = view.has;
    const cmp = (o, d, off) => (off || !o ? '<td>–</td>' : `<td>${rpj(o.rpd)}<br>${pill(d)}</td>`);
    return `<td>${h.rpd && r.cur ? `<b>${rpj(r.cur.rpd)}</b><small>${ca(r.cur.rev)}</small>` : '–'}</td>${cmp(r.ly, r.dLy, !h.ly)}${cmp(r.lyf, r.dLyf, !h.lyf)}`;
  }
  function renderTable() {
    const v = view, h = v.has;
    const partial = r => (r.nDays < r.full ? `<small>⚠ ${r.nDays}/${r.full} j chargés</small>` : '');
    let body;
    if (prefs.tab === 'periods') {
      body = v.periodRows.length ? v.periodRows.map(r => `<tr data-k="${r.p.k}" tabindex="0" class="${r.p.k === v.selP.k ? 'sel' : ''}" title="Choisir ${pLabel(r.p)}">
        <td><span class="zl">${pLabel(r.p)}</span><small>${rng(r.from, r.to)}</small>${partial(r)}</td>${cells(r)}</tr>`).join('')
        : '<tr><td colspan="4" class="mut">Aucune période dans la plage du graphique.</td></tr>';
    } else {
      const head = `<tr class="head"><td><span class="zl">${pLabel(v.selP)} · départs</span><small>${rng(v.selStats.from, v.selStats.to)}</small>${partial(v.selStats)}</td>${cells(v.selStats)}</tr>`;
      body = head + (v.zones.length ? v.zones.map((z, i) => `<tr data-z="${i}" tabindex="0"><td><i style="background:rgb(${PALETTE[z.ci % PALETTE.length]})"></i><span class="zl">${z.label}</span><small>${rng(z.from, z.to)}</small>${partial(z)}</td>${cells(z)}</tr>`).join('')
        : '<tr><td colspan="4" class="mut">Aucun palier : ajoutez-en dans les réglages.</td></tr>');
    }
    $('#tbl').innerHTML = `<table><thead><tr><th></th><th>RPJ N</th>
      <th class="${h.ly ? '' : 'off'}" title="N-1 à la même date">N-1</th>
      <th class="${h.lyf ? '' : 'off'}" title="N-1 final (réalisé)">N-1 final</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  // ---------- signaux prix × rythme ----------
  // Une ligne par période à venir : écarts relatifs (code), verdict par règles (code), verdict Jev (si analysé et à jour).
  function sigRows() {
    if (!view || !view.has.rpd) return [];
    const ref = view.ref, ctx = SIG.context(view.periodRows, ref, view.kind, view.windowDays);
    return view.periodRows.filter(r => SIG.eligible(r, ref)).map(r => {
      const f = SIG.features(r, ref, ctx), fk = SIG.key(f), rl = SIG.rules(f);
      const j = jev[f.k], fresh = j && j.fk === fk ? j.res : null;
      const useJev = prefs.source === 'jev' && !!fresh;
      return { r, f, fk, rl, jv: fresh, raw: fresh && j.raw, skip: SIG.skipJev(f), old: j && !fresh ? j.res : null, stale: !!j && !fresh, shown: useJev ? 'jev' : 'rules',
        action: useJev ? fresh.action : rl.action, alpha: useJev ? (typeof fresh.conf === 'number' ? fresh.conf : 0.5) : rl.strength };
    });
  }
  function sendSignals() {
    const items = sigRows().map(s => ({ k: s.f.k, kind: s.action, alpha: Math.round(s.alpha * 100) / 100 }));
    const j = JSON.stringify(items);
    if (j !== lastSig) { lastSig = j; send({ op: 'signals', items }); }
  }
  const chip = (src, action, extra = {}) => {
    if (extra.na) return `<span class="vch none" title="Données fragiles ou absentes : le code conclut seul, Jev n’est pas appelé"><span class="src">${src}</span> n/a</span>`;
    if (!action) return `<span class="vch none"><span class="src">${src}</span> —</span>`;
    const a = SIG.ACTIONS[action];
    return `<span class="vch ${action}${extra.on ? ' on' : ''}${extra.stale ? ' stale' : ''}" title="${esc(extra.title || '')}"><span class="src">${src}</span> ${a.glyph} ${a.label}${extra.conf != null ? ` · ${Math.round(extra.conf * 100)} %` : ''}</span>`;
  };
  const openJd = new Set();   // détails Jev ouverts : conservés d'un rafraîchissement à l'autre
  const pc = v => (typeof v === 'number' ? `${Math.round(v * 100)} %` : '–');
  const LV_VOL = ['très en retrait', 'en retrait', 'comparable', 'en avance', 'très en avance'], LV_PRICE = ['très bas', 'plus bas', 'comparable', 'plus haut', 'très haut'];
  // Ce que Jev a réellement répondu : de quoi comprendre un verdict surprenant, et copier la requête + réponse brutes pour diagnostic.
  function detail(s) {
    const v = s.jv; if (!v) return '';
    const probs = Object.entries(v.probs || {}).sort((a, b) => b[1] - a[1]).map(([k, p]) => `${SIG.ACTIONS[k] ? SIG.ACTIONS[k].label : k} ${pc(p)}`).join(' · ');
    const lv = (x, L) => (x == null ? '–' : L[Math.max(0, Math.min(4, Math.round(x) + 2))]);
    return `<details class="jd" data-k="${s.f.k}"${openJd.has(s.f.k) ? ' open' : ''}><summary>Détail Jev</summary><div class="jdb">
      <div>Prix trop bas ? <b>${pc(v.under)}</b> · trop haut ? <b>${pc(v.over)}</b>${v.note ? ` · <span class="mut">${esc(v.note)}</span>` : ''}</div>
      <div>Choix direct : <b>${v.choice ? SIG.ACTIONS[v.choice].label : '–'}</b> <span class="mut">(${probs || '–'})</span></div>
      <div class="mut">Lecture de Jev : ${SIG.kindLabel(s.f.kind, s.f.windowDays).toLowerCase()} ${lv(v.pace, LV_VOL)} · prix ${lv(v.price, LV_PRICE)}</div>
      <button class="link" data-raw="${s.f.k}">Copier la requête et la réponse brutes</button></div></details>`;
  }
  function renderSignals() {
    const rows = sigRows(), sb = SIG.scoreboard(journal);
    const n = rows.length;
    const status = analyzing ? `Analyse… ${analyzing.done}/${analyzing.total}` : astat
      || (!jevKey ? 'Pas de clé : verdicts par règles seulement. Collez une clé dans Réglages › Jev.' : rows.some(x => x.jv) ? '' : 'Jev n’a pas encore analysé ces périodes.');
    let html = `<div class="sighead">
      <div class="row between">
        <div class="seg" role="group" aria-label="Verdict affiché sur le graphique">
          <button data-src="jev" aria-pressed="${prefs.source === 'jev'}">Jev</button><button data-src="rules" aria-pressed="${prefs.source === 'rules'}">Règles</button></div>
        <button class="btn primary sm" data-sig="analyze" ${analyzing || !n ? 'disabled' : ''} title="${jevKey ? 'Envoie les écarts relatifs de chaque période à Jev' : 'Ajoutez d’abord une clé API dans les réglages'}">${analyzing ? 'Analyse…' : 'Analyser avec Jev'}</button>
      </div>
      <p class="hint" role="status">${esc(status)}</p></div>`;
    if (!view.has.rpd) html += '<div class="note">Les signaux demandent la série « Revenu par jour ».</div>';
    else if (!n) html += '<div class="note">Aucune période à venir avec des données chargées.</div>';
    html += '<div class="sigl">' + rows.map(s => {
      const f = s.f, dis = s.jv && s.jv.action !== s.rl.action;
      const entry = journal.find(e => e.id === `${f.label}|${s.fk}`);
      const vote = entry ? `<span class="done">Noté ${entry.vote === 'up' ? '👍' : '👎'}${entry.fix ? ` → ${SIG.ACTIONS[entry.fix].label}` : ''}</span>` : '';
      const buttons = fixing === f.k
        ? `<span class="done">Plutôt :</span>${['raise', 'lower', 'hold', 'review'].map(a => `<button class="btn" data-k="${f.k}" data-vote="down" data-fix="${a}">${SIG.ACTIONS[a].label}</button>`).join('')}<button class="btn" data-k="${f.k}" data-vote="down">Je ne sais pas</button>`
        : `<button class="btn" data-k="${f.k}" data-vote="up" aria-label="Verdict juste" title="Verdict affiché : juste">👍</button><button class="btn" data-k="${f.k}" data-vote="ask" aria-label="Verdict à corriger" title="Verdict affiché : à corriger">👎</button>`;
      return `<article class="sigc${f.k === view.selP.k ? ' sel' : ''}" data-k="${f.k}" tabindex="0">
        <div class="sigt"><span class="zl">${f.label}</span><span class="mut small">${rng(s.r.from, s.r.to)}</span><span class="mut right">${f.leadDays <= 0 ? 'en cours' : f.leadDays < 14 ? `dans ${f.leadDays} j` : `dans ${Math.round(f.leadDays / 7)} sem.`}</span></div>
        <div class="sigm">${SIG.kindLabel(f.kind, f.windowDays)} <b class="${f.pacePct > 0 ? 'up' : f.pacePct < 0 ? 'dn' : ''}">${f.pacePct == null ? '–' : sgn(f.pacePct)}</b> · Prix <b>${f.pricePct == null ? '–' : sgn(f.pricePct)}</b>
          ${f.priceFinalPct == null ? '' : `<span class="mut">(final ${sgn(f.priceFinalPct)})</span>`} <span class="mut">vs N-1</span></div>
        <div class="chips2">${chip('Jev', (s.jv || s.old) && (s.jv || s.old).action, { na: s.skip && !s.jv && !s.old, on: s.shown === 'jev', stale: s.stale, conf: (s.jv || s.old) && (s.jv || s.old).conf, title: s.stale ? 'Périmé : les chiffres ont changé depuis l’analyse, relancez-la' : s.jv ? `Jev : ${SIG.ACTIONS[s.jv.raw] ? SIG.ACTIONS[s.jv.raw].label : s.jv.raw}${s.jv.note ? ' (' + s.jv.note + ')' : ''}` : '' })}
          ${chip('Règles', s.rl.action, { on: s.shown === 'rules' })}${dis ? '<span class="neq" title="Jev et les règles divergent">≠</span>' : ''}</div>
        <p class="why">${esc(s.rl.why)}</p>${detail(s)}
        <div class="vote">${vote}${buttons}</div></article>`;
    }).join('') + '</div>';
    html += `<div class="board"><div class="lbl">Jev ou règles : qui a raison ?</div>${sb.labelled
      ? `<div><b>Jev ${sb.jev}/${sb.jevN}</b> · <b>Règles ${sb.rules}/${sb.labelled}</b>${sb.choiceN ? ` · <span class="mut">Jev choix direct ${sb.choice}/${sb.choiceN}</span>` : ''} <span class="mut small">sur ${sb.labelled} verdicts étiquetés (${sb.rated} notés)</span></div>`
      : `<div class="mut small">${sb.rated ? `${sb.rated} noté(s), aucun étiqueté (👎 sans correction). ` : ''}Notez des verdicts avec 👍 / 👎 : le score apparaît ici.</div>`}</div>`;
    $('#sig').innerHTML = html;
  }

  async function analyze() {
    if (analyzing) return;
    if (!jevKey) { astat = 'Ajoutez d’abord une clé API dans Réglages › Jev.'; return renderSignals(); }
    const all = sigRows(), rows = all.filter(s => !s.skip), skipped = all.length - rows.length;
    if (!rows.length) { astat = 'Rien à analyser : les périodes affichées ont des données absentes ou fragiles.'; return renderSignals(); }
    analyzing = { done: 0, total: rows.length }; astat = ''; renderSignals();
    const t0 = performance.now(); let ok = 0, tokens = 0, lastErr = null;
    await SIG.pool(rows, 6, async s => {
      try {
        const body = SIG.jevBody(s.f);
        const res = await SIG.jevCall({ apiKey: jevKey, model: jevModel, body, fetchImpl: (u, i) => fetch(u, i) });
        jev[s.f.k] = { fk: s.fk, res: SIG.parseJev(res), raw: { body, res } }; ok++; tokens += (res.usage && res.usage.input_tokens) || 0;
      } catch (e) { lastErr = e; }
      analyzing.done++;
      if (analyzing.done % 3 === 0) renderSignals();
    });
    analyzing = null;
    const sec = ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',');
    astat = lastErr && !ok ? errMsg(lastErr) : `${ok}/${rows.length} périodes analysées en ${sec} s · ${nf(tokens, 0)} tokens${skipped ? ` · ${skipped} non envoyée${skipped > 1 ? 's' : ''} (données fragiles)` : ''}${lastErr ? ` · ${rows.length - ok} en erreur (${errMsg(lastErr)})` : ''}`;
    if (view) render();
  }
  const errMsg = e => (e.status === 401 ? 'Clé refusée (401) : vérifiez la clé.' : e.status === 422 ? `Requête refusée (422) : ${e.body || ''}` : e.status === 429 || e.status === 529 ? 'Service saturé (429/529) : réessayez.'
    : /Failed to fetch|NetworkError/i.test(e.message) ? 'Réseau indisponible ou accès à api.typesafe.ai refusé.' : e.message);

  function rate(k, vote, fix) {
    const s = sigRows().find(x => x.f.k === k); if (!s) return;
    const e = { id: `${s.f.label}|${s.fk}`, t: new Date().toISOString(), period: s.f.label, kind: s.f.kind, window: s.f.windowDays, lead: s.f.leadDays, pricePct: s.f.pricePct, priceFinalPct: s.f.priceFinalPct, pacePct: s.f.pacePct,
      rules: { action: s.rl.action }, jev: s.jv ? { action: s.jv.action, conf: s.jv.conf, under: s.jv.under, over: s.jv.over, choice: s.jv.choice } : null,
      shown: s.action, source: s.shown, vote, fix: fix || null };
    journal = journal.filter(x => x.id !== e.id).concat(e).slice(-2000);
    store.set({ wypJournal: journal }); fixing = null; render();
  }

  // ---------- interactions ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button, tr[data-k], .sigc'); if (!t) return;
    if (e.target.closest('details.jd') && t.tagName !== 'BUTTON') return;   // ouvrir / fermer le détail ne sélectionne pas la période
    const d = t.dataset;
    if (d.vote) { if (d.vote === 'ask') { fixing = +d.k; return renderSignals(); } return rate(+d.k, d.vote, d.fix); }
    if (d.raw != null) { const x = jev[+d.raw]; return x && x.raw && navigator.clipboard.writeText(JSON.stringify({ request: x.raw.body, response: x.raw.res }, null, 1)).then(() => { astat = 'Requête et réponse brutes copiées ✓'; renderSignals(); }); }
    if (d.sig === 'analyze') return analyze();
    if (d.src) { prefs.source = d.src; savePrefs(); return view && render(); }
    if (d.diag != null || t.id === 'diag') return send({ op: 'diag' });
    if (d.op === 'prev') return send({ op: 'step', d: -1 });
    if (d.op === 'next') return send({ op: 'step', d: 1 });
    if (d.op === 'auto') return send({ op: 'auto' });
    if (d.layer) return send({ op: 'toggle', name: d.layer });
    if (d.off != null && view) { const o = +d.off; return send({ op: 'config', patch: { offset: o === 0 ? 0 : view.offset + o } }); }
    if (d.tab) { prefs.tab = d.tab; savePrefs(); return view && render(); }
    if (d.k != null && t.tagName !== 'BUTTON') return send({ op: 'select', k: +d.k });
  });
  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const row = e.target.closest && e.target.closest('tr[data-k], .sigc');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return send({ op: 'select', k: +row.dataset.k }); }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); send({ op: 'step', d: -1 }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); send({ op: 'step', d: 1 }); }
  });

  $('#sig').addEventListener('toggle', e => { const d = e.target; if (d.classList && d.classList.contains('jd')) { d.open ? openJd.add(+d.dataset.k) : openJd.delete(+d.dataset.k); } }, true);

  // survol d'une ligne → la zone ressort sur le graphique
  const hover = (zone, period) => { const k = `${zone}|${period}`; if (k === lastHover) return; lastHover = k; send({ op: 'hover', zone, period }); };
  const hoverRow = e => { const r = e.target.closest ? e.target.closest('tr[data-z], tr[data-k], .sigc') : null; if (!r) return; r.dataset.z != null ? hover(+r.dataset.z, null) : hover(null, +r.dataset.k); };
  ['#tbl', '#sig'].forEach(sel => { const el = $(sel); el.addEventListener('mouseover', hoverRow); el.addEventListener('focusin', hoverRow); el.addEventListener('mouseleave', () => hover(null, null)); el.addEventListener('focusout', () => hover(null, null)); });

  // copie
  let liveTimer = 0;
  const flash = msg => { $('#live').textContent = msg; clearTimeout(liveTimer); liveTimer = setTimeout(() => { $('#live').textContent = ''; }, 1800); };
  $('#copy').addEventListener('click', () => {
    if (!view) return;
    const rows = prefs.tab === 'periods'
      ? view.periodRows.map(r => Object.assign({ label: r.p.label }, r))
      : [Object.assign({ label: `${view.selP.label} départs` }, view.selStats), ...view.zones.map(z => Object.assign({ label: `${view.selP.label} ${z.label}` }, z))];
    navigator.clipboard.writeText(WY.toTSV(rows)).then(() => flash('Copié ✓'), () => flash('Copie impossible'));
  });

  // ---------- réglages ----------
  const settings = $('#settings');
  settings.open = !!prefs.settings;
  settings.addEventListener('toggle', () => { prefs.settings = settings.open; savePrefs(); });
  const cfg = patch => send({ op: 'config', patch });
  const intIn = (el, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+el.value || lo)));
  $('#gnum').addEventListener('change', () => cfg({ gridNum: intIn($('#gnum'), 1, 999), gridDate: $('#gdate').value || (st && st.gridDate) || '' }));
  $('#gdate').addEventListener('change', () => cfg({ gridDate: $('#gdate').value, gridNum: intIn($('#gnum'), 1, 999) }));
  $('#gauto').addEventListener('click', () => cfg({ gridDate: '', gridNum: 1 }));
  $('#glen').addEventListener('change', () => cfg({ gridLen: intIn($('#glen'), 1, 366) }));
  $$('[data-unit]').forEach(b => b.addEventListener('click', () => cfg({ gridUnit: b.dataset.unit })));
  $('#dsel').addEventListener('change', () => cfg({ dataIdx: $('#dsel').value === 'auto' ? null : +$('#dsel').value }));

  const tiersFromDom = () => $$('#tiers .trow').map(r => {
    const a = Math.max(0, Math.round(+r.querySelector('.ta').value || 0));
    const b = Math.max(a, Math.round(+r.querySelector('.tb').value || 0));
    return [a, b];
  });
  $('#tiers').addEventListener('change', () => cfg({ tierList: tiersFromDom() }));
  $('#tiers').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const list = tiersFromDom(); list.splice(+b.dataset.del, 1); cfg({ tierList: list });
  });
  $('#tadd').addEventListener('click', () => {
    const list = tiersFromDom(), last = list[list.length - 1];
    list.push(last ? [last[1] + 1, last[1] + 7] : [1, 2]); cfg({ tierList: list.slice(0, 12) });
    tierSig = ''; // forcer le redessin pour afficher la nouvelle ligne
  });
  $('#treset').addEventListener('click', () => { cfg({ tierList: WY.parseTiers(WY.DEFAULT_TIERS).tiers }); tierSig = ''; });

  let tierSig = '';
  function syncSettings() {
    if (!settings.contains(document.activeElement)) {
      $('#gnum').value = st.gridNum; $('#gdate').value = st.gridDate; $('#glen').value = st.gridLen;
    }
    $$('[data-unit]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.unit === st.gridUnit)));
    const ch = view.charts;
    $('#dataset').hidden = ch.length < 2;
    if (ch.length > 1) {
      $('#dsel').innerHTML = `<option value="auto">Automatique${view.dataAuto ? ` (graphique ${view.dataIdx + 1})` : ''}</option>`
        + ch.map(c => `<option value="${c.i}">${c.i + 1}. ${esc(c.title)}${c.score >= 4 ? ' · séries reconnues' : ''}</option>`).join('');
      $('#dsel').value = view.dataAuto ? 'auto' : String(view.dataIdx);
    }
    renderRoles();
    const g = view.grid;
    $('#ghint').textContent = g.auto ? `Auto : P1 = lundi de la semaine de référence (${fmtDMY(g.p1)}).` : `Soit P1 = ${fmtDMY(g.p1)}.`;
    const sig = JSON.stringify(st.tierList);
    if (sig !== tierSig) {
      tierSig = sig;
      $('#tiers').innerHTML = st.tierList.map(([a, b], i) => `<div class="trow" data-i="${i}">
        <i style="background:rgb(${PALETTE[i % PALETTE.length]})"></i>
        <input class="num ta" type="number" min="0" max="366" inputmode="numeric" value="${a}" aria-label="Palier ${i + 1}, de (jours)">
        <span class="mut">à</span>
        <input class="num tb" type="number" min="0" max="366" inputmode="numeric" value="${b}" aria-label="Palier ${i + 1}, à (jours)">
        <span class="mut u">jours</span>
        <button class="ib sm" data-del="${i}" aria-label="Supprimer le palier ${a} à ${b} jours" title="Supprimer">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></div>`).join('')
        || '<p class="hint">Aucun palier.</p>';
    }
    const n = st.tierList.length, len = `${st.gridLen} ${st.gridUnit === 'w' ? 'sem.' : 'j'}`;
    $('#setSum').textContent = `${g.auto ? 'Auto' : `P${st.gridNum} = ${fmtDM(Date.parse(st.gridDate + 'T00:00:00Z'))}`} · ${len} · ${n} palier${n > 1 ? 's' : ''}`;
  }

  // Séries lues : un rôle par ligne (RPJ / volume × N, N-1, N-1 final). « Auto » = détection par nom ; surcharge mémorisée par disposition de graphique.
  let rolesSig = '';
  function renderRoles() {
    const v = view, sig = JSON.stringify([v.series, v.roles, v.mapped, v.ckey]);
    if (sig === rolesSig || $('#roles').contains(document.activeElement)) return;
    rolesSig = sig;
    const lab = k => { const x = v.series.find(s => s.key === k); return x ? x.label : '—'; };
    $('#roles').innerHTML = WY.ROLES.map(r => {
      const m = v.mapped[r], opts = v.series.map(x => `<option value="${esc(x.key)}">${esc(x.label)} · ${x.n} pts</option>`).join('');
      return `<div class="fld"><label for="r-${r}">${WY.ROLE_LABEL[r]}</label><select id="r-${r}" data-role="${r}">
        <option value="auto">Auto${v.autoRoles[r] ? ` : ${esc(lab(v.autoRoles[r]))}` : ' : aucune'}</option><option value="none">Aucune</option>${opts}</select></div>`;
    }).join('');
    WY.ROLES.forEach(r => { const el = $(`#r-${r}`); if (el) el.value = v.mapped[r] ? (v.series.some(x => x.key === v.mapped[r]) || v.mapped[r] === 'none' ? v.mapped[r] : 'auto') : 'auto'; });
  }
  $('#roles').addEventListener('change', e => { const sel = e.target.closest('select[data-role]'); if (sel) send({ op: 'map', role: sel.dataset.role, key: sel.value === 'auto' ? null : sel.value }); });

  // ---------- réglages Jev ----------
  function syncJev() {
    $('#jmodel').value = jevModel;
    $('#jkey').placeholder = jevKey ? '•••••••• clé enregistrée' : 'Coller la clé puis Enregistrer';
    if (!$('#jstat').dataset.busy) $('#jstat').textContent = jevKey ? 'Clé enregistrée dans ce navigateur.' : 'Aucune clé : les signaux restent calculés par règles.';
  }
  const jstat = (t, busy) => { $('#jstat').textContent = t; if (busy) $('#jstat').dataset.busy = '1'; else delete $('#jstat').dataset.busy; };
  $('#jsave').addEventListener('click', async () => {
    const k = $('#jkey').value.trim(); if (!k) return jstat('Collez une clé avant d’enregistrer.');
    jevKey = k; $('#jkey').value = ''; await store.set({ wypJevKey: k }); syncJev(); jstat('Clé enregistrée dans ce navigateur.'); if (view) render();
  });
  $('#jclear').addEventListener('click', async () => { jevKey = ''; jev = {}; await store.del('wypJevKey'); syncJev(); if (view) render(); });
  $('#jmodel').addEventListener('change', async () => { jevModel = $('#jmodel').value; jev = {}; await store.set({ wypJevModel: jevModel }); if (view) render(); });
  $('#jtest').addEventListener('click', async () => {
    const k = $('#jkey').value.trim() || jevKey; if (!k) return jstat('Aucune clé à tester.');
    jstat('Test en cours…', true);
    try {
      const res = await SIG.jevCall({ apiKey: k, model: jevModel, body: { state: 'Hello, this is a connection test.', questions: { greeting: { type: 'noul', instructions: 'The text is a greeting or a test message' } } }, fetchImpl: (u, i) => fetch(u, i) });
      jstat(`Clé valide ✓ · ${res.model || jevModel} · ${(res.usage && res.usage.input_tokens) || '?'} tokens`);
    } catch (e) { jstat(errMsg(e)); }
  });
  $('#jcsv').addEventListener('click', () => navigator.clipboard.writeText(SIG.toCSV(journal)).then(() => jstat(`Journal copié ✓ (${journal.length} lignes)`), () => jstat('Copie impossible')));
  let wipeTimer = 0;
  $('#jwipe').addEventListener('click', async () => {
    const b = $('#jwipe');
    if (b.dataset.arm) { clearTimeout(wipeTimer); delete b.dataset.arm; b.textContent = 'Vider le journal'; journal = []; await store.set({ wypJournal: [] }); jstat('Journal vidé.'); if (view) render(); return; }
    b.dataset.arm = '1'; b.textContent = 'Confirmer ?'; wipeTimer = setTimeout(() => { delete b.dataset.arm; b.textContent = 'Vider le journal'; }, 3000);
  });
})();
