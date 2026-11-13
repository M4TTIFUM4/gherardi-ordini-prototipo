// Motore di ricerca del catalogo.
// Priorità: 1) parola principale del nome  2) categoria merceologica
//           3) parola secondaria nel nome  4) descrizione.

const STOP = new Set(['di', 'da', 'de', 'del', 'della', 'dei', 'delle', 'dello', 'degli', 'per', 'con', 'al', 'alla', 'allo', 'ai', 'alle', 'agli', 'e', 'ed', 'in', 'il', 'la', 'lo', 'le', 'i', 'gli', 'un', 'una', 'a', 'x', 'su', 'd', 'l', 'c']);
// Dopo queste parole il termine è un complemento ("sugo PER pasta", "biscotti DI pasta frolla"),
// non il prodotto stesso.
const PREP = new Set(['per', 'di', 'da', 'con', 'al', 'alla', 'allo', 'ai', 'alle', 'agli', 'del', 'della', 'dei', 'delle', 'dello', 'degli', 'tipo', 'gusto', 'x', 'in', 'a', 'd', 'c']);
// Parole generiche che in testa al nome non sono il prodotto ("Mezze penne", "Mini croissant").
const WEAK_HEAD = new Set(['mezze', 'mezzi', 'mini', 'maxi', 'mix', 'gran', 'grande', 'piccoli', 'piccole', 'piccolini', 'le', 'il', 'la', 'i', 'gli', 'lo']);

export const TIER = { HEAD: 4, CAT: 3, NAME: 2, DESC: 1 };
const W = { CODE: 2000, HEAD: 1000, HEAD_IN_CAT: 200, LINE: 700, SECTOR: 660, FAMILY: 630, NAME: 520, MOD: 340, DESC: 100 };

export function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
const toks = (s) => { const n = norm(s); return n ? n.split(' ') : []; };

// Varianti singolare/plurale italiane (pasta↔paste, pomodoro↔pomodori, olio↔oli, fungo↔funghi).
function variants(w) {
  const v = new Set();
  if (w.length < 3 || /\d/.test(w)) return v;
  const b = w.slice(0, -1), l = w[w.length - 1];
  if (l === 'a') {
    if (/[cg]$/.test(b)) v.add(b + 'he');
    else if (/[cg]i$/.test(b)) { v.add(b.slice(0, -1) + 'e'); v.add(b + 'e'); }
    else v.add(b + 'e');
  } else if (l === 'o') {
    if (/[cg]$/.test(b)) { v.add(b + 'hi'); v.add(b + 'i'); }
    else if (b.endsWith('i')) v.add(b);
    else v.add(b + 'i');
  } else if (l === 'e') {
    v.add(b + 'i');
    if (/[cg]h$/.test(b)) v.add(b.slice(0, -1) + 'a');
    else if (/[cg]$/.test(b)) v.add(b + 'ia');
    else v.add(b + 'a');
  } else if (l === 'i') {
    v.add(b + 'e');
    if (/[cg]h$/.test(b)) v.add(b.slice(0, -1) + 'o');
    else { v.add(b + 'o'); v.add(b + 'io'); }
  }
  return v;
}
const IRREGULAR = { uovo: 'uova', uova: 'uovo' };

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Qualità della corrispondenza fra un termine cercato e una parola: 0 = nessuna.
function matchQ(q, word, fuzzy) {
  if (q.t === word) return 1;
  if (q.vars.has(word)) return 0.95;
  if (q.t.length >= 2 && word.startsWith(q.t)) return q.t.length >= 3 ? 0.8 : 0.6;
  if (fuzzy && q.t.length >= 4 && word.length >= 4) {
    const max = q.t.length >= 8 ? 2 : 1;
    if (editDistance(q.t, word, max) <= max) return 0.5;
  }
  return 0;
}

function buildQuery(text) {
  let all = toks(text);
  let t = all.filter((w) => !STOP.has(w));
  if (!t.length) t = all;
  return t.map((w) => {
    const vars = variants(w);
    if (IRREGULAR[w]) vars.add(IRREGULAR[w]);
    return { t: w, vars };
  });
}

export function buildIndex(products, lines) {
  const lineById = new Map(), sectorById = new Map();
  for (const l of lines) {
    lineById.set(l.id, { ...l, toks: toks(l.name).filter((w) => !STOP.has(w)) });
    for (const s of l.sectors) sectorById.set(s.id, { ...s, line: l.id, toks: toks(s.name).filter((w) => !STOP.has(w)) });
  }
  const docs = products.map((p) => {
    const raw = toks(p.n);
    const name = [];
    let pos = 0, afterPrep = false, headSet = false;
    for (const w of raw) {
      if (STOP.has(w)) { if (PREP.has(w)) afterPrep = true; continue; }
      let kind = afterPrep ? 'mod' : 'word';
      if (!headSet && !afterPrep && !WEAK_HEAD.has(w)) { kind = 'head'; headSet = true; }
      name.push({ w, kind, pos });
      pos++;
      afterPrep = PREP.has(w);
    }
    return {
      p,
      code: norm(p.c).replace(/ /g, ''),
      name,
      line: lineById.get(p.l).toks,
      sector: sectorById.get(p.s).toks,
      family: p.f ? toks(p.f).filter((w) => !STOP.has(w)) : [],
      desc: p.d ? new Set(toks(p.d)) : null,
    };
  });
  return { docs, lineById, sectorById };
}

function scoreToken(q, doc, fuzzy) {
  let best = 0, tier = 0, nameHit = -1, headHit = false, catHit = false;
  const take = (s, t) => { if (s > best) { best = s; tier = t; } };

  if (/\d/.test(q.t) || q.t.length >= 4) {
    if (doc.code === q.t) take(W.CODE, TIER.HEAD);
    else if (q.t.length >= 3 && doc.code.startsWith(q.t)) take(900, TIER.HEAD);
  }
  for (const n of doc.name) {
    const m = matchQ(q, n.w, fuzzy);
    if (!m) continue;
    if (n.kind === 'head') { take(W.HEAD * m, TIER.HEAD); headHit = true; }
    else if (n.kind === 'mod') take(W.MOD * m, TIER.NAME);
    else take(Math.max(400, W.NAME - 20 * n.pos) * m, TIER.NAME);
    if (nameHit < 0) nameHit = n.pos;
  }
  for (const [field, weight] of [[doc.line, W.LINE], [doc.sector, W.SECTOR], [doc.family, W.FAMILY]]) {
    for (const w of field) {
      const m = matchQ(q, w, false);
      if (m >= 0.8) { take(weight * m, TIER.CAT); catHit = true; }
    }
  }
  if (headHit && catHit) best += W.HEAD_IN_CAT;
  if (!best && doc.desc) {
    for (const w of doc.desc) {
      const m = matchQ(q, w, false);
      if (m >= 0.95 || (m && q.t.length >= 4)) { take(W.DESC * m, TIER.DESC); break; }
    }
  }
  return { score: best, tier, nameHit };
}

/**
 * Cerca nel catalogo. Tutti i termini devono trovare riscontro (AND).
 * Ritorna { results:[{p, score, tier}], fuzzy, categories:[{type,id,name,n,line}] }.
 */
export function search(index, text) {
  const query = buildQuery(text);
  if (!query.length) return { results: [], fuzzy: false, categories: [], terms: [] };

  const run = (fuzzy) => {
    const out = [];
    for (const doc of index.docs) {
      let total = 0, maxTier = 0, minTier = 9, ok = true;
      const hits = [];
      for (const q of query) {
        const r = scoreToken(q, doc, fuzzy);
        if (!r.score) { ok = false; break; }
        total += r.score;
        if (r.tier > maxTier) maxTier = r.tier;
        if (r.tier < minTier) minTier = r.tier;
        hits.push(r.nameHit);
      }
      if (!ok) continue;
      let score = total / query.length;
      // Bonus se i termini compaiono vicini e in ordine nel nome ("penne rigate").
      if (query.length > 1 && hits.every((h, i) => h >= 0 && (i === 0 || h === hits[i - 1] + 1))) score += 80;
      const tier = minTier === TIER.DESC && maxTier < TIER.HEAD ? TIER.DESC : maxTier;
      out.push({ p: doc.p, score, tier, len: doc.name.length });
    }
    return out;
  };

  let results = run(false), fuzzy = false;
  if (!results.length) { results = run(true); fuzzy = results.length > 0; }
  // Categorie il cui nome corrisponde alla ricerca: proposte come scorciatoia.
  const categories = [];
  const primary = new Set(); // categorie che parlano proprio di ciò che si cerca ("Pasta", "Oli e Aceti")
  const catMatch = (t) => query.every((q) => t.some((w) => matchQ(q, w, false) >= 0.8));
  const isPrimary = (t) => t.length && matchQ(query[0], t[0], false) >= 0.95;
  for (const l of index.lineById.values()) {
    if (!catMatch(l.toks)) continue;
    categories.push({ type: 'line', id: l.id, name: l.name, n: l.n });
    if (isPrimary(l.toks)) primary.add(l.id);
  }
  for (const s of index.sectorById.values()) {
    if (!catMatch(s.toks)) continue;
    categories.push({ type: 'sector', id: s.id, line: s.line, name: s.name, n: s.n, parent: index.lineById.get(s.line).name });
    if (isPrimary(s.toks)) primary.add(s.id);
  }
  // Se esiste una categoria dedicata, un omonimo di un altro reparto ("Pasta di acciughe",
  // "Pesce" taglio di carne) non deve scavalcare i prodotti della categoria.
  if (primary.size) {
    for (const r of results) {
      if (r.tier === TIER.HEAD && r.score < 1500 && !primary.has(r.p.l) && !primary.has(r.p.s)) { r.tier = TIER.NAME; r.score = 650; }
    }
  }
  results.sort((a, b) => b.tier - a.tier || b.score - a.score || (a.p.ord || 0) - (b.p.ord || 0) || a.p.n.localeCompare(b.p.n, 'it'));
  return { results, fuzzy, categories: categories.slice(0, 6), terms: query.map((q) => q.t) };
}

// Evidenzia nel nome le parole che corrispondono ai termini cercati.
export function highlight(name, terms, esc) {
  if (!terms || !terms.length) return esc(name);
  return name.split(/(\s+)/).map((part) => {
    const n = norm(part);
    if (!n) return esc(part);
    const hit = terms.some((t) => n === t || n.startsWith(t) || variants(t).has(n));
    return hit ? `<mark>${esc(part)}</mark>` : esc(part);
  }).join('');
}
