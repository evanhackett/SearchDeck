# SearchDeck

Inspired by a Chrome extension I used to use called "Search Center".

Type one search term and open it on a whole deck of websites at once.

A **deck** is a list of sites that accept the same search term (for example *Stock Research*: Finviz, Yahoo Finance, Seeking Alpha, …). Open the popup, type `AAPL`, press Enter, and every selected site opens in its own tab.

Chrome extension, Manifest V3, vanilla JavaScript. No build step, no dependencies, no network access of its own.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Optional: pin SearchDeck to the toolbar.

Requires Chrome 123 or newer.

## Use

| Action | How |
|---|---|
| Open the popup | Click the toolbar icon or press `Alt+Shift+S` (`Option+Shift+S` on macOS) |
| Launch | Type a search term, press `Enter` |
| Close without launching | `Escape` |
| Switch deck | `Shift+Tab` from the search box to the deck dropdown, then arrow keys |
| Pick destinations | `Tab` to the checkboxes, `Space` to toggle |
| Launch from the address bar | Type `sd`, press `Space` or `Tab`, type the term, press `Enter` |

The popup remembers the last deck and which destinations are checked. The address bar launches the active deck with its checked destinations.

If Chrome did not assign the shortcut (it is skipped when another extension already uses it), set it at `chrome://extensions/shortcuts`. The settings page shows the current shortcut and links there.

### Settings

Open with the button in the popup header, or right-click the toolbar icon → **Options**.

- **Decks**: create, rename (edit the name field), duplicate, delete, drag to reorder.
- **Destinations**: add, edit, remove, drag to reorder, enable or disable. Edits save as soon as you leave a field.
- **Reordering**: drag a row by its ⋮⋮ handle. From the keyboard, focus the handle and press ↑ or ↓.
- **URL templates** must be `http://` or `https://` and contain `{query}`, which is replaced by the URL-encoded search term. Each row shows the resulting URL for the sample term; **Test** opens it. An invalid edit shows an error and is not saved.
- **Icons**: taken from Chrome's local favicon cache, so a site's icon appears after you have visited it. Click a destination's icon to set a custom icon URL instead.
- **Opening tabs**: current or new window, foreground or background, optional tab group named after the search term (optionally with the deck name, e.g. `AAPL — Stock Research`).
- **Theme**: system, light, or dark.
- **Backup**: export everything as JSON, import it again, or restore the defaults. Import and restore replace the whole configuration and ask first.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save decks and settings in `chrome.storage.local` |
| `tabGroups` | Name the tab group when grouping is enabled |
| `favicon` | Show site icons from Chrome's local favicon cache, without contacting any server |

No host permissions, no content scripts, no remote code. Search terms are never stored or sent anywhere; they only go into the URLs of the tabs you open. The one network request the extension's own pages can make is loading a custom icon URL, if you set one.

## Project layout

```
manifest.json
background.js        service worker: runs launches for the popup, `sd` omnibox keyword
src/defaults.js      default decks and settings
src/core.js          pure logic: template validation, URL building, config normalization
src/storage.js       load/save in chrome.storage.local
src/launcher.js      opens tabs / window / tab group
src/ui.js            DOM helpers, theme, favicons
src/ui.css           shared styles and theme colors
src/theme.js         applies the theme before first paint
popup/               the popup
options/             the settings page
icons/               extension icons
tests/               unit tests
```

The popup asks the service worker to open the tabs, because the popup is destroyed as soon as the first foreground tab takes focus.

Stored and imported configurations always pass through `normalizeConfig` in `src/core.js`: only known fields are copied, destinations with invalid templates are dropped, and ids are repaired. A stored configuration that cannot be read at all is copied to the `configBackup` storage key before the defaults are used. Extension updates never overwrite stored data.

## Tests

```
npm test        # or: node --test
```

Needs Node 20 or newer and nothing else. The tests cover URL substitution and encoding, template and configuration validation, deck helpers, storage fallback, and the tab-launching logic against a fake `chrome` API.

### Manual test checklist

The UI and the real Chrome APIs are not covered by the unit tests. After loading the extension, check:

- [x] Popup opens with the search box focused; typing a term and pressing Enter opens the checked destinations in deck order and closes the popup.
- [x] Escape closes the popup. Empty term shows "Enter a search term."
- [ ] Unchecking destinations and switching decks is remembered when the popup is reopened.
- [x] Keyboard shortcut opens the popup (assign it at `chrome://extensions/shortcuts` if it is not set).
- [x] `sd AAPL` in the address bar launches the active deck.
- [ ] Each "Opening tabs" combination: current/new window, foreground/background, tab group on/off, group title with and without deck name.
- [ ] Settings: create, rename, duplicate, delete, reorder decks; add, edit, remove, reorder, disable destinations; changes appear in the popup.
- [x] Dragging a deck or destination by its handle reorders it and the order persists; Escape or dropping outside the list cancels; ↑ ↓ on a focused handle also moves it.
- [ ] An invalid template (`ftp://x/{query}`, or no `{query}`) shows an error and is not saved.
- [ ] Export, then Restore defaults, then Import the exported file brings everything back.
- [ ] Importing a non-JSON file, or JSON without decks, shows an error and changes nothing.
- [x] Light, dark, and system themes in both popup and settings.
- [x] Favicons appear for sites you have visited.

## Notes on the default destinations

- Stock Analysis uses `/stocks/{query}/`, which works for stocks but not ETFs (those live under `/etf/`).
- Macrotrends has no ticker-only URL, so that destination is a Google `site:macrotrends.net` search.
