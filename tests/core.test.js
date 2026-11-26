import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  buildMenuItems,
  buildUrl,
  duplicateDeck,
  getActiveDeck,
  groupTitle,
  moveItem,
  normalizeConfig,
  normalizeSettings,
  parseMenuId,
  templateOrigin,
  validateFavicon,
  validateTemplate,
} from '../src/core.js';
import { DEFAULT_SETTINGS, defaultConfig } from '../src/defaults.js';

test('buildUrl substitutes the query', () => {
  assert.equal(buildUrl('https://finviz.com/quote.ashx?t={query}', 'AAPL'), 'https://finviz.com/quote.ashx?t=AAPL');
  assert.equal(buildUrl('https://finance.yahoo.com/quote/{query}/', 'AAPL'), 'https://finance.yahoo.com/quote/AAPL/');
  assert.equal(buildUrl('https://www.google.com/search?q={query}+stock', 'AAPL'), 'https://www.google.com/search?q=AAPL+stock');
});

test('buildUrl URL-encodes spaces and special characters', () => {
  const t = 'https://www.google.com/search?q={query}';
  assert.equal(buildUrl(t, 'hello world'), 'https://www.google.com/search?q=hello%20world');
  assert.equal(buildUrl(t, 'a&b=c#d?e/f+g'), 'https://www.google.com/search?q=a%26b%3Dc%23d%3Fe%2Ff%2Bg');
  assert.equal(buildUrl(t, 'café 日本'), `https://www.google.com/search?q=${encodeURIComponent('café 日本')}`);
  assert.equal(buildUrl(t, '$& $1 $$'), `https://www.google.com/search?q=${encodeURIComponent('$& $1 $$')}`);
  assert.equal(buildUrl('https://example.com/{query}/x', '../etc'), 'https://example.com/..%2Fetc/x');
});

test('buildUrl trims the query and replaces every placeholder', () => {
  assert.equal(buildUrl('https://example.com/{query}?again={query}', '  BRK.B  '), 'https://example.com/BRK.B?again=BRK.B');
});

test('buildUrl returns null for unusable input', () => {
  assert.equal(buildUrl('https://example.com/?q={query}', ''), null);
  assert.equal(buildUrl('https://example.com/?q={query}', '   '), null);
  assert.equal(buildUrl('https://example.com/?q={query}', undefined), null);
  assert.equal(buildUrl('https://example.com/?q={query}', '\ud800'), null); // lone surrogate
  assert.equal(buildUrl('javascript:alert({query})', 'x'), null);
  assert.equal(buildUrl('https://example.com/', 'x'), null);
  assert.equal(buildUrl(null, 'x'), null);
});

test('buildUrl cannot be steered to another scheme by the query', () => {
  assert.equal(buildUrl('{query}', 'javascript:alert(1)'), null);
  assert.equal(buildUrl('https://{query}/', 'evil.com/path'), null); // encoded "/" is not a valid host
});

test('validateTemplate accepts http and https templates', () => {
  assert.equal(validateTemplate('https://example.com/search?q={query}'), null);
  assert.equal(validateTemplate('http://localhost:8080/{query}'), null);
  for (const deck of defaultConfig().decks) {
    for (const d of deck.destinations) assert.equal(validateTemplate(d.template), null, d.name);
  }
});

test('validateTemplate rejects bad templates with a message', () => {
  assert.match(validateTemplate(''), /required/);
  assert.match(validateTemplate(undefined), /required/);
  assert.match(validateTemplate('https://example.com/search'), /\{query\}/);
  assert.match(validateTemplate('example.com/?q={query}'), /valid URL/);
  assert.match(validateTemplate('https://exa mple.com/?q={query}'), /spaces/);
  assert.match(validateTemplate('javascript:alert("{query}")'), /http/);
  assert.match(validateTemplate('data:text/html,{query}'), /http/);
  assert.match(validateTemplate('file:///etc/{query}'), /http/);
  assert.match(validateTemplate('chrome://settings/{query}'), /http/);
  assert.match(validateTemplate(`https://example.com/{query}${'a'.repeat(LIMITS.template)}`), /longer/);
});

test('validateFavicon allows empty or http(s) only', () => {
  assert.equal(validateFavicon(''), null);
  assert.equal(validateFavicon('https://example.com/favicon.ico'), null);
  assert.ok(validateFavicon('javascript:alert(1)'));
  assert.ok(validateFavicon('data:image/svg+xml,<svg onload=alert(1)>'));
  assert.ok(validateFavicon('not a url'));
});

test('templateOrigin', () => {
  assert.equal(templateOrigin('https://www.google.com/search?q={query}'), 'https://www.google.com');
  assert.equal(templateOrigin('nonsense'), '');
  assert.equal(templateOrigin('javascript:{query}'), '');
});

test('groupTitle', () => {
  assert.equal(groupTitle(' AAPL ', 'Stock Research', true), 'AAPL — Stock Research');
  assert.equal(groupTitle('AAPL', 'Stock Research', false), 'AAPL');
});

test('default configuration is already normalized', () => {
  const { config, warnings } = normalizeConfig(defaultConfig());
  assert.deepEqual(config, defaultConfig());
  assert.deepEqual(warnings, []);
  assert.deepEqual(config.decks.map((d) => d.destinations.length), [8, 5]);
});

test('normalizeConfig rejects configurations with nothing usable', () => {
  assert.throws(() => normalizeConfig(null), /JSON object/);
  assert.throws(() => normalizeConfig([]), /JSON object/);
  assert.throws(() => normalizeConfig('x'), /JSON object/);
  assert.throws(() => normalizeConfig({}), /decks/);
  assert.throws(() => normalizeConfig({ decks: [] }), /no valid decks/);
  assert.throws(() => normalizeConfig({ decks: [1, 'two', null] }), /no valid decks/);
});

test('normalizeConfig drops invalid destinations and reports them', () => {
  const { config, warnings } = normalizeConfig({
    decks: [
      {
        name: 'Mixed',
        destinations: [
          { name: 'Good', template: 'https://example.com/?q={query}' },
          { name: 'Script', template: 'javascript:alert("{query}")' },
          { name: 'No placeholder', template: 'https://example.com/' },
          { name: 'Bad icon', template: 'https://example.org/{query}', favicon: 'javascript:alert(1)' },
          'garbage',
        ],
      },
    ],
  });
  assert.deepEqual(config.decks[0].destinations.map((d) => d.name), ['Good', 'Bad icon']);
  assert.equal(config.decks[0].destinations[1].favicon, '');
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /Mixed › Script skipped/);
});

test('normalizeConfig fills in defaults and copies only known fields', () => {
  const raw = JSON.parse(
    '{"__proto__":{"polluted":true},"extra":1,"settings":{"theme":"neon","openIn":"new","groupTabs":"yes"},' +
      '"decks":[{"name":"  ","onclick":"x","destinations":[{"template":" https://example.com/{query} ","enabled":false,"evil":"<script>"}]}]}',
  );
  const { config } = normalizeConfig(raw);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(config), ['version', 'activeDeckId', 'settings', 'decks']);
  assert.deepEqual(config.settings, { ...DEFAULT_SETTINGS, openIn: 'new' });
  const [deck] = config.decks;
  assert.equal(deck.name, 'Deck 1');
  assert.deepEqual(Object.keys(deck), ['id', 'name', 'destinations']);
  const [dest] = deck.destinations;
  assert.deepEqual(Object.keys(dest), ['id', 'name', 'template', 'enabled', 'favicon']);
  assert.equal(dest.name, 'example.com');
  assert.equal(dest.template, 'https://example.com/{query}');
  assert.equal(dest.enabled, false);
  assert.equal(config.activeDeckId, deck.id);
});

test('normalizeConfig repairs missing, invalid and duplicate ids', () => {
  const t = 'https://example.com/{query}';
  const { config } = normalizeConfig({
    activeDeckId: 'b',
    decks: [
      { id: 'a', name: 'A', destinations: [{ id: 'x', template: t }, { id: 'x', template: t }, { id: '<bad id>', template: t }] },
      { id: 'a', name: 'B', destinations: [{ template: t }] },
      { id: 'b', name: 'C', destinations: [] },
    ],
  });
  const ids = config.decks.flatMap((d) => [d.id, ...d.destinations.map((x) => x.id)]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[\w-]{1,64}$/.test(id)));
  assert.equal(config.decks[0].id, 'a');
  assert.equal(config.decks[0].destinations[0].id, 'x');
  assert.equal(config.activeDeckId, 'b');
});

test('normalizeConfig enforces size limits', () => {
  const t = 'https://example.com/{query}';
  const { config, warnings } = normalizeConfig({
    decks: [{ name: 'n'.repeat(500), destinations: Array.from({ length: LIMITS.destinations + 5 }, () => ({ template: t })) }],
  });
  assert.equal(config.decks[0].name.length, LIMITS.name);
  assert.equal(config.decks[0].destinations.length, LIMITS.destinations);
  assert.equal(warnings.length, 1);
});

test('normalizeSettings tolerates garbage', () => {
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings('dark'), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings({ theme: 'dark', foreground: false, groupTabs: 1 }), {
    ...DEFAULT_SETTINGS,
    theme: 'dark',
    foreground: false,
  });
});

test('getActiveDeck falls back to the first deck', () => {
  const config = defaultConfig();
  assert.equal(getActiveDeck(config).id, 'stock-research');
  config.activeDeckId = 'general-search';
  assert.equal(getActiveDeck(config).id, 'general-search');
  config.activeDeckId = 'gone';
  assert.equal(getActiveDeck(config).id, 'stock-research');
});

test('duplicateDeck makes an independent copy with fresh ids and a unique name', () => {
  const [deck] = defaultConfig().decks;
  const copy = duplicateDeck(deck, ['Stock Research', 'Stock Research copy']);
  assert.equal(copy.name, 'Stock Research copy 2');
  assert.notEqual(copy.id, deck.id);
  assert.deepEqual(copy.destinations.map((d) => d.template), deck.destinations.map((d) => d.template));
  assert.ok(copy.destinations.every((d, i) => d.id !== deck.destinations[i].id && d !== deck.destinations[i]));
});

test('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(moveItem(list, 0, 1), true);
  assert.deepEqual(list, ['b', 'a', 'c', 'd']);
  assert.equal(moveItem(list, 3, 0), true);
  assert.deepEqual(list, ['d', 'b', 'a', 'c']);
  assert.equal(moveItem(list, 0, 3), true);
  assert.deepEqual(list, ['b', 'a', 'c', 'd']);
  assert.equal(moveItem(list, 0, -1), false);
  assert.equal(moveItem(list, 3, 4), false);
  assert.equal(moveItem(list, 2, 2), false);
  assert.equal(moveItem(list, NaN, 1), false);
  assert.deepEqual(list, ['b', 'a', 'c', 'd']);
});

test('buildMenuItems: active deck at the top level, other decks as submenus', () => {
  const config = defaultConfig();
  config.activeDeckId = 'general-search';
  config.decks[1].destinations[1].enabled = false; // Bing
  config.decks[0].name = 'Stocks & ETFs';
  const items = buildMenuItems(config);

  assert.deepEqual(items[0], { id: 'root', title: 'SearchDeck: “%s”' });
  assert.deepEqual(items[1], { id: 'all:general-search', parentId: 'root', title: 'All enabled in General Search (4)', enabled: true });
  assert.deepEqual(items[2], { id: 'sep:general-search', parentId: 'root', type: 'separator' });
  assert.deepEqual(
    items.filter((i) => i.parentId === 'root' && i.id.startsWith('dest:')).map((i) => i.title),
    ['Google', 'Bing', 'Reddit', 'YouTube', 'Wikipedia'], // disabled destinations can still be picked individually
  );
  assert.deepEqual(items.find((i) => i.id === 'deck:stock-research'), { id: 'deck:stock-research', parentId: 'root', title: 'Stocks && ETFs' });
  const sub = items.filter((i) => i.parentId === 'deck:stock-research');
  assert.equal(sub[0].title, 'All enabled in Stocks && ETFs (8)');
  assert.equal(sub.length, 10); // all + separator + 8 destinations

  // every parent is created before its children, and ids are unique
  const seen = new Set();
  for (const item of items) {
    assert.ok(!item.parentId || seen.has(item.parentId), item.id);
    assert.ok(!seen.has(item.id), item.id);
    seen.add(item.id);
  }
});

test('buildMenuItems: edge cases', () => {
  const config = defaultConfig();
  config.settings.contextMenu = false;
  assert.deepEqual(buildMenuItems(config), []);

  const single = normalizeConfig({ decks: [{ id: 'd', name: 'Empty', destinations: [] }] }).config;
  assert.deepEqual(buildMenuItems(single).map((i) => [i.id, i.enabled]), [
    ['root', undefined],
    ['all:d', false],
  ]);
});

test('parseMenuId', () => {
  assert.deepEqual(parseMenuId('all:stock-research'), { deckId: 'stock-research' });
  assert.deepEqual(parseMenuId('dest:stock-research:stock-finviz'), { deckId: 'stock-research', destinationIds: ['stock-finviz'] });
  for (const id of ['root', 'sep:decks', 'deck:stock-research', 'dest:only-deck', '', undefined, 7]) {
    assert.equal(parseMenuId(id), null);
  }
  for (const item of buildMenuItems(defaultConfig())) {
    assert.equal(parseMenuId(item.id) !== null, /^(all|dest):/.test(item.id));
  }
});
