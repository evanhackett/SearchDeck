import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultConfig } from '../src/defaults.js';
import { normalizeConfig } from '../src/core.js';
import { launch } from '../src/launcher.js';
import { loadConfig } from '../src/storage.js';

/** Minimal fake of the chrome.* APIs the launcher uses; records every call. */
function fakeChrome({ failUrl, noWindow = false } = {}) {
  const calls = [];
  let nextTabId = 1;
  globalThis.chrome = {
    windows: {
      async getLastFocused() {
        if (noWindow) throw new Error('No last-focused window');
        return { id: 7, type: 'normal' };
      },
      async create(props) {
        calls.push(['windows.create', props]);
        return { id: 99, tabs: props.url.map(() => ({ id: nextTabId++ })) };
      },
    },
    tabs: {
      async create(props) {
        if (failUrl && props.url.includes(failUrl)) throw new Error('boom');
        calls.push(['tabs.create', props]);
        return { id: nextTabId++ };
      },
      async group(props) {
        calls.push(['tabs.group', props]);
        return 42;
      },
    },
    tabGroups: {
      async update(id, props) {
        calls.push(['tabGroups.update', id, props]);
      },
    },
  };
  return calls;
}

const general = (settings = {}) => {
  const config = defaultConfig();
  config.activeDeckId = 'general-search';
  Object.assign(config.settings, settings);
  return config;
};

test('opens enabled destinations of the active deck in order, first tab active', async () => {
  const calls = fakeChrome();
  const config = general();
  config.decks[1].destinations[1].enabled = false; // Bing
  const result = await launch(config, { query: 'hello world' });

  assert.deepEqual(result, { opened: 4, failed: [] });
  assert.deepEqual(calls.map(([name, p]) => [name, p.url, p.active, p.windowId]), [
    ['tabs.create', 'https://www.google.com/search?q=hello%20world', true, 7],
    ['tabs.create', 'https://www.reddit.com/search/?q=hello%20world', false, 7],
    ['tabs.create', 'https://www.youtube.com/results?search_query=hello%20world', false, 7],
    ['tabs.create', 'https://en.wikipedia.org/w/index.php?search=hello%20world', false, 7],
  ]);
});

test('explicit deck and destination ids override the stored selection', async () => {
  const calls = fakeChrome();
  const result = await launch(general({ foreground: false }), {
    query: 'AAPL',
    deckId: 'stock-research',
    destinationIds: ['stock-yahoo', 'stock-finviz'],
  });
  assert.equal(result.opened, 2);
  // deck order, not request order; background means no tab is activated
  assert.deepEqual(calls.map(([, p]) => [p.url, p.active]), [
    ['https://finviz.com/quote.ashx?t=AAPL', false],
    ['https://finance.yahoo.com/quote/AAPL/', false],
  ]);
});

test('new window receives all URLs in order', async () => {
  const calls = fakeChrome();
  const result = await launch(general({ openIn: 'new', foreground: false }), { query: 'x' });
  assert.equal(result.opened, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'windows.create');
  assert.equal(calls[0][1].focused, false);
  assert.equal(calls[0][1].url[0], 'https://www.google.com/search?q=x');
  assert.equal(calls[0][1].url.length, 5);
});

test('falls back to a new window when no browser window is open', async () => {
  const calls = fakeChrome({ noWindow: true });
  const result = await launch(general(), { query: 'x' });
  assert.equal(result.opened, 5);
  assert.equal(calls[0][0], 'windows.create');
});

test('groups tabs and names the group', async () => {
  let calls = fakeChrome();
  await launch(general({ groupTabs: true }), { query: ' AAPL ' });
  assert.deepEqual(calls.at(-2), ['tabs.group', { tabIds: [1, 2, 3, 4, 5], createProperties: { windowId: 7 } }]);
  assert.deepEqual(calls.at(-1), ['tabGroups.update', 42, { title: 'AAPL — General Search' }]);

  calls = fakeChrome();
  await launch(general({ groupTabs: true, groupIncludeDeck: false, openIn: 'new' }), { query: 'AAPL' });
  assert.deepEqual(calls.at(-2)[1].createProperties, { windowId: 99 });
  assert.deepEqual(calls.at(-1), ['tabGroups.update', 42, { title: 'AAPL' }]);
});

test('a failing tab does not stop the rest and is reported', async () => {
  const calls = fakeChrome({ failUrl: 'google.com' });
  const result = await launch(general(), { query: 'x' });
  assert.deepEqual(result, { opened: 4, failed: ['Google'] });
  assert.equal(calls[0][1].active, true); // the first tab that did open is the active one
});

test('reports errors instead of throwing', async () => {
  const calls = fakeChrome();
  const config = general();
  assert.match((await launch(config, { query: '  ' })).error, /search term/);
  assert.match((await launch(config, { query: 'x', deckId: 'missing' })).error, /deck/);
  assert.match((await launch(config, { query: 'x', destinationIds: [] })).error, /No destinations/);
  assert.match((await launch(config, {})).error, /search term/);
  assert.equal(calls.length, 0);
});

test('loadConfig: defaults when empty, repair when malformed, backup when unreadable', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => void Object.assign(store, items),
      },
    },
  };
  assert.deepEqual(await loadConfig(), defaultConfig());

  store.config = { decks: [{ name: 'Mine', destinations: [{ name: 'A', template: 'https://a.test/{query}' }, { template: 'nope' }] }] };
  const repaired = await loadConfig();
  assert.equal(repaired.decks[0].name, 'Mine');
  assert.equal(repaired.decks[0].destinations.length, 1);
  assert.deepEqual(normalizeConfig(repaired).config, repaired);

  store.config = 'corrupt';
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await loadConfig(), defaultConfig());
  } finally {
    console.warn = original;
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.configBackup, 'corrupt');
});
