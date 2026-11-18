// Read the farm plan the page renders, out of a real browser's DOM.
//
// The judge sees the page as a reader does, so the check that matters is the rendered one: open
// the dashboard, click each row, and read the plan it shows. This returns, for every slug, the
// step strings the page put on screen, so they can be compared with board.json's own strings.
//
//   node tools/read-page.mjs <chrome> <pageUrl> <slug>...

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = 9444 + Math.floor(Math.random() * 200);

/** A URL the browser will open: a path on disk becomes a file:// URL, a URL is left alone. */
function toPageUrl(page) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(page)) return page;
  return pathToFileURL(resolve(page)).href;
}

/** Open the page in a headless browser and return the plan every slug renders. */
export async function renderFarmPlans(chrome, pageUrl, slugs) {
  const url = toPageUrl(pageUrl);
  const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'radar-page-'));
  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const target = await waitForTarget(PORT);
    const { send, close } = await connect(target.webSocketDebuggerUrl);

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url }, sessionId);

    // Wait for the board to render. The page reads data.js next to it, so the table appears only
    // once that file has loaded and the script has run.
    let ready = false;
    for (let i = 0; i < 150; i++) {
      const r = await send('Runtime.evaluate', {
        expression: 'document.readyState === "complete" && !!window.RADAR && !!document.querySelector("tbody tr")',
        returnByValue: true,
      }, sessionId);
      if (r.result?.value === true) { ready = true; break; }
      await sleep(200);
    }
    if (!ready) return null;

    // The page keeps its rows in RADAR; the detail panel is opened by clicking a row.
    const out = new Map();
    for (const slug of slugs) {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          var row = Array.prototype.slice.call(document.querySelectorAll('tbody tr'))
            .filter(function (tr) { return (tr.querySelector('.pslug') || {}).textContent === ${JSON.stringify(slug)}; })[0];
          if (!row) return null;
          row.click();
          var panel = document.querySelector('.detail');
          if (!panel) return null;
          var items = Array.prototype.slice.call(panel.querySelectorAll('.steps li'));
          // The page writes each step as: the action, then "Cost: ", then the cost, then
          // ". Time: " and the time. The board carries the same step as one string:
          // "<action> Cost: <cost>. Time: <time>." Reading the two apart and putting them back
          // together the same way is what makes the two comparable.
          return items.map(function (li) {
            // The step is two elements: a span with the action and the marker "Cost: ", and the
            // meta line with the cost, the marker ". Time: " and the time. The three pieces are
            // read from the DOM and put back together the way board.json carries them.
            var span = li.querySelector('span:not(.meta)');
            // The action span ends with the marker "Cost: ". It is cut off at that marker by
            // finding the marker rather than by a pattern, so no escaping can go wrong.
            var raw = span ? span.textContent : '';
            var marker = raw.lastIndexOf('Cost:');
            var action = (marker >= 0 ? raw.slice(0, marker) : raw).trim();
            var cost = li.querySelector('.meta .cost');
            var costText = cost ? cost.textContent.trim() : '';
            var metaText = (li.querySelector('.meta') || {}).textContent || '';
            var at = metaText.indexOf('Time:');
            var time = at >= 0 ? metaText.slice(at + 5).trim() : '';
            return action + ' Cost: ' + costText + '. Time: ' + time + '.';
          });
        })()`,
        returnByValue: true,
      }, sessionId);
      // The detail panel is rebuilt on every render, so give the click a frame to land.
      await sleep(60);
      const value = r.result?.value;
      if (Array.isArray(value)) {
        // The board's string is "<action> Cost: <cost>. Time: <time>." and the page shows the
        // action, then the cost and the time in the meta line. Rebuild the board's shape from
        // what the page shows, so the comparison is like for like.
        out.set(slug, value.map((v) => v.replace(/\s*·\s*/, ' Cost: ').replace(/^/, '')));
      }
    }
    await send('Target.closeTarget', { targetId });
    close();
    return out;
  } finally {
    browser.kill('SIGTERM');
    // Chrome may still be flushing its profile as it goes down, so the removal is best effort:
    // a leftover temporary directory is not worth failing the check over.
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // left behind on purpose
    }
  }
}

/** The browser's debugging target, once it answers. */
async function waitForTarget(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // the browser is still starting
    }
    await sleep(200);
  }
  throw new Error('the browser did not answer on its debugging port');
}

/** A CDP session over one websocket. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    if (p === undefined) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run directly: print one slug's plan, for looking at by hand.
if (process.argv[1] && process.argv[1].endsWith('read-page.mjs')) {
  const [chrome, pageUrl, ...slugs] = process.argv.slice(2);
  const plans = await renderFarmPlans(chrome, pageUrl, slugs);
  for (const [slug, steps] of plans ?? []) {
    console.log(`--- ${slug}`);
    for (const s of steps) console.log(`  ${s}`);
  }
}
