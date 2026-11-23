"""Genera data/palmare.json per la demo del palmare di magazzino.

Prende 100 prodotti dal catalogo locale (data/catalog.json) e aggiunge:
EAN (reale se il codice articolo lo è, altrimenti interno con prefisso 20),
codice PLU per gli articoli a peso variabile (etichette EAN 21 + PLU + peso),
ubicazione in magazzino, lotti con scadenza, giacenza e 3 ordini di prova.

Uso: python tools/genera_palmare.py
"""
import json
import random
import re

random.seed(1977)
cat = json.load(open('data/catalog.json', encoding='utf-8'))
LINE = {l['id']: l['name'] for l in cat['lines']}
SECT = {s['id']: s['name'] for l in cat['lines'] for s in l['sectors']}
P = [p for p in cat['products'] if p.get('img') and not p.get('ord')]


def ean_check(d12):
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(d12))
    return str((10 - s % 10) % 10)


def valid_ean13(c):
    return bool(re.fullmatch(r'\d{13}', c)) and ean_check(c[:12]) == c[12] and c[0] != '2'


VAR_LINES = {'Carni Fresche', 'Salumi', 'Latticini', 'Pesce'}


def is_var(p):
    return p['um'] == 'KG' and LINE[p['l']] in VAR_LINES and ('P' in p['u'] or p['du'] == 'K')


def pick(pool, n):
    pool = sorted(pool, key=lambda p: p['n'])
    if len(pool) <= n:
        return pool
    step = len(pool) / n
    return [pool[int(i * step)] for i in range(n)]


chosen, seen = [], set()


def add(items):
    for p in items:
        if p['c'] not in seen and len(chosen) < 100:
            seen.add(p['c'])
            chosen.append(p)


var = [p for p in P if is_var(p)]
for line, n in [('Carni Fresche', 8), ('Salumi', 6), ('Latticini', 4)]:
    add(pick([p for p in var if LINE[p['l']] == line], n))
fixed = [p for p in P if not is_var(p)]
add(pick([p for p in fixed if valid_ean13(p['c'])], 8))  # alcuni con EAN reale del produttore
QUOTA = [('Pasta', 8), ('Conserve', 8), ('Oli e Aceti', 5), ('Farine', 6), ('Latticini', 6), ('Dolci e Preparati', 6),
         ('Drogheria Alimentare', 6), ('Bevande', 5), ('Uova e Ovoprodotti', 3), ('Riso, Cereali e Legumi Secchi', 3),
         ('Frutta Secca', 3), ('Pane e Sostitutivi', 3), ('Grassi Vegetali e Animali', 2), ('Pesce', 3),
         ('Monouso', 6), ('Igiene e Pulizia', 6), ('Attrezzature Professionali', 3)]
for line, n in QUOTA:
    add(pick([p for p in fixed if LINE[p['l']] == line], n))
add([p for p in fixed if valid_ean13(p['c'])])
add(fixed)

FRESH = {'Carni Fresche': (4, 12), 'Pesce': (8, 30), 'Latticini': (8, 55), 'Salumi': (25, 90), 'Uova e Ovoprodotti': (10, 28)}
NOFOOD = {'Monouso', 'Igiene e Pulizia', 'Attrezzature Professionali', 'Legna da Ardere'}
ZONE = {'Carni Fresche': 'F1', 'Salumi': 'F2', 'Latticini': 'F3', 'Uova e Ovoprodotti': 'F3', 'Pesce': 'F4',
        'Pasta': 'A1', 'Riso, Cereali e Legumi Secchi': 'A1', 'Farine': 'A2', 'Conserve': 'A3', 'Oli e Aceti': 'A4',
        'Grassi Vegetali e Animali': 'A4', 'Drogheria Alimentare': 'A5', 'Dolci e Preparati': 'A6', 'Frutta Secca': 'A6',
        'Pane e Sostitutivi': 'A7', 'Bevande': 'B1', 'Monouso': 'N1', 'Igiene e Pulizia': 'N2', 'Attrezzature Professionali': 'N3'}


def avg_weight(p):
    m = re.search(r'kg\s*(\d+(?:[.,]\d+)?)', p['n'], re.I)
    if m:
        return round(float(m.group(1).replace(',', '.')), 2)
    m = re.search(r'(\d{3,4})\s*g\b', p['n'], re.I)
    if m:
        return round(int(m.group(1)) / 1000, 2)
    return {'Carni Fresche': 3.2, 'Salumi': 2.6, 'Latticini': 1.8, 'Pesce': 1.2}[LINE[p['l']]]


out, plu, slot = [], 10001, {}
for p in chosen:
    line = LINE[p['l']]
    o = {'c': p['c'], 'n': ' '.join(p['n'].split()), 'img': p['img'], 'line': line, 'sector': SECT[p['s']],
         'u': p['u'], 'du': p['du'], 'cc': p['cc']}
    if valid_ean13(p['c']):
        o['ean'], o['realEan'] = p['c'], 1
    else:
        d12 = '20' + str(random.randint(10**9, 10**10 - 1))
        o['ean'] = d12 + ean_check(d12)
    if is_var(p):
        o['var'], o['plu'], o['avg'] = 1, str(plu), avg_weight(p)
        plu += 1
    z = ZONE.get(line, 'A8')
    slot[z] = slot.get(z, 0) + 1
    o['loc'] = f"{z}-{(slot[z] + 1) // 2:02d}-{'AB'[slot[z] % 2]}"
    if z.startswith('F'):
        o['cold'] = 1
    if line not in NOFOOD:
        lo, hi = FRESH.get(line, (90, 540))
        o['perish'] = 'F' if line in FRESH else 'S'
        lots, d = [], random.randint(lo, hi)
        for _ in range(random.randint(1, 3)):
            lots.append({'lot': f"L{random.randint(100, 999)}{chr(65 + random.randint(0, 25))}", 'd': d, 'q': random.randint(4, 40)})
            d += random.randint(max(2, (hi - lo) // 4), max(3, hi - lo))
        o['lots'] = lots
    o['stock'] = random.randint(12, 160)
    if p.get('d'):
        o['desc'] = p['d']
    out.append(o)

by = {o['c']: o for o in out}
customers = [
    {'id': 'POM', 'name': 'Pompucci', 'minF': 3, 'minS': 30, 'giro': 'Giro 1 · mattino', 'color': '#c8201a'},
    {'id': 'TIG', 'name': 'I Tigli', 'minF': 5, 'minS': 30, 'giro': 'Giro 2 · mattino', 'color': '#1d7a46'},
    {'id': 'TIN', 'name': 'Tinello', 'minF': 7, 'minS': 45, 'giro': 'Giro 3 · pomeriggio', 'color': '#9a5b00'},
]
NOTES = ['', 'Consegnare dal retro', 'Chiamare 10 minuti prima dell\'arrivo']
orders = []
for i, cu in enumerate(customers):
    used, lines = set(), []

    def put(o):
        used.add(o['c'])
        if o.get('var'):
            unit = 'P' if 'P' in o['u'] else 'K'
            q = random.randint(1, 3) if unit == 'P' else round(o['avg'] * random.choice([1, 2, 3]), 1)
        else:
            unit = next((k for k in 'CLP' if k in o['u']), next(iter(o['u'])))
            q = random.choice([1, 2, 2, 3, 4, 6])
        lines.append({'c': o['c'], 'qty': q, 'unit': unit})

    for o in random.sample([o for o in out if o.get('var')], 4):
        put(o)
    # un fresco con il lotto più vecchio sotto il residuo minimo richiesto dal cliente
    near = next(o for o in out if o.get('perish') == 'F' and not o.get('var') and o['c'] not in used
                and all(o['c'] not in [l['c'] for l in od['lines']] for od in orders))
    near['lots'][0]['d'] = cu['minF'] - 1
    if len(near['lots']) == 1:
        near['lots'].append({'lot': f"L{random.randint(100, 999)}Z", 'd': cu['minF'] + 9, 'q': 20})
    put(near)
    for o in random.sample([o for o in out if not o.get('var') and o['c'] not in used], 8):
        put(o)
    if cu['id'] == 'TIN':  # articolo esaurito per mostrare la gestione del mancante
        by[lines[-1]['c']]['stock'] = 0
    orders.append({'id': f"OV-26-{4120 + i * 7}", 'cust': cu['id'], 'note': NOTES[i], 'lines': lines})

json.dump({'generated': '2026-11-23', 'imgBase': 'https://ordini.gherardi.so/files/img_art/',
           'customers': customers, 'products': out, 'orders': orders},
          open('data/palmare.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'prodotti,', sum(1 for o in out if o.get('var')), 'a peso variabile,',
      sum(1 for o in out if o.get('realEan')), 'EAN reali,', sum(1 for o in out if 'lots' in o), 'con scadenza')
for o in orders:
    print(o['id'], o['cust'], len(o['lines']), [(by[l['c']]['n'][:30], l['qty'], l['unit']) for l in o['lines']])
