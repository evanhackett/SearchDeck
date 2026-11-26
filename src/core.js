// Pure logic: no chrome.* and no DOM, so it runs unchanged under `node --test`.

import { CONFIG_VERSION, DEFAULT_SETTINGS } from './defaults.js';

export const PLACEHOLDER = '{query}';
export const LIMITS = Object.freeze({ name: 80, template: 2000, decks: 100, destinations: 100 });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isWebUrl = (url) => url.protocol === 'https:' || url.protocol === 'http:';
const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, LIMITS.name) : '');

export function newId() {
  return crypto.randomUUID();
}

function parseTemplate(template) {
  try {
    return new URL(template.replaceAll(PLACEHOLDER, 'test'));
  } catch {
    return null;
  }
}

/** Returns an error message, or null when the template is usable. */
export function validateTemplate(template) {
  if (typeof template !== 'string' || !template.trim()) return 'URL template is required.';
  if (template.length > LIMITS.template) return `URL template is longer than ${LIMITS.template} characters.`;
  if (/\s/.test(template.trim())) return 'URL template must not contain spaces.';
  if (!template.includes(PLACEHOLDER)) return `URL template must contain ${PLACEHOLDER} where the search term goes.`;
  const url = parseTemplate(template.trim());
  if (!url) return 'Not a valid URL. Templates look like https://example.com/search?q={query}';
  if (!isWebUrl(url)) return 'Only http:// and https:// URLs are allowed.';
  return null;
}

/** Returns an error message, or null. An empty favicon is valid (it is optional). */
export function validateFavicon(favicon) {
  if (favicon === '' || favicon === undefined || favicon === null) return null;
  if (typeof favicon !== 'string' || favicon.length > LIMITS.template) return 'Icon URL is not valid.';
  try {
    return isWebUrl(new URL(favicon)) ? null : 'Icon URL must start with https:// or http://';
  } catch {
    return 'Icon URL is not a valid URL.';
  }
}

/** Origin of a template (e.g. "https://finviz.com"), or '' if it cannot be parsed. */
export function templateOrigin(template) {
  const url = typeof template === 'string' ? parseTemplate(template) : null;
  return url && isWebUrl(url) ? url.origin : '';
}

/**
 * Substitutes the URL-encoded query into the template.
 * Returns the final URL, or null if the result is not a valid http(s) URL.
 */
export function buildUrl(template, query) {
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term || validateTemplate(template)) return null;
  try {
    const encoded = encodeURIComponent(term);
    const url = new URL(template.trim().replaceAll(PLACEHOLDER, () => encoded));
    return isWebUrl(url) ? url.href : null;
  } catch {
    return null; // lone surrogates in the query, or the query broke the host name
  }
}

export function groupTitle(query, deckName, includeDeck) {
  const term = String(query).trim();
  return includeDeck && deckName ? `${term} — ${deckName}` : term;
}

export function normalizeSettings(raw) {
  const src = isObject(raw) ? raw : {};
  const bool = (key) => (typeof src[key] === 'boolean' ? src[key] : DEFAULT_SETTINGS[key]);
  const oneOf = (key, allowed) => (allowed.includes(src[key]) ? src[key] : DEFAULT_SETTINGS[key]);
  return {
    openIn: oneOf('openIn', ['current', 'new']),
    groupTabs: bool('groupTabs'),
    groupIncludeDeck: bool('groupIncludeDeck'),
    foreground: bool('foreground'),
    theme: oneOf('theme', ['system', 'light', 'dark']),
    contextMenu: bool('contextMenu'),
  };
}

/**
 * Turns untrusted data (storage contents or an imported file) into a well-formed
 * configuration. Only known fields are copied, invalid destinations are dropped
 * and reported in `warnings`. Throws when there is nothing usable at all.
 */
export function normalizeConfig(raw) {
  if (!isObject(raw)) throw new Error('Configuration must be a JSON object.');
  if (!Array.isArray(raw.decks)) throw new Error('Configuration has no "decks" list.');

  const warnings = [];
  const usedIds = new Set();
  const takeId = (id) => {
    const ok = typeof id === 'string' && /^[\w-]{1,64}$/.test(id) && !usedIds.has(id);
    const value = ok ? id : newId();
    usedIds.add(value);
    return value;
  };

  if (raw.decks.length > LIMITS.decks) warnings.push(`Only the first ${LIMITS.decks} decks were kept.`);

  const decks = [];
  raw.decks.slice(0, LIMITS.decks).forEach((rawDeck, i) => {
    if (!isObject(rawDeck)) {
      warnings.push(`Deck ${i + 1} skipped: not an object.`);
      return;
    }
    const name = cleanName(rawDeck.name) || `Deck ${i + 1}`;
    const rawDests = Array.isArray(rawDeck.destinations) ? rawDeck.destinations : [];
    if (rawDests.length > LIMITS.destinations) {
      warnings.push(`${name}: only the first ${LIMITS.destinations} destinations were kept.`);
    }

    const destinations = [];
    rawDests.slice(0, LIMITS.destinations).forEach((rawDest, j) => {
      const label = `${name} › ${(isObject(rawDest) && cleanName(rawDest.name)) || `destination ${j + 1}`}`;
      if (!isObject(rawDest)) {
        warnings.push(`${label} skipped: not an object.`);
        return;
      }
      const template = typeof rawDest.template === 'string' ? rawDest.template.trim() : '';
      const error = validateTemplate(template);
      if (error) {
        warnings.push(`${label} skipped: ${error}`);
        return;
      }
      let favicon = typeof rawDest.favicon === 'string' ? rawDest.favicon.trim() : '';
      if (validateFavicon(favicon)) {
        warnings.push(`${label}: icon URL ignored (must be http or https).`);
        favicon = '';
      }
      destinations.push({
        id: takeId(rawDest.id),
        name: cleanName(rawDest.name) || new URL(templateOrigin(template)).hostname,
        template,
        enabled: rawDest.enabled !== false,
        favicon,
      });
    });

    decks.push({ id: takeId(rawDeck.id), name, destinations });
  });

  if (!decks.length) throw new Error('Configuration contains no valid decks.');

  return {
    config: {
      version: CONFIG_VERSION,
      activeDeckId: decks.some((d) => d.id === raw.activeDeckId) ? raw.activeDeckId : decks[0].id,
      settings: normalizeSettings(raw.settings),
      decks,
    },
    warnings,
  };
}

export function getActiveDeck(config) {
  return config.decks.find((d) => d.id === config.activeDeckId) ?? config.decks[0];
}

/** Copy of a deck with fresh ids and a name that is not in `takenNames`. */
export function duplicateDeck(deck, takenNames = []) {
  const base = `${deck.name} copy`.slice(0, LIMITS.name);
  let name = base;
  for (let n = 2; takenNames.includes(name); n++) name = `${base.slice(0, LIMITS.name - 4)} ${n}`;
  return {
    id: newId(),
    name,
    destinations: deck.destinations.map((d) => ({ ...d, id: newId() })),
  };
}

/** Moves list[from] to position `to` in place. Returns false if nothing moved. */
export function moveItem(list, from, to) {
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < list.length;
  if (!valid(from) || !valid(to) || from === to) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

export const MENU_ROOT = 'root';

/**
 * Right-click menu for selected text, as a flat list of chrome.contextMenus
 * items (parents before children). The active deck's destinations sit directly
 * under the root; every other deck gets a submenu. Ids encode the target:
 * "all:<deckId>" and "dest:<deckId>:<destinationId>" (ids never contain ":").
 */
export function buildMenuItems(config) {
  if (!config.settings.contextMenu) return [];
  const escape = (text) => text.replaceAll('&', '&&'); // a single & marks an access key
  const items = [{ id: MENU_ROOT, title: 'SearchDeck: “%s”' }];

  const addDeck = (deck, parentId) => {
    const count = deck.destinations.filter((d) => d.enabled).length;
    items.push({
      id: `all:${deck.id}`,
      parentId,
      title: `All enabled in ${escape(deck.name)} (${count})`,
      enabled: count > 0,
    });
    if (deck.destinations.length) items.push({ id: `sep:${deck.id}`, parentId, type: 'separator' });
    for (const d of deck.destinations) items.push({ id: `dest:${deck.id}:${d.id}`, parentId, title: escape(d.name) });
  };

  const active = getActiveDeck(config);
  addDeck(active, MENU_ROOT);
  const others = config.decks.filter((deck) => deck !== active);
  if (others.length) items.push({ id: 'sep:decks', parentId: MENU_ROOT, type: 'separator' });
  for (const deck of others) {
    items.push({ id: `deck:${deck.id}`, parentId: MENU_ROOT, title: escape(deck.name) });
    addDeck(deck, `deck:${deck.id}`);
  }
  return items;
}

/** Turns a clicked menu id into launch() arguments, or null for non-launching items. */
export function parseMenuId(id) {
  const [kind, deckId, destinationId] = String(id).split(':');
  if (kind === 'all' && deckId) return { deckId };
  if (kind === 'dest' && deckId && destinationId) return { deckId, destinationIds: [destinationId] };
  return null;
}
