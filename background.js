// Service worker. Launching happens here rather than in the popup because the
// popup is destroyed as soon as the first foreground tab takes focus.

import { buildMenuItems, getActiveDeck, parseMenuId } from './src/core.js';
import { CONFIG_KEY, loadConfig } from './src/storage.js';
import { launch } from './src/launcher.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'launch') return false;
  loadConfig()
    .then((config) => launch(config, message))
    .catch((error) => ({ opened: 0, failed: [], error: String(error?.message ?? error) }))
    .then(sendResponse);
  return true; // respond asynchronously
});

// Address bar: "sd AAPL" launches the active deck with its enabled destinations.
const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

chrome.omnibox.onInputStarted.addListener(async () => {
  const deck = getActiveDeck(await loadConfig());
  const count = deck.destinations.filter((d) => d.enabled).length;
  chrome.omnibox.setDefaultSuggestion({
    description: `Open <match>%s</match> in ${escapeXml(deck.name)} <dim>(${count} ${count === 1 ? 'tab' : 'tabs'})</dim>`,
  });
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const result = await launch(await loadConfig(), { query: text });
  if (result.error || result.failed.length) console.warn('SearchDeck: omnibox launch incomplete.', result);
});

// Right-click menu for selected text. Rebuilt whenever the service worker
// starts and whenever the configuration changes.
let menuBuild = Promise.resolve();

function rebuildMenus() {
  menuBuild = menuBuild
    .then(async () => {
      const config = await loadConfig();
      await chrome.contextMenus.removeAll();
      for (const item of buildMenuItems(config)) {
        chrome.contextMenus.create({ ...item, contexts: ['selection'] }, () => {
          if (chrome.runtime.lastError) console.warn('SearchDeck: menu item failed.', chrome.runtime.lastError.message);
        });
      }
    })
    .catch((error) => console.warn('SearchDeck: could not build the context menu.', error));
}

rebuildMenus(); // every time the service worker starts, so the menu can never be missing or stale
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CONFIG_KEY]) rebuildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const target = parseMenuId(info.menuItemId);
  if (!target || !info.selectionText) return;
  const result = await launch(await loadConfig(), { query: info.selectionText, ...target });
  if (result.error || result.failed.length) console.warn('SearchDeck: context menu launch incomplete.', result);
});
