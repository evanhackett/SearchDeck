// Service worker. Launching happens here rather than in the popup because the
// popup is destroyed as soon as the first foreground tab takes focus.

import { getActiveDeck } from './src/core.js';
import { loadConfig } from './src/storage.js';
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
