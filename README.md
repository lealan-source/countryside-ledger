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
| `index.html` | The entire app — markup, styles, data, and logic in one file |
| `sw.js` | Service worker: precaches the app shell so it opens offline |
| `manifest.webmanifest` | Install metadata (name, colors, icons) |
| `icons/` | App icons generated from the brand wheat mark |
| `brand-assets/` | Source brand art (wheat divider, favicon, wheat vector) |

## Updating prices

All data lives in the `CATALOG` array near the top of the `<script>` in
`index.html` — one entry per product, one offer per vendor with `sku`, net
weight `lb`, case `price`, `pack` label, `bulk` flag, and `stock`
(`in` / `low` / `out`). Per-pound math, best-price stamps, and confidence
badges all derive from it.

After any edit, bump `VERSION` in `sw.js` (e.g. `v1` → `v2`) so installed
apps pick up the change, then commit and push — GitHub Pages redeploys
automatically.

## Photo matching

`identifyPhoto()` in `index.html` is a stub that matches on the photo's
filename and falls back to a demo item — it is the single seam where a real
vision API call would plug in. Everything downstream (loading state, ticket,
toast) already works.

## Design source

Redesign spec and brief live in the Claude Design project
“Countryside Ledger redesign” (claude.ai/design). Design tokens are the CSS
custom properties in `:root` of `index.html` — every color, font, and knob
(`--row-pad`, `--stamp-rot`) comes from the spec's token sheet.
