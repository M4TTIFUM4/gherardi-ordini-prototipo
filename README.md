# Gherardi · Area ordini (prototipo)

Restyling del portale B2B `ordini.gherardi.so`: web app statica, senza dipendenze, con dati locali.

## Avvio

Doppio clic su `avvia.bat` (richiede Python), oppure:

```bash
python -m http.server 5173 --bind 127.0.0.1
```

Poi apri <http://localhost:5173/> e accedi con `admin` / `admin`.

## Cosa contiene

| Percorso | Contenuto |
| --- | --- |
| `index.html` | Pagina unica dell'app |
| `css/style.css` | Grafica responsive (desktop, tablet, mobile) |
| `js/app.js` | Login, catalogo, filtri, carrello, storico ordini |
| `js/search.js` | Motore di ricerca con priorità nome → categoria → descrizione |
| `data/catalog.json` | Catalogo locale: 2.955 prodotti, 21 linee, 84 settori |

## Dati

- Il catalogo è una copia locale dell'assortimento, estratta in sola lettura il 13/11/2026. I prezzi sono quelli del listino dell'utente usato per l'analisi.
- Le foto prodotto sono caricate dal portale attuale (`ordini.gherardi.so/files/img_art/`); senza rete compare un'icona di categoria.
- Carrello e ordini restano nel browser (`localStorage`). **Nessun ordine viene trasmesso a Gherardi.**

## Ricerca

Ogni termine cercato viene valutato su quattro livelli, in quest'ordine:

1. **Parola principale del nome** (es. «Penne rigate Barilla» per `penne`) e codice articolo.
2. **Categoria merceologica**: tutti i prodotti della linea/settore corrispondente (es. linea Pasta per `pasta`).
3. **Parola secondaria nel nome**: «Brodo pasta carne», «Sugo per pasta».
4. **Descrizione**.

In più: singolari/plurali italiani (`pomodoro` ↔ `pomodori`), ricerca per prefisso mentre si digita, tolleranza ai refusi (`spagheti`), più parole in AND (`farina 00`).

## Da fare per la versione reale

- Autenticazione vera lato server (qui il controllo è nel browser, solo dimostrativo).
- Collegamento al gestionale per listini per cliente, disponibilità, invio ordini, storico.
- Panieri tematici del portale attuale (Hotel, Pizzeria, Gastronomia, Pasticceria, Senza glutine) e promozioni con date.
