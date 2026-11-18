#!/usr/bin/env node
// Put the snapshot where the program reads it.
//
// The competition mounts its own sealed copy at /input/snapshot.json; that is what the grader
// runs the entry against. For a run on this machine, the same file is fetched once from
// DefiLlama's public endpoint and written to input/snapshot.json.
//
//   node tools/fetch-snapshot.mjs [outFile]
//
// The file is not committed: it is the competition's input, not the entry's work, and it is large
// enough that committing it would drown out the code it sits next to.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ENDPOINT = 'https://api.llama.fi/protocols';
const FLOOR_USD = 5_000_000;
const AS_OF = new Date().toISOString().slice(0, 10);

const out = resolve(process.argv[2] ?? 'input/snapshot.json');

const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
if (!response.ok) {
  process.stderr.write(`snapshot: DefiLlama answered ${response.status}: ${await response.text()}\n`);
  process.exit(1);
}
const protocols = await response.json();
if (!Array.isArray(protocols)) {
  process.stderr.write('snapshot: the endpoint did not answer with a list of protocols\n');
  process.exit(1);
}

/** The protocol record the model reads: ten fields, nothing else. */
function entryOf(p) {
  const tvl = typeof p.tvl === 'number' && Number.isFinite(p.tvl) ? p.tvl : 0;
  const mcap = typeof p.mcap === 'number' && Number.isFinite(p.mcap) ? p.mcap : null;
  const gecko = typeof p.gecko_id === 'string' && p.gecko_id !== '' ? p.gecko_id : null;
  const symbol = typeof p.symbol === 'string' && p.symbol !== '' && p.symbol !== '-' ? p.symbol : null;
  const listed = typeof p.listedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.listedAt) ? p.listedAt.slice(0, 10) : null;
  const change = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null;
  const chains = Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [];
  return {
    slug: typeof p.slug === 'string' ? p.slug : null,
    name: typeof p.name === 'string' ? p.name : null,
    category: typeof p.category === 'string' ? p.category : null,
    chains,
    tvl_usd: Math.trunc(tvl),
    change_7d: change === null ? null : Math.round(change * 1e4) / 1e4,
    mcap_usd: mcap === null ? null : Math.trunc(mcap),
    listed_at: listed,
    gecko_id: gecko,
    symbol,
  };
}

const kept = protocols
  .map(entryOf)
  .filter((p) => p.slug !== null && p.name !== null && p.tvl_usd >= FLOOR_USD)
  .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The categories that are products of another protocol rather than protocols of their own. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'Staking Pool', 'Stablecoin Wrapper', 'Wrapped', 'CEX',
]);
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The watchlist: protocols that record no token and are not a product of something that trades. */
const watchlist = kept
  .filter((p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null)
  .filter((p) => p.category === null || !DERIVATIVE_CATEGORIES.has(p.category))
  .filter((p) => !DERIVATIVE_WORD.test(p.name))
  .filter((p) => !EXCHANGE_NAMES.some((e) => p.name.startsWith(e)))
  .filter((p) => !VERSIONED.test(p.name))
  .map((p) => p.slug);

const snapshot = {
  as_of: AS_OF,
  source: `DefiLlama ${ENDPOINT}, fetched ${new Date().toISOString()}`,
  floor_usd: 50_000_000,
  protocols: kept,
  watchlist,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
process.stdout.write(`snapshot: wrote ${out} (${kept.length} protocols, ${watchlist.length} on the watchlist)\n`);
