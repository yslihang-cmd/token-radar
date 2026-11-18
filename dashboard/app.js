// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable and sortable table, and a per-protocol detail panel that shows the
// model's own arithmetic: the same function main.ts ran, recomputed here from the row's figures, so
// a reader can check the number on the board against the inputs it came from.
//
// No network, no framework, no build step: every byte this page shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'rank', dir: 1, selected: null, chain: 'all' };

  /* ---------- formatting ---------- */
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- the model, recomputed in the page ----------
     This is the same arithmetic lib/model.ts runs, written out again here on purpose: the page can
     then show a reader every step from the snapshot's own figures to the number on the board, and
     the row carries the result the model wrote so the two can be compared. */
  function impliedOf(row, model) {
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = Math.min(model.growth_cap, Math.max(model.growth_floor, growth));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var maturityMult;
    if (row.age_days === null || row.age_days === undefined) {
      maturityMult = model.unknown_age_maturity;
    } else {
      var ln = Math.log1p(row.age_days);
      var lnFull = Math.log1p(model.age_full_decay);
      var decay = Math.min(1, ln / lnFull);
      maturityMult = model.age_cap - (model.age_cap - model.age_floor) * decay;
    }
    var sizeFactor = Math.pow(Math.max(row.tvl_usd, 0), model.size_exponent);
    var anchor = row.anchor_fdv_tvl;
    var implied = Math.max(1, Math.round(anchor * sizeFactor * growthMult * maturityMult));
    return { implied: implied, anchor: anchor, sizeFactor: sizeFactor, growthMult: growthMult, maturityMult: maturityMult };
  }

  /* ---------- farm plan, generated the same way the model generates it ----------
     Each step is derived from this protocol's own record — its chains, its TVL depth, its week of
     movement, and how long it has run without a token — the same code lib/model.ts runs. */
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function tvlDepth(tvl) {
    if (tvl >= 1e12) return '$' + (tvl / 1e12).toFixed(1) + 'T';
    if (tvl >= 1e9) return '$' + (tvl / 1e9).toFixed(1) + 'B';
    if (tvl >= 1e6) return '$' + (tvl / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(tvl / 1e3) + 'K';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function momentumLine(change, tvl) {
    if (change === null) return 'with no seven-day reading yet, treat the position as a probe: add only after the next snapshot confirms the direction.';
    if (change >= 25) return 'a ' + change.toFixed(0) + '% week means the crowd is already moving — this is the one to front-run, so keep the position topped up and re-check it weekly.';
    if (change >= 5) return 'a ' + change.toFixed(0) + '% week is steady; keep the position and add once more before the next snapshot.';
    if (change >= -5) return 'a flat week (' + change.toFixed(1) + '%) means the base is stable; keep the position without adding until the next reading.';
    if (change >= -20) return 'a ' + change.toFixed(0) + '% week is a mild bleed; keep the position but do not add until it turns.';
    return 'a ' + change.toFixed(0) + '% week against a ' + tvlDepth(tvl) + ' pool is a real drop; hold for now and only re-enter if two straight weeks turn positive.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain);
    var gas = capital >= 150 ? 8 : 4;
    var all = p.chains || [];
    var named = all.length > 5 ? all.slice(0, 5).join(', ') + ' and ' + (all.length - 5) + ' more' : all.join(', ');
    var cross = all.length > 1
      ? "It records " + all.length + ' chains — ' + named + ' — so mirror the position on a second one, starting with ' + chain + ' and adding ' + all[1] + ", to make sure the launch is not read off a single chain's books."
      : 'It runs on ' + chain + ' alone, so the whole position lives there; keep the seed phrase for just that chain and skip the cross-chain work entirely.';
    var depth = 'Its TVL of ' + tvlDepth(p.tvl_usd) + ' is the depth you are buying against: at this size a $' + capital + ' position is a drop in the pool, which is what you want — you want to be counted without moving the rate.';
    var momentum = momentumLine(p.change_7d, p.tvl_usd);
    var ageLine = p.age_days === null || p.age_days === undefined
      ? 'The snapshot records no listing date, so treat the age as unknown: a shorter hold, and a second check of when it actually appeared before you commit the full position.'
      : "It has been listed " + p.age_days + ' days — about ' + Math.max(1, Math.round(p.age_days / 30)) + " months — without a token, which is why the model's own maturity term holds its value down, and the plan's job is to keep the position while that timer runs.";
    return [
      { text: 'Use a fresh wallet that holds only the $' + capital + ' you plan to farm on ' + chain + ', and keep its seed phrase offline.', cost: 'under $' + gas + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: cross, cost: 'one bridged or native transfer, about $4 of gas', time: '10 minutes' },
      { text: 'Read the pool against its depth: ' + depth, cost: 'nothing to read', time: '5 minutes' },
      { text: 'Set your pace from the week of movement: ' + momentum, cost: 'the decision is free, the added capital is not', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot. ' + ageLine, cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw from " + p.name + ", open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction on ' + chain + ' in a farm log, so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  /* ---------- dom helper ---------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* ---------- data slices ---------- */
  var watchSet = {};
  DATA.rows.forEach(function (r) { if (r.is_watchlist) watchSet[r.slug] = true; });
  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function visibleRows() {
    var q = state.q.toLowerCase();
    var out = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return (r.name || '').toLowerCase().indexOf(q) >= 0 || (r.slug || '').toLowerCase().indexOf(q) >= 0;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (typeof av === 'string' || typeof bv === 'string') {
        var c = String(av).localeCompare(String(bv));
        return state.dir * c;
      }
      av = av === null || av === undefined ? -Infinity : av;
      bv = bv === null || bv === undefined ? -Infinity : bv;
      if (av === bv) return a.rank - b.rank;
      return state.dir * (av < bv ? -1 : 1);
    });
    return out;
  }

  /* ---------- header ---------- */
  function renderHeader() {
    var watch = DATA.watchlist_size;
    var early = DATA.early_size;
    var total = DATA.rows.length;
    var sum = DATA.rows.slice(0, 20).reduce(function (s, r) { return s + r.implied_value_usd; }, 0);

    var stats = el('div', { class: 'stats' },
      el('div', { class: 'stat accent' },
        el('div', { class: 'k', text: 'Launch candidates' }),
        el('div', { class: 'v', html: total + '<small>ranked</small>' }),
        el('div', { class: 'n', text: watch + ' on the house watchlist, ' + early + ' more found by the scan' })),
      el('div', { class: 'stat' },
        el('div', { class: 'k', text: 'Implied value, top 20' }),
        el('div', { class: 'v', html: fmtUsd(sum) }),
        el('div', { class: 'n', text: 'sum of the twenty highest implied launch values' })),
      el('div', { class: 'stat' },
        el('div', { class: 'k', text: 'Category anchor' }),
        el('div', { class: 'v', html: DATA.global_anchor.toFixed(1) + '<small>anchor</small>' }),
        el('div', { class: 'n', text: 'the all-category median multiple, the anchor’s own fallback' })),
      el('div', { class: 'stat' },
        el('div', { class: 'k', text: 'Already trading' }),
        el('div', { class: 'v', html: DATA.live_size + '<small>live</small>' }),
        el('div', { class: 'n', text: 'token-bearing protocols, shown apart from the board' })));

    var formula = el('div', { class: 'formula' });
    formula.innerHTML =
      '<span class="term">implied_value</span> = <span class="term2">anchor</span> × <span class="term">TVL</span><sup>' + DATA.model.size_exponent + '</sup> × <span class="term2">growth</span> × <span class="term">maturity</span>' +
      '<br>' +
      '<span class="term2">anchor</span> = median of (market cap ÷ TVL<sup>' + DATA.model.size_exponent + '</sup>) over live peers of the same category, blended on the log with the all-category median (' + DATA.global_anchor.toFixed(2) + '); with k peers, trust = k ÷ (k + 3)' +
      '<br>' +
      '<span class="term">growth</span> = 1 + ' + DATA.model.growth_weight + ' × (7d TVL change ÷ 100), clamped to [' + DATA.model.growth_floor + '%, ' + DATA.model.growth_cap + '%]' +
      '<br>' +
      '<span class="term">maturity</span> = ' + DATA.model.age_cap + ' − ' + (DATA.model.age_cap - DATA.model.age_floor) + ' × ln(1 + days) ÷ ln(1 + ' + DATA.model.age_full_decay + '); unknown listing date → ' + DATA.model.unknown_age_maturity + ' &nbsp;&nbsp;·&nbsp;&nbsp; no protocol name is special-cased';

    var card = el('section', { class: 'model-card' },
      el('header', null,
        el('h2', { text: 'How a launch is valued' }),
        el('span', { class: 'tag', text: 'model ' + DATA.model_version })),
      formula,
      el('p', { class: 'note', html:
        'Every figure comes from the sealed snapshot itself: <b>TVL</b>, the <b>seven-day TVL change</b>, <b>days listed</b>, the <b>category</b> and the <b>chains</b> a protocol records. ' +
        'The anchor is read out of the same file — each protocol that <b>already has a token</b> and a real market cap contributes one observation of market cap over TVL raised to the size exponent, and a category’s median is what a protocol of that category would fetch if it issued one. ' +
        'A thin category is <b>blended on the logarithm with the all-category median</b>, in proportion to how many peers it has: one observation trusts the category a quarter and the market three quarters. ' +
        'Growth lifts a launch that is close; age lowers one that has clearly been decided against. Nothing in the model reads a protocol’s name.' }));

    return el('header', { class: 'masthead' },
      el('div', { class: 'masthead-top' },
        el('div', null,
          el('div', { class: 'brand' },
            el('div', { class: 'sweep', 'aria-hidden': 'true' }),
            el('div', null,
              el('h1', { text: 'Token Radar' }),
              el('div', { class: 'sub', text: 'Protocols that record no token yet, ranked by what a launch would be worth, with the steps to farm each one.' }))),
          el('div', { class: 'asof', html: 'snapshot <b>' + DATA.as_of + '</b> &nbsp;·&nbsp; ' + DATA.source })),
        stats),
      card);
  }

  /* ---------- controls ---------- */
  function renderControls(onChange) {
    var search = el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; onChange(); });

    var catSel = el('select', { 'aria-label': 'Filter by category' });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; onChange(); });

    var chainSel = el('select', { 'aria-label': 'Filter by chain' });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; onChange(); });

    var tabs = el('div', { class: 'tabs', role: 'tablist' });
    [['pre-token', 'Pre-token board'], ['live', 'Already trading']].forEach(function (t) {
      var b = el('button', { type: 'button', role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false', text: t[1] });
      b.addEventListener('click', function () { state.tab = t[0]; state.selected = null; onChange(); });
      tabs.appendChild(b);
    });

    var count = el('div', { class: 'count' });

    var bar = el('div', { class: 'controls' },
      tabs,
      el('div', { class: 'field' }, el('label', { text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { text: 'Chain' }), chainSel),
      count);
    return { bar: bar, count: count };
  }

  /* ---------- the board table ---------- */
  var COLUMNS = [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: 'Protocol' },
    { key: 'category', label: 'Category' },
    { key: 'chains', label: 'Chains' },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
    { key: 'age_days', label: 'Listed', num: true },
    { key: 'anchor_scope', label: 'Anchor', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true }
  ];

  function sortHeader(col, onChange) {
    var th = el('th', { class: 'sortable', text: col.label });
    if (state.sort === col.key) th.appendChild(el('span', { class: 'arrow', text: state.dir === 1 ? '▲' : '▼' }));
    th.addEventListener('click', function () {
      if (state.sort === col.key) state.dir = -state.dir;
      else { state.sort = col.key; state.dir = col.key === 'rank' || col.key === 'name' ? 1 : -1; }
      onChange();
    });
    return th;
  }

  function renderTable(rows, onChange) {
    var max = rows.length ? rows[0].implied_value_usd : 1;
    var thead = el('thead', null, el('tr', null, COLUMNS.map(function (c) { return sortHeader(c, onChange); })));
    var tbody = el('tbody');

    rows.forEach(function (r) {
      var pct = r.change_7d;
      var tr = el('tr', { class: state.selected === r.slug ? 'on' : '' });
      tr.addEventListener('click', function () { state.selected = state.selected === r.slug ? null : r.slug; onChange(); });

      tr.appendChild(el('td', { class: 'rank', text: String(r.rank) }));

      var nameCell = el('td', null,
        el('div', { class: 'pname' }, el('span', { text: r.name }), r.is_watchlist ? el('span', { class: 'wl', text: 'WATCHLIST' }) : null),
        el('div', { class: 'pslug', text: r.slug }));
      tr.appendChild(nameCell);

      tr.appendChild(el('td', { class: 'cat', text: r.category || '—' }));

      var tags = el('div', { class: 'chain-tags' });
      (r.chains || []).slice(0, 3).forEach(function (c) { tags.appendChild(el('span', { text: c })); });
      if ((r.chains || []).length > 3) tags.appendChild(el('span', { class: 'more', text: '+' + (r.chains.length - 3) }));
      tr.appendChild(el('td', null, tags));

      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num ' + (pct === null ? 'dim' : pct >= 0 ? 'pos' : 'neg'), text: fmtPct(pct) }));
      tr.appendChild(el('td', { class: 'num dim', text: fmtAge(r.age_days) }));

      var scopeLabel = r.anchor_scope === 'category' ? 'category' : 'global';
      var scopeTip = r.anchor_scope === 'category'
        ? 'Anchored to the median of (market cap ÷ TVL^' + DATA.model.size_exponent + ') over ' + r.anchor_peers + ' live peers in this protocol’s own category, blended on the logarithm with the all-category median by how thin that sample is'
        : 'Anchored to the all-category median of (market cap ÷ TVL^' + DATA.model.size_exponent + ') — no priced live peers are recorded in this category';
      tr.appendChild(el('td', { class: 'num dim anchor-scope scope-' + r.anchor_scope, title: scopeTip, text: scopeLabel }));

      var bar = el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' }));
      tr.appendChild(el('td', null, el('div', { class: 'value', text: fmtUsd(r.implied_value_usd) }), bar));

      tbody.appendChild(tr);
    });

    return el('div', { class: 'board' }, el('table', null, thead, tbody));
  }

  /* ---------- the live view ---------- */
  function renderLive() {
    var rows = DATA.live;
    var thead = el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'TVL' }),
      el('th', { text: 'Market cap' }),
      el('th', { text: 'FDV/TVL' }),
      el('th', { text: '7d' })));
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'pname', text: r.name }), el('div', { class: 'pslug', text: r.slug })),
        el('td', { class: 'cat', text: r.category || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.fdv_tvl === null ? '—' : r.fdv_tvl.toFixed(3) }),
        el('td', { class: 'num ' + (r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })));
    });
    return el('div', null,
      el('p', { class: 'live-note', html: 'These protocols <b>already have a token</b>: their value is the market’s, not the model’s. They are listed apart from the board, and their market cap over TVL is what the board’s anchor is measured against — the anchor reads each live peer’s market cap over its own size, then takes the median of those observations in a category.' }),
      el('div', { class: 'board' }, el('table', null, thead, tbody)));
  }

  /* ---------- the detail panel ---------- */
  function renderDetail(row) {
    var calc = impliedOf(row, DATA.model);
    var steps = farmSteps(row);

    var kv = el('dl', { class: 'kv' },
      el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(row.tvl_usd) }),
      el('dt', { text: '7d TVL change' }), el('dd', { text: fmtPct(row.change_7d) }),
      el('dt', { text: 'Listed' }), el('dd', { text: row.listed_at || 'unknown' }),
      el('dt', { text: 'Age' }), el('dd', { text: fmtAge(row.age_days) }),
      el('dt', { text: 'Category' }), el('dd', { text: row.category || '—' }),
      el('dt', { text: 'Chains' }), el('dd', { text: (row.chains || []).join(', ') || '—' }),
      el('dt', { text: 'Token recorded' }), el('dd', { text: 'none — no market cap, no CoinGecko id, no symbol' }));

    var calcBox = el('div', { class: 'calc' },
      el('div', { class: 'line' }, el('span', { text: 'anchor (' + row.anchor_scope + ')' }), el('b', { text: row.anchor_fdv_tvl.toFixed(2) + (row.anchor_scope === 'category' ? ' from ' + row.anchor_peers + ' live peers' : ' all-category median') })),
      el('div', { class: 'line' }, el('span', { text: 'size (TVL^' + DATA.model.size_exponent + ')' }), el('b', { text: calc.sizeFactor.toExponential(2) })),
      el('div', { class: 'line' }, el('span', { text: 'growth (7d TVL change)' }), el('b', { text: calc.growthMult.toFixed(4) })),
      el('div', { class: 'line' }, el('span', { text: row.age_days === null ? 'maturity (unknown listing date)' : 'maturity (' + row.age_days + ' days listed)' }), el('b', { text: calc.maturityMult.toFixed(4) })),
      el('div', { class: 'line total' }, el('span', { text: 'implied value' }), el('b', { text: fmtUsd(calc.implied) })));

    var stepList = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      // The cost and the time read as the model's own sentence, so the page shows the same string
      // board.json carries for this step: "action Cost: cost. Time: time."
      stepList.appendChild(el('li', null,
        el('span', { text: s.text + ' Cost: ' }),
        el('span', { class: 'meta', html: '<span class="cost">' + esc(s.cost) + '</span>. Time: ' + esc(s.time) })));
    });

    var head = el('header', null,
      el('div', null,
        el('h2', { text: row.name }),
        el('div', { class: 'pslug', text: row.slug + ' · rank ' + row.rank + ' of ' + DATA.board_size })),
      el('button', { class: 'close', type: 'button', text: 'Close' }));

    var panel = el('section', { class: 'detail' }, head,
      el('div', { class: 'detail-body' },
        el('div', null,
          el('h3', { text: 'What the snapshot records' }),
          kv,
          calcBox,
          el('p', { class: 'disclaimer', text: 'This is an estimate of what a launch would be worth if the protocol’s record stayed as it is. It is not a forecast of whether a token will be issued, and nothing here is financial advice.' })),
        el('div', null,
          el('h3', { text: 'How to farm it' }),
          stepList)));

    head.querySelector('.close').addEventListener('click', function () { state.selected = null; render(); });
    return panel;
  }

  /* ---------- render ---------- */
  function render() {
    var scroll = window.scrollY;
    app.innerHTML = '';
    app.removeAttribute('aria-busy');

    var shell = el('div', { class: 'shell' });
    shell.appendChild(renderHeader());

    var ctl = renderControls(render);
    shell.appendChild(ctl.bar);

    if (state.tab === 'pre-token') {
      var rows = visibleRows();
      ctl.count.innerHTML = '<b>' + rows.length + '</b> of ' + DATA.board_size + ' ranked';
      shell.appendChild(renderTable(rows, render));
      if (state.selected) {
        var sel = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
        if (sel) shell.appendChild(renderDetail(sel));
      }
    } else {
      ctl.count.innerHTML = '<b>' + DATA.live_size + '</b> live-token protocols';
      shell.appendChild(renderLive());
    }

    shell.appendChild(el('footer', null,
      el('span', { html: 'Model <code>' + DATA.model_version + '</code> · floor <code>$' + (DATA.floor_usd / 1e6).toFixed(0) + 'M</code> · watchlist <code>' + DATA.watchlist_size + '</code>' }),
      el('span', { html: 'Static page, no network. Data from <code>DefiLlama</code> as of <code>' + DATA.as_of + '</code>.' })));

    app.appendChild(shell);
    window.scrollTo(0, scroll);
  }

  render();
})();
