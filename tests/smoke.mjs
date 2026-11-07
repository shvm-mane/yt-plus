// Checks every feature on live YouTube in a temporary, muted, windowless profile.
// Usage: node smoke.mjs [browserPath] [extraFlag ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../chromium');
const browser = process.argv[2] || '/Applications/Helium.app/Contents/MacOS/Helium';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-plus-smoke-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: browser,
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--enable-automation', '--disable-component-extensions-with-background-pages'],
  args: ['--headless=new', '--mute-audio', '--no-first-run', '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required',
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...process.argv.slice(3)],
  viewport: { width: 1440, height: 900 }
});
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=60';
try {
  await new Promise((r) => setTimeout(r, 1500));
  await ctx.addCookies([
    { name: 'PREF', value: 'f6=400&hl=en', domain: '.youtube.com', path: '/' },
    { name: 'wide', value: '1', domain: '.youtube.com', path: '/' }
  ]);
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.text().includes('[YT+]')) problems.push(m.text().slice(0, 160)); });
  const q = (fn, arg) => page.evaluate(fn, arg);
  // Reads what's really on screen. 'x,y' pairs are CSS pixels.
  const pixels = async (points) => {
    const png = (await page.screenshot({ type: 'png' })).toString('base64');
    return q(async ({ png, points }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
      c.drawImage(bitmap, 0, 0);
      const k = bitmap.width / innerWidth;
      return points.map(([x, y]) => {
        // Average a patch so film grain doesn't skew the reading.
        const d = c.getImageData(x * k, y * k, 12, 12).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / 4 * 3);
      });
    }, { png, points });
  };
  const glow = () => q(() => ({
    canvas: !!document.querySelector('#ytu-ambient canvas'),
    on: document.documentElement.hasAttribute('data-ytu-ambient-on'),
    renderer: document.documentElement.getAttribute('data-ytu-renderer')
  }));

  await page.goto(VIDEO, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  await page.waitForTimeout(7000);
  await q(() => document.querySelector('#movie_player').mute());

  // Follows the default in settings.js: videos either wait for a click or start by themselves.
  const settings = fs.readFileSync(path.join(ext, 'src/settings.js'), 'utf8');
  const blocks = /blockAutoplay: true/.test(settings);
  const paused = await q(() => document.querySelector('#movie_player video').paused);
  check(blocks ? 'videos wait for play' : 'videos start by themselves', paused === blocks);
  if (paused) await page.click('#movie_player video', { force: true });
  await page.waitForTimeout(5000);
  const playing = await q(() => { const m = document.querySelector('#movie_player'); return { state: m.getPlayerState(), q: m.getPlaybackQuality(), autonav: document.querySelector('.ytp-autonav-toggle-button')?.getAttribute('aria-checked') }; });
  check('video is playing', playing.state === 1 || playing.state === 3, `state ${playing.state}`);
  check('quality selection', playing.q === 'hd2160', playing.q);
  check('"Up next" autoplay off', playing.autonav === 'false', playing.autonav);
  const g = await glow();
  check('glow running', g.canvas && g.on, g.renderer);
  const lit = await pixels([[1405, 400], [1405, 760]]);
  check('glow is visible on screen', Math.max(...lit) > 8, `brightness ${lit.map((v) => v.toFixed(0)).join(', ')}`);
  check('recommended hidden', await q(() => !document.querySelector('#related')?.getClientRects().length));
  check('page is black, no seam', await q(() => getComputedStyle(document.documentElement).backgroundColor === 'rgb(0, 0, 0)'));
  check('film grain present', await q(() => getComputedStyle(document.querySelector('ytd-app'), '::before').backgroundImage.includes('blob:')));
  check('header clear at top', await q(() => getComputedStyle(document.querySelector('ytd-masthead')).backgroundColor === 'rgba(0, 0, 0, 0)'));
  await page.mouse.move(500, 700);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(1500);
  check('header tinted when scrolled', await q(() => getComputedStyle(document.querySelector('ytd-masthead')).backdropFilter.includes('blur')));
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1500);
  const below = await pixels([[1405, 200], [1405, 500], [1405, 850]]);
  check('no grey below the glow', Math.max(...below) < 12, `brightness ${below.map((v) => v.toFixed(0)).join(', ')}`);
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(800);

  await page.keyboard.press('a');
  await page.waitForTimeout(1000);
  check('A turns glow off', !(await glow()).canvas);
  await page.keyboard.press('a');
  await page.waitForTimeout(2000);
  check('A turns glow on', (await glow()).canvas);

  await page.keyboard.press('f');
  await page.waitForTimeout(2500);
  check('fullscreen shows the player', await q(() => document.querySelector('#movie_player').getBoundingClientRect().width > 1000));
  await page.keyboard.press('f');
  await page.waitForTimeout(1200);

  await page.goto('https://www.youtube.com/shorts/aqz-KE-bpKQ', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  check('Shorts open as videos', page.url().includes('/watch?v='));

  await page.goto('https://www.youtube.com/results?search_query=lofi', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const search = await q(() => ({
    shorts: [...document.querySelectorAll('a[href^="/shorts/"]')].filter((e) => e.getClientRects().length).length,
    mixes: [...document.querySelectorAll('yt-lockup-view-model')].filter((e) => e.querySelector('a[href*="start_radio=1"]') && e.getClientRects().length).length,
    chip: [...document.querySelectorAll('yt-chip-cloud-chip-renderer')].some((e) => e.getClientRects().length && e.textContent.trim() === 'Shorts')
  }));
  check('Shorts hidden', search.shorts === 0 && !search.chip);
  check('Mixes hidden', search.mixes === 0);
  check('glow released off video pages', !(await glow()).canvas);

  await page.goto('https://www.youtube.com/@YouTube/videos', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const row = await q(() => { const items = [...document.querySelectorAll('ytd-rich-item-renderer')].filter((e) => e.getClientRects().length); const top = items[0]?.getBoundingClientRect().top; return items.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 5).length; });
  check('4 videos per row', row === 4, String(row));
  check('no extension warnings', problems.length === 0, problems[0] || '');
} catch (err) {
  check('test ran to the end', false, err.message.slice(0, 160));
} finally {
  await ctx.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
