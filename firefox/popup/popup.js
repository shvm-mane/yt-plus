// [key, label, type = 'switch', ...]; a row with { parent } is indented and greys out while its parent is off.
const SECTIONS = [
  ['Hide', [
    ['hideHome', 'Home feed'],
    ['hideRecommended', 'Recommended videos'],
    ['hideShorts', 'Shorts'],
    ['hideMixes', 'Mixes'],
    ['hidePlayables', 'Playables & home shelves'],
    ['hideEndScreen', 'End screen videos'],
    ['hideCards', 'Cards'],
    ['hideFundraiser', 'Fundraisers'],
    ['hideMerch', 'Merch & offers'],
    ['hideMoreFromYT', 'More from YouTube']
  ]],
  ['Playback', [
    ['blockAutoplay', 'Don’t autoplay videos'],
    ['allowPlaylistAutoplay', 'Except in playlists', 'switch', { parent: 'blockAutoplay' }],
    ['disableAutoplay', 'Turn off “Up next”'],
    ['hideAutonavToggle', 'Hide autoplay switch'],
    ['convertShorts', 'Open Shorts as videos'],
    ['resetSpeed', 'Reset speed each video']
  ]],
  ['Quality', [
    ['selectQuality', 'Set quality automatically'],
    ['qualityVideos', 'Videos', 'quality', { parent: 'selectQuality' }],
    ['qualityPlaylists', 'Playlists', 'quality', { parent: 'selectQuality' }],
    ['qualityEmbeds', 'Embeds', 'quality', { parent: 'selectQuality' }]
  ]],
  ['Layout', [
    ['controlsBelow', 'Controls below video'],
    ['centerVideo', 'Center video if sidebar is empty'],
    ['gridPerRow', 'Videos per row', 'number'],
    ['channelGridPerRow', 'Videos per row on channels', 'number'],
    ['hideScrollbar', 'Hide scrollbar']
  ]],
  ['Glow', [
    ['ambient', 'Ambient glow'],
    ['ambientKey', 'Shortcut', 'key', { parent: 'ambient' }],
    ['glowFps', 'Frame rate', 'cycle', { parent: 'ambient', options: [10, 24], unit: ' fps' }],
    ['brightness', 'Brightness', 'range', { parent: 'ambient', min: 0, max: 200, unit: '%' }],
    ['contrast', 'Contrast', 'range', { parent: 'ambient', min: 0, max: 200, unit: '%' }],
    ['saturation', 'Saturation', 'range', { parent: 'ambient', min: 0, max: 200, unit: '%' }],
    ['spread', 'Spread', 'range', { parent: 'ambient', min: 0, max: 200, unit: '%' }],
    ['blur', 'Blur', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }],
    ['fadeStart', 'Fade start', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }],
    ['fadeCurve', 'Fade curve', 'range', { parent: 'ambient', min: 5, max: 100, unit: '%' }],
    ['filmGrain', 'Film grain', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }],
    ['videoShadowSize', 'Shadow size', 'range', { parent: 'ambient', min: 0, max: 100, unit: 'px' }],
    ['videoShadowOpacity', 'Shadow opacity', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }]
  ]],
  ['Page tint', [
    ['headerFill', 'Header', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }],
    ['contentFill', 'Cards & panels', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }],
    ['contentImages', 'Images', 'range', { parent: 'ambient', min: 0, max: 100, unit: '%' }]
  ]]
];
const QUALITIES = [['hd2160', '2160p'], ['hd1440', '1440p'], ['hd1080', '1080p'], ['hd720', '720p'], ['large', '480p'], ['medium', '360p'], ['small', '240p'], ['tiny', '144p']];

const host = document.getElementById('sections');
let settings = { ...YTU_DEFAULTS };
const save = (key, value) => { settings[key] = value; chrome.storage.local.set({ [key]: value }); };

// Grey out rows whose parent switch is off.
const sync = () => {
  for (const row of host.querySelectorAll('[data-parent]')) {
    const off = !settings[row.dataset.parent];
    row.classList.toggle('off', off);
    row.querySelector('input, select, button').disabled = off;
  }
};

const render = () => {
  host.replaceChildren();
  for (const [title, items] of SECTIONS) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    for (const [key, text, type = 'switch', opts = {}] of items) section.append(control(key, text, type, opts));
    host.append(section);
  }
  sync();
};

const control = (key, text, type, { parent, min, max, options, unit = '' }) => {
  const id = `f-${key}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = text;
  const row = document.createElement('div');
  if (parent) { row.dataset.parent = parent; row.classList.add('child'); }

  if (type === 'range') {
    row.classList.add('slider');
    const output = document.createElement('output');
    output.htmlFor = id;
    output.textContent = `${settings[key]}${unit}`;
    const input = Object.assign(document.createElement('input'), { type: 'range', id, min, max, step: 5, value: settings[key], title: 'Double-click to reset' });
    const update = () => {
      input.style.setProperty('--p', `${(input.value - min) / (max - min) * 100}%`);
      output.textContent = `${input.value}${unit}`;
    };
    update();
    input.addEventListener('input', () => { update(); save(key, Number(input.value)); });
    input.addEventListener('dblclick', () => { input.value = YTU_DEFAULTS[key]; update(); save(key, YTU_DEFAULTS[key]); });
    row.append(label, output, input);
    return row;
  }

  row.classList.add('row');
  let input;
  if (type === 'quality') {
    input = document.createElement('select');
    for (const [value, name] of QUALITIES) input.add(new Option(name, value, false, value === settings[key]));
    input.addEventListener('change', () => save(key, input.value));
  } else if (type === 'cycle') {
    // A button that steps through a few fixed values.
    input = Object.assign(document.createElement('button'), { type: 'button', className: 'key', textContent: `${settings[key]}${unit}` });
    input.addEventListener('click', () => {
      const next = options[(options.indexOf(settings[key]) + 1) % options.length];
      save(key, next);
      input.textContent = `${next}${unit}`;
    });
  } else if (type === 'key') {
    // Click, then press a key combo. Esc cancels, Backspace/Delete clears it.
    input = Object.assign(document.createElement('button'), { type: 'button', className: 'key' });
    const show = () => { input.textContent = settings[key] || 'None'; input.classList.remove('listening'); };
    show();
    input.addEventListener('click', () => { input.textContent = 'Press a key…'; input.classList.add('listening'); });
    input.addEventListener('blur', show);
    input.addEventListener('keydown', (e) => {
      if (!input.classList.contains('listening')) return;
      e.preventDefault();
      if (e.key === 'Escape') return show();
      if (e.key === 'Backspace' || e.key === 'Delete') { save(key, ''); return show(); }
      const name = YTU_keyName(e);
      if (name) { save(key, name); show(); }
    });
  } else if (type === 'number') {
    input = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 10, value: settings[key], title: '0 = YouTube default' });
    input.addEventListener('change', () => save(key, Math.min(10, Math.max(0, Math.round(Number(input.value) || 0)))));
  } else {
    input = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'switch', checked: !!settings[key] });
    input.addEventListener('change', () => { save(key, input.checked); sync(); });
  }
  input.id = id;
  row.append(label, input);
  return row;
};

document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.local.clear();
  settings = { ...YTU_DEFAULTS };
  render();
});

chrome.storage.local.get(null).then((stored) => {
  settings = { ...YTU_DEFAULTS, ...stored };
  render();
});
