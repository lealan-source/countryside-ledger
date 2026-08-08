# Handoff — Countryside Ledger

Paste the text below into a new Claude Code chat on this PC to pick up the
project, or just say: **"Read HANDOFF.md and get up to speed."**

---

I'm Caleb — I run Countryside Market, a bulk food store in Kirksville, Missouri.
I'm not a developer, so please explain things in plain language. This project is
the **Countryside Ledger**, our internal price-comparison app. I just moved it to
this PC from my old one, so you're picking up where the last Claude Code session
left off.

**What it does:** photograph or search an item, see what it costs across our five
distributors, and build per-vendor order sheets while walking inventory.

- Live app: https://lealan-source.github.io/countryside-ledger/
- Public repo `lealan-source/countryside-ledger` — GitHub Pages redeploys on push to `main`
- Installed as an app on my phone and my PCs
- Project folder: `Documents\Country Ledger`

**How it's put together** (no framework, no build step):

| File | What it is |
| --- | --- |
| `index.html` | The entire app — markup, styles, logic |
| `search.js` | Search engine (`LedgerSearch`), also loaded by the tests |
| `sw.js` | Service worker — **bump `VERSION` on every deploy** (at v22) or installed apps won't update |
| `data/catalog.json` | 20,745 items across 5 vendors — generated, don't hand-edit |
| `tools/build.js` | Importer: price sheets → catalog. Every vendor's format differs; Denver Wholesale is built from invoices |
| `tools/thumbs.js` | Product thumbnails |
| `tools/search-tests.js` | 29 regression tests, each one a real bug reported from the aisles |
| `Price Sheets/`, `Product Images/` | Source data, ~3 GB, gitignored — only on this PC and my external drive |

**Three rules that matter:**

1. Run `node tools/search-tests.js` after touching search or the catalog — all 29 must pass.
2. Bump `VERSION` in `sw.js` on every deploy.
3. Never commit `Price Sheets/` or `Product Images/`. The repo is public and the
   Denver Wholesale invoices carry my account number and the store's address.

**Where things stand — two things are unfinished:**

1. **Order-sheet sending between my phone and PC is built but never tested end to
   end.** It uses a private GitHub repo called `countryside-orders` as a mailbox.
   Create that repo **by hand, once** — empty and private. The app no longer tries
   to create it: a fine-grained token scoped to one repo can't create repos, so the
   old self-provisioning path could never have worked with the token the app asks
   for. Then make ONE fine-grained token (repo access: only `countryside-orders`,
   permission: Contents read & write) and paste it on both devices under
   **Price lists ›**. Needs verifying: send from the phone, import on the PC,
   confirm the mailbox file is deleted afterward.
2. **The old PC still has a full copy of the project** and needs to be cleaned out
   once this PC is confirmed working.

**If this PC isn't set up yet:** `cd tools` then `npm install`; run
`tools\install-shortcuts.cmd` for the Start Menu icon; for free photo search,
`npm install -g @anthropic-ai/claude-code`, then run `claude` once and `/login`.
Inside the app under **Price lists ›**, paste my Anthropic API key and GitHub
token — those live per-device and didn't come across with the files.

`README.md` has the rest: how price updates work, how photo search is wired, and
the vendor-by-vendor quirks the importer handles.
