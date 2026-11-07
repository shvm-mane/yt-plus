<h1 align="center">YT+</h1>

<p align="center">
  unhook <code>&&</code> enhancer for youtube <code>&&</code> ambient light, in one extension
</p>

<p align="center">
  <a href="https://github.com/shvm-mane/yt-plus/releases/latest"><b>DOWNLOAD :)</b></a>
</p>

i used to run three youtube extensions at once. that's a lot of RAM and CPU for one website 🥲 so i merged em into one lightweight extension (w/ some tweaks ofc).

## what it does

- **hide stuff:** home feed, recommended videos, shorts, mixes, end screen feed, cards, annotations, fundraisers, merch, "more from youtube"
- **playback:** no "up next" autoplay, shorts open as normal videos, auto quality (4k by default), speed resets every video
- **layout:** 4 videos per row
- **ambient light:** soft glow behind the player w/ subtle film grain, see-through header & panels. press `A` to toggle it

everything's toggleable from the toolbar popup. built for dark mode + theatre mode.

## install

**chromium** (chrome, brave, edge, arc, etc.)
1. download `yt-plus-chromium.zip` from [releases](https://github.com/shvm-mane/yt-plus/releases/latest) and unzip it
2. go to `chrome://extensions`, turn on **developer mode**
3. **load unpacked** → pick the unzipped folder

**firefox** (and firefox-based browsers)
1. download `yt-plus-firefox.xpi` from [releases](https://github.com/shvm-mane/yt-plus/releases/latest)
2. it's unsigned, so either:
   - set `xpinstall.signatures.required` to `false` in `about:config` (developer edition / nightly / most forks), then drag the `.xpi` in, **or**
   - load it temporarily from `about:debugging` → **this firefox** → **load temporary add-on** (gone after restart)

## credits

YT+ wouldn't exist without:

- **[unhook](https://unhook.app)** by unhook: the idea for hiding all the distracting stuff
- **[enhancer for youtube](https://www.mrfdev.com/enhancer-for-youtube)** by maxime rf: the playback tweaks
- **[ambient light for youtube](https://github.com/WesselKroos/youtube-ambilight)** by wessel kroos (mit): the glow and its settings

go use and support them.

## license

[mit](LICENSE) (includes ambient light's mit notice)
