// Default configuration. Everything here is editable by the user afterwards.

export const CONFIG_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  openIn: 'current', // 'current' | 'new' (window)
  groupTabs: false, // put the opened tabs in a Chrome tab group
  groupIncludeDeck: true, // "AAPL — Stock Research" instead of "AAPL"
  foreground: true, // switch to the opened tabs / focus the new window
  theme: 'system', // 'system' | 'light' | 'dark'
  contextMenu: true, // right-click menu for selected text
});

const dest = (id, name, template) => ({ id, name, template, enabled: true, favicon: '' });

/** Returns a fresh copy of the default configuration. */
export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    activeDeckId: 'stock-research',
    settings: { ...DEFAULT_SETTINGS },
    decks: [
      {
        id: 'stock-research',
        name: 'Stock Research',
        destinations: [
          dest('stock-finviz', 'Finviz', 'https://finviz.com/quote.ashx?t={query}'),
          dest('stock-yahoo', 'Yahoo Finance', 'https://finance.yahoo.com/quote/{query}/'),
          dest('stock-seekingalpha', 'Seeking Alpha', 'https://seekingalpha.com/symbol/{query}'),
          dest('stock-stockanalysis', 'Stock Analysis', 'https://stockanalysis.com/stocks/{query}/'),
          dest('stock-macrotrends', 'Macrotrends', 'https://www.google.com/search?q=site%3Amacrotrends.net+{query}'),
          dest('stock-tradingview', 'TradingView', 'https://www.tradingview.com/chart/?symbol={query}'),
          dest('stock-googlefinance', 'Google Finance', 'https://www.google.com/search?q={query}+stock'),
          dest('stock-reddit', 'Reddit', 'https://www.reddit.com/search/?q={query}+stock'),
        ],
      },
      {
        id: 'general-search',
        name: 'General Search',
        destinations: [
          dest('general-google', 'Google', 'https://www.google.com/search?q={query}'),
          dest('general-bing', 'Bing', 'https://www.bing.com/search?q={query}'),
          dest('general-reddit', 'Reddit', 'https://www.reddit.com/search/?q={query}'),
          dest('general-youtube', 'YouTube', 'https://www.youtube.com/results?search_query={query}'),
          dest('general-wikipedia', 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search={query}'),
        ],
      },
    ],
  };
}
