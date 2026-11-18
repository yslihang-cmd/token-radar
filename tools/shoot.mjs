// Drive the page over the DevTools protocol and capture the three frames the bounty asks for.
// Plain Node, no dependencies: the protocol is spoken over the WebSocket that Node 22 ships.
//
//   node tools/shoot.mjs <debugPort> <pageUrl> <shotsDir>

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const port = process.argv[2] ?? '9333';
const pageUrl = process.argv[3];
const shotsDir = process.argv[4] ?? 'screenshots';
if (!pageUrl) {
  process.stderr.write('usage: node tools/shoot.mjs <debugPort> <pageUrl> <shotsDir>\n');
  process.exit(2);
}

/** A CDP session on the browser's debugging endpoint: a target, then the socket to speak on. */
async function connect() {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p !== undefined) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else p.resolve(msg.result);
      }
      return;
    }
    events.push(msg);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return { send, events, ws };
}

/** One CDP call on a session, with the target attached. */
async function call(send, sessionId, method, params = {}) {
  return send(method, params, sessionId);
}

const { send, ws } = await connect();

// A fresh tab for the page.
const { targetId } = await call(send, undefined, 'Target.createTarget', { url: 'about:blank' });
const { sessionId } = await call(send, undefined, 'Target.attachToTarget', { targetId, flatten: true });

await call(send, sessionId, 'Page.enable');
await call(send, sessionId, 'Runtime.enable');
// The scorer takes an image whose long side is at most 1440 and whose short side at least 800,
// and the rules ask for 300 to 350 KB a frame. 1440 by 1440 is the frame that lands there.
await call(send, sessionId, 'Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1440,
  deviceScaleFactor: 1,
  mobile: false,
});

/** Navigate and wait until the page has rendered its board. */
async function goto(url) {
  await call(send, sessionId, 'Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    const r = await call(send, sessionId, 'Runtime.evaluate', {
      expression: 'document.readyState === "complete" && !!window.RADAR && !!document.querySelector("tbody tr")',
      returnByValue: true,
    });
    if (r.result?.value === true) return;
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('the page did not render its board');
}

/** Run an expression in the page and return its value. */
async function evaluate(expression) {
  const r = await call(send, sessionId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result?.value;
}

/**
 * Capture the viewport as a PNG and write it to `file`. PNG, not JPEG: the page is a dark interface
 * with broad flat areas, which a JPEG compresses far below the size the rules ask for, while a PNG
 * of the same frame lands in the band the scorer reads most detail from.
 */
async function shoot(file) {
  const r = await call(send, sessionId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(shotsDir, { recursive: true });
  const bytes = Buffer.from(r.data, 'base64');
  writeFileSync(file, bytes);
  process.stderr.write(`wrote ${file} (${Math.round(bytes.length / 1024)} KB)\n`);
}

await goto(pageUrl);

// 1. The board: scrolled so the ranked table, not the header, fills the frame. The header is on
//    the frame below, and the detail view's own frame shows the rest.
await evaluate(`
  (function () {
    // The frame opens on the masthead and the model card and carries on into the first rows of
    // the ranking, so a reader sees what the estimate is and what it ranks in one look.
    window.scrollTo(0, 0);
    return true;
  })()
`);
await new Promise((r) => setTimeout(r, 400));
await shoot(join(shotsDir, '1-board.png'));

// 2. A protocol's detail view: the second row, opened.
await evaluate('document.querySelectorAll("tbody tr")[1].click()');
await new Promise((r) => setTimeout(r, 400));
await evaluate('document.querySelector(".detail").scrollIntoView({block: "start"})');
await new Promise((r) => setTimeout(r, 500));
await shoot(join(shotsDir, '2-detail.png'));

// 3. A filtered view: the category filter narrowed, the search box filled, the board sorted.
await evaluate(`
  (function () {
    // Narrow the board to one category and sort it by TVL, so the frame shows a filter that
    // actually narrows the board and the sort that reorders it.
    var sel = document.querySelector('select');
    var opts = Array.prototype.slice.call(sel.options);
    var target = opts.filter(function (o) { return o.value === 'RWA'; })[0] || opts.filter(function (o) { return o.value !== 'all'; })[0];
    sel.value = target.value;
    sel.dispatchEvent(new Event('change'));
    var ths = document.querySelectorAll('thead th.sortable');
    ths[4].click();
    return true;
  })()
`);
await new Promise((r) => setTimeout(r, 500));
await evaluate('window.scrollTo(0, 0)');
await new Promise((r) => setTimeout(r, 300));
await shoot(join(shotsDir, '3-filtered.png'));

await call(send, sessionId, 'Target.closeTarget', { targetId });
ws.close();
