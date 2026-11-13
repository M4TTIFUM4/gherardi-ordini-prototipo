import { buildIndex, search, highlight, TIER } from './search.js';

/* ---------- utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const num = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(n);
const LS = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage non disponibile */ } },
};

/* ---------- credenziali prototipo ---------- */
const DEMO_USER = 'admin';
const DEMO_PASS = 'admin';

/* ---------- dati ---------- */
let DB = null, INDEX = null;
const byCode = new Map();
const UNIT_LABEL = { CO: 'Collo', CF: 'Conf.', NR: 'Pz', KG: 'Kg', PZ: 'Pz', LT: 'Lt' };
const UM_LABEL = { KG: 'kg', NR: 'pz', CF: 'conf.', CO: 'collo', PZ: 'pz', LT: 'lt' };
const ICONS = { Attrezzature: '🔪', Bevande: '🥤', Carni: '🥩', Conserve: '🥫', Dolci: '🍰', Drogheria: '🧂', Farine: '🌾', Frutta: '🥜', Grassi: '🧈', Igiene: '🧴', Latticini: '🧀', Legna: '🪵', Monouso: '🍽️', Oli: '🫒', Pane: '🥖', Pasta: '🍝', Patate: '🥔', Pesce: '🐟', Riso: '🍚', Salumi: '🥓', Uova: '🥚' };
const iconFor = (lineName) => ICONS[lineName.split(/[ ,]/)[0]] || '📦';

let session = LS.get('gh_session', null);
let cart = LS.get('gh_cart', {});       // codice -> { qty, unit, note }
let orders = LS.get('gh_orders', []);
const state = { q: '', line: '', sector: '', onlyNew: false, onlyPromo: false, onlyStock: false, all: false, sort: 'rel', view: LS.get('gh_view', 'grid'), shown: 48 };
let lastTerms = [];
const PAGE = 48;

/* ---------- unità di misura e importi (stessa logica del gestionale) ---------- */
function conv(p, qty, from, to) {
  if (from === to) return qty;
  const f = { L: p.cc, C: 1, P: p.cp, K: p.cw };
  return (qty * (f[from] || 1)) / (f[to] || 1);
}
const lineTotal = (p, qty, unit) => p.p * conv(p, qty, unit, p.bu);
const unitLabel = (p, u) => UNIT_LABEL[p.u[u]] || p.u[u] || u;

function cartTotals() {
  let net = 0, vat = 0, lines = 0;
  for (const [code, it] of Object.entries(cart)) {
    const p = byCode.get(code);
    if (!p) continue;
    const t = lineTotal(p, it.qty, it.unit);
    net += t; vat += (t * p.iva) / 100; lines++;
  }
  return { net, vat, total: net + vat, lines };
}

function setCart(code, qty, unit, note) {
  const p = byCode.get(code);
  if (!p) return;
  qty = Math.round((Number(qty) || 0) * 100) / 100;
  if (qty <= 0) delete cart[code];
  else cart[code] = { qty, unit: unit || cart[code]?.unit || p.du, note: note ?? cart[code]?.note ?? '' };
  LS.set('gh_cart', cart);
  refreshCards(code);
  renderCartBadge();
  if ($('#cart')?.classList.contains('open')) renderCart();
}

/* ---------- avvio ---------- */
async function boot() {
  try {
    DB = await fetch('data/catalog.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  } catch (e) {
    $('#app').innerHTML = `<div class="boot">Impossibile caricare il catalogo locale (data/catalog.json).<br>Avvia l'app con <code>avvia.bat</code> oppure <code>python -m http.server 5173</code>.</div>`;
    return;
  }
  for (const p of DB.products) byCode.set(p.c, p);
  INDEX = buildIndex(DB.products, DB.lines);
  window.addEventListener('hashchange', route);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKey);
  route();
}

/* ---------- routing ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path: path || 'catalogo', params: new URLSearchParams(qs || '') };
}
function catalogHash() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.line) p.set('l', state.line);
  if (state.sector) p.set('s', state.sector);
  if (state.onlyNew) p.set('new', '1');
  if (state.onlyPromo) p.set('promo', '1');
  if (state.onlyStock) p.set('stock', '1');
  if (state.all) p.set('all', '1');
  if (state.sort !== 'rel') p.set('sort', state.sort);
  const s = p.toString();
  return '#/catalogo' + (s ? '?' + s : '');
}
function go(patch, replace) {
  Object.assign(state, patch, { shown: PAGE });
  const h = catalogHash();
  if (replace) { history.replaceState(null, '', h); renderCatalog(); } else if (location.hash === h) renderCatalog(); else location.hash = h;
}

function route() {
  if (!session) return renderLogin();
  if (!$('#main')) renderShell();
  const { path, params } = parseHash();
  closeDrawers();
  $('#modal').hidden = true;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === path));
  if (path === 'ordini') { renderOrders(); window.scrollTo(0, 0); return; }
  Object.assign(state, {
    q: params.get('q') || '', line: params.get('l') || '', sector: params.get('s') || '',
    onlyNew: params.has('new'), onlyPromo: params.has('promo'), onlyStock: params.has('stock'), all: params.has('all'),
    sort: params.get('sort') || 'rel', shown: PAGE,
  });
  const input = $('#q');
  if (input && document.activeElement !== input) input.value = state.q;
  renderCatalog();
  window.scrollTo(0, 0);
}

/* ---------- login ---------- */
function renderLogin(error) {
  $('#app').innerHTML = `
  <div class="login">
    <section class="login-hero">
      <div class="brand big">Gherardi<small>dal 1977 · soluzioni per ristorazione e panificazione</small></div>
      <h1>Ordina in pochi tocchi,<br>dal banco o dal telefono.</h1>
      <ul>
        <li><b>${DB.products.length.toLocaleString('it-IT')}</b> referenze alimentari e non food</li>
        <li>Ricerca intelligente per nome, categoria e codice</li>
        <li>Consegna in Provincia di Sondrio e zone limitrofe</li>
      </ul>
    </section>
    <section class="login-panel">
      <form class="login-form" data-form="login" novalidate>
        <h2>Area riservata</h2>
        <p class="muted">Accedi per consultare l'assortimento e inviare i tuoi ordini.</p>
        <label>Utente<input name="user" autocomplete="username" autocapitalize="none" required autofocus></label>
        <label>Password<input name="pass" type="password" autocomplete="current-password" required></label>
        ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
        <button class="btn primary block" type="submit">Accedi</button>
        <p class="demo-note">Prototipo dimostrativo · accesso unico <code>${DEMO_USER}</code> / <code>${DEMO_PASS}</code></p>
        <p class="muted small">Non hai le credenziali? tel. 0342 354055 · info@gherardi.so</p>
      </form>
    </section>
  </div>`;
}

/* ---------- struttura ---------- */
const svg = {
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9.5" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg>',
  grid: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="3" y="4" width="18" height="4" rx="1.5"/><rect x="3" y="10" width="18" height="4" rx="1.5"/><rect x="3" y="16" width="18" height="4" rx="1.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9 12h6M9 16h6"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function renderShell() {
  $('#app').innerHTML = `
  <header class="top">
    <button class="icon-btn mobile-only" data-act="open-cats" aria-label="Categorie">${svg.menu}</button>
    <a class="brand" href="#/catalogo">Gherardi<small>Area ordini</small></a>
    <form class="search" data-form="search" role="search">
      ${svg.search}
      <input id="q" type="search" placeholder="Cerca per nome, categoria o codice…" autocomplete="off" enterkeyhint="search" aria-label="Cerca prodotti">
      <kbd class="desktop-only">/</kbd>
    </form>
    <nav class="top-nav desktop-only">
      <a href="#/catalogo" data-nav="catalogo">Catalogo</a>
      <a href="#/ordini" data-nav="ordini">I miei ordini</a>
    </nav>
    <button class="cart-btn" data-act="open-cart" aria-label="Apri carrello">${svg.cart}<span class="cart-count" id="cartCount" hidden>0</span><span class="cart-total desktop-only" id="cartTotal"></span></button>
    <button class="user desktop-only" data-act="logout" title="Esci">Esci</button>
  </header>
  <div class="demo-bar">Prototipo dimostrativo · catalogo locale, nessun ordine reale viene inviato</div>
  <div class="layout">
    <aside class="cats" id="cats" aria-label="Categorie"></aside>
    <main id="main"></main>
  </div>
  <footer class="foot">Gherardi S.r.l. · tel. 0342 354055 · info@gherardi.so <button class="link mobile-only" data-act="logout">Esci</button></footer>
  <aside class="drawer" id="cart" aria-label="Carrello"></aside>
  <div class="scrim" data-act="close-drawers"></div>
  <nav class="bottom-nav mobile-only">
    <a href="#/catalogo" data-nav="catalogo">${svg.home}<span>Catalogo</span></a>
    <button data-act="open-cats">${svg.menu}<span>Categorie</span></button>
    <button data-act="open-cart">${svg.cart}<span>Carrello</span><b class="cart-count" id="cartCount2" hidden>0</b></button>
    <a href="#/ordini" data-nav="ordini">${svg.doc}<span>Ordini</span></a>
  </nav>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <div class="modal" id="modal" hidden></div>`;
  $('#q').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim();
    if (parseHash().path !== 'catalogo') { state.q = q; location.hash = catalogHash(); } else go({ q }, true);
  }, 140));
  renderCartBadge();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- catalogo ---------- */
function flagsOk(p) {
  return (!state.onlyNew || p.new) && (!state.onlyPromo || p.promo) && (!state.onlyStock || !p.ord);
}

function computeList() {
  let rows, info = null;
  if (state.q) {
    info = search(INDEX, state.q);
    rows = info.results.filter((r) => flagsOk(r.p));
  } else {
    rows = DB.products.filter(flagsOk).map((p) => ({ p, tier: 0, score: 0 }));
  }
  // conteggi per la barra categorie (prima del filtro per categoria)
  const counts = new Map();
  for (const r of rows) {
    counts.set(r.p.l, (counts.get(r.p.l) || 0) + 1);
    counts.set(r.p.s, (counts.get(r.p.s) || 0) + 1);
  }
  const total = rows.length;
  if (state.sector) rows = rows.filter((r) => r.p.s === state.sector);
  else if (state.line) rows = rows.filter((r) => r.p.l === state.line);
  const byName = (a, b) => a.p.n.localeCompare(b.p.n, 'it');
  if (state.sort === 'name' || (state.sort === 'rel' && !state.q)) rows.sort(byName);
  else if (state.sort === 'pa') rows.sort((a, b) => (a.p.p || 1e9) - (b.p.p || 1e9));
  else if (state.sort === 'pd') rows.sort((a, b) => b.p.p - a.p.p);
  return { rows, info, counts, total };
}

function renderCats(counts, total) {
  const filtered = !!(state.q || state.onlyNew || state.onlyPromo || state.onlyStock);
  const n = (id, def) => (filtered ? counts.get(id) || 0 : def);
  const link = (patch) => { const s = { ...state, ...patch }; return catalogHashFor(s); };
  let html = `<div class="cats-head"><h2>Categorie</h2><button class="icon-btn mobile-only" data-act="close-drawers" aria-label="Chiudi">${svg.x}</button></div>
  <a class="cat ${!state.line ? 'active' : ''}" href="${link({ line: '', sector: '', all: !filtered })}"><span>Tutto il catalogo</span><em>${filtered ? total : DB.products.length}</em></a>`;
  for (const l of DB.lines) {
    const c = n(l.id, l.n);
    if (filtered && !c) continue;
    const open = state.line === l.id;
    html += `<a class="cat ${open && !state.sector ? 'active' : ''} ${open ? 'open' : ''}" href="${link({ line: l.id, sector: '' })}"><span><i>${iconFor(l.name)}</i>${esc(l.name)}</span><em>${c}</em></a>`;
    if (open && l.sectors.length > 1) {
      html += '<div class="subcats">' + l.sectors.map((s) => {
        const sc = n(s.id, s.n);
        return filtered && !sc ? '' : `<a class="cat sub ${state.sector === s.id ? 'active' : ''}" href="${link({ line: l.id, sector: s.id })}"><span>${esc(s.name)}</span><em>${sc}</em></a>`;
      }).join('') + '</div>';
    }
  }
  $('#cats').innerHTML = html;
}
function catalogHashFor(s) {
  const keep = { ...state };
  Object.assign(state, s);
  const h = catalogHash();
  Object.assign(state, keep);
  return h;
}

function priceHtml(p) {
  if (!p.p) return '<div class="price ask">Prezzo su richiesta</div>';
  return `<div class="price"><b>${eur.format(p.p)}</b><span>/ ${UM_LABEL[p.um] || p.um.toLowerCase()} · IVA escl.</span></div>`;
}

function buyHtml(p) {
  const it = cart[p.c];
  const unit = it?.unit || p.du;
  const keys = Object.keys(p.u);
  const unitCtl = keys.length > 1
    ? `<select class="unit" data-act="unit" aria-label="Unità di misura">${keys.map((k) => `<option value="${k}" ${k === unit ? 'selected' : ''}>${esc(unitLabel(p, k))}</option>`).join('')}</select>`
    : `<span class="unit fixed">${esc(unitLabel(p, keys[0]))}</span>`;
  const stepper = `<div class="stepper"><button type="button" data-act="dec" aria-label="Diminuisci">−</button><input class="qty" data-act="qty" inputmode="decimal" value="${it ? num(it.qty) : 1}" aria-label="Quantità"><button type="button" data-act="inc" aria-label="Aumenta">+</button></div>`;
  const action = it
    ? `<div class="in-cart-info"><span>✓ nel carrello</span><b>${p.p ? eur.format(lineTotal(p, it.qty, it.unit)) : '—'}</b></div>`
    : `<button type="button" class="btn primary add" data-act="add">Aggiungi</button>`;
  return `<div class="buy">${stepper}${unitCtl}${action}</div>`;
}

function cardHtml(p, terms) {
  const line = INDEX.lineById.get(p.l), sector = INDEX.sectorById.get(p.s);
  const badges = [p.promo ? '<span class="badge promo">Promo</span>' : '', p.new ? '<span class="badge new">Novità</span>' : '', p.ord ? '<span class="badge ord">Su ordinazione</span>' : ''].join('');
  const img = p.img ? `<img loading="lazy" decoding="async" alt="" src="${esc(DB.imgBase + encodeURIComponent(p.img))}" onerror="this.remove()">` : '';
  const pack = p.cc > 1 && p.u.L ? `<span class="pack">${num(p.cc)} ${esc((UM_LABEL[p.u.C] || 'pz'))} per collo</span>` : '';
  return `<article class="card ${cart[p.c] ? 'in-cart' : ''}" data-card="${esc(p.c)}">
    <div class="thumb"><span class="ph">${iconFor(line.name)}</span>${img}<div class="badges">${badges}</div></div>
    <div class="body">
      <div class="meta"><span class="code">${esc(p.c)}</span><a href="${catalogHashFor({ q: '', line: p.l, sector: p.s, all: false })}">${esc(sector.name)}</a></div>
      <h3>${highlight(p.n, terms, esc)}</h3>
      ${p.d ? `<p class="desc" title="${esc(p.d)}">${esc(p.d)}</p>` : ''}
      <div class="price-row">${priceHtml(p)}${pack}</div>
      ${buyHtml(p)}
    </div>
  </article>`;
}

function refreshCards(code) {
  const p = byCode.get(code);
  $$(`[data-card="${CSS.escape(code)}"]`).forEach((el) => {
    if (el.closest('#cart')) return;
    const t = document.createElement('template');
    t.innerHTML = cardHtml(p, lastTerms).trim();
    el.replaceWith(t.content.firstChild);
  });
}

const TIER_TITLE = {
  [TIER.HEAD]: (q) => `Corrispondenza principale <small>«${esc(q)}» è il prodotto</small>`,
  [TIER.CAT]: () => `Dalla categoria corrispondente`,
  [TIER.NAME]: (q) => `Altri prodotti che contengono «${esc(q)}» nel nome`,
  [TIER.DESC]: (q) => `«${esc(q)}» citato solo nella descrizione`,
};

function renderCatalog() {
  const main = $('#main');
  if (!main) return;
  const { rows, info, counts, total } = computeList();
  lastTerms = info ? info.terms : [];
  renderCats(counts, total);
  const line = state.line && INDEX.lineById.get(state.line);
  const sector = state.sector && INDEX.sectorById.get(state.sector);
  const isHome = !state.q && !state.line && !state.onlyNew && !state.onlyPromo && !state.onlyStock && !state.all;

  if (isHome) { main.innerHTML = homeHtml(); return; }

  const title = state.q ? `Risultati per «${esc(state.q)}»` : sector ? esc(sector.name) : line ? esc(line.name) : state.onlyPromo ? 'In promozione' : state.onlyNew ? 'Nuove proposte' : 'Tutto il catalogo';
  const crumbs = [`<a href="#/catalogo">Catalogo</a>`];
  if (line) crumbs.push(`<a href="${catalogHashFor({ sector: '' })}">${esc(line.name)}</a>`);
  if (sector) crumbs.push(`<span>${esc(sector.name)}</span>`);
  if (state.q) crumbs.push(`<span>Ricerca</span>`);

  const chip = (key, label) => `<button class="chip ${state[key] ? 'on' : ''}" data-act="toggle" data-key="${key}" aria-pressed="${!!state[key]}">${label}</button>`;
  const catChips = info && info.categories.length && !state.line
    ? `<div class="cat-suggest"><span>Vai alla categoria:</span>${info.categories.map((c) => `<a class="chip cat-chip" href="${catalogHashFor({ q: '', line: c.type === 'line' ? c.id : c.line, sector: c.type === 'sector' ? c.id : '' })}">${iconFor(c.parent || c.name)} ${esc(c.name)} <em>${c.n}</em></a>`).join('')}</div>` : '';

  let list = '';
  if (!rows.length) {
    list = `<div class="empty"><div class="empty-ic">🔎</div><h3>Nessun prodotto trovato</h3><p>Prova con un termine più generico, controlla l'ortografia oppure rimuovi i filtri attivi.</p><a class="btn" href="#/catalogo">Torna al catalogo</a></div>`;
  } else {
    const grouped = state.q && state.sort === 'rel';
    let prev = null;
    const slice = rows.slice(0, state.shown);
    list = `<div class="products ${state.view}">` + slice.map((r) => {
      let head = '';
      if (grouped && r.tier !== prev) { prev = r.tier; head = `<h2 class="group">${TIER_TITLE[r.tier](state.q)}</h2>`; }
      return head + cardHtml(r.p, lastTerms);
    }).join('') + '</div>';
    if (rows.length > state.shown) list += `<div class="more"><button class="btn" data-act="more">Mostra altri prodotti (${rows.length - state.shown})</button></div>`;
  }

  main.innerHTML = `
    <nav class="crumbs">${crumbs.join('<i>›</i>')}</nav>
    <div class="toolbar">
      <div class="title"><h1>${title}</h1><span class="muted">${rows.length} ${rows.length === 1 ? 'prodotto' : 'prodotti'}</span></div>
      <div class="tools">
        <div class="chips">${chip('onlyStock', 'Pronta consegna')}${chip('onlyPromo', 'In promozione')}${chip('onlyNew', 'Novità')}</div>
        <select class="sort" data-act="sort" aria-label="Ordina">
          <option value="rel" ${state.sort === 'rel' ? 'selected' : ''}>${state.q ? 'Più pertinenti' : 'Nome A–Z'}</option>
          ${state.q ? `<option value="name" ${state.sort === 'name' ? 'selected' : ''}>Nome A–Z</option>` : ''}
          <option value="pa" ${state.sort === 'pa' ? 'selected' : ''}>Prezzo crescente</option>
          <option value="pd" ${state.sort === 'pd' ? 'selected' : ''}>Prezzo decrescente</option>
        </select>
        <div class="view-toggle" role="group" aria-label="Vista">
          <button class="${state.view === 'grid' ? 'on' : ''}" data-act="view" data-view="grid" aria-label="Griglia">${svg.grid}</button>
          <button class="${state.view === 'list' ? 'on' : ''}" data-act="view" data-view="list" aria-label="Elenco rapido">${svg.list}</button>
        </div>
      </div>
    </div>
    ${info?.fuzzy ? `<p class="notice">Nessuna corrispondenza esatta: mostro i risultati più simili a «${esc(state.q)}».</p>` : ''}
    ${catChips}
    ${list}`;
  observeMore();
}

function homeHtml() {
  const pick = (key) => {
    const all = DB.products.filter((p) => p[key] && p.p && p.img && !p.ord);
    const step = Math.max(1, Math.floor(all.length / 8));
    return all.filter((_, i) => i % step === 0).slice(0, 8);
  };
  const row = (title, items, href) => items.length ? `<section class="home-row"><div class="row-head"><h2>${title}</h2><a href="${href}">Vedi tutti ›</a></div><div class="products grid">${items.map((p) => cardHtml(p, [])).join('')}</div></section>` : '';
  return `
    <section class="hero">
      <div><h1>Buongiorno, cosa ordiniamo oggi?</h1><p>Cerca un prodotto per nome o codice, oppure parti da una categoria.</p></div>
      <div class="hero-actions"><a class="btn light" href="#/catalogo?all=1">Tutto il catalogo</a>${orders.length ? `<a class="btn ghost" href="#/ordini">Riordina dagli ordini precedenti</a>` : ''}</div>
    </section>
    <section class="tiles">${DB.lines.map((l) => `<a class="tile" href="${catalogHashFor({ line: l.id, sector: '' })}"><i>${iconFor(l.name)}</i><b>${esc(l.name)}</b><span>${l.n} prodotti</span></a>`).join('')}</section>
    ${row('In promozione', pick('promo'), '#/catalogo?promo=1')}
    ${row('Nuove proposte', pick('new'), '#/catalogo?new=1')}`;
}

let moreObserver = null;
function observeMore() {
  moreObserver?.disconnect();
  const btn = $('[data-act="more"]');
  if (!btn || !('IntersectionObserver' in window)) return;
  moreObserver = new IntersectionObserver((e) => { if (e[0].isIntersecting) showMore(); }, { rootMargin: '600px' });
  moreObserver.observe(btn);
}
function showMore() {
  const y = window.scrollY;
  state.shown += PAGE;
  renderCatalog();
  window.scrollTo(0, y);
}

/* ---------- carrello ---------- */
function renderCartBadge() {
  const t = cartTotals();
  for (const id of ['cartCount', 'cartCount2']) { const el = $('#' + id); if (el) { el.textContent = t.lines; el.hidden = !t.lines; } }
  const tot = $('#cartTotal');
  if (tot) tot.textContent = t.lines ? eur.format(t.net) : 'Carrello';
}

function defaultDelivery() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

function renderCart() {
  const el = $('#cart');
  const keep = { date: $('#delivery')?.value, note: $('#orderNote')?.value };
  const entries = Object.entries(cart).filter(([c]) => byCode.has(c));
  const t = cartTotals();
  const head = `<div class="drawer-head"><h2>Carrello <small>${t.lines} ${t.lines === 1 ? 'riga' : 'righe'}</small></h2><button class="icon-btn" data-act="close-drawers" aria-label="Chiudi">${svg.x}</button></div>`;
  if (!entries.length) {
    el.innerHTML = head + `<div class="empty"><div class="empty-ic">🛒</div><h3>Il carrello è vuoto</h3><p>Aggiungi i prodotti dal catalogo: li ritrovi qui, pronti per l'invio.</p><button class="btn" data-act="close-drawers">Continua a ordinare</button></div>`;
    return;
  }
  const lines = entries.map(([code, it]) => {
    const p = byCode.get(code);
    const keys = Object.keys(p.u);
    const unitCtl = keys.length > 1
      ? `<select class="unit" data-act="unit" aria-label="Unità">${keys.map((k) => `<option value="${k}" ${k === it.unit ? 'selected' : ''}>${esc(unitLabel(p, k))}</option>`).join('')}</select>`
      : `<span class="unit fixed">${esc(unitLabel(p, keys[0]))}</span>`;
    return `<li class="cart-line" data-card="${esc(code)}">
      <div class="cl-main"><b>${esc(p.n)}</b><span class="muted">${esc(p.c)} · ${p.p ? eur.format(p.p) + ' / ' + (UM_LABEL[p.um] || p.um) : 'prezzo su richiesta'}${p.ord ? ' · su ordinazione' : ''}</span></div>
      <button class="icon-btn remove" data-act="remove" aria-label="Rimuovi ${esc(p.n)}">${svg.x}</button>
      <div class="cl-ctl"><div class="stepper"><button type="button" data-act="dec" aria-label="Diminuisci">−</button><input class="qty" data-act="qty" inputmode="decimal" value="${num(it.qty)}" aria-label="Quantità"><button type="button" data-act="inc" aria-label="Aumenta">+</button></div>${unitCtl}<b class="cl-tot">${p.p ? eur.format(lineTotal(p, it.qty, it.unit)) : '—'}</b></div>
      <input class="note" data-act="note" placeholder="Nota per questa riga (facoltativa)" maxlength="80" value="${esc(it.note || '')}">
    </li>`;
  }).join('');
  const scrollTop = $('.cart-scroll', el)?.scrollTop || 0;
  el.innerHTML = head + `<div class="cart-scroll"><ul class="cart-lines">${lines}</ul>
    <div class="cart-fields">
      <label>Consegna richiesta<input type="date" id="delivery" name="delivery" form="orderForm" min="${new Date().toISOString().slice(0, 10)}" value="${esc(keep.date || defaultDelivery())}" required></label>
      <label>Note per l'ordine<textarea id="orderNote" name="note" form="orderForm" rows="2" placeholder="Es. consegnare entro le 10">${esc(keep.note || '')}</textarea></label>
    </div>
  </div>
  <form class="cart-foot" id="orderForm" data-form="order">
    <dl class="totals"><div><dt>Imponibile</dt><dd>${eur.format(t.net)}</dd></div><div><dt>IVA</dt><dd>${eur.format(t.vat)}</dd></div><div class="grand"><dt>Totale</dt><dd>${eur.format(t.total)}</dd></div></dl>
    <button class="btn primary block" type="submit">Invia ordine (demo)</button>
    <button class="link danger" type="button" data-act="clear-cart">Svuota carrello</button>
  </form>`;
  $('.cart-scroll', el).scrollTop = scrollTop;
}

function openDrawer(id) {
  closeDrawers();
  if (id === 'cart') renderCart();
  $('#' + id).classList.add('open');
  document.body.classList.add('drawer-open');
}
function closeDrawers() {
  $$('.drawer.open, .cats.open').forEach((d) => d.classList.remove('open'));
  document.body.classList.remove('drawer-open');
}

function submitOrder(form) {
  const entries = Object.entries(cart).filter(([c]) => byCode.has(c));
  if (!entries.length) return;
  const t = cartTotals();
  const year = new Date().getFullYear();
  const seq = orders.filter((o) => o.id.includes(String(year))).length + 1;
  const order = {
    id: `DEMO-${year}-${String(seq).padStart(4, '0')}`,
    date: new Date().toISOString(),
    delivery: form.delivery.value,
    note: form.note.value.trim(),
    lines: entries.map(([code, it]) => { const p = byCode.get(code); return { c: code, n: p.n, qty: it.qty, unit: it.unit, ul: unitLabel(p, it.unit), note: it.note || '', total: lineTotal(p, it.qty, it.unit) }; }),
    net: t.net, vat: t.vat, total: t.total,
  };
  orders.unshift(order);
  LS.set('gh_orders', orders);
  const codes = Object.keys(cart);
  cart = {};
  LS.set('gh_cart', cart);
  codes.forEach(refreshCards);
  renderCartBadge();
  closeDrawers();
  showModal(`<div class="ok-ic">✓</div><h2>Ordine ${esc(order.id)} registrato</h2><p>${order.lines.length} righe · totale ${eur.format(order.total)} IVA inclusa<br>Consegna richiesta: ${fmtDate(order.delivery)}</p><p class="muted small">Questo è un prototipo: l'ordine è salvato solo su questo dispositivo e non è stato trasmesso a Gherardi.</p><div class="modal-actions"><a class="btn" href="#/ordini" data-act="close-modal">Vedi i miei ordini</a><button class="btn primary" data-act="close-modal">Continua</button></div>`);
}

const fmtDate = (s) => new Date(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/* ---------- ordini ---------- */
function renderOrders() {
  renderCats(new Map(), 0);
  const body = orders.length ? orders.map((o, i) => `
    <details class="order" ${i === 0 ? 'open' : ''}>
      <summary><div><b>${esc(o.id)}</b><span class="muted">${new Date(o.date).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })} · consegna ${fmtDate(o.delivery)}</span></div><div class="o-right"><span class="badge ok">Registrato (demo)</span><b>${eur.format(o.total)}</b></div></summary>
      <table><thead><tr><th>Codice</th><th>Prodotto</th><th class="r">Q.tà</th><th class="r">Importo</th></tr></thead>
      <tbody>${o.lines.map((l) => `<tr><td class="code">${esc(l.c)}</td><td>${esc(l.n)}${l.note ? `<br><span class="muted small">Nota: ${esc(l.note)}</span>` : ''}</td><td class="r">${num(l.qty)} ${esc(l.ul)}</td><td class="r">${eur.format(l.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3" class="r">Imponibile</td><td class="r">${eur.format(o.net)}</td></tr><tr><td colspan="3" class="r">IVA</td><td class="r">${eur.format(o.vat)}</td></tr></tfoot></table>
      ${o.note ? `<p class="muted">Note: ${esc(o.note)}</p>` : ''}
      <div class="order-actions"><button class="btn primary" data-act="reorder" data-id="${esc(o.id)}">Riordina tutto</button></div>
    </details>`).join('')
    : `<div class="empty"><div class="empty-ic">📄</div><h3>Ancora nessun ordine</h3><p>Gli ordini inviati da questo dispositivo compaiono qui, pronti da riordinare con un tocco.</p><a class="btn primary" href="#/catalogo">Vai al catalogo</a></div>`;
  $('#main').innerHTML = `<nav class="crumbs"><a href="#/catalogo">Catalogo</a><i>›</i><span>I miei ordini</span></nav><div class="toolbar"><div class="title"><h1>I miei ordini</h1><span class="muted">${orders.length} ${orders.length === 1 ? 'ordine' : 'ordini'}</span></div></div><div class="orders">${body}</div>`;
}

/* ---------- modale e toast ---------- */
function showModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- eventi ---------- */
const parseQty = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };

function cardCtx(el) {
  const card = el.closest('[data-card]');
  if (!card) return null;
  const code = card.dataset.card;
  const p = byCode.get(code);
  const qtyEl = $('.qty', card), unitEl = $('select.unit', card);
  return { card, code, p, qtyEl, qty: parseQty(qtyEl?.value), unit: unitEl?.value || cart[code]?.unit || p.du, inCart: !!cart[code] };
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const c = cardCtx(el);
  switch (act) {
    case 'inc': case 'dec': {
      const next = Math.max(c.inCart ? 0 : 1, (c.qty || 0) + (act === 'inc' ? 1 : -1));
      if (c.inCart) { setCart(c.code, next, c.unit); if (!next) toast('Rimosso dal carrello'); } else c.qtyEl.value = num(next);
      break;
    }
    case 'add': setCart(c.code, c.qty || 1, c.unit); toast(`Aggiunto: ${c.p.n}`); break;
    case 'remove': setCart(c.code, 0); break;
    case 'open-cart': openDrawer('cart'); break;
    case 'open-cats': openDrawer('cats'); break;
    case 'close-drawers': closeDrawers(); break;
    case 'close-modal': $('#modal').hidden = true; break;
    case 'toggle': go({ [el.dataset.key]: !state[el.dataset.key] }); break;
    case 'view': state.view = el.dataset.view; LS.set('gh_view', state.view); renderCatalog(); break;
    case 'more': showMore(); break;
    case 'clear-cart': {
      const codes = Object.keys(cart);
      cart = {}; LS.set('gh_cart', cart);
      codes.forEach(refreshCards); renderCartBadge(); renderCart();
      break;
    }
    case 'reorder': {
      const o = orders.find((x) => x.id === el.dataset.id);
      let n = 0;
      for (const l of o?.lines || []) if (byCode.has(l.c)) { setCart(l.c, l.qty, l.unit, l.note); n++; }
      toast(`${n} prodotti aggiunti al carrello`);
      openDrawer('cart');
      break;
    }
    case 'logout': session = null; LS.set('gh_session', null); location.hash = ''; renderLogin(); break;
  }
}

function onChange(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'sort') return go({ sort: el.value });
  const c = cardCtx(el);
  if (!c) return;
  if (act === 'qty') { if (c.inCart) setCart(c.code, c.qty, c.unit); else c.qtyEl.value = num(c.qty || 1); }
  if (act === 'unit' && c.inCart) setCart(c.code, c.qty || cart[c.code].qty, el.value);
  if (act === 'note' && c.inCart) { cart[c.code].note = el.value.trim(); LS.set('gh_cart', cart); }
}

function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'login') {
    const user = form.user.value.trim(), pass = form.pass.value;
    if (user === DEMO_USER && pass === DEMO_PASS) {
      session = { user, at: Date.now() };
      LS.set('gh_session', session);
      $('#app').innerHTML = '';
      route();
    } else renderLogin('Utente o password non corretti.');
  } else if (form.dataset.form === 'search') {
    $('#q').blur();
    go({ q: $('#q').value.trim() });
  } else if (form.dataset.form === 'order') {
    if (!form.reportValidity()) return;
    submitOrder(form);
  }
}

function onKey(e) {
  if (e.key === 'Escape') { closeDrawers(); const m = $('#modal'); if (m) m.hidden = true; }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('#q')) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Enter' && e.target.classList?.contains('qty')) { e.preventDefault(); const c = cardCtx(e.target); if (c && !c.inCart) { setCart(c.code, c.qty || 1, c.unit); toast(`Aggiunto: ${c.p.n}`); } else e.target.blur(); }
}

boot();
