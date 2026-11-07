// Isolated world: loads settings, exposes them to CSS through <html> attributes
// and hands them to the page-world player script.
(() => {
  const FLAGS = {
    hideHome: 'hide-home',
    hideRecommended: 'hide-recommended',
    hideFundraiser: 'hide-fundraiser',
    hideEndScreen: 'hide-endscreen',
    hideCards: 'hide-cards',
    hideShorts: 'hide-shorts',
    hideMixes: 'hide-mixes',
    hideMerch: 'hide-merch',
    hideMoreFromYT: 'hide-more',
    disableAnnotations: 'no-annotations',
    hideAutonavToggle: 'hide-autonav'
  };

  let settings = null;
  const root = document.documentElement;
  const listeners = [];
  globalThis.YTU_onSettings = (fn) => { listeners.push(fn); if (settings) fn(settings); };

  const send = () => {
    if (settings) window.dispatchEvent(new CustomEvent('ytu:settings', { detail: JSON.stringify(settings) }));
  };

  const apply = () => {
    for (const [key, attr] of Object.entries(FLAGS)) root.toggleAttribute(`data-ytu-${attr}`, !!settings[key]);
    root.toggleAttribute('data-ytu-grid', settings.gridPerRow > 0);
    root.toggleAttribute('data-ytu-channel-grid', settings.channelGridPerRow > 0);
    root.style.setProperty('--ytu-grid', settings.gridPerRow);
    root.style.setProperty('--ytu-channel-grid', settings.channelGridPerRow);
    send();
    listeners.forEach((fn) => fn(settings));
  };

  window.addEventListener('ytu:request-settings', send);

  // The search page's "Shorts" filter has no link or attribute to select it by.
  const markShortsChip = () => {
    for (const chip of document.querySelectorAll('yt-chip-cloud-chip-renderer')) {
      chip.toggleAttribute('data-ytu-shorts-chip', chip.textContent.trim() === 'Shorts');
    }
  };
  document.addEventListener('yt-navigate-finish', () => {
    if (location.pathname !== '/results') return;
    for (const ms of [0, 800, 2500]) setTimeout(markShortsChip, ms);
  });

  // "A" toggles the glow on video pages, unless a text field has focus.
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'a' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (!settings?.ambientShortcut || location.pathname !== '/watch') return;
      const target = e.composedPath()[0];
      if (target instanceof Element && (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"], [contenteditable]'))) return;
      chrome.storage.local.set({ ambient: !settings.ambient }).catch(() => {});
    });
  }

  // If storage ever fails, carry on with the defaults instead of doing nothing.
  chrome.storage.local.get(null).catch(() => ({})).then((stored) => {
    settings = { ...globalThis.YTU_DEFAULTS, ...stored };
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !settings) return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue === undefined ? globalThis.YTU_DEFAULTS[key] : newValue;
    }
    apply();
  });
})();
