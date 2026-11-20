// Isolated world: loads settings, exposes them to CSS through <html> attributes
// and hands them to the page-world player script.
(() => {
  const FLAGS = {
    hideHome: 'hide-home',
    controlsBelow: 'controls-below',
    centerVideo: 'center',
    hideRecommended: 'hide-recommended',
    hideFundraiser: 'hide-fundraiser',
    hideEndScreen: 'hide-endscreen',
    hideCards: 'hide-cards',
    hideShorts: 'hide-shorts',
    hideMixes: 'hide-mixes',
    hideMerch: 'hide-merch',
    hidePlayables: 'hide-playables',
    hideMoreFromYT: 'hide-more',
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

  // The glow shortcut (A by default) works on video pages, unless a text field has focus.
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (e.repeat || !settings?.ambientKey || location.pathname !== '/watch') return;
      if (globalThis.YTU_keyName(e) !== settings.ambientKey) return;
      const target = e.composedPath()[0];
      if (target instanceof Element && (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"], [contenteditable]'))) return;
      chrome.storage.local.set({ ambient: !settings.ambient }).catch(() => {});
    });
  }

  // Marks the page when nothing is showing on the right of a video page (no playlist,
  // chat, chapters, transcript...), so "Center the video" can center it. The right
  // column stays laid out, just out of the way, so its height tells us when a panel opens.
  if (window.top === window) {
    let watched = null;
    const sizes = new ResizeObserver(([entry]) => {
      root.toggleAttribute('data-ytu-side-empty', entry.contentRect.height < 1);
    });
    const watch = () => {
      const inner = document.querySelector('ytd-watch-flexy #secondary-inner');
      if (inner === watched) return;
      if (watched) sizes.unobserve(watched);
      watched = inner;
      if (inner) sizes.observe(inner);
      else root.removeAttribute('data-ytu-side-empty');
    };
    document.addEventListener('yt-navigate-finish', watch);
    document.addEventListener('yt-page-data-updated', watch);
  }

  // If storage ever fails, carry on with the defaults instead of doing nothing.
  chrome.storage.local.get(null).catch(() => ({})).then(async (stored) => {
    // v1.4 changed the defaults: drop old keys once so the new defaults apply.
    if (!stored.defaults14) {
      const old = ['blockAutoplay', 'ambientShortcut'];
      old.forEach((k) => delete stored[k]);
      await chrome.storage.local.remove(old).then(() => chrome.storage.local.set({ defaults14: true })).catch(() => {});
    }
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
