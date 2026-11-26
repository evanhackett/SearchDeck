import { getActiveDeck } from '../src/core.js';
import { loadConfig, saveConfig } from '../src/storage.js';
import { applyTheme, faviconEl, h } from '../src/ui.js';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('form'),
  deck: $('deck'),
  query: $('query'),
  all: $('all'),
  count: $('count'),
  list: $('destinations'),
  status: $('status'),
  open: $('open'),
};

let config;
let deck;
let saving = Promise.resolve();

init();

async function init() {
  config = await loadConfig();
  applyTheme(config.settings.theme);
  deck = getActiveDeck(config);

  els.deck.replaceChildren(...config.decks.map((d) => h('option', { value: d.id, textContent: d.name })));
  els.deck.value = deck.id;
  renderDestinations();

  els.deck.addEventListener('change', () => {
    deck = config.decks.find((d) => d.id === els.deck.value) ?? deck;
    config.activeDeckId = deck.id;
    save();
    renderDestinations();
  });

  els.all.addEventListener('change', () => {
    for (const d of deck.destinations) d.enabled = els.all.checked;
    save();
    renderDestinations();
  });

  els.form.addEventListener('submit', onSubmit);
  els.query.addEventListener('input', () => setStatus(''));
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });

  els.query.focus();
}

function renderDestinations() {
  if (!deck.destinations.length) {
    els.list.replaceChildren(h('li', { className: 'empty', textContent: 'This deck is empty. Add destinations in settings.' }));
  } else {
    els.list.replaceChildren(
      ...deck.destinations.map((d) => {
        const box = h('input', { type: 'checkbox', checked: d.enabled });
        box.addEventListener('change', () => {
          d.enabled = box.checked;
          save();
          updateSummary();
        });
        return h('li', {}, h('label', { title: d.template }, box, faviconEl(d), h('span', { className: 'name', textContent: d.name })));
      }),
    );
  }
  updateSummary();
}

function updateSummary() {
  const total = deck.destinations.length;
  const selected = deck.destinations.filter((d) => d.enabled).length;
  els.all.checked = total > 0 && selected === total;
  els.all.indeterminate = selected > 0 && selected < total;
  els.all.disabled = total === 0;
  els.count.textContent = `${selected} of ${total}`;
  els.open.textContent = selected ? `Open ${selected} ${selected === 1 ? 'Tab' : 'Tabs'}` : 'Open Tabs';
  els.open.disabled = selected === 0;
  setStatus('');
}

function save() {
  saving = saving.then(() => saveConfig(config)).catch((error) => console.warn('SearchDeck: save failed.', error));
  return saving;
}

function setStatus(text) {
  els.status.textContent = text;
}

async function onSubmit(event) {
  event.preventDefault();
  const query = els.query.value.trim();
  if (!query) {
    setStatus('Enter a search term.');
    els.query.focus();
    return;
  }
  const destinationIds = deck.destinations.filter((d) => d.enabled).map((d) => d.id);
  if (!destinationIds.length) {
    setStatus('Select at least one destination.');
    return;
  }

  els.open.disabled = true;
  await saving;
  let result;
  try {
    // With foreground tabs the popup usually closes before this resolves; the
    // service worker finishes the job either way.
    result = await chrome.runtime.sendMessage({ type: 'launch', query, deckId: deck.id, destinationIds });
  } catch (error) {
    result = { failed: [], error: `Could not reach the SearchDeck background worker: ${error.message}` };
  }

  if (result?.error || result?.failed?.length) {
    const parts = [];
    if (result.error) parts.push(result.error);
    if (result.failed?.length) parts.push(`Could not open: ${result.failed.join(', ')}.`);
    setStatus(parts.join(' '));
    els.open.disabled = false;
    return;
  }
  window.close();
}
