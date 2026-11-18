// Parity check: the dashboard recomputes the model's arithmetic in the browser, so the page could
// drift from the model that wrote board.json. The bounty asks the screenshots and the code to
// agree, and this is the check that keeps them agreeing.
//
// It loads dashboard/app.js in a minimal DOM shim, drives the same functions the page drives, and
// compares every row's implied value and every farm step against what lib/model.ts wrote.
//
//   node tools/check-parity.mjs [outDir]
//
// This is a local check, not one of the house gate's seven: it exists because the page and the
// model are two copies of the same arithmetic, and two copies drift.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = process.argv[2] ?? 'out';
const dashboard = join(out, 'dashboard');
const problems = [];

// The page's own code, loaded as it is shipped.
const appPath = join(dashboard, 'app.js');
if (!existsSync(appPath)) {
  console.error(`parity: no ${appPath}: run main.ts first`);
  process.exit(2);
}
const appSource = readFileSync(appPath, 'utf8');

// The data the page reads.
const dataSource = readFileSync(join(out, 'data.js'), 'utf8');
const start = dataSource.indexOf('window.RADAR=');
const end = dataSource.indexOf(';', start);
if (start < 0 || end < 0) {
  console.error('parity: data.js does not define window.RADAR');
  process.exit(2);
}
const DATA = JSON.parse(dataSource.slice(start + 'window.RADAR='.length, end));

// The board the model wrote.
const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
const boardRows = Array.isArray(board) ? board : board.rows;

// The model itself, for its own farm steps.
const modelUrl = pathToFileURL(join(process.cwd(), 'lib', 'model.ts')).href;
const model = await import(modelUrl);

// A DOM shim just rich enough for app.js to run: the page only needs elements it can create and
// append to. Every element records its text so the farm plan can be read back out of the page.
function makeElement(tag) {
  const node = {
    tag,
    children: [],
    _text: '',
    className: '',
    style: {},
    attributes: {},
    listeners: {},
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); },
    set innerHTML(v) { this._text = String(v).replace(/<[^>]*>/g, ''); this.children = []; },
    get innerHTML() { return this._text; },
    appendChild(c) { this.children.push(c); return c; },
    removeAttribute() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(k, fn) { this.listeners[k] = fn; },
    querySelector(sel) { return findIn(this, sel); },
    querySelectorAll(sel) { return findAllIn(this, sel); },
    remove() {},
  };
  return node;
}
function findIn(root, sel) {
  const all = findAllIn(root, sel);
  return all[0] ?? null;
}
function findAllIn(root, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children ?? []) {
      if (sel.startsWith('.') && c.className === sel.slice(1)) out.push(c);
      else if (sel.startsWith('#') && c.attributes.id === sel.slice(1)) out.push(c);
      else if (c.tag === sel) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

const root = makeElement('body');
globalThis.document = {
  createElement: (tag) => makeElement(tag),
  createTextNode: (t) => ({ textContent: String(t), children: [] }),
  getElementById: (id) => (id === 'board' ? root : null),
  querySelector: (sel) => findIn(root, sel),
  querySelectorAll: (sel) => findAllIn(root, sel),
};
globalThis.window = { RADAR: DATA, scrollY: 0, scrollTo: () => {} };

// Run the page's own code.
new Function(appSource)();

// The page's functions are inside its IIFE, so reach them through what they built: the page
// renders the board into the shim, and the detail panel is what carries the farm plan. Instead of
// poking at the DOM, re-run the two functions app.js defines by extracting them from its source.
function extractFunction(name) {
  const marker = `function ${name}(`;
  const at = appSource.indexOf(marker);
  if (at < 0) throw new Error(`parity: app.js has no ${name}`);
  let depth = 0;
  let i = appSource.indexOf('{', at);
  for (; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}') {
      depth--;
      if (depth === 0) return appSource.slice(at, i + 1);
    }
  }
  throw new Error(`parity: app.js's ${name} is not closed`);
}
// The page's helpers the two functions need, in the page's own order.
const helpers = ['chainOf', 'capitalFor', 'holdDaysFor', 'tvlDepth', 'actionFor', 'momentumLine'];
const pageScope = new Function(
  `${helpers.map((h) => extractFunction(h)).join('\n')}\n` +
    `return { farmSteps: ${extractFunction('farmSteps')}, impliedOf: ${extractFunction('impliedOf')} };`,
)();

// --- implied value: the page's recomputation against the model's board ---
let valueProblems = 0;
for (const row of DATA.rows) {
  const calc = pageScope.impliedOf(row, DATA.model);
  if (calc.implied !== row.implied_value_usd) {
    if (valueProblems < 5) {
      problems.push(`${row.slug}: the page computes ${calc.implied}, the board says ${row.implied_value_usd}`);
    }
    valueProblems++;
  }
}

// --- farm plan: the page's plan against the model's plan, as strings ---
// The model writes each step as "action Cost: cost. Time: time."; the page shows the same
// sentence, so the two are compared as the same sentence.
function stepText(step) {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
let planProblems = 0;
const boardBySlug = new Map(boardRows.map((r) => [r.slug, r]));
for (const row of DATA.rows) {
  const boardRow = boardBySlug.get(row.slug);
  if (boardRow === undefined) {
    problems.push(`${row.slug}: on the page but not in board.json`);
    planProblems++;
    continue;
  }
  const pageSteps = pageScope.farmSteps(row).map(stepText);
  const modelSteps = boardRow.farm_steps;
  if (pageSteps.length !== modelSteps.length) {
    problems.push(`${row.slug}: the page has ${pageSteps.length} steps, the board has ${modelSteps.length}`);
    planProblems++;
    continue;
  }
  for (let i = 0; i < pageSteps.length; i++) {
    if (pageSteps[i] !== modelSteps[i]) {
      if (planProblems < 5) {
        problems.push(`${row.slug} step ${i + 1} differs:\n    page:  ${pageSteps[i]}\n    board: ${modelSteps[i]}`);
      }
      planProblems++;
    }
  }
}

// --- the model's own rows against the page's, for the fields the plan depends on ---
for (const boardRow of boardRows) {
  const row = DATA.rows.find((r) => r.slug === boardRow.slug);
  if (row === undefined) {
    problems.push(`${boardRow.slug}: in board.json but not on the page`);
    continue;
  }
  for (const k of ['name', 'category', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd']) {
    if (row[k] !== boardRow[k]) problems.push(`${boardRow.slug}: ${k} differs between the page and the board`);
  }
}

if (problems.length) {
  console.log(`FAIL  parity: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems.slice(0, 12)) console.log(`  ${p}`);
  process.exit(1);
}
let totalSteps = 0;
for (const row of DATA.rows) totalSteps += pageScope.farmSteps(row).length;
console.log(
  `PASS  parity: the page's ${DATA.rows.length} implied values and ${totalSteps} farm steps are byte-identical to board.json`,
);
