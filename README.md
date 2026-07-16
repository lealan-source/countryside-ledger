# Countryside Ledger

Countryside Market's own price book — photograph or search an item and compare
wholesale prices per pound across four distributors (Dutch Valley, Gateway,
Walnut Creek, Frontier). Built from the Claude Design redesign spec
(“Countryside Ledger Redesign.dc.html”): ledger paper, thin black rules,
condensed black caps, and red ink marking the numbers that matter.

**Live app:** https://lealan-source.github.io/countryside-ledger/

## Using it

- **Phone (Android):** open the hosted URL in Chrome → menu (⋮) → **Add to
  Home screen / Install app**. It installs like a real app and keeps working
  with no signal in the aisles (the app shell is cached offline).
- **PC (Windows):** open the hosted URL in Edge or Chrome → **Install
  Countryside Ledger** (icon in the address bar), or use the Start Menu
  shortcut. It runs in its own window with the wheat icon.

## What's in here

| File | Purpose |
| --- | --- |
| `index.html` | The app — markup, styles, and logic |
| `data/catalog.json` | The catalog: 20k+ items built from the four price sheets |
| `images/` | Product thumbnails (320px webp), named `images/<vendor>/<sku>.webp` |
| `sw.js` | Service worker: precaches the app shell + catalog so it opens offline |
| `manifest.webmanifest` | Install metadata (name, colors, icons) |
| `icons/` | App icons generated from the brand favicon |
| `brand-assets/` | Source brand art (wheat divider, favicon, wheat vector) |
| `tools/` | Importer: price sheets + product images → catalog + thumbnails |
| `Price Sheets/`, `Product Images/` | Source data — stays on this PC, never published |

## Updating prices

1. Drop the new vendor sheet(s) into `Price Sheets/` (same filenames:
   `Dutch Valley.xls`, `Frontier.xlsx`, `Gateway.xlsx`, `Walnut Creek.xlsx`).
   New product photos go under `Product Images/<Vendor>/` — the importer
   matches them by the SKU at the start of each filename.
2. In `tools/`: `npm install` (first time only), then `npm run import`.
   This rebuilds `data/catalog.json` and adds any missing thumbnails.
3. Bump `VERSION` in `sw.js` (e.g. `v2` → `v3`) so installed apps pick up
   the change, then commit and push — GitHub Pages redeploys automatically.

Or just ask Claude to do it.

Vendor sheet quirks the importer handles: Dutch Valley's price book gives
per-lb prices directly on bulk rows; Gateway's `LB/Qty` column is pounds for
bulk foods but unit-counts for supplies; Walnut Creek's list price is per
pound; Frontier prices per each with case counts. Cross-vendor comparison on
the ticket is a runtime closest-match by name — each row shows the matched
item and its match %, so check pack sizes before ordering.

## Photo search

The model only *reads the label* (returning `{product, details,
search_query, core_query}`, ignoring barcodes — they're the store's own
scale-label codes); the app's search engine does the matching, retrying
with the broader `core_query` when the specific match lands weak.

- **Office PC** — free. The app posts the photo to a local helper
  (`tools/photo-bridge.js`, port 8474) which asks Claude Code, signed in
  with the store's regular Claude subscription. The **Countryside Ledger**
  Start Menu / Desktop shortcut runs `tools/ledger-pc.vbs`, which starts
  the helper and opens the app. One-time setup on a new PC:
  `npm install -g @anthropic-ai/claude-code`, run `claude` once, `/login`.
- **Phone** — via API key. Price lists › → API KEY, paste a key from
  console.anthropic.com. The photo goes straight to Claude
  (claude-haiku-4-5, image downscaled to ≤1568px) — roughly a quarter of a
  cent per photo. The key is stored only on that device.

## Design source

Redesign spec and brief live in the Claude Design project
“Countryside Ledger redesign” (claude.ai/design). Design tokens are the CSS
custom properties in `:root` of `index.html` — every color, font, and knob
(`--row-pad`, `--stamp-rot`) comes from the spec's token sheet.
