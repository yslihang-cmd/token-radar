[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yslihang-cmd/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yslihang-cmd/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar

A launch radar for protocols that still have no token of their own. It reads a sealed DefiLlama
protocol snapshot, scores every pre-token protocol with a fully stated arithmetic model, and
writes a ranked board, a static dashboard, and the dossier the judge reads. No network, no
credentials, no build step: every byte the dashboard shows is generated and shipped beside it.

The question it answers is the one a trader actually asks: *of the protocols that have not issued
a token yet, which are worth preparing for, and what should I do about each one?* So every row
carries both halves of an answer — what a launch would be worth, and the concrete steps to farm
it.

## Run it

```sh
node main.ts --input input/snapshot.json --output out
```

`--input` takes either the snapshot file or a directory holding `snapshot.json`; it defaults to
`/input`, which is where the competition mounts its sealed copy. `--output` defaults to
`/output`, or to `MAKEFUN_OUTPUT_DIR` if that is set.

Writes to `out/`:

- `board.json` — the ranked board, one entry per pre-token protocol, sorted by implied value
- `data.js` — `window.RADAR`, the same data the dashboard reads; no fetch, no API
- `dashboard/` — static dashboard (`index.html`, `app.css`, `app.js`), open in any browser
- `screenshots/` — three frames: the board, a protocol's detail view, a filtered view
- `dossier.json` — the summary the judge reads: the screenshots plus the page's own source

The program refuses to write a bundle it can see is broken: too few screenshots, a frame outside
the size band the rules ask for, a dashboard file with a name the dossier refuses, or a source
file that names a network address. A failure here is a failure there, so it fails early and
loudly instead.

Then validate locally:

```sh
node tools/check-gate.mjs out input/snapshot.json
```

Eight checks: board file, sort order, coverage, farm steps, the page agreeing with the board,
dashboard files, screenshots, dossier.

The page-agreement check runs the dashboard's own JavaScript and compares what it renders against
what `board.json` carries — the implied values and every farm step, byte for byte. It also
re-runs the model over the sealed snapshot and compares that against the board, so a
`board.json` left over from an earlier snapshot cannot pass. The same comparison on its own:

```sh
node tools/check-parity.mjs out input/snapshot.json
```

Regenerate screenshots (requires a running Chrome/Chromium with a debug port, or the script's own
headless instance):

```sh
bash tools/screenshots.sh out screenshots
```

The frames are 1440×1440 PNGs. Regenerate them **after** the last `main.ts` run, because
`main.ts` copies `screenshots/` into `out/` — screenshots taken against an older build would
otherwise ship stale.

The snapshot itself is not in this repository: it is the competition's input. To build one
locally, `node tools/fetch-snapshot.mjs` writes the same shape from DefiLlama's public endpoint.

## The model

Every protocol on the board gets an implied value — what a launch would be worth if the
protocol's record stayed as it is. The model has four factors, all read out of the snapshot
itself. The page names the version it runs (`radar-3`), and the dashboard recomputes the same
arithmetic in the browser so a reader can check any number against the figures it came from:

```
implied = max(1, round(anchor × size × growth × maturity))
```

1. **Anchor** — the constant that converts a protocol's size into what its category's already
   trading peers command. It starts as the median of one observation per live peer:

   ```
   observation = market_cap_usd / tvl_usd ** size_exponent
   ```

   Two things keep that median honest:

   - A live peer whose market cap the snapshot records as zero or negative is not a priced peer —
     the field is simply not filled in — so it contributes no observation at all. Including it
     would drag a category's median toward zero and read as "this category is worth nothing". A
     peer with no TVL cannot be divided, so it is left out for the same reason.
   - The observations are worked **on the logarithm**, because they span six orders of magnitude
     across the snapshot (0.03 to about 20,000). A median taken in linear space is pulled by
     whichever peers sit at the top, and so is the blend below.

   The category's median is then **blended with the all-category median** in proportion to how
   many live peers it actually has: with `k` peers it trusts its own median `k/(k + 3)` of the
   way and the global median `3/(k + 3)` of the way, on the logarithm. A category with fifteen
   live peers is trusted five sixths of the way; one with a single observation leans three
   quarters of the way back to the all-category figure. This is the single biggest determinant
   of the number.

   Because the observation divides market cap by TVL raised to the size exponent, multiplying the
   anchor back by TVL raised to that same exponent recovers roughly what a live peer of the same
   size is worth. That is why the numbers read as market caps rather than as arbitrary multiples.

2. **Size** — `tvl_usd` raised to `size_exponent` (0.75). A $100M protocol is not worth 10× what
   a $10M protocol is worth; the exponent caps the scaling so that TVL growth has diminishing
   returns on implied value. The raw field is `tvl_usd` from the snapshot.

3. **Growth** — the 7-day TVL change (`change_7d`, in per cent), clamped to a floor and a cap,
   then weighted:

   ```
   growth = 1 + growth_weight × (clamped 7-day change ÷ 100)
   ```

   At weight 0.45 a flat week scores 1.00, a +25% week scores 1.11 and the +150% cap scores
   1.68; a −25% week scores 0.89. A missing 7-day reading is neither growth nor decline, so it
   scores 1. The raw field is `change_7d` from the snapshot.

4. **Maturity** — how long the protocol has been listed (`age_days` from the snapshot's
   `listed_at`). A protocol that launched last year is less likely to launch a token than one that
   appeared three weeks ago. The factor decays on a **logarithmic** curve from `age_cap` to
   `age_floor` over `age_full_decay` days — the first few months of silence matter far more than
   the thousandth month:

   ```
   decay    = min(1, ln(1 + days) / ln(1 + age_full_decay))
   maturity = age_cap − (age_cap − age_floor) × decay
   ```

   With the constants below, a 30-day-old protocol scores 0.69, a one-year-old one 0.47, and
   anything listed four years ago or longer the floor of 0.35. A protocol with no `listed_at` is
   not "very old"; it is "unknown", and gets `unknown_age_maturity` (0.70) instead of being
   dragged to the floor.

The model is fully deterministic: same input, same output. No protocol name is special-cased.

## Which protocols are on the board

A protocol is pre-token when its snapshot entry records no token at all: no market cap, no
CoinGecko id and no symbol. The board then carries:

- every slug on the snapshot's own watchlist, whatever else it is; and
- every other protocol that records no token, is a protocol in its own right, and has TVL of at
  least $5M.

That second group is the scan. It excludes products of something that already trades — wrapped,
staked, bridged, exchange-branded or versioned — because WBTC is Bitcoin on Ethereum and
Binance's staked ETH is ETH in a staking product, and neither is a protocol still waiting on a
launch of its own. The whole set is then ordered by implied value, so what the board ranks by is
what it selects by.

## Why "Already trading" is a separate view

Protocols that already have a live token are shown in a dedicated tab, not on the board. Two
reasons:

- Their value is the market's, not the model's. The market cap a token trades at is a fact, not
  an estimate. Mixing it in would dilute the board's purpose, which is to rank *potential* launches.
- Their market-cap-over-TVL multiple is what the board's anchor is measured against. Showing them
  apart makes the anchor legible: a reader can see the live protocols that set the category anchor
  and understand why a pre-token protocol in the same category gets its number.

## The dashboard's three features

1. **A stated model, not a black box.** The masthead shows the formula and every constant. The
   detail panel recomputes the model's own arithmetic from the row's figures, so a reader can check
   the number on the board against the inputs it came from.

2. **A farm plan for every row.** Each protocol's detail panel includes the concrete steps to
   farm its launch: how much capital, on which chain, what action, and what to record. Every step
   is derived from the protocol's own record — its chains, its TVL depth, its week of movement,
   and how long it has run without a token — so two protocols in the same category get different
   plans. The steps are generated by the same logic `main.ts` runs, so they are deterministic and
   reproducible.

3. **Filterable, sortable, static.** The table can be filtered by category and chain, searched by
   name or slug, and sorted by any column. No network: the page loads `data.js` from the same
   directory and renders everything client-side. The three screenshots in `screenshots/` are
   captured deterministically by `tools/shoot.mjs` over a headless Chrome instance.

## Layout

```
main.ts                 the entry point: read, score, write, copy, summarise
lib/model.ts            the model: anchors, implied value, farm plan, snapshot parsing
dashboard/              the static page: index.html, app.css, app.js
tools/check-gate.mjs    the local stand-in for the house gate
tools/check-parity.mjs  page versus board, byte for byte
tools/shoot.mjs         drives the page over the DevTools protocol and captures the frames
tools/screenshots.sh    runs Chrome headless and calls tools/shoot.mjs
tools/fetch-snapshot.mjs  writes a snapshot in the shape the model reads
vendor/makefun-board.ts the make.fun dossier library, vendored
```
