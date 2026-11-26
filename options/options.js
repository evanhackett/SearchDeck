import {
  LIMITS,
  buildUrl,
  duplicateDeck,
  moveItem,
  newId,
  normalizeConfig,
  templateOrigin,
  validateFavicon,
  validateTemplate,
} from '../src/core.js';
import { defaultConfig } from '../src/defaults.js';
import { CONFIG_KEY, loadConfig, saveConfig } from '../src/storage.js';
import { applyTheme, faviconEl, h, setFavicon } from '../src/ui.js';

const $ = (id) => document.getElementById(id);

let config;
let selectedId; // deck shown in the editor (independent of the popup's active deck)
let previewUpdaters = []; // one per destination row, re-run when the sample term changes
let statusTimer;

init();

async function init() {
  config = await loadConfig();
  selectedId = config.activeDeckId;
  bindEvents();
  renderAll();
  showShortcut();
}

// ---------- state helpers ----------

function selectedDeck() {
  let deck = config.decks.find((d) => d.id === selectedId);
  if (!deck) {
    deck = config.decks[0];
    selectedId = deck.id;
  }
  return deck;
}

async function commit(message = 'Saved') {
  try {
    await saveConfig(config);
    flash(message);
  } catch (error) {
    flash(`Could not save: ${error.message}`, true);
  }
}

function flash(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.textContent = ''), isError ? 8000 : 1500);
}

// The popup can change the config (active deck, checkboxes) while this page is open.
function onStorageChanged(changes, area) {
  const next = area === 'local' ? changes[CONFIG_KEY]?.newValue : undefined;
  if (next === undefined || JSON.stringify(next) === JSON.stringify(config)) return;
  try {
    config = normalizeConfig(next).config;
    renderAll();
  } catch {
    // ignore unreadable external writes; the next save from here replaces them
  }
}

// ---------- rendering ----------

function renderAll() {
  renderDeckList();
  renderEditor();
  renderSettings();
}

function smallButton(label, ariaLabel, action, onclick, disabled = false) {
  return h('button', {
    type: 'button',
    className: 'icon-btn',
    textContent: label,
    title: ariaLabel,
    ariaLabel,
    disabled,
    onclick,
    dataset: { action },
  });
}

/** After a re-render, put focus back on the control the user just used. */
function refocus(listId, id, action) {
  const row = $(listId).querySelector(`li[data-id="${CSS.escape(id)}"]`);
  const target = row?.querySelector(`[data-action="${action}"]:not(:disabled)`) ?? row?.querySelector('button:not(:disabled)');
  target?.focus();
}

function renderDeckList() {
  const current = selectedDeck();
  const last = config.decks.length - 1;
  $('deck-list').replaceChildren(
    ...config.decks.map((deck, i) => {
      const select = h('button', {
        type: 'button',
        className: 'deck-select',
        textContent: deck.name,
        title: deck.name,
        dataset: { action: 'select' },
        onclick: () => {
          selectedId = deck.id;
          renderDeckList();
          renderEditor();
          refocus('deck-list', deck.id, 'select');
        },
      });
      if (deck.id === current.id) select.setAttribute('aria-current', 'true');
      const move = (delta, action) => () => {
        moveItem(config.decks, i, delta);
        commit();
        renderDeckList();
        refocus('deck-list', deck.id, action);
      };
      return h(
        'li',
        { dataset: { id: deck.id } },
        select,
        smallButton('↑', `Move ${deck.name} up`, 'up', move(-1, 'up'), i === 0),
        smallButton('↓', `Move ${deck.name} down`, 'down', move(1, 'down'), i === last),
      );
    }),
  );
}

function renderEditor() {
  const deck = selectedDeck();
  $('deck-name').value = deck.name;
  $('deck-delete').disabled = config.decks.length <= 1;
  $('add-error').textContent = '';
  previewUpdaters = [];
  $('dest-list').replaceChildren(...deck.destinations.map((d, i) => destinationRow(deck, d, i)));
}

function destinationRow(deck, dest, index) {
  const li = h('li', { dataset: { id: dest.id }, className: dest.enabled ? '' : 'disabled' });

  const enabled = h('input', { type: 'checkbox', checked: dest.enabled, title: 'Enabled', ariaLabel: `Enable ${dest.name}` });
  enabled.addEventListener('change', () => {
    dest.enabled = enabled.checked;
    li.classList.toggle('disabled', !dest.enabled);
    commit();
  });

  const icon = faviconEl(dest);
  const iconButton = h(
    'button',
    { type: 'button', className: 'icon-btn icon-edit', title: 'Set a custom icon URL', ariaLabel: `Custom icon for ${dest.name}` },
    icon,
  );

  const name = h('input', { type: 'text', className: 'name', value: dest.name, maxLength: LIMITS.name, ariaLabel: 'Destination name' });
  name.addEventListener('change', () => {
    const value = name.value.trim();
    if (!value) {
      name.value = dest.name; // a name is required; keep the old one
      return;
    }
    dest.name = name.value = value;
    commit();
  });

  const template = h('input', {
    type: 'text',
    className: 'template',
    value: dest.template,
    spellcheck: false,
    ariaLabel: `URL template for ${dest.name}`,
  });
  const preview = h('div', { className: 'preview' });
  const test = h('button', { type: 'button', textContent: 'Test', title: 'Open this destination with the sample term' });

  const updatePreview = () => {
    const value = template.value.trim();
    const error = validateTemplate(value);
    const url = error ? null : buildUrl(value, $('sample').value);
    preview.classList.toggle('error', Boolean(error));
    template.setAttribute('aria-invalid', String(Boolean(error)));
    preview.textContent = error ? `${error} This change is not saved.` : (url ?? 'Enter a sample term above to preview the URL.');
    test.disabled = !url;
  };
  previewUpdaters.push(updatePreview);
  updatePreview();

  template.addEventListener('input', updatePreview);
  template.addEventListener('change', () => {
    const value = template.value.trim();
    if (validateTemplate(value) || value === dest.template) return; // invalid edits are never stored
    dest.template = template.value = value;
    setFavicon(icon, dest);
    commit();
  });
  test.addEventListener('click', () => {
    const url = buildUrl(template.value.trim(), $('sample').value);
    if (url) chrome.tabs.create({ url }).catch((error) => flash(`Could not open tab: ${error.message}`, true));
  });

  const iconUrl = h('input', {
    type: 'url',
    className: 'icon-url',
    value: dest.favicon,
    hidden: !dest.favicon,
    placeholder: 'Custom icon URL (optional), e.g. https://example.com/favicon.ico',
    spellcheck: false,
    ariaLabel: `Custom icon URL for ${dest.name}`,
  });
  const iconError = h('span', { className: 'error' });
  iconButton.addEventListener('click', () => {
    iconUrl.hidden = !iconUrl.hidden;
    if (!iconUrl.hidden) iconUrl.focus();
  });
  iconUrl.addEventListener('change', () => {
    const value = iconUrl.value.trim();
    const error = validateFavicon(value);
    iconError.textContent = error ? `${error} This change is not saved.` : '';
    if (error) return;
    dest.favicon = iconUrl.value = value;
    setFavicon(icon, dest);
    commit();
  });

  const move = (delta, action) => () => {
    moveItem(deck.destinations, index, delta);
    commit();
    renderEditor();
    refocus('dest-list', dest.id, action);
  };
  const actions = h(
    'div',
    { className: 'actions' },
    test,
    smallButton('↑', `Move ${dest.name} up`, 'up', move(-1, 'up'), index === 0),
    smallButton('↓', `Move ${dest.name} down`, 'down', move(1, 'down'), index === deck.destinations.length - 1),
    smallButton('✕', `Remove ${dest.name}`, 'remove', () => {
      if (!confirm(`Remove "${dest.name}" from "${deck.name}"?`)) return;
      deck.destinations.splice(deck.destinations.indexOf(dest), 1);
      commit();
      renderEditor();
    }),
  );
  actions.lastChild.classList.add('danger');

  li.append(enabled, iconButton, name, template, actions, h('div', { className: 'detail' }, preview, iconUrl, iconError));
  return li;
}

function renderSettings() {
  const s = config.settings;
  $('set-openIn').value = s.openIn;
  $('set-foreground').value = String(s.foreground);
  $('set-groupTabs').checked = s.groupTabs;
  $('set-groupIncludeDeck').checked = s.groupIncludeDeck;
  $('set-groupIncludeDeck').disabled = !s.groupTabs;
  $('set-theme').value = s.theme;
  applyTheme(s.theme);
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === '_execute_action')?.shortcut;
  $('shortcut').textContent = shortcut || 'Not set';
}

// ---------- events ----------

function bindEvents() {
  chrome.storage.onChanged.addListener(onStorageChanged);
  window.addEventListener('focus', showShortcut);

  $('sample').addEventListener('input', () => previewUpdaters.forEach((update) => update()));

  $('deck-name').addEventListener('change', () => {
    const deck = selectedDeck();
    const value = $('deck-name').value.trim();
    if (!value) {
      $('deck-name').value = deck.name;
      return;
    }
    deck.name = $('deck-name').value = value;
    commit();
    renderDeckList();
  });

  $('deck-new').addEventListener('click', () => {
    if (config.decks.length >= LIMITS.decks) return flash(`You can have at most ${LIMITS.decks} decks.`, true);
    const names = config.decks.map((d) => d.name);
    let name = 'New deck';
    for (let n = 2; names.includes(name); n++) name = `New deck ${n}`;
    const deck = { id: newId(), name, destinations: [] };
    config.decks.push(deck);
    selectedId = deck.id;
    commit();
    renderDeckList();
    renderEditor();
    $('deck-name').focus();
    $('deck-name').select();
  });

  $('deck-duplicate').addEventListener('click', () => {
    if (config.decks.length >= LIMITS.decks) return flash(`You can have at most ${LIMITS.decks} decks.`, true);
    const deck = selectedDeck();
    const copy = duplicateDeck(deck, config.decks.map((d) => d.name));
    config.decks.splice(config.decks.indexOf(deck) + 1, 0, copy);
    selectedId = copy.id;
    commit();
    renderDeckList();
    renderEditor();
  });

  $('deck-delete').addEventListener('click', () => {
    if (config.decks.length <= 1) return;
    const deck = selectedDeck();
    const count = deck.destinations.length;
    if (!confirm(`Delete the deck "${deck.name}" and its ${count} ${count === 1 ? 'destination' : 'destinations'}? This cannot be undone.`)) return;
    const index = config.decks.indexOf(deck);
    config.decks.splice(index, 1);
    if (config.activeDeckId === deck.id) config.activeDeckId = config.decks[0].id;
    selectedId = config.decks[Math.min(index, config.decks.length - 1)].id;
    commit();
    renderDeckList();
    renderEditor();
  });

  $('dest-add').addEventListener('submit', (event) => {
    event.preventDefault();
    const deck = selectedDeck();
    const template = $('add-template').value.trim();
    const error =
      validateTemplate(template) ??
      (deck.destinations.length >= LIMITS.destinations ? `A deck can have at most ${LIMITS.destinations} destinations.` : null);
    $('add-error').textContent = error ?? '';
    if (error) {
      $('add-template').focus();
      return;
    }
    const name = $('add-name').value.trim().slice(0, LIMITS.name) || new URL(templateOrigin(template)).hostname;
    deck.destinations.push({ id: newId(), name, template, enabled: true, favicon: '' });
    $('dest-add').reset();
    commit();
    renderEditor();
    $('add-name').focus();
  });

  for (const id of ['set-openIn', 'set-foreground', 'set-groupTabs', 'set-groupIncludeDeck', 'set-theme']) {
    $(id).addEventListener('change', () => {
      config.settings = {
        openIn: $('set-openIn').value,
        foreground: $('set-foreground').value === 'true',
        groupTabs: $('set-groupTabs').checked,
        groupIncludeDeck: $('set-groupIncludeDeck').checked,
        theme: $('set-theme').value,
      };
      renderSettings();
      commit();
    });
  }

  $('shortcut-change').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  $('export').addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' });
    const link = h('a', { href: URL.createObjectURL(blob), download: 'searchdeck-config.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = ''; // allow re-importing the same file
    if (file) importFile(file);
  });

  $('reset').addEventListener('click', () => {
    if (!confirm('Restore the default decks and settings? All of your decks and destinations will be replaced. This cannot be undone.')) return;
    config = defaultConfig();
    selectedId = config.activeDeckId;
    $('import-warnings').replaceChildren();
    commit('Defaults restored');
    renderAll();
  });
}

async function importFile(file) {
  try {
    if (file.size > 1_000_000) throw new Error('the file is larger than 1 MB.');
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new Error('the file is not valid JSON.');
    }
    const { config: next, warnings } = normalizeConfig(raw);
    const destinations = next.decks.reduce((sum, d) => sum + d.destinations.length, 0);
    const question =
      `Replace your current configuration with ${next.decks.length} deck(s) and ${destinations} destination(s) from "${file.name}"?` +
      (warnings.length ? `\n\n${warnings.length} item(s) in the file are invalid and will be skipped.` : '') +
      '\n\nThis cannot be undone.';
    if (!confirm(question)) return;
    config = next;
    selectedId = config.activeDeckId;
    $('import-warnings').replaceChildren(...warnings.map((w) => h('li', { textContent: w })));
    commit('Imported');
    renderAll();
  } catch (error) {
    flash(`Import failed: ${error.message}`, true);
  }
}
