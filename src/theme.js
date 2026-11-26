// Classic (blocking) script: applies the last known theme before first paint so
// the popup does not flash. The authoritative value lives in chrome.storage and
// is mirrored to localStorage by applyTheme() in ui.js.
try {
  document.documentElement.dataset.theme = localStorage.getItem('sd-theme') || 'system';
} catch {
  document.documentElement.dataset.theme = 'system';
}
