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

### Sales and price history

None of the five vendors mark sales on their sheets — Dutch Valley's `BREAK`
and Walnut Creek's `1 CS / 10 CS` are volume tiers, not sales. So a sale is
worked out from the item's own history: `data/history.json` records a price
point every time a price actually *moves*, and anything now selling at 10% or
more under the median of its last five recorded prices is flagged **ON SALE**,
with its usual price shown struck through.

This only looks forward. The first build lays down a baseline and can't show
any sales; the picture fills in as prices move. It also decays correctly — once
a lower price becomes the norm, the median follows it down and the flag clears.

History is deliberately **not** seeded from git. The stored catalogs are all
the same July prices and differ only by code changes, so replaying them would
invent enormous fake sales.

Opening any item shows its price history — a chart plus every recorded price
with the change between them. `history.json` is ~107 KB gzipped and isn't
precached, so it's fetched the first time someone opens an item and cached from
then on; the app works normally without it.

`Price Changes.md` is rewritten each build: what moved, by how much, per
vendor, plus everything currently on sale.

Vendor sheet quirks the importer handles: Dutch Valley's price book gives
per-lb prices directly on bulk rows; Gateway's `LB/Qty` column is pounds for
bulk foods but unit-counts for supplies; Walnut Creek's list price is per
pound; Frontier prices per each with case counts. Cross-vendor comparison on
the ticket is a runtime closest-match by name — each row shows the matched
item and its match %, so check pack sizes before ordering.

## The dev copy

A full second copy of the app lives in `dev/` and publishes alongside the real
one at **https://lealan-source.github.io/countryside-ledger/dev/** — install it
on the phone and it appears as a separate app, "Ledger DEV". Break it as much
as you like; the live price book is untouched.

| | |
| --- | --- |
| `npm run dev` | Create or update the dev copy (never overwrites your dev edits) |
| `npm run dev -- --reset` | Throw away dev's code changes, re-copy from live |
| `npm run dev:data` | Refresh dev's catalog + history from live |
| `npm run promote` | Copy dev's code over the live app, ready to publish |

**dev keeps its own catalog** (3.4 MB), so changing the data format there can't
break the live app. It **shares** the 173 MB of thumbnails through a `../images/`
path that `index.html` works out at runtime — which is also why `index.html` and
`sw.js` are byte-identical in both copies, making promotion a plain file copy.

### Why the service worker namespaces its caches

Cache storage is per-**origin**, not per-folder, and the old service worker
deleted every cache that wasn't its own. Both copies live on
`lealan-source.github.io`, so opening the dev app would have wiped the live
app's offline cache — the ledger would then have failed in the aisles with no
signal. Each copy now prefixes its caches (`csl-live-` / `csl-dev-`, deliberately
not prefixes of each other) and only ever cleans up its own.

`Update Prices.cmd` publishes the live app only; dev's data is refreshed
explicitly with `npm run dev:data`.

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
