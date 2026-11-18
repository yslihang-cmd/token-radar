// Local stand-in for the house gate (RULES.txt "The gate", seven checks).
// Run: node tools/check-gate.mjs [outDir]
// It reads the same files the scorer reads and applies the same limits, so a green run here is
// evidence, not a promise: the house still has the last word.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'out';
const snapshot = JSON.parse(readFileSync(process.argv[3] ?? 'input/snapshot.json', 'utf8'));
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = new Set(snapshot.watchlist);
const results = [];
const fail = (name, detail) => results.push({ ok: false, name, detail });
const pass = (name, detail) => results.push({ ok: true, name, detail });

// --- board_file ---
let rows = [];
try {
  const raw = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
  rows = Array.isArray(raw) ? raw : raw.rows;
} catch (e) {
  fail('board_file', `board.json unreadable: ${e.message}`);
}
if (rows.length) {
  const problems = [];
  if (rows.length < 100 || rows.length > 4000) problems.push(`row count ${rows.length} outside 100..4000`);
  const seen = new Set();
  for (const r of rows) {
    if (typeof r.slug !== 'string' || !slugs.has(r.slug)) { problems.push(`slug not in snapshot: ${r.slug}`); break; }
    if (seen.has(r.slug)) { problems.push(`duplicate slug ${r.slug}`); break; }
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) { problems.push(`empty name ${r.slug}`); break; }
    if (!Number.isInteger(r.rank) || r.rank < 1) { problems.push(`rank not a positive integer: ${r.slug}`); break; }
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) {
      problems.push(`implied_value_usd out of range: ${r.slug}`); break;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      problems.push(`farm_steps count ${r?.farm_steps?.length} outside 3..12: ${r.slug}`); break;
    }
    for (const s of r.farm_steps) {
      const t = typeof s === 'string' ? s.trim() : '';
      if (t.length < 20 || t.length > 600) { problems.push(`farm step length ${t.length} outside 20..600: ${r.slug}`); break; }
    }
  }
  const values = rows.map((r) => r.implied_value_usd);
  if (rows.length >= 2 && values.every((v) => v === values[0])) problems.push('all implied values identical');
  if (problems.length) fail('board_file', problems.join('; ')); else pass('board_file', `${rows.length} rows`);
}

// --- sorted_by_value ---
{
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const problems = [];
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) { problems.push('ranks are not exactly 1..N once each'); break; }
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) {
      problems.push(`implied value rises at rank ${byRank[i].rank} (${byRank[i].slug})`); break;
    }
  }
  if (problems.length) fail('sorted_by_value', problems.join('; ')); else pass('sorted_by_value', 'ranks 1..N, values non-rising');
}

// --- coverage ---
{
  const covered = new Set(rows.map((r) => r.slug));
  const missing = [...watchlist].filter((s) => !covered.has(s));
  if (missing.length) fail('coverage', `${missing.length} watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`);
  else pass('coverage', `${watchlist.size}/${watchlist.size} watchlist covered, ${rows.length} rows total`);
}

// --- farm_steps ---
{
  let bad = 0;
  for (const r of rows) {
    const arr = r.farm_steps ?? [];
    if (!Array.isArray(arr) || arr.length < 3 || arr.length > 12) { bad++; continue; }
    if (!arr.every((s) => typeof s === 'string' && s.trim().length >= 20 && s.trim().length <= 600)) bad++;
  }
  if (bad) fail('farm_steps', `${bad} rows with a bad farm_steps array`); else pass('farm_steps', `all ${rows.length} rows carry 3..12 steps of 20..600 chars`);
}

// --- dashboard_files ---
{
  const dir = join(out, 'dashboard');
  const problems = [];
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  if (!existsSync(dir)) problems.push('dashboard/ missing');
  else {
    walk(dir);
    if (files.length > 400) problems.push(`${files.length} files over the 400 cap`);
    const names = files.map((f) => f.slice(dir.length + 1));
    if (!names.includes('index.html')) problems.push('index.html missing');
    if (!names.some((n) => n.endsWith('.css'))) problems.push('no .css file');
    if (!names.some((n) => n.endsWith('.js'))) problems.push('no .js file');
    let bytes = 0;
    for (const f of files) {
      bytes += statSync(f).size;
      const text = readFileSync(f, 'utf8');
      const m = text.match(/https?:\/\/[^\s"'`)]+/g);
      if (m) problems.push(`${f.slice(dir.length + 1)} names a network address: ${m[0]}`);
    }
    if (bytes > 4 * 1024 * 1024) problems.push(`dashboard is ${bytes} bytes, over 4 MiB`);
    // The dossier text cap: every source file whole, 65536 bytes total.
    const textTotal = files
      .filter((f) => /\.(html|css|js|json|mjs|svg|md|txt)$/.test(f))
      .reduce((n, f) => n + statSync(f).size, 0);
    if (textTotal > 65536) problems.push(`source text is ${textTotal} bytes, over the 65536 dossier cap`);
  }
  if (problems.length) fail('dashboard_files', problems.join('; ')); else pass('dashboard_files', 'index.html + css + js, no network address');
}

// --- screenshots ---
{
  const dir = join(out, 'screenshots');
  const problems = [];
  const shots = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')) : [];
  if (shots.length < 3 || shots.length > 4) problems.push(`${shots.length} images, needs 3..4`);
  for (const n of shots) {
    const p = join(dir, n);
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n)) problems.push(`bad image name ${n}`);
    const size = statSync(p).size;
    if (size > 524288) problems.push(`${n} is ${size} bytes, over 512 KiB`);
    if (size < 300 * 1024) problems.push(`${n} is ${size} bytes, under the 300 KB the rules ask for`);
  }
  if (problems.length) fail('screenshots', problems.join('; ')); else pass('screenshots', `${shots.length} images`);
}

// --- dossier_matches ---
{
  const p = join(out, 'dossier.json');
  const problems = [];
  if (!existsSync(p)) problems.push('dossier.json missing');
  else {
    const size = statSync(p).size;
    if (size > 1.5 * 1024 * 1024) problems.push(`dossier is ${size} bytes, over 1.5 MiB`);
  }
  if (problems.length) fail('dossier_matches', problems.join('; ')); else pass('dossier_matches', 'present and within the cap');
}

let bad = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
  if (!r.ok) bad++;
}
console.log(`\n${results.length - bad}/${results.length} checks pass`);
process.exit(bad === 0 ? 0 : 1);
