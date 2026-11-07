const SECTIONS = [
  ['Hide', [
    ['hideHome', 'Home screen'],
    ['hideRecommended', 'Recommended videos'],
    ['hideFundraiser', 'Fundraisers'],
    ['hideEndScreen', 'End screen feed'],
    ['hideCards', 'Cards'],
    ['hideShorts', 'Shorts'],
    ['hideMixes', 'Mixes'],
    ['hideMerch', 'Merch, tickets and offers'],
    ['hideMoreFromYT', 'More from YouTube'],
    ['disableAnnotations', 'Annotations']
  ]],
  ['Playback', [
    ['blockAutoplay', 'Don’t start videos automatically'],
    ['allowPlaylistAutoplay', 'Except in playlists'],
    ['disableAutoplay', 'Turn off “Up next” autoplay'],
    ['hideAutonavToggle', 'Hide autoplay switch in player'],
    ['convertShorts', 'Open Shorts as regular videos'],
    ['selectQuality', 'Choose video quality automatically'],
    ['qualityVideos', 'Videos', 'quality'],
    ['qualityPlaylists', 'Playlists', 'quality'],
    ['qualityEmbeds', 'Embedded videos', 'quality'],
    ['resetSpeed', 'Reset speed on each new video'],
    ['gridPerRow', 'Videos per row (0 = YouTube default)', 'number'],
    ['channelGridPerRow', 'Videos per row on channels', 'number']
  ]],
  ['Ambient glow', [
    ['ambient', 'Show glow'],
    ['ambientShortcut', 'Press A to toggle glow'],
    ['hideScrollbar', 'Hide page scrollbar'],
    ['glowFps', 'Update rate (lower uses less CPU)', 'range', 10, 60, ' fps'],
    ['brightness', 'Brightness', 'range', 0, 200, '%'],
    ['contrast', 'Contrast', 'range', 0, 200, '%'],
    ['saturation', 'Saturation', 'range', 0, 200, '%'],
    ['spread', 'Spread', 'range', 0, 200, '%'],
    ['blur', 'Blur', 'range', 0, 100, '%'],
    ['fadeStart', 'Fade start', 'range', 0, 100, '%'],
    ['fadeCurve', 'Fade curve', 'range', 1, 100, '%'],
    ['filmGrain', 'Film grain', 'range', 0, 100, '%'],
    ['videoShadowSize', 'Video shadow size', 'range', 0, 100, 'px'],
    ['videoShadowOpacity', 'Video shadow opacity', 'range', 0, 100, '%'],
    ['headerFill', 'Header opacity', 'range', 0, 100, '%'],
    ['contentFill', 'Card and panel tint', 'range', 0, 100, '%'],
    ['contentImages', 'Page image opacity', 'range', 0, 100, '%']
  ]]
];
const QUALITIES = [['hd2160', '2160p'], ['hd1440', '1440p'], ['hd1080', '1080p'], ['hd720', '720p'], ['large', '480p'], ['medium', '360p'], ['small', '240p'], ['tiny', '144p']];

const host = document.getElementById('sections');
let settings = { ...YTU_DEFAULTS };
const save = (key, value) => { settings[key] = value; chrome.storage.local.set({ [key]: value }); };

const render = () => {
  host.replaceChildren();
  for (const [title, items] of SECTIONS) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    for (const [key, text, type = 'switch', min, max, unit] of items) section.append(control(key, text, type, min, max, unit));
    host.append(section);
  }
};

const control = (key, text, type, min, max, unit) => {
  const id = `f-${key}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = text;
  const row = document.createElement('div');

  if (type === 'range') {
    row.className = 'slider';
    const output = document.createElement('output');
    output.textContent = `${settings[key]}${unit}`;
    const input = Object.assign(document.createElement('input'), { type: 'range', id, min, max, value: settings[key] });
    input.addEventListener('input', () => {
      output.textContent = `${input.value}${unit}`;
      save(key, Number(input.value));
    });
    row.append(label, output, input);
    return row;
  }

  row.className = 'row';
  let input;
  if (type === 'quality') {
    input = document.createElement('select');
    for (const [value, name] of QUALITIES) input.add(new Option(name, value, false, value === settings[key]));
    input.addEventListener('change', () => save(key, input.value));
  } else if (type === 'number') {
    input = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 10, value: settings[key] });
    input.addEventListener('change', () => save(key, Math.min(10, Math.max(0, Math.round(Number(input.value) || 0)))));
  } else {
    input = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'switch', checked: !!settings[key] });
    input.addEventListener('change', () => save(key, input.checked));
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
