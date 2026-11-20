// Default settings. "Reset" in the popup returns to these; double-clicking a slider resets just that one.
globalThis.YTU_DEFAULTS = {
  // Cleanup (Unhook)
  hideHome: true,
  hideRecommended: true,
  hideFundraiser: true,
  hideEndScreen: true,
  hideCards: true,
  hideShorts: true,
  hideMixes: true,
  hideMerch: true,
  hidePlayables: true,
  hideMoreFromYT: true,
  disableAutoplay: true,
  hideAutonavToggle: true,

  // Playback (Enhancer)
  blockAutoplay: false,
  controlsBelow: true,
  centerVideo: true,
  allowPlaylistAutoplay: true,
  convertShorts: true,
  selectQuality: true,
  qualityVideos: 'hd2160',
  qualityPlaylists: 'hd2160',
  qualityEmbeds: 'medium',
  resetSpeed: true,
  defaultSpeed: 1,
  gridPerRow: 4,
  channelGridPerRow: 4,

  // Ambient glow (Ambient light)
  ambient: true,
  ambientKey: 'A', // toggles the glow; '' = no shortcut
  glowFps: 10,
  brightness: 40,
  contrast: 100,
  saturation: 200,
  blur: 100,
  spread: 40,
  fadeStart: 100,
  fadeCurve: 100,
  filmGrain: 60,
  resolution: 6.25,
  videoShadowSize: 40,
  videoShadowOpacity: 40,
  headerFill: 40,
  headerShadowSize: 80,
  headerShadowOpacity: 20,
  contentFill: 10,
  contentImages: 80,
  contentShadowSize: 80,
  contentShadowOpacity: 20,
  hideScrollbar: true
};

// Turns a keydown into a name like "A" or "Shift+G" (null for a lone modifier).
// Letters and digits use the physical key so Alt/Shift don't change the name.
globalThis.YTU_keyName = (e) => {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null;
  const key = /^(Key|Digit)/.test(e.code) ? e.code.slice(e.code.startsWith('Key') ? 3 : 5)
    : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd', key].filter(Boolean).join('+');
};
