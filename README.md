# Token Radar

A launch radar for protocols that still have no token of their own. It reads a sealed DefiLlama
protocol snapshot, scores every pre-token protocol with a fully stated arithmetic model, and writes
a ranked board, a static dashboard, and a per-protocol dossier. No network, no credentials, no
build step: every byte the dashboard shows is generated and shipped beside it.

## Run it

```sh
node main.ts --input input/snapshot.json --output out
```

Writes to `out/`:

- `board.json` — the ranked board, one entry per pre-token protocol, sorted by implied value
- `data.js` — `window.RADAR`, the same data the dashboard reads; no fetch, no API
- `dashboard/` — static dashboard (`index.html`, `app.css`, `app.js`), open in any browser
- `screenshots/` — three frames: the board, a protocol's detail view, a filtered view
- `dossier.json` — per-protocol narrative: what the snapshot records, the model's own arithmetic,
  and the steps to farm the protocol's launch

Then validate locally:

```sh
node tools/check-gate.mjs out input/snapshot.json
```

Seven checks: board file, sort order, coverage, farm steps, dashboard files, screenshots, dossier.

Regenerate screenshots (requires a running Chrome/Chromium with a debug port, or the script's own
headless instance):

```sh
bash tools/screenshots.sh out screenshots
```

## The model

Every protocol on the board gets an implied value — what a launch would be worth if the protocol's
record stayed as it is. The model has four factors, all read out of the snapshot itself:

1. **Anchor** — `anchor_fdv_tvl`, a multiple of TVL the model applies to each protocol. It starts
   as the median market-cap-over-TV L of the live-token protocols in that protocol's own category.
   Two things keep that median honest:

   - A live peer whose market cap the snapshot records as zero or negative is not a priced peer —
     the field is simply not filled in — so it contributes no observation at all. Including it
     would drag a category's median toward zero and read as "this category is worth nothing".
   - The ratios are worked **on the logarithm**, because FDV/TVL spans three orders of magnitude
     across the snapshot. A median taken in linear space is pulled by whichever peers sit at the
     top, and so is the blend below.

   The category's median is then **blended with the all-category median** in proportion to how many
   live peers it actually has: with `k` peers it trusts its own median `k/(k + 3)` of the way and
   the global median `3/(k + 3)` of the way. A category with fifteen live peers is nearly pure
   category; one with a single observation leans three-quarters of the way back to the all-category
   figure. This is the single biggest determinant of the number.

2. **Size** — `tvl_usd` raised to `size_exponent` (0.75). A $100M protocol is not worth 10× what a
   $10M protocol is worth; the exponent caps the scaling so that TVL growth has diminishing
   returns on implied value. The raw field is `tvl_usd` from the snapshot.

3. **Growth** — the 7-day TVL change (`change_7d`, in percent), clamped to a floor and a cap, then
   multiplied by `growth_weight`. A protocol that grew 20% in a week gets a lift; one that
   bled 30% gets a haircut. The raw field is `change_7d` from the snapshot.

4. **Maturity** — how long the protocol has been listed (`age_days` from the snapshot's
   `listed_at`). A protocol that launched last year is less likely to launch a token than one that
   appeared three weeks ago. The factor decays on a **logarithmic** curve from `age_cap` to
   `age_floor` over `age_full_decay` days — the first few months of silence matter far more than the
   thousandth month. A protocol with no `listed_at` is not "very old"; it is "unknown", and gets
   `unknown_age_maturity` (0.70) instead of being dragged to the floor.

The implied value is: `max(1, round(anchor × size × growth × maturity))`.

The model is fully deterministic: same input, same output. No protocol name is special-cased.

## Why "Already trading" is a separate view

Protocols that already have a live token are shown in a dedicated tab, not on the board. Two
reasons:

- Their value is the market's, not the model's. The market cap a token trades at is a fact, not an
  estimate. Mixing it in would dilute the board's purpose, which is to rank *potential* launches.
- Their market-cap-over-TV L multiple is what the board's anchor is measured against. Showing them
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
