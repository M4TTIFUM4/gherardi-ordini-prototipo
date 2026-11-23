import { isValidEan13, parseWeightEan, weightEan, ean13Svg } from './ean.js';

/* =========================================================
   Palmare di magazzino Gherardi — demo
   Prelievo ordini con lettura EAN (fotocamera, lettore laser
   "a tastiera" del palmare Android o simulazione), lotti e
   scadenze FEFO, articoli a peso variabile.
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 2) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: d }).format(n);
const kg = (n) => nf(n, 3) + ' kg';
const STORE = 'gherardi_palmare_v1';
const OPERATORS = ['Andrea', 'Giulia', 'Paolo', 'Sara'];
const UNIT = { CO: ['collo', 'colli'], NR: ['pz', 'pz'], CF: ['conf.', 'conf.'], PZ: ['pz', 'pz'], KG: ['kg', 'kg'], LT: ['lt', 'lt'] };
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const dateIn = (days) => { const d = new Date(TODAY); d.setDate(d.getDate() + days); return d; };
const fmtD = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtLong = (d) => d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

let D, P, BYEAN, BYPLU, CUST, ORD;
let S = load();
const ui = { lastAuto: 0, scanCtx: null };

function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.orders) return s; } catch { /* storage assente */ }
  return { op: null, sound: true, auto: true, orders: {} };
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* storage assente */ } }
const os = (id) => (S.orders[id] ||= { status: 'new', lines: {}, colli: 1 });
const ls = (id, i) => (os(id).lines[i] ||= { picks: [], miss: null, lot: null, force: {} });

/* ---------- modello ---------- */
const prod = (c) => P.get(c);
const img = (p) => p.img ? D.imgBase + encodeURIComponent(p.img) : '';
const uName = (p, unit, n = 2) => { const k = p.u[unit] || unit; return (UNIT[k] || [k.toLowerCase(), k.toLowerCase()])[n === 1 ? 0 : 1]; };
const isKgLine = (p, L) => p.var && L.unit === 'K';
const minFor = (p, cust) => (p.perish === 'F' ? cust.minF : cust.minS);

function lotsFor(p, cust) {
  if (!p.lots) return [];
  const min = minFor(p, cust);
  return p.lots.map((l) => ({ ...l, exp: dateIn(l.d), expired: l.d < 0, below: l.d < min, min }));
}
function defaultLot(p, cust) {
  const lots = lotsFor(p, cust);
  return (lots.find((l) => !l.below) || lots.find((l) => !l.expired) || lots[0])?.lot || null;
}

function lineState(oid, i) {
  const o = ORD.get(oid), L = o.lines[i], p = prod(L.c), st = ls(oid, i);
  const w = st.picks.reduce((s, x) => s + (x.w || 0), 0);
  let picked;
  if (isKgLine(p, L)) picked = w;
  else if (p.var) picked = st.picks.length;
  else picked = st.picks.reduce((s, x) => s + (x.q || 0), 0);
  const tol = isKgLine(p, L) ? 0.1 : 0;
  let status = 'todo';
  if (picked > 0) status = 'part';
  if (picked >= L.qty * (1 - tol) - 1e-9) status = 'done';
  if (picked > L.qty * (1 + tol) + 1e-9) status = 'over';
  if (st.miss && status !== 'done' && status !== 'over') status = 'miss';
  return { o, L, p, st, picked, w, status, closed: status === 'done' || status === 'over' || status === 'miss' };
}
const route = (oid) => ORD.get(oid).lines.map((_, i) => i).sort((a, b) => prod(ORD.get(oid).lines[a].c).loc.localeCompare(prod(ORD.get(oid).lines[b].c).loc));
function orderProgress(oid) {
  const n = ORD.get(oid).lines.length;
  let closed = 0, miss = 0, part = 0;
  for (let i = 0; i < n; i++) { const s = lineState(oid, i); if (s.closed) closed++; if (s.status === 'miss') miss++; if (s.status === 'part') part++; }
  return { n, closed, miss, part, pct: Math.round((closed / n) * 100) };
}
const qtyText = (p, L, v) => (isKgLine(p, L) ? kg(v) : `${nf(v)} ${uName(p, L.unit, v)}`);

/* ---------- feedback: suono, vibrazione, banner ---------- */
let actx;
function beep(kind) {
  if (!S.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === 'ok' ? [[1760, 0.07]] : kind === 'done' ? [[1320, 0.08], [1760, 0.12]] : kind === 'warn' ? [[660, 0.12], [660, 0.12]] : [[220, 0.32]];
    let t = actx.currentTime;
    for (const [f, d] of seq) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'err' ? 'square' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d); t += d + 0.04;
    }
  } catch { /* audio non disponibile */ }
}
document.addEventListener('pointerdown', () => { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch { /* */ } }, { once: true });

let flashT;
function flash(kind, title, sub = '') {
  beep(kind);
  if (navigator.vibrate) navigator.vibrate(kind === 'err' ? [80, 60, 80] : kind === 'warn' ? 60 : 25);
  const el = $('#flash');
  el.className = 'flash show ' + kind;
  el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  clearTimeout(flashT);
  flashT = setTimeout(() => el.classList.remove('show'), kind === 'err' ? 2600 : 1700);
}

/* ---------- foglio a scomparsa (dialoghi) ---------- */
function sheet(html, onAction) {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-box" role="dialog" aria-modal="true">${html}</div>`;
  el.hidden = false;
  el.onclick = (e) => {
    if (e.target === el) return closeSheet();
    const b = e.target.closest('[data-s]');
    if (b) onAction?.(b.dataset.s, el, b);
  };
  const f = el.querySelector('input'); if (f) setTimeout(() => f.focus(), 60);
}
function closeSheet() { const el = $('#sheet'); el.hidden = true; el.innerHTML = ''; }

/* ---------- avvio ---------- */
async function boot() {
  D = await fetch('data/palmare.json').then((r) => r.json());
  P = new Map(D.products.map((p) => [p.c, p]));
  BYEAN = new Map(D.products.map((p) => [p.ean, p]));
  BYPLU = new Map(D.products.filter((p) => p.plu).map((p) => [p.plu, p]));
  CUST = new Map(D.customers.map((c) => [c.id, c]));
  ORD = new Map(D.orders.map((o) => [o.id, o]));
  $('#app').innerHTML = `<div id="view" class="view"></div><div id="scanner" class="scanner" hidden></div><div id="sheet" class="sheet" hidden></div><div id="flash" class="flash"></div>`;
  window.addEventListener('hashchange', render);
  document.addEventListener('keydown', wedge);
  $('#app').addEventListener('click', onClick);
  render();
  sidePanel();
}

function sidePanel() {
  const url = location.href.split('#')[0];
  const u = $('#sideUrl'); if (u) u.textContent = url.replace(/^https?:\/\//, '');
  const box = $('#qr');
  if (!box || getComputedStyle($('.side')).display === 'none') return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  s.onload = () => { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); };
  document.head.appendChild(s);
}

/* ---------- navigazione ---------- */
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };
function parts() { return location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent); }

function shell({ title, sub = '', back = '', body, bar = '', cls = '' }) {
  $('#view').className = 'view ' + cls;
  $('#view').innerHTML = `
    <header class="hd">
      ${back ? `<a class="hd-btn" href="${back}" aria-label="Indietro"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>` : '<span class="hd-logo">G</span>'}
      <div class="hd-t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>
      <a class="hd-btn" href="#/impostazioni" aria-label="Impostazioni"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg></a>
    </header>
    <main class="ct">${body}</main>
    ${bar ? `<nav class="bar">${bar}</nav>` : ''}`;
  $('#view .ct').scrollTop = 0;
}
const scanBtn = (label = 'Scansiona') => `<button class="scan-btn" data-a="scan"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3"/><path d="M8 9v6M11 9v6M13.5 9v6M16 9v6"/></svg><span>${label}</span></button>`;

function render() {
  closeSheet();
  if (!S.op) return renderLogin();
  const [r, a, b] = parts();
  ui.scanCtx = null;
  if (r === 'ordini') return renderOrders();
  if (r === 'ordine') return ORD.has(a) ? renderOrder(a) : go('#/ordini');
  if (r === 'riga') return ORD.has(a) ? renderLine(a, +b) : go('#/ordini');
  if (r === 'chiudi') return ORD.has(a) ? renderClose(a) : go('#/ordini');
  if (r === 'verifica') return renderCheck(a);
  if (r === 'scadenze') return renderExpiry(a);
  if (r === 'impostazioni') return renderSettings();
  renderHome();
}

/* ---------- accesso ---------- */
function renderLogin() {
  $('#view').className = 'view login';
  $('#view').innerHTML = `
    <div class="lg">
      <div class="lg-logo">Gherardi</div>
      <p class="lg-sub">Palmare magazzino · demo</p>
      <h2>Chi sta lavorando?</h2>
      <div class="ops">${OPERATORS.map((o) => `<button data-a="op" data-v="${o}"><span>${o[0]}</span>${o}</button>`).join('')}</div>
      <p class="lg-note">Dati di prova: 100 articoli del catalogo e 3 ordini. Nessun collegamento al gestionale.</p>
    </div>`;
}

/* ---------- home ---------- */
function renderHome() {
  const toDo = D.orders.filter((o) => os(o.id).status !== 'done').length;
  const soon = allLots().filter((l) => l.d <= 7).length;
  const h = new Date().getHours();
  shell({
    title: `${h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'}, ${esc(S.op)}`,
    sub: esc(fmtLong(new Date())),
    body: `
      <div class="tiles">
        <a class="tile red" href="#/ordini"><i>📦</i><b>Preparazione ordini</b><span>${toDo} da preparare</span></a>
        <a class="tile" href="#/verifica"><i>🔎</i><b>Verifica articolo</b><span>Giacenza, lotti, ubicazione</span></a>
        <a class="tile" href="#/scadenze"><i>⏱️</i><b>Scadenze</b><span>${soon} lotti entro 7 giorni</span></a>
        <a class="tile" href="etichette.html" target="_blank" rel="noopener"><i>🏷️</i><b>Etichette di prova</b><span>Codici da inquadrare</span></a>
      </div>
      <h3 class="sec">Ordini di oggi</h3>
      ${D.orders.map(orderCard).join('')}`,
    bar: scanBtn('Scansiona articolo'),
  });
}
function orderCard(o) {
  const c = CUST.get(o.cust), st = os(o.id), pr = orderProgress(o.id);
  const label = st.status === 'done' ? '<em class="pill ok">Preparato</em>' : st.status === 'work' ? `<em class="pill run">In corso · ${pr.pct}%</em>` : '<em class="pill">Da preparare</em>';
  const cold = o.lines.some((l) => prod(l.c).cold);
  return `<a class="ocard" href="#/ordine/${o.id}" style="--c:${c.color}">
    <div class="oc-top"><b>${esc(c.name)}</b>${label}</div>
    <div class="oc-mid"><span>${o.id}</span><span>${esc(c.giro)}</span></div>
    <div class="oc-bot"><span>${o.lines.length} righe${cold ? ' · ❄️ freschi' : ''}</span><span class="prog"><i style="width:${pr.pct}%"></i></span></div>
  </a>`;
}

function renderOrders() {
  shell({ title: 'Preparazione ordini', sub: `Consegna ${esc(fmtLong(dateIn(1)))}`, back: '#/', body: D.orders.map(orderCard).join(''), bar: scanBtn() });
}

/* ---------- ordine ---------- */
function renderOrder(oid) {
  const o = ORD.get(oid), c = CUST.get(o.cust), st = os(oid), pr = orderProgress(oid);
  const rows = route(oid).map((i) => {
    const s = lineState(oid, i), p = s.p;
    const icon = { todo: '', part: '◐', done: '✓', over: '!', miss: '✕' }[s.status];
    return `<a class="lrow ${s.status}" href="#/riga/${oid}/${i}">
      <span class="loc ${p.cold ? 'cold' : ''}">${esc(p.loc)}</span>
      <span class="thumb">${img(p) ? `<img src="${img(p)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
      <span class="lr-t"><b>${esc(p.n)}</b><small>${esc(p.c)}${p.var ? ' · peso variabile' : ''}${p.lots ? ' · lotti' : ''}</small></span>
      <span class="lr-q"><b>${s.picked ? qtyText(p, s.L, s.picked) + ' / ' : ''}${qtyText(p, s.L, s.L.qty)}</b><i>${icon}</i></span>
    </a>`;
  }).join('');
  const next = route(oid).find((i) => !lineState(oid, i).closed);
  const done = st.status === 'done';
  shell({
    title: esc(c.name), sub: `${oid} · ${esc(c.giro)}`, back: '#/ordini',
    body: `
      ${done ? doneBox(oid) : ''}
      <div class="ohead">
        <div class="oh-prog"><b>${pr.closed}/${pr.n}</b><span>righe evase</span><div class="prog big"><i style="width:${pr.pct}%"></i></div></div>
        <div class="oh-info">
          <span>Residuo minimo freschi: <b>${c.minF} gg</b> · secchi: <b>${c.minS} gg</b></span>
          ${o.note ? `<span class="onote">📝 ${esc(o.note)}</span>` : ''}
        </div>
      </div>
      <h3 class="sec">Percorso di prelievo <small>ordinato per ubicazione</small></h3>
      <div class="lrows">${rows}</div>`,
    bar: done ? `<button class="bbtn" data-a="reopen" data-o="${oid}">Riapri ordine</button><a class="bbtn" href="#/chiudi/${oid}">Riepilogo</a>`
      : `${scanBtn()}${next !== undefined ? `<a class="bbtn primary" href="#/riga/${oid}/${next}">${st.status === 'new' ? 'Inizia' : 'Continua'}</a>` : `<a class="bbtn primary" href="#/chiudi/${oid}">Chiudi ordine</a>`}`,
  });
  ui.scanCtx = { type: 'order', oid };
}

/* ---------- riga di prelievo ---------- */
function renderLine(oid, i) {
  const o = ORD.get(oid);
  if (!o.lines[i]) return go('#/ordine/' + oid);
  const c = CUST.get(o.cust), s = lineState(oid, i), { p, L, st } = s;
  if (os(oid).status === 'new') { os(oid).status = 'work'; os(oid).start = Date.now(); save(); }
  const r = route(oid), pos = r.indexOf(i);
  const lots = lotsFor(p, c);
  if (lots.length && !st.lot) { st.lot = defaultLot(p, c); save(); }
  const pct = Math.min(100, (s.picked / L.qty) * 100);
  const lotHtml = lots.length ? `
    <h3 class="sec">Lotto e scadenza <small>FEFO · residuo minimo ${lots[0].min} gg</small></h3>
    <div class="lots">${lots.map((l) => `
      <button class="lot ${l.lot === st.lot ? 'sel' : ''} ${l.expired ? 'exp' : l.below ? 'below' : ''}" data-a="lot" data-v="${l.lot}">
        <b>${esc(l.lot)}</b><span>Scad. ${fmtD(l.exp)}</span>
        <em>${l.expired ? 'Scaduto' : l.below ? `Solo ${l.d} gg · sotto minimo` : `${l.d} gg residui`}</em>
        <small>${l.q} disp.</small>
      </button>`).join('')}
      <button class="lot other" data-a="lot-other"><b>Altro lotto</b><span>Inserisci a mano</span></button>
    </div>` : '';
  const picks = st.picks.length ? `
    <h3 class="sec">Letture <small>${st.picks.length}</small></h3>
    <ul class="picks">${st.picks.map((x, k) => `<li><span>${x.w ? kg(x.w) : `+${nf(x.q)} ${uName(p, L.unit, x.q)}`}</span><span>${x.lot ? `${esc(x.lot)} · ${x.exp}` : ''}</span><button data-a="undo" data-v="${k}" aria-label="Annulla lettura">✕</button></li>`).reverse().join('')}</ul>` : '';
  const varInfo = p.var ? `<div class="varinfo">⚖️ Peso variabile · PLU ${p.plu} · peso medio ${kg(p.avg)}${isKgLine(p, L) ? ' · tolleranza ±10%' : ''}</div>` : '';
  shell({
    title: `Riga ${pos + 1} di ${r.length}`, sub: `${esc(c.name)} · ${oid}`, back: '#/ordine/' + oid, cls: 'line-view',
    body: `
      <div class="where ${p.cold ? 'cold' : ''}"><span>Ubicazione</span><b>${esc(p.loc)}</b>${p.cold ? '<em>❄️ Cella frigo</em>' : ''}</div>
      <div class="pcard">
        <div class="pimg">${img(p) ? `<img src="${img(p)}" alt="" onerror="this.remove()">` : ''}<span>📦</span></div>
        <div class="pinfo">
          <b>${esc(p.n)}</b>
          <small>Cod. ${esc(p.c)} · EAN ${esc(p.ean)}${p.realEan ? '' : ' (interno)'}</small>
          ${p.stock === 0 ? '<span class="warnline">Giacenza a sistema: 0</span>' : `<small>Giacenza ${p.stock} ${uName(p, p.du)}</small>`}
        </div>
      </div>
      ${varInfo}
      <div class="qty ${s.status}">
        <div class="q-big"><b>${isKgLine(p, L) ? nf(s.picked, 3) : nf(s.picked)}</b><span>/ ${qtyText(p, L, L.qty)}</span></div>
        ${p.var && !isKgLine(p, L) && s.w ? `<div class="q-w">Peso letto: <b>${kg(s.w)}</b></div>` : ''}
        <div class="prog big"><i style="width:${pct}%"></i></div>
        <div class="q-st">${{ todo: 'Da prelevare', part: 'In corso', done: 'Riga completa ✓', over: 'Quantità superata', miss: 'Segnato mancante: ' + esc(st.miss || '') }[s.status]}</div>
        <div class="q-act">
          ${p.var ? `<button class="sbtn" data-a="weigh">⚖️ Pesa / inserisci peso</button>`
            : `<button class="sbtn" data-a="minus" ${s.picked ? '' : 'disabled'}>−1</button><button class="sbtn" data-a="plus">+1</button><button class="sbtn" data-a="qty">Quantità…</button>`}
        </div>
      </div>
      ${lotHtml}
      ${picks}
      <div class="sim">
        <span>Demo senza lettore:</span>
        <button data-a="sim" data-v="ok">Simula lettura giusta</button>
        <button data-a="sim" data-v="other">Articolo di un'altra riga</button>
        <button data-a="sim" data-v="wrong">Articolo sbagliato</button>
      </div>`,
    bar: `<button class="bbtn" data-a="miss">Mancante</button>${scanBtn()}<button class="bbtn primary" data-a="next">${s.closed ? 'Avanti' : 'Salta'}</button>`,
  });
  ui.scanCtx = { type: 'line', oid, i };
}

function nextLine(oid, from) {
  const r = route(oid), start = r.indexOf(from);
  for (let k = 1; k <= r.length; k++) { const i = r[(start + k) % r.length]; if (!lineState(oid, i).closed) return i; }
  return null;
}

function addPick(oid, i, pick) {
  const s = lineState(oid, i), { p, L, st } = s;
  const c = CUST.get(ORD.get(oid).cust);
  if (p.lots) {
    const lot = lotsFor(p, c).find((l) => l.lot === st.lot);
    if (lot) {
      if (lot.expired) return flash('err', 'Lotto scaduto', `${lot.lot} scaduto il ${fmtD(lot.exp)}: scegli un altro lotto`);
      if (lot.below && !st.force[lot.lot]) {
        flash('warn', 'Scadenza troppo vicina', `${c.name} chiede almeno ${lot.min} giorni`);
        return sheet(`<h3>Scadenza sotto il minimo</h3><p>Il lotto <b>${esc(lot.lot)}</b> scade il <b>${fmtD(lot.exp)}</b> (${lot.d} gg). <b>${esc(c.name)}</b> richiede almeno <b>${lot.min} giorni</b> di residuo.</p>
          <div class="s-act"><button class="bbtn primary" data-s="pick">Scegli un altro lotto</button><button class="bbtn" data-s="force">Usa comunque (verrà segnalato)</button></div>`, (a) => {
          if (a === 'pick') { st.lot = defaultLot(p, c); save(); closeSheet(); renderLine(oid, i); }
          if (a === 'force') { st.force[lot.lot] = true; save(); closeSheet(); addPick(oid, i, pick); }
        });
      }
      pick.lot = lot.lot; pick.exp = fmtD(lot.exp);
      if (st.force[lot.lot]) pick.forced = true;
    } else if (st.lot) { pick.lot = st.lot; pick.exp = st.lotExp || ''; }
  }
  const before = s.status;
  st.picks.push(pick); st.miss = null; save();
  const after = lineState(oid, i);
  const what = pick.w ? kg(pick.w) : `+${nf(pick.q)} ${uName(p, L.unit, pick.q)}`;
  if (after.status === 'over') flash('warn', 'Quantità superata', `${qtyText(p, L, after.picked)} su ${qtyText(p, L, L.qty)} richiesti`);
  else if (after.status === 'done' && before !== 'done') {
    flash('done', 'Riga completa ✓', `${what} · ${p.n}`);
    if (S.auto) {
      const n = nextLine(oid, i);
      setTimeout(() => { if (ui.scanCtx?.type === 'line' && ui.scanCtx.i === i) go(n === null ? '#/chiudi/' + oid : `#/riga/${oid}/${n}`); }, 900);
    }
  } else flash('ok', what, `${qtyText(p, L, after.picked)} su ${qtyText(p, L, L.qty)}`);
  if (ui.scanCtx?.type === 'line' && ui.scanCtx.i === i) renderLine(oid, i);
}

function askWeight(oid, i, note = '') {
  const { p } = lineState(oid, i);
  sheet(`<h3>Peso del pezzo</h3>${note ? `<p class="muted">${esc(note)}</p>` : ''}<p>${esc(p.n)} · peso medio ${kg(p.avg)}</p>
    <label class="big-in"><input id="wIn" inputmode="decimal" placeholder="0,000"><span>kg</span></label>
    <div class="s-act"><button class="bbtn" data-s="scale">⚖️ Leggi bilancia (simulata)</button><button class="bbtn primary" data-s="ok">Conferma peso</button></div>`, (a) => {
    const inp = $('#wIn');
    if (a === 'scale') { inp.value = nf(simWeight(p), 3); beep('ok'); }
    if (a === 'ok') {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (!(v > 0 && v < 100)) { flash('err', 'Peso non valido'); return; }
      closeSheet(); addPick(oid, i, { w: Math.round(v * 1000) / 1000 });
    }
  });
}
const simWeight = (p) => Math.round(p.avg * (0.86 + Math.random() * 0.28) * 1000) / 1000;

/* ---------- lettura codici ---------- */
function handleScan(raw) {
  const code = String(raw).replace(/\D/g, '');
  if (!code) return;
  const ctx = ui.scanCtx;
  const wl = parseWeightEan(code);
  const p = wl ? BYPLU.get(wl.plu) : BYEAN.get(code);
  if (!p) return flash('err', 'Codice non riconosciuto', code.length === 13 && !isValidEan13(code) ? `${code}: cifra di controllo errata` : code);

  if (ctx?.type === 'line' || ctx?.type === 'order') {
    const o = ORD.get(ctx.oid);
    const idx = o.lines.findIndex((l) => l.c === p.c);
    if (idx < 0) return flash('err', 'Non è in questo ordine', p.n);
    if (ctx.type === 'line' && idx !== ctx.i) {
      flash('warn', `È l'articolo della riga ${route(ctx.oid).indexOf(idx) + 1}`, p.n);
      return sheet(`<h3>Articolo di un'altra riga</h3><p>Hai letto <b>${esc(p.n)}</b>, che è alla riga ${route(ctx.oid).indexOf(idx) + 1} (${esc(p.loc)}).</p><div class="s-act"><button class="bbtn" data-s="stay">Resta qui</button><button class="bbtn primary" data-s="go">Vai a quella riga</button></div>`, (a) => {
        closeSheet(); if (a === 'go') go(`#/riga/${ctx.oid}/${idx}`);
      });
    }
    if (ctx.type === 'order') { history.pushState(null, '', `#/riga/${ctx.oid}/${idx}`); renderLine(ctx.oid, idx); }
    if (wl) return addPick(ctx.oid, idx, { w: wl.kg });
    if (p.var) return askWeight(ctx.oid, idx, 'Hai letto il codice articolo senza peso: pesa il pezzo o leggi l\'etichetta del peso.');
    return addPick(ctx.oid, idx, { q: 1 });
  }
  flash('ok', p.n, wl ? `Etichetta peso: ${kg(wl.kg)}` : p.loc);
  go('#/verifica/' + encodeURIComponent(p.c));
}

// Lettore laser del palmare Android in modalità tastiera: cifre veloci seguite da Invio.
let wbuf = '', wt = 0;
function wedge(e) {
  const t = e.target;
  if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName) && t.id !== 'scanIn') return;
  if (t && t.id === 'scanIn') return;
  const now = Date.now();
  if (now - wt > 2000) wbuf = '';
  wt = now;
  if (/^\d$/.test(e.key)) { wbuf += e.key; return; }
  if (e.key === 'Enter' && wbuf.length >= 8) { e.preventDefault(); const c = wbuf; wbuf = ''; handleScan(c); }
}

/* ---------- fotocamera ---------- */
const cam = { stream: null, reader: null, timer: null, paused: false, last: '' };
async function openScanner() {
  const el = $('#scanner');
  el.hidden = false;
  el.innerHTML = `
    <div class="sc-top"><b>Inquadra il codice a barre</b><button class="hd-btn" data-a="scan-close" aria-label="Chiudi">✕</button></div>
    <div class="sc-video"><video id="scVideo" playsinline muted autoplay></video><div class="sc-frame"><i></i></div><p class="sc-msg" id="scMsg">Avvio fotocamera…</p></div>
    <form class="sc-manual" id="scForm"><input id="scanIn" inputmode="numeric" placeholder="Oppure digita l'EAN" autocomplete="off"><button class="bbtn primary">OK</button></form>
    ${ui.scanCtx?.type === 'line' ? `<div class="sc-sim"><button data-a="sim" data-v="ok">Simula lettura giusta</button><button data-a="sim" data-v="wrong">Simula articolo sbagliato</button></div>` : ''}`;
  $('#scForm').onsubmit = (e) => { e.preventDefault(); const v = $('#scanIn').value; $('#scanIn').value = ''; handleScan(v); };
  const video = $('#scVideo'), msg = $('#scMsg');
  const onCode = (code) => {
    if (cam.paused) return;
    cam.paused = true; msg.textContent = 'Letto ' + code;
    handleScan(code);
    setTimeout(() => { cam.paused = false; if (msg.isConnected) msg.textContent = 'Pronto per la prossima lettura'; }, 1300);
  };
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Fotocamera non disponibile: usa il campo qui sotto o la simulazione.'; return; }
  try {
    if ('BarcodeDetector' in window) {
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128'] });
      cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = cam.stream; await video.play();
      msg.textContent = 'Pronto';
      cam.timer = setInterval(async () => { if (cam.paused || video.readyState < 2) return; try { const r = await det.detect(video); if (r[0]) onCode(r[0].rawValue); } catch { /* frame non pronto */ } }, 220);
    } else {
      await loadZXing();
      const Z = window.ZXing, hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.CODE_128]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      cam.reader = new Z.BrowserMultiFormatReader(hints, 250);
      await cam.reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, video, (res) => { if (res) onCode(res.getText()); });
      msg.textContent = 'Pronto';
    }
  } catch (err) {
    msg.textContent = err && err.name === 'NotAllowedError' ? 'Accesso alla fotocamera negato: abilitalo nelle impostazioni di Safari.' : 'Fotocamera non disponibile: usa il campo qui sotto o la simulazione.';
  }
}
function closeScanner() {
  clearInterval(cam.timer); cam.timer = null;
  try { cam.reader?.reset(); } catch { /* */ }
  cam.reader = null;
  cam.stream?.getTracks().forEach((t) => t.stop()); cam.stream = null;
  const el = $('#scanner'); el.hidden = true; el.innerHTML = '';
}
let zx;
function loadZXing() {
  return (zx ||= new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }));
}

/* ---------- simulazione (demo senza lettore) ---------- */
function simulate(kind) {
  const ctx = ui.scanCtx;
  if (ctx?.type !== 'line') return;
  const o = ORD.get(ctx.oid), p = prod(o.lines[ctx.i].c);
  if (kind === 'ok') return handleScan(p.var ? weightEan(p.plu, simWeight(p)) : p.ean);
  if (kind === 'other') {
    const others = o.lines.filter((_, k) => k !== ctx.i);
    const q = prod(others[Math.floor(Math.random() * others.length)].c);
    return handleScan(q.var ? weightEan(q.plu, simWeight(q)) : q.ean);
  }
  const inOrder = new Set(o.lines.map((l) => l.c));
  const pool = D.products.filter((x) => !inOrder.has(x.c) && !x.var);
  handleScan(pool[Math.floor(Math.random() * pool.length)].ean);
}

/* ---------- chiusura ordine ---------- */
function renderClose(oid) {
  const o = ORD.get(oid), c = CUST.get(o.cust), st = os(oid), pr = orderProgress(oid);
  const all = route(oid).map((i) => lineState(oid, i));
  const open = all.filter((s) => !s.closed);
  const forced = all.flatMap((s) => s.st.picks.filter((x) => x.forced).map(() => s.p.n));
  const wVar = all.reduce((t, s) => t + s.w, 0);
  const cold = all.some((s) => s.p.cold);
  const done = st.status === 'done';
  const rows = all.map((s) => `<li class="${s.status}"><span>${{ todo: '○', part: '◐', done: '✓', over: '!', miss: '✕' }[s.status]}</span><b>${esc(s.p.n)}</b><em>${s.picked ? qtyText(s.p, s.L, s.picked) : '—'} / ${qtyText(s.p, s.L, s.L.qty)}${s.status === 'miss' ? ' · ' + esc(s.st.miss) : ''}</em></li>`).join('');
  shell({
    title: done ? 'Ordine preparato' : 'Chiudi ordine', sub: `${esc(c.name)} · ${oid}`, back: '#/ordine/' + oid,
    body: `
      ${done ? doneBox(oid) : ''}
      <div class="sum">
        <div><b>${pr.closed}/${pr.n}</b><span>righe evase</span></div>
        <div><b>${pr.miss}</b><span>mancanti</span></div>
        <div><b>${nf(wVar, 2)}</b><span>kg peso var.</span></div>
      </div>
      ${open.length && !done ? `<p class="warnbox">${open.length} ${open.length === 1 ? 'riga non completa' : 'righe non complete'}: confermando ${open.length === 1 ? 'verrà segnata' : 'verranno segnate'} come mancanti parziali.</p>` : ''}
      ${forced.length ? `<p class="warnbox">Scadenze sotto il minimo accettate su: ${esc([...new Set(forced)].join(', '))}.</p>` : ''}
      <ul class="sumlist">${rows}</ul>
      ${done ? '' : `
      <h3 class="sec">Spedizione</h3>
      <div class="ship">
        <div class="colli"><span>Colli</span><button data-a="colli" data-v="-1">−</button><b>${st.colli}</b><button data-a="colli" data-v="1">+</button></div>
        ${cold ? `<label class="chk"><input type="checkbox" id="coldOk"> Freschi in contenitore refrigerato</label>` : ''}
        <label class="note-in">Note per l'autista<textarea id="shipNote" rows="2" placeholder="Facoltative">${esc(st.note || o.note || '')}</textarea></label>
      </div>`}`,
    bar: done ? `<button class="bbtn" data-a="labels" data-o="${oid}">Etichette colli</button><a class="bbtn primary" href="#/ordini">Altri ordini</a>`
      : `<a class="bbtn" href="#/ordine/${oid}">Torna alle righe</a><button class="bbtn primary" data-a="confirm" data-o="${oid}">Conferma preparazione</button>`,
  });
}
function doneBox(oid) {
  const st = os(oid);
  return `<div class="donebox">✓ Preparato da <b>${esc(st.by || S.op)}</b> alle ${new Date(st.end).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · ${st.colli} ${st.colli === 1 ? 'collo' : 'colli'} · inviato al gestionale (simulato)</div>`;
}
function confirmOrder(oid) {
  const o = ORD.get(oid), st = os(oid);
  if (o.lines.some((l) => prod(l.c).cold) && !$('#coldOk')?.checked) return flash('warn', 'Conferma la catena del freddo', 'Spunta "Freschi in contenitore refrigerato"');
  st.note = $('#shipNote')?.value.trim() || '';
  route(oid).forEach((i) => { const s = lineState(oid, i); if (!s.closed) s.st.miss = s.picked ? 'Parziale' : 'Non prelevato'; });
  Object.assign(st, { status: 'done', end: Date.now(), by: S.op });
  save();
  flash('done', 'Ordine preparato', `${CUST.get(o.cust).name} · ${st.colli} colli`);
  renderClose(oid);
}
function showLabels(oid) {
  const o = ORD.get(oid), c = CUST.get(o.cust), st = os(oid);
  const items = Array.from({ length: st.colli }, (_, k) => `<div class="clabel"><b>${esc(c.name)}</b><span>${oid} · ${esc(c.giro)}</span><strong>Collo ${k + 1}/${st.colli}</strong><span>Consegna ${fmtD(dateIn(1))}${o.lines.some((l) => prod(l.c).cold) ? ' · ❄️ FRESCO' : ''}</span></div>`).join('');
  sheet(`<h3>Etichette colli</h3><p class="muted">Anteprima: sul palmare Android verranno inviate alla stampante portatile.</p><div class="clabels">${items}</div><div class="s-act"><button class="bbtn primary" data-s="x">Chiudi</button></div>`, () => closeSheet());
}

/* ---------- verifica articolo ---------- */
function renderCheck(code) {
  const p = code && prod(code);
  if (p) {
    const lots = lotsFor(p, { minF: 0, minS: 0 });
    const inOrders = D.orders.filter((o) => o.lines.some((l) => l.c === p.c));
    shell({
      title: 'Scheda articolo', sub: esc(p.c), back: '#/verifica',
      body: `
        <div class="pcard big"><div class="pimg">${img(p) ? `<img src="${img(p)}" alt="" onerror="this.remove()">` : ''}<span>📦</span></div>
          <div class="pinfo"><b>${esc(p.n)}</b><small>${esc(p.line)} · ${esc(p.sector)}</small></div></div>
        <div class="facts">
          <div><span>Ubicazione</span><b>${esc(p.loc)}${p.cold ? ' ❄️' : ''}</b></div>
          <div><span>Giacenza</span><b class="${p.stock ? '' : 'red'}">${p.stock} ${uName(p, p.du)}</b></div>
          <div><span>Confezione</span><b>${Object.values(p.u).map((u) => (UNIT[u] || [u])[0]).join(' · ')}</b></div>
          ${p.var ? `<div><span>Peso medio</span><b>${kg(p.avg)} · PLU ${p.plu}</b></div>` : `<div><span>Pz per collo</span><b>${nf(p.cc)}</b></div>`}
        </div>
        <div class="eanbox">${ean13Svg(p.ean, { height: 56 })}<small>${p.realEan ? 'EAN del produttore' : 'EAN interno di prova'}</small></div>
        ${lots.length ? `<h3 class="sec">Lotti a magazzino</h3><div class="lots static">${lots.map((l) => `<div class="lot ${l.expired ? 'exp' : l.d <= 7 ? 'below' : ''}"><b>${esc(l.lot)}</b><span>Scad. ${fmtD(l.exp)}</span><em>${l.expired ? 'Scaduto' : l.d + ' gg'}</em><small>${l.q} pz</small></div>`).join('')}</div>` : '<p class="muted pad">Articolo senza scadenza.</p>'}
        ${p.desc ? `<p class="muted pad">${esc(p.desc)}</p>` : ''}
        ${inOrders.length ? `<h3 class="sec">Negli ordini di oggi</h3>${inOrders.map((o) => `<a class="mini" href="#/riga/${o.id}/${o.lines.findIndex((l) => l.c === p.c)}">${esc(CUST.get(o.cust).name)} · ${o.id}<span>›</span></a>`).join('')}` : ''}`,
      bar: scanBtn('Leggi un altro'),
    });
    return;
  }
  shell({
    title: 'Verifica articolo', sub: 'Leggi un codice o cerca per nome', back: '#/',
    body: `<form class="search" id="srch"><input id="sq" placeholder="Nome, codice o EAN" autocomplete="off" inputmode="search"></form><div id="sres" class="sres">${checkList('')}</div>`,
    bar: scanBtn(),
  });
  $('#sq').addEventListener('input', (e) => { $('#sres').innerHTML = checkList(e.target.value); });
  $('#srch').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#sq').value.trim(); if (/^\d{8,13}$/.test(v)) handleScan(v); });
}
function checkList(q) {
  const t = q.trim().toLowerCase();
  const list = D.products.filter((p) => !t || p.n.toLowerCase().includes(t) || p.c.toLowerCase().includes(t) || p.ean.includes(t)).slice(0, 40);
  return list.length ? list.map((p) => `<a class="lrow" href="#/verifica/${encodeURIComponent(p.c)}"><span class="loc ${p.cold ? 'cold' : ''}">${esc(p.loc)}</span><span class="thumb">${img(p) ? `<img src="${img(p)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span><span class="lr-t"><b>${esc(p.n)}</b><small>${esc(p.c)} · ${esc(p.ean)}</small></span></a>`).join('') : '<p class="muted pad">Nessun articolo.</p>';
}

/* ---------- scadenze ---------- */
function allLots() {
  return D.products.flatMap((p) => (p.lots || []).map((l) => ({ ...l, p, exp: dateIn(l.d) }))).sort((a, b) => a.d - b.d);
}
function renderExpiry(f = '30') {
  const lots = allLots();
  const filt = { scaduti: (l) => l.d < 0, 7: (l) => l.d <= 7, 30: (l) => l.d <= 30, tutti: () => true }[f] || ((l) => l.d <= 30);
  const list = lots.filter(filt);
  const chip = (k, label, n) => `<a class="chip ${f === k ? 'on' : ''}" href="#/scadenze/${k}">${label} <em>${n}</em></a>`;
  shell({
    title: 'Scadenze', sub: 'Lotti a magazzino per data', back: '#/',
    body: `<div class="chips">${chip('7', 'Entro 7 gg', lots.filter((l) => l.d <= 7).length)}${chip('30', 'Entro 30 gg', lots.filter((l) => l.d <= 30).length)}${chip('tutti', 'Tutti', lots.length)}</div>
      ${list.length ? list.map((l) => `<a class="xrow ${l.d < 0 ? 'exp' : l.d <= 7 ? 'soon' : ''}" href="#/verifica/${encodeURIComponent(l.p.c)}"><span class="xd"><b>${l.d < 0 ? 'Scad.' : l.d}</b><small>${l.d < 0 ? '' : 'gg'}</small></span><span class="lr-t"><b>${esc(l.p.n)}</b><small>Lotto ${esc(l.lot)} · ${fmtD(l.exp)} · ${l.q} pz · ${esc(l.p.loc)}</small></span></a>`).join('') : '<p class="muted pad">Nessun lotto in questo intervallo.</p>'}`,
    bar: scanBtn(),
  });
}

/* ---------- impostazioni ---------- */
function renderSettings() {
  shell({
    title: 'Impostazioni', back: '#/',
    body: `
      <div class="set">
        <div class="set-row"><span>Operatore</span><b>${esc(S.op)}</b><button class="sbtn" data-a="logout">Cambia</button></div>
        <label class="set-row"><span>Suoni di conferma</span><input type="checkbox" data-a="toggle" data-v="sound" ${S.sound ? 'checked' : ''}></label>
        <label class="set-row"><span>Passa alla riga successiva quando completa</span><input type="checkbox" data-a="toggle" data-v="auto" ${S.auto ? 'checked' : ''}></label>
      </div>
      <h3 class="sec">Lettore codici</h3>
      <p class="muted pad">Sul telefono si usa la fotocamera. Sul palmare Android con lettore laser (Zebra, Honeywell, Datalogic…) imposta l'uscita "tastiera" con suffisso Invio: la lettura arriva all'app senza toccare lo schermo.</p>
      <h3 class="sec">Dati demo</h3>
      <p class="muted pad">${D.products.length} articoli, ${D.orders.length} ordini. I progressi sono salvati solo su questo dispositivo.</p>
      <div class="pad"><button class="bbtn danger" data-a="reset">Azzera la demo</button></div>`,
  });
}

/* ---------- clic ---------- */
function onClick(e) {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v, ctx = ui.scanCtx;
  switch (a) {
    case 'op': S.op = v; save(); go('#/'); break;
    case 'logout': S.op = null; save(); render(); break;
    case 'scan': openScanner(); break;
    case 'scan-close': closeScanner(); break;
    case 'sim': simulate(v); break;
    case 'toggle': S[v] = el.checked; save(); break;
    case 'reset':
      sheet('<h3>Azzerare la demo?</h3><p>Tutti i prelievi e gli ordini chiusi su questo dispositivo tornano allo stato iniziale.</p><div class="s-act"><button class="bbtn" data-s="no">Annulla</button><button class="bbtn danger" data-s="yes">Azzera</button></div>', (x) => {
        if (x === 'yes') { const op = S.op; S = { op, sound: S.sound, auto: S.auto, orders: {} }; save(); go('#/'); flash('ok', 'Demo azzerata'); }
        closeSheet();
      });
      break;
    case 'reopen': os(el.dataset.o).status = 'work'; save(); render(); break;
    case 'confirm': confirmOrder(el.dataset.o); break;
    case 'labels': showLabels(el.dataset.o); break;
    case 'colli': { const st = os(parts()[1]); st.colli = Math.max(1, st.colli + +v); save(); renderClose(parts()[1]); break; }
  }
  if (ctx?.type !== 'line') return;
  const { oid, i } = ctx, s = lineState(oid, i);
  switch (a) {
    case 'plus': addPick(oid, i, { q: 1 }); break;
    case 'minus': {
      const k = s.st.picks.map((x) => !!x.q).lastIndexOf(true);
      if (k >= 0) { s.st.picks.splice(k, 1); save(); renderLine(oid, i); }
      break;
    }
    case 'undo': s.st.picks.splice(+v, 1); save(); renderLine(oid, i); break;
    case 'weigh': askWeight(oid, i); break;
    case 'qty':
      sheet(`<h3>Quantità prelevata</h3><p>${esc(s.p.n)}</p><label class="big-in"><input id="qIn" inputmode="decimal" value="${s.L.qty - s.picked > 0 ? nf(s.L.qty - s.picked) : ''}"><span>${uName(s.p, s.L.unit)}</span></label><div class="s-act"><button class="bbtn primary" data-s="ok">Aggiungi</button></div>`, (x) => {
        if (x !== 'ok') return;
        const q = parseFloat(String($('#qIn').value).replace(',', '.'));
        if (!(q > 0)) return flash('err', 'Quantità non valida');
        closeSheet(); addPick(oid, i, { q });
      });
      break;
    case 'lot': {
      const c = CUST.get(ORD.get(oid).cust), lot = lotsFor(s.p, c).find((l) => l.lot === v);
      if (lot?.expired) return flash('err', 'Lotto scaduto', 'Non può essere spedito');
      s.st.lot = v; save(); renderLine(oid, i);
      if (lot?.below) flash('warn', 'Scadenza sotto il minimo', `${c.name} chiede almeno ${lot.min} giorni`);
      break;
    }
    case 'lot-other':
      sheet(`<h3>Altro lotto</h3><label>Numero lotto<input id="lotN" placeholder="Es. L123A" autocomplete="off"></label><label>Scadenza<input id="lotD" type="date" min="${TODAY.toISOString().slice(0, 10)}"></label><div class="s-act"><button class="bbtn primary" data-s="ok">Usa questo lotto</button></div>`, (x) => {
        if (x !== 'ok') return;
        const n = $('#lotN').value.trim().toUpperCase(), d = $('#lotD').value;
        if (!n || !d) return flash('err', 'Inserisci lotto e scadenza');
        s.st.lot = n; s.st.lotExp = fmtD(new Date(d)); save(); closeSheet(); renderLine(oid, i);
      });
      break;
    case 'miss':
      sheet(`<h3>Segna mancante</h3><p>${esc(s.p.n)} · prelevato ${s.picked ? qtyText(s.p, s.L, s.picked) : 'niente'} su ${qtyText(s.p, s.L, s.L.qty)}</p>
        <div class="reasons">${['Esaurito', 'Non trovato in ubicazione', 'Danneggiato', 'Scadenza non idonea'].map((r) => `<button class="bbtn" data-s="${r}">${r}</button>`).join('')}</div>`, (x) => {
        s.st.miss = x; save(); closeSheet(); flash('warn', 'Riga segnata mancante', x);
        const n = nextLine(oid, i); go(n === null ? '#/chiudi/' + oid : `#/riga/${oid}/${n}`);
      });
      break;
    case 'next': { const n = nextLine(oid, i); go(n === null ? '#/chiudi/' + oid : `#/riga/${oid}/${n}`); break; }
  }
}

boot().catch((err) => { $('#app').innerHTML = `<div class="boot">Impossibile avviare la demo: ${esc(err.message)}</div>`; });
