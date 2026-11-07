// Compares memory and CPU on a 4K video in dark theatre mode, muted and windowless.
// Usage: node benchmark.mjs [repeats] [otherExtensionPath ...]
// Always measures no extensions and YT+. Extra paths are measured together as "others".
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BROWSER = process.env.BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium';
const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30';
const QUALITY = 'hd2160';
// Signed-out playback can stop after about 40 seconds, so the window has to stay short.
const WINDOW_MS = 16000;

const repeats = Number(process.argv[2]) || 3;
const ytPlus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../chromium');
const setups = [['none', []], ['YT+', [ytPlus]]];
if (process.argv.length > 3) setups.push(['others', process.argv.slice(3)]);

const browserProcesses = (profile) => {
  const list = execSync('ps -axo pid=,ppid=,command=', { maxBuffer: 1 << 24 }).toString().trim().split('\n').map((line) => {
    const [, pid, ppid, command] = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return { pid: Number(pid), ppid: Number(ppid), command };
  });
  const main = list.find((p) => p.command.includes(`--user-data-dir=${profile}`) && !p.command.includes('--type='));
  const ids = new Set([main.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of list) {
      if (ids.has(p.ppid) && !ids.has(p.pid)) { ids.add(p.pid); grew = true; }
    }
  }
  return ids;
};

const sample = (profile) => {
  const ids = browserProcesses(profile);
  let memoryMB = 0;
  // `top` reports physical footprint, which includes GPU allocations.
  for (const line of execSync('top -l 1 -stats pid,mem', { maxBuffer: 1 << 24 }).toString().split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)([KMG])\+?-?\s*$/);
    if (m && ids.has(Number(m[1]))) memoryMB += parseFloat(m[2]) * { K: 1 / 1024, M: 1, G: 1024 }[m[3]];
  }
  let cpuSeconds = 0;
  for (const time of execSync(`ps -o cputime= -p ${[...ids].join(',')}`).toString().trim().split('\n')) {
    cpuSeconds += time.trim().split(':').map(parseFloat).reduce((total, part) => total * 60 + part, 0);
  }
  return { memoryMB, cpuSeconds };
};

const run = async (extensions) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-plus-bench-'));
  const args = ['--headless=new', '--mute-audio', '--no-first-run', '--window-size=1440,900', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'];
  if (extensions.length) args.push(`--disable-extensions-except=${extensions.join(',')}`, `--load-extension=${extensions.join(',')}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: BROWSER,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation', '--disable-component-extensions-with-background-pages'],
    args,
    viewport: { width: 1440, height: 900 }
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    await ctx.addCookies([
      { name: 'PREF', value: 'f6=400&hl=en', domain: '.youtube.com', path: '/' },
      { name: 'wide', value: '1', domain: '.youtube.com', path: '/' }
    ]);
    const page = await ctx.newPage();
    await page.goto(VIDEO, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#movie_player video', { timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => document.querySelector('#movie_player').mute());
    if (await page.evaluate(() => document.querySelector('#movie_player video').paused)) {
      await page.click('#movie_player video', { force: true });
    }
    // Wait until the real video is playing at the same quality in every setup.
    let steady = 0;
    for (let i = 0; i < 15 && steady < 4; i++) {
      const state = await page.evaluate((q) => {
        const player = document.querySelector('#movie_player');
        player.mute();
        if (player.getPlaybackQuality() !== q) player.setPlaybackQualityRange(q, q);
        if (![1, 3].includes(player.getPlayerState())) player.playVideo();
        return { state: player.getPlayerState(), quality: player.getPlaybackQuality() };
      }, QUALITY);
      steady = state.state === 1 && state.quality === QUALITY ? steady + 1 : 0;
      await page.waitForTimeout(1500);
    }
    const before = sample(profile);
    await page.waitForTimeout(WINDOW_MS);
    const after = sample(profile);
    return { valid: steady >= 4, memoryMB: after.memoryMB, cpu: (after.cpuSeconds - before.cpuSeconds) / (WINDOW_MS / 1000) * 100 };
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
};

const results = new Map(setups.map(([name]) => [name, []]));
for (let i = 0; i < repeats; i++) {
  for (const [name, extensions] of setups) {
    const result = await run(extensions);
    if (result.valid) results.get(name).push(result);
    else console.log(`Skipped a ${name} run: the video never played steadily`);
  }
}
const mean = (list, key) => list.reduce((total, r) => total + r[key], 0) / list.length;
for (const [name, list] of results) {
  if (list.length) console.log(`${name.padEnd(8)} memory ${mean(list, 'memoryMB').toFixed(0)} MB   CPU ${mean(list, 'cpu').toFixed(0)}%   (${list.length} runs)`);
}
