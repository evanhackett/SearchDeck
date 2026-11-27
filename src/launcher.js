// Opens the destinations of a deck for a query, honouring the tab settings.

import { buildUrl, getActiveDeck, groupTitle, needsQuery } from './core.js';

/**
 * @param config  normalized configuration
 * @param request { query?, deckId?, destinationIds? } — without deckId the active
 *                deck is used; without destinationIds the enabled destinations.
 * @returns {Promise<{ opened: number, failed: string[], error?: string }>}
 *          `failed` lists the names of destinations that could not be opened.
 */
export async function launch(config, { query, deckId, destinationIds } = {}) {
  const term = typeof query === 'string' ? query.trim() : '';

  const deck = deckId ? config.decks.find((d) => d.id === deckId) : getActiveDeck(config);
  if (!deck) return { opened: 0, failed: [], error: 'That deck no longer exists.' };

  const wanted = Array.isArray(destinationIds) ? new Set(destinationIds) : null;
  const selected = deck.destinations.filter((d) => (wanted ? wanted.has(d.id) : d.enabled));
  if (!selected.length) return { opened: 0, failed: [], error: 'No destinations are selected.' };
  // Fixed URLs open without a search term; anything with {query} needs one.
  if (!term && selected.some((d) => needsQuery(d.template))) return { opened: 0, failed: [], error: 'Enter a search term.' };

  const failed = [];
  const items = [];
  for (const d of selected) {
    const url = buildUrl(d.template, term);
    if (url) items.push({ name: d.name, url });
    else failed.push(d.name);
  }
  if (!items.length) return { opened: 0, failed, error: 'No valid URLs could be built for this search term.' };

  const { settings } = config;
  let tabIds = [];
  let windowId;
  try {
    const current = settings.openIn === 'new' ? null : await currentWindowId();
    if (current === null) {
      ({ tabIds, windowId } = await openInNewWindow(items, settings.foreground));
    } else {
      windowId = current;
      tabIds = await openInWindow(items, windowId, settings.foreground, failed);
    }
  } catch (error) {
    return { opened: 0, failed: [...failed, ...items.map((i) => i.name)], error: `Could not open tabs: ${error.message}` };
  }

  if (settings.groupTabs && tabIds.length) {
    try {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: groupTitle(term, deck.name, settings.groupIncludeDeck) });
    } catch (error) {
      console.warn('SearchDeck: tabs opened, but grouping failed.', error);
    }
  }

  return { opened: tabIds.length, failed };
}

/** Id of the last focused normal browser window, or null if there is none. */
async function currentWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win?.type === 'normal' && typeof win.id === 'number' ? win.id : null;
  } catch {
    return null;
  }
}

// Tabs are created one at a time so they end up in destination order.
async function openInWindow(items, windowId, foreground, failed) {
  const tabIds = [];
  for (const item of items) {
    try {
      const tab = await chrome.tabs.create({ url: item.url, windowId, active: foreground && tabIds.length === 0 });
      tabIds.push(tab.id);
    } catch (error) {
      console.warn(`SearchDeck: could not open ${item.url}`, error);
      failed.push(item.name);
    }
  }
  return tabIds;
}

async function openInNewWindow(items, foreground) {
  const win = await chrome.windows.create({ url: items.map((i) => i.url), focused: foreground });
  return { windowId: win.id, tabIds: (win.tabs ?? []).map((t) => t.id) };
}
