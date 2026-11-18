// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board's job is to answer a question a trader asks: of the protocols that record no token yet,
// which are worth preparing for, and what should a reader do about each one? Two things follow from
// that, and this file is where they are decided.
//
// 1. What a launch would be worth. The implied value of a pre-token protocol is estimated from the
//    snapshot's own figures, never from a name. The estimate has three parts:
//
//      anchor    = the constant that turns a protocol's size into what its category's already
//                  trading peers command. It is read out of the snapshot itself: every protocol in
//                  it that already trades gives one observation of market cap over its size, and
//                  the median of those observations, per category, is the anchor. A category with
//                  too few observations falls back to the all-category median. So the anchor moves
//                  with the data and is stated on the page; it is not a constant someone chose.
//
//      size      = tvl raised to the model's size exponent (0.75) rather than tvl itself. TVL is
//                  the protocol's footprint, and a footprint ten times larger is worth more than
//                  ten times a launch, not less: the sub-linear exponent is the usual shape of
//                  that curve, and it stops one whale from owning the board.
//
//      momentum  = a growth term from the seven-day TVL change, and a maturity term from how long
//                  the protocol has been listed without a token. A protocol that has run for years
//                  without a token is a protocol that does not intend to have one, so age lowers the
//                  estimate; a protocol that is growing is closer to a launch. Both are bounded.
//
//    implied = anchor x size x momentum, rounded to whole dollars.
//
// 2. What to do about it. Every row carries a farm plan derived from the protocol's own record:
//    its category decides the action, its TVL decides the capital and its depth, its age decides
//    the holding window and how often a qualifying action has to be repeated.
//
// A protocol is pre-token when its index entry records no token: no market cap, no CoinGecko id and
// no symbol. The snapshot's live-token protocols are kept apart and shown with the market's own
// market cap, never mixed into the ranked board.
//
// No protocol name is ever special-cased. The same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: the shape of the estimate, stated on the page. */
export interface ModelConstants {
  /** The exponent of the size curve: TVL raised to this power is the protocol's scale. */
  size_exponent: number;
  /** How much of a week of growth carries into the estimate. */
  growth_weight: number;
  /** The growth term's bounds, in per cent of TVL. */
  growth_floor: number;
  growth_cap: number;
  /** The maturity term's bounds: a protocol this old without a token is not going to issue one. */
  age_floor: number;
  age_cap: number;
  /** Age in days at which the maturity term is at its floor. */
  age_full_decay: number;
  /** The age used when the snapshot records no listing date. */
  unknown_age_days: number;
  /** The maturity value an unknown-age protocol gets, instead of being penalised as very old. */
  unknown_age_maturity: number;
  /** TVL below which a protocol is not a launch candidate worth a reader's time. */
  min_tvl_usd: number;
}

export const MODEL: ModelConstants = {
  size_exponent: 0.75,
  growth_weight: 0.45,
  growth_floor: -25,
  growth_cap: 150,
  age_floor: 0.35,
  age_cap: 1.0,
  age_full_decay: 1460,
  unknown_age_days: 540,
  unknown_age_maturity: 0.7,
  min_tvl_usd: 5_000_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/**
 * The shrinkage prior for a category's anchor: with k live peers in a category, trust the
 * category's own median k/(k + m) of the way and the global median m/(k + m) of the way.
 * m is the "equivalent peer count" — a category must have m live observations before its own
 * median is fully trusted. A single-observation category leans 3/4 of the way back to the
 * global figure; a category with m peers or more trusts its own median almost entirely.
 */
export const ANCHOR_SHRINKAGE_M = 3;

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    anchor_fdv_tvl: number;
    anchor_peers: number;
    anchor_scope: 'category' | 'global';
    size_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row: the numbers it draws, and nothing it does not need. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  is_watchlist: boolean;
  anchor_fdv_tvl: number;
  anchor_peers: number;
  anchor_scope: 'category' | 'global';
  size_factor: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  fdv_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, the anchors and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_anchor: number;
  anchors: Record<string, { fdv_tvl: number; peers: number }>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories that are products of another protocol rather than protocols of their own. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Staking Pool',
  'Stablecoin Wrapper',
  'Wrapped',
  'CEX',
]);

/** A name carrying one of these whole words is a product of something that already trades. */
const DERIVATIVE_WORD = /\b(wrapped|staked|staking|staked)\b/i;

/** An exchange's own name at the front of a protocol's name: the exchange's product, not a protocol. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: it records no token, and it is a protocol in its
 * own right rather than a wrapped, staked, bridged or exchange-branded product of something that
 * already trades. WBTC is Bitcoin on Ethereum, Binance's staked ETH is ETH in a staking product,
 * and neither is a protocol still waiting on a launch of its own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (DERIVATIVE_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The median of a list of numbers; null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The anchors: for each category, the constant that converts a protocol's TVL into the value its
 * live-token peers command. A protocol with a token has a price the market set; the pre-token
 * protocols in the same category have not, so their peers are the best available estimate of what
 * one would fetch. Each live peer contributes one observation, market cap over TVL to the power of
 * the model's size exponent, and the median of those observations in a category is the category's
 * constant.
 *
 * Two things make this robust rather than merely arithmetic:
 *
 * - A peer whose market cap the snapshot records as zero or negative is not a priced peer — the
 *   field is simply not filled in — so it contributes no observation at all. Including it would
 *   drag a category's median to zero and mean "this category is worth nothing".
 *
 * - The ratios are worked in log space. FDV/TVL spans three orders of magnitude across the
 *   snapshot (0.03 to 20,000), so a median in linear space is pulled by whichever peers sit at the
 *   top, and the shrink toward the global median has to be done on the logarithm for a single
 *   thin category to be pulled back rather than to dominate.
 */
export function buildAnchors(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { global: number; byCategory: Record<string, { fdv_tvl: number; peers: number; shrink: number }> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / Math.pow(p.tvl_usd, model.size_exponent);
    const logRatio = Math.log(ratio);
    all.push(logRatio);
    const key = p.category ?? '(none)';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [logRatio]);
    else list.push(logRatio);
  }
  const globalLog = median(all) ?? Math.log(14);
  const byCategory: Record<string, { fdv_tvl: number; peers: number; shrink: number }> = {};
  for (const [key, list] of byCat) {
    const med = median(list);
    if (med === null) continue;
    byCategory[key] = { fdv_tvl: round4(Math.exp(med)), peers: list.length, shrink: 0 };
  }
  return { global: round4(Math.exp(globalLog)), byCategory };
}

/**
 * The anchor a category uses: its own median, shrunk toward the global median by how many live
 * peers it actually has. With k peers, trust = k / (k + ANCHOR_SHRINKAGE_M): a category with
 * many peers trusts its own median; a category with a single observation trusts it only 1/4 and
 * the global figure 3/4. The blend happens on the logarithm, so a thin category is pulled back
 * toward the market rather than dominating it. This keeps a lone unusual live protocol from
 * owning a whole category's anchor, while not throwing away data from categories that do have
 * real peers.
 */
export function anchorFor(
  category: string | null,
  anchors: { global: number; byCategory: Record<string, { fdv_tvl: number; peers: number; shrink: number }> },
): { fdv_tvl: number; peers: number; scope: 'category' | 'global' } {
  const key = category ?? '(none)';
  const own = anchors.byCategory[key];
  if (own === undefined || own.peers === 0) return { fdv_tvl: anchors.global, peers: 0, scope: 'global' };
  const k = own.peers;
  const trust = k / (k + ANCHOR_SHRINKAGE_M);
  const globalLog = Math.log(anchors.global);
  const ownLog = Math.log(own.fdv_tvl);
  const fdv_tvl = round4(Math.exp(ownLog * trust + globalLog * (1 - trust)));
  return { fdv_tvl, peers: k, scope: 'category' };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  anchors: { global: number; byCategory: Record<string, { fdv_tvl: number; peers: number }> },
): {
  implied: number;
  anchor: { fdv_tvl: number; peers: number; scope: 'category' | 'global' };
  sizeFactor: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const anchor = anchorFor(protocol.category, anchors);

  // Size: TVL to the model's exponent, so a bigger footprint is worth more than a smaller one but
  // never in proportion: a whale cannot own the board by size alone.
  const sizeFactor = Math.pow(Math.max(protocol.tvl_usd, 0), model.size_exponent);

  // Momentum: a week of growth lifts the estimate, a week of decline lowers it, both bounded.
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  // Maturity: a protocol listed long ago and still without a token is not going to issue one,
  // but the decay is logarithmic, not linear — the first few months of silence matter far more
  // than the thousandth month. A 30-day protocol is 0.97, a year is 0.79, five years is 0.35.
  // An unknown listing date is not "very old"; it is "unknown", and gets its own neutral 0.70
  // instead of being dragged to the floor.
  let maturityMult: number;
  if (age === null) {
    maturityMult = model.unknown_age_maturity;
  } else {
    const ln = Math.log1p(age);
    const lnFull = Math.log1p(model.age_full_decay);
    const decay = Math.min(1, ln / lnFull);
    maturityMult = model.age_cap - (model.age_cap - model.age_floor) * decay;
  }

  const implied = Math.max(1, Math.round(anchor.fdv_tvl * sizeFactor * growthMult * maturityMult));
  return { implied, anchor, sizeFactor, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  anchors = buildAnchors(snapshot),
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd && p.tvl_usd >= model.min_tvl_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const parts = impliedValue(p, snapshot.as_of, model, anchors);
    return { p, ...parts };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      anchor_fdv_tvl: s.anchor.fdv_tvl,
      anchor_peers: s.anchor.peers,
      anchor_scope: s.anchor.scope,
      size_factor: round4(s.sizeFactor),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A compact USD figure for a TVL, so a step can say how deep the pool is. */
function tvlDepth(tvl: number): string {
  if (tvl >= 1_000_000_000_000) return `$${(tvl / 1e12).toFixed(1)}T`;
  if (tvl >= 1_000_000_000) return `$${(tvl / 1e9).toFixed(1)}B`;
  if (tvl >= 1_000_000) return `$${(tvl / 1e6).toFixed(1)}M`;
  return `$${Math.round(tvl / 1e3)}K`;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** What a week of TVL movement means for the pace of a farm: accelerate, hold, or wait and see. */
function momentumLine(change: number | null, tvl: number): string {
  if (change === null) return `with no seven-day reading yet, treat the position as a probe: add only after the next snapshot confirms the direction.`;
  if (change >= 25) return `a ${change.toFixed(0)}% week means the crowd is already moving — this is the one to front-run, so keep the position topped up and re-check it weekly.`;
  if (change >= 5) return `a ${change.toFixed(0)}% week is steady; keep the position and add once more before the next snapshot.`;
  if (change >= -5) return `a flat week (${change.toFixed(1)}%) means the base is stable; keep the position without adding until the next reading.`;
  if (change >= -20) return `a ${change.toFixed(0)}% week is a mild bleed; keep the position but do not add until it turns.`;
  return `a ${change.toFixed(0)}% week against a ${tvlDepth(tvl)} pool is a real drop; hold for now and only re-enter if two straight weeks turn positive.`;
}

/**
 * A protocol's farm plan: six to eight steps, each an action with a cost and a time, derived from
 * the protocol's own record — its chains, its TVL depth, its week of movement, and how long it has
 * run without a token. No hand-written list of names: the same code reads the snapshot's figures
 * and writes the plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const all = p.chains;
  const cross = all.length > 1
    ? `It records ${all.length} chains — ${all.join(', ')} — so mirror the position on a second one, starting with ${chain} and adding ${all[1]!}, to make sure the launch is not read off a single chain's books.`
    : `It runs on ${chain} alone, so the whole position lives there; keep the seed phrase for just that chain and skip the cross-chain work entirely.`;
  const depth = `Its TVL of ${tvlDepth(p.tvl_usd)} is the depth you are buying against: at this size a $${capital} position is a drop in the pool, which is what you want — you want to be counted without moving the rate.`;
  const momentum = momentumLine(p.change_7d, p.tvl_usd);
  const ageLine = age === null
    ? `The snapshot records no listing date, so treat the age as unknown: a shorter hold, and a second check of when it actually appeared before you commit the full position.`
    : `It has been listed ${age} days — about ${Math.max(1, Math.round(age / 30))} months — without a token, which is why the model's own maturity term holds its value down, and the plan's job is to keep the position while that timer runs.`;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the $${capital} you plan to farm on ${chain}, and keep its seed phrase offline.`,
      cost: `under $${gas} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: cross, cost: 'one bridged or native transfer, about $4 of gas', time: '10 minutes' },
    { text: `Read the pool against its depth: ${depth}`, cost: 'nothing to read', time: '5 minutes' },
    { text: `Set your pace from the week of movement: ${momentum}`, cost: 'the decision is free, the added capital is not', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. ${ageLine}`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    {
      text: `Before you withdraw from ${p.name}, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction on ${chain} in a farm log, so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      fdv_tvl: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, isWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    is_watchlist: isWatchlist,
    anchor_fdv_tvl: row.model.anchor_fdv_tvl,
    anchor_peers: row.model.anchor_peers,
    anchor_scope: row.model.anchor_scope,
    size_factor: row.model.size_factor,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const anchors = buildAnchors(snapshot);
  const board = buildBoard(snapshot, model, anchors);
  const live = liveRows(snapshot);
  const watchSet = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchSet.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_anchor: anchors.global,
    anchors: anchors.byCategory,
    rows: board.map((r) => radarRow(r, watchSet.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
