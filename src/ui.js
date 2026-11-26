// Small DOM helpers shared by the popup and the settings page.

import { templateOrigin } from './core.js';

/**
 * Creates an element. `props` are assigned as DOM properties (textContent,
 * className, onclick, ariaLabel, ...); user data never goes through innerHTML.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) Object.assign(el.dataset, dataset);
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('sd-theme', theme);
  } catch {
    // localStorage is only a cache to avoid a flash on open
  }
}

/** Custom icon URL if set, otherwise the icon from Chrome's local favicon cache. */
export function faviconSrc(dest) {
  if (dest.favicon) return dest.favicon;
  const origin = templateOrigin(dest.template);
  if (!origin) return '';
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', origin);
  url.searchParams.set('size', '32');
  return url.href;
}

export function faviconEl(dest) {
  const img = h('img', { className: 'favicon', alt: '', width: 16, height: 16 });
  img.onerror = () => {
    img.style.visibility = 'hidden';
  };
  setFavicon(img, dest);
  return img;
}

export function setFavicon(img, dest) {
  const src = faviconSrc(dest);
  img.style.visibility = src ? '' : 'hidden';
  if (src) img.src = src;
  else img.removeAttribute('src');
}
