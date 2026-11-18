// Token Radar's entry point (Node 22+, standard library only, no build step).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores
// every pre-token protocol with the model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/ into /output.
// Last, it writes /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from
// the same board. The page recomputes every row's implied value from the snapshot figures it
// carries and shows the arithmetic, so a reader can check the board against its inputs.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
/** The rules ask for frames of at least this size, so a blank page cannot pass as a screenshot. */
const SCREENSHOT_MIN_BYTES = 300 * 1024;
/** A plain file's name: the dossier and the scorer both refuse anything else. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * Empty a directory of everything it holds, so a stale file from a previous run can never reach
 * the scorer: a leftover screenshot or a half-written page is a silent wrong answer, and the
 * scorer only reads what is there.
 */
function clearDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

clearDir(join(out, 'screenshots'));
clearDir(join(out, 'dashboard'));
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

// The bundle is checked here as well as by tools/check-gate.mjs: the gate is a local stand-in
// for the house gate, and a broken bundle should fail on the machine that built it, not on the
// judge's, where the failure costs the whole entry.
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const size = statSync(join(out, 'screenshots', name)).size;
  if (size > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_CAPS.max_bytes} a frame may be\n`);
    process.exit(1);
  }
  if (size < SCREENSHOT_MIN_BYTES) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes, under the ${SCREENSHOT_MIN_BYTES} the rules ask a frame to be: it is probably a blank page\n`);
    process.exit(1);
  }
}

const dashDir = join(out, 'dashboard');
const dashFiles = readdirSync(dashDir).filter((n) => !n.startsWith('.'));
if (dashFiles.length > DASHBOARD_CAPS.max_files) {
  process.stderr.write(`token radar: dashboard/ holds ${dashFiles.length} files, over the ${DASHBOARD_CAPS.max_files} a dossier may carry\n`);
  process.exit(1);
}
for (const name of dashFiles) {
  const path = join(dashDir, name);
  if (!statSync(path).isFile()) continue;
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`token radar: dashboard/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const text = readFileSync(path, 'utf8');
  const url = text.match(/https?:\/\/[^\s"'`)]+/);
  if (url) {
    process.stderr.write(`token radar: dashboard/${name} names the network address ${url[0]}: the page must work with no network at all\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} found by the scan, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
