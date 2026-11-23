(() => {
  const UP = 'https://gherardi.so/wp-content/uploads/';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- dati ---------- */
  const CARDS = {
    food: [
      ['Pasta e riso', 'Pasta secca e fresca, pasta ripiena, Barilla Professional, De Cecco, riso italiano e cereali.', '2020/10/pasta.jpg', 'pasta'],
      ['Oli, aceti e grassi', 'Olio extravergine e di semi, aceti, salse e condimenti.', '2020/10/oli.jpg', 'olio'],
      ['Drogheria', 'Spezie e sali, preparati per brodo, zuccheri, cacao e cioccolato.', '2020/10/spezie.jpg', 'spezie'],
      ['Farine e preparati', 'Farine per pane, pizza e pasticceria, amidi e semilavorati.', '2020/10/impasti.jpg', 'farina'],
      ['Confetture e frutta secca', 'Confetture, miele, frutta secca, composte e passate di frutta.', '2020/10/confetture.jpg', 'confettura'],
      ['Conserve', 'Pomodoro, sottoli e sottaceti, contorni, sughi, pesce e frutta conservati.', '2020/10/conserve.jpg', 'pomodoro'],
      ['Salumi, latticini e uova', 'Salumi e formaggi valtellinesi, Grana Padano, Parmigiano Reggiano, freschi e stagionati.', '2020/10/salumi-formaggi.jpg', 'bresaola'],
      ['Carne e pesce', 'Manzo Angus, suino e avicolo italiani, salmone, insalata di mare, affumicati.', '2020/10/carne.jpg', 'salmone'],
      ['Vini, liquori e bevande', 'Vini, bagne e liquori, succhi, caffè, cioccolata e infusi.', '2020/10/vini.jpg', 'succo'],
      ['Prodotti da forno', 'Grissini, pane conservato, fette biscottate, biscotti e muesli.', '2020/10/panificazione.jpg', 'grissini'],
      ['Senza glutine', 'Pasta, prodotti da forno, semilavorati, brodi e dessert.', '2020/10/gluten-free.jpg', 'senza glutine'],
      ['Biologico', 'Pelati, olio, farine, confetture, uova, zucchero di canna, miele.', '2020/10/bio.jpg', 'bio'],
    ],
    nonfood: [
      ['Detergenti', 'Detersivi professionali, spugne e panni, guanti, attrezzature per la pulizia.', '2020/10/detergenti.jpg', 'detersivo'],
      ['Carta, tovagliato e monouso', 'Tovaglioli e coprimacchia, piatti e bicchieri, bobine, contenitori per asporto e delivery.', '2020/10/tovagliato.jpg', 'tovaglioli'],
      ['Attrezzature', 'Pale, teglie e accessori per pizzerie e laboratori di panificazione.', '2020/10/attrezzature.jpg', 'pala'],
    ],
    brand: [
      ['Big Chef', 'Riso, pomodoro, olio, legumi, salse, brodi, verdure, formaggi, tonno e molto altro.', '2022/05/big-chef2022.jpg', 'big chef'],
      ['Delizie di Latte', 'La linea latticini: latte UHT, panna, mozzarella, Grana Padano, Parmigiano, burro.', '2022/05/delizie2022.jpg', 'panna'],
      ['Salumi Reali', 'Bresaola della Valtellina IGP, prosciutti crudi e cotti, mortadella e salumi tipici.', '2022/05/salumi2022.jpg', 'prosciutto'],
      ['Easy Professional', 'Carta, tovaglioli, bobine, pellicole e alluminio, detersivi e detergenti.', '2022/05/easy2022.jpg', 'pellicola'],
      ['DoGusto', 'Selezione di alta qualità per ristoranti e pizzerie: salumi piacentini, guanciale e altro.', '2025/02/dogusto.jpg', 'dogusto'],
    ],
  };
  const NEWS = [
    ['Sala&Cucina Magazine – N° 108', 'Ottobre 2026', '2026/10/salaecucina.jpg', 'https://gherardi.so/salacucina-magazine-n-108-ottobre-2026/', 'Magazine'],
    ['Vesti la tavola delle feste con stile!', 'Ottobre 2026', '2026/10/cf87796d-a213-4f91-9c7d-656012749030.jpg', 'https://gherardi.so/vesti-la-tavola-delle-feste-con-stile/', 'Monouso'],
    ['Per un Natale dal sapore indimenticabile!', 'Ottobre 2026', '2026/10/immagine.png', 'https://gherardi.so/per-un-natale-dal-sapore-indimenticabile/', 'Pasticceria'],
  ];
  const PARTNERS = 'MOLINO-VERRINI MORO MOTTOLINI-SALUMIFICIO MUTTI PANNAELENA RISTORA RIZZI ROBERTOALIM SCOTTI SPADONI TOSCHI VICENZI VIS WELL WIBERG ZAROTTI ZUCCATO ZUCCHI AGUGIARO AIA BARILLA BASSOSEBASTIANO BAYERNALD BIBANESI BONOLI BRIVIO CALLIPO COLUSSI DEBIC DECECCO DELZOPPO DEMETRA DI-CARLO DIVITA ESKA EUROVO FARMFRITES FERRERO FIAMMANTE FILIPPINI GALBANI GALBUSERA HAG ITALIAZUCCHERI LESAFFRE MAGGI MASTERMARTINI MEGGLE MENU MENZGASSER ARIX CONTITAL DECOR DIVERSEY ECOLAB LILLYCODROIPO LINERIT OKAY PACKSERVICE PAVONI'.split(' ');
  // giorno (0 = domenica) -> fasce orarie in minuti
  const HOURS = { 1: [[450, 720], [840, 1080]], 2: [[450, 720], [840, 1080]], 3: [[450, 720], [840, 1080]], 4: [[450, 720], [840, 1080]], 5: [[450, 720], [840, 1080]], 6: [[510, 720]], 0: [] };
  const DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

  /* ---------- menu mobile e barra ---------- */
  const nav = $('.nav'), burger = $('#burger'), menu = $('#menu');
  const setMenu = (open) => { document.body.classList.toggle('menu-open', open); burger.setAttribute('aria-expanded', String(open)); burger.setAttribute('aria-label', open ? 'Chiudi il menu' : 'Apri il menu'); };
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  const onScroll = () => nav.classList.toggle('solid', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // voce di menu attiva in base alla sezione visibile
  const links = [...menu.querySelectorAll('a[href^="#"]')];
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((a) => { const s = document.querySelector(a.getAttribute('href')); if (s) spy.observe(s); });
  }

  /* ---------- slideshow hero ---------- */
  const slides = [...document.querySelectorAll('#slides img')], dots = $('#dots');
  let cur = 0, timer;
  dots.innerHTML = slides.map((_, i) => `<button role="tab" aria-label="Immagine ${i + 1}" aria-selected="${i === 0}"></button>`).join('');
  const show = (i) => {
    slides[cur].classList.remove('on'); dots.children[cur].setAttribute('aria-selected', 'false');
    cur = (i + slides.length) % slides.length;
    slides[cur].classList.add('on'); dots.children[cur].setAttribute('aria-selected', 'true');
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = () => { clearInterval(timer); if (!reduce) timer = setInterval(() => show(cur + 1), 6000); };
  dots.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { show([...dots.children].indexOf(b)); start(); } });
  start();

  /* ---------- prodotti ---------- */
  const cards = $('#cards');
  const renderCards = (key) => {
    cards.innerHTML = CARDS[key].map(([t, d, img, q]) => `
      <a class="pcard" href="ordini.html#/catalogo?q=${encodeURIComponent(q)}">
        <div class="pimg"><img src="${UP + img}" alt="" loading="lazy"></div>
        <div class="pbody"><h3>${esc(t)}</h3><p>${esc(d)}</p><span>Vedi nel catalogo →</span></div>
      </a>`).join('');
    cards.className = 'cards ' + key;
  };
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderCards(b.dataset.tab);
  }));
  renderCards('food');

  /* ---------- partner ---------- */
  const row = PARTNERS.map((p) => `<img src="${UP}2020/10/${p}-500x500.jpg" alt="${esc(p.replace(/-/g, ' ').toLowerCase())}" loading="lazy" width="120" height="120">`).join('');
  $('#marquee').innerHTML = `<div class="track">${row}${row.replace(/alt="[^"]*"/g, 'alt="" aria-hidden="true"')}</div>`;

  /* ---------- news ---------- */
  $('#newsList').innerHTML = NEWS.map(([t, d, img, href, tag]) => `
    <a class="ncard reveal" href="${href}" target="_blank" rel="noopener">
      <div class="nimg"><img src="${UP + img}" alt="" loading="lazy"><span>${esc(tag)}</span></div>
      <div class="nbody"><time>${esc(d)}</time><h3>${esc(t)}</h3><span>Leggi ↗</span></div>
    </a>`).join('');

  /* ---------- orari ---------- */
  const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const today = new Date().getDay();
  $('#hours').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="${d === today ? 'today' : ''}"><dt>${DAYS[d]}</dt><dd>${HOURS[d].length ? HOURS[d].map(([a, b]) => fmt(a) + '–' + fmt(b)).join(' · ') : 'Chiuso'}</dd></div>`).join('');
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const isOpen = HOURS[today].some(([a, b]) => mins >= a && mins < b);
  const openEl = $('#openNow');
  openEl.textContent = isOpen ? 'Aperto ora' : 'Chiuso ora';
  openEl.classList.toggle('closed', !isOpen);
  $('#year').textContent = now.getFullYear();

  /* ---------- modulo contatti (prototipo: apre la posta) ---------- */
  $('#contactForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const body = `Nome: ${f.nome.value}\nAttività: ${f.attivita.value}\nEmail: ${f.email.value}\nTelefono: ${f.tel.value}\n\n${f.msg.value}`;
    window.location.href = `mailto:info@gherardi.so?subject=${encodeURIComponent('Richiesta informazioni dal sito')}&body=${encodeURIComponent(body)}`;
  });

  /* ---------- animazioni ---------- */
  const counters = document.querySelectorAll('[data-count]');
  const animate = (el) => {
    const to = +el.dataset.count, from = to > 1900 ? 1900 : 0, t0 = performance.now(), dur = 1200;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur), v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); el.textContent = to > 1900 ? v : v.toLocaleString('it-IT'); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); if (e.target.dataset.count) animate(e.target); io.unobserve(e.target); }
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    counters.forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }
})();
