// Persistence in chrome.storage.local. Nothing ever leaves the browser.

import { defaultConfig } from './defaults.js';
import { normalizeConfig } from './core.js';

export const CONFIG_KEY = 'config';
const BACKUP_KEY = 'configBackup';

/**
 * Loads the configuration. Never throws: a missing configuration yields the
 * defaults, and an unreadable one is set aside under `configBackup` (so it is
 * not lost when the next save happens) before falling back to the defaults.
 */
export async function loadConfig() {
  let raw;
  try {
    ({ [CONFIG_KEY]: raw } = await chrome.storage.local.get(CONFIG_KEY));
    if (raw === undefined) return defaultConfig();
    return normalizeConfig(raw).config;
  } catch (error) {
    console.warn('SearchDeck: could not read the stored configuration, using defaults.', error);
    if (raw !== undefined) {
      chrome.storage.local.set({ [BACKUP_KEY]: raw }).catch(() => {});
    }
    return defaultConfig();
  }
}

export async function saveConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}
