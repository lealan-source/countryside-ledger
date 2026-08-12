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

1. Drop the new vendor sheet(s) into `Price Sheets/`. **Filenames don't
   matter** — the importer identifies each vendor by what's inside the
   workbook. Denver Wholesale invoices go in `Price Sheets/Denver Wholesale/`.
   New product photos go under `Product Images/<Vendor>/` — the importer
   matches them by the SKU at the start of each filename.
2. Double-click **`Update Prices.cmd`** (or in `tools/`: `npm run update`).
   It rebuilds the catalog, checks the numbers, shows what changed, and asks
   before publishing. Saying yes bumps `sw.js`, commits, and pushes.

That's the whole weekly job. Or just ask Claude to do it.

### What the checks catch

A vendor who renames a tab or moves a column doesn't crash the importer — it
quietly yields fewer items or wrong prices, and the store orders on them. So
before writing the catalog, the importer compares against the one it's about
to replace and **stops** if a vendor lost more than 10% of its items, or
vanished entirely. It warns (but continues) about sheets that haven't changed
since last time, prices that moved more than 25%, and items that disappeared.

If a big change is genuine, re-run with `npm run import -- --force` (or
`npm run update -- --force`).

### Price freshness

`data/catalog.json` carries a date per vendor — file date for the four price
sheets, newest invoice date for Denver Wholesale, whose prices are only as
current as the last time we ordered the item. Any vendor 30+ days behind is
named in red on the ticket, so a stale number never looks as current as the
rest. The headline "prices refreshed" date is the *freshest sheet*, not the
day you rebuilt — rebuilding old sheets must not make the app claim today's
prices.

`npm run import` alone rebuilds without publishing.

Vendor sheet quirks the importer handles: Dutch Valley's price book gives
per-lb prices directly on bulk rows; Gateway's `LB/Qty` column is pounds for
bulk foods but unit-counts for supplies; Walnut Creek's list price is per
pound; Frontier prices per each with case counts. Cross-vendor comparison on
the ticket is a runtime closest-match by name — each row shows the matched
item and its match %, so check pack sizes before ordering.

## Moving the project to another PC

The app itself needs nothing — install it from the URL above. These steps are
for the *project* folder, so the other PC can re-import prices and be worked on
with Claude Code.

1. Install [Git](https://git-scm.com) and [Node.js](https://nodejs.org) (LTS).
2. Clone into Documents:
   `git clone https://github.com/lealan-source/countryside-ledger.git "%USERPROFILE%\Documents\Country Ledger"`
   That brings the app, the catalog, all 18k thumbnails, and the tools.
3. Copy the two folders git deliberately leaves behind — `Price Sheets/`
   (a few MB, needed to re-import) and, only if you'll add new product photos,
   `Product Images/` (~3 GB). USB drive or OneDrive both work.
4. In `tools/`: `npm install`.
5. Run `tools/install-shortcuts.cmd` for the Start Menu / Desktop icon.
6. Optional, for free photo search on that PC:
   `npm install -g @anthropic-ai/claude-code`, run `claude` once, `/login`.

Every path in the tools is derived from the project folder, so the username and
location don't matter. Rebuilding without `Product Images/` is safe — existing
thumbnails are kept rather than dropped.

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
