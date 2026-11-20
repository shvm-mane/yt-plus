// Page world: the only place the YouTube player API is reachable.
(() => {
  let S = null;
  const isEmbed = location.pathname.startsWith('/embed/');
  const RANK = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'hd2880', 'highres'];
  const PLAY_TARGETS = '.ytp-play-button, video, .ytp-cued-thumbnail-overlay, .ytp-large-play-button, .ytp-player-content';

  const hasPlaylist = () => new URLSearchParams(location.search).has('list');
  const mainPlayer = () => document.querySelector('#movie_player');
  const fromVideo = (v) => (v instanceof HTMLVideoElement ? v.closest('#movie_player') : null);

  // ---- Shorts -> regular watch page
  const shortsId = (path) => /^\/shorts\/([\w-]+)/.exec(path)?.[1];
  const redirectShorts = () => {
    const id = S?.convertShorts && shortsId(location.pathname);
    if (id) location.replace(`/watch?v=${id}`);
  };
  document.addEventListener('click', (e) => {
    if (!S?.convertShorts || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target instanceof Element && e.target.closest('a[href^="/shorts/"]');
    const id = a && shortsId(a.getAttribute('href'));
    if (!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(`/watch?v=${id}`);
  }, true);

  // ---- Per-video state
  let current = null;
  let qualityTimers = [];
  let userPickedQuality = false;

  const videoState = (player) => {
    // The page URL names the real video. While an ad plays, the player reports the ad's
    // id instead, which would otherwise count as a second video and pause twice.
    const id = (!isEmbed && new URLSearchParams(location.search).get('v')) || player.getVideoData?.()?.video_id;
    if (!id) return null;
    if (current?.id !== id) {
      // A click on the player just before it finished loading still counts.
      current = { id, armed: performance.now() - lastGesture > 2000 };
      onNewVideo(player);
    }
    return current;
  };

  const onNewVideo = (player) => {
    userPickedQuality = false;
    scheduleQuality(player);
    disableAutonav(player);
    if (S.resetSpeed && player.getPlaybackRate?.() !== S.defaultSpeed) player.setPlaybackRate?.(S.defaultSpeed);
  };

  // ---- Quality
  const targetQuality = () => {
    if (isEmbed) return S.qualityEmbeds;
    return hasPlaylist() ? S.qualityPlaylists : S.qualityVideos;
  };

  const applyQuality = (player) => {
    if (!S.selectQuality || userPickedQuality || player.classList.contains('ad-showing')) return;
    const levels = (player.getAvailableQualityLevels?.() || []).filter((q) => q !== 'auto');
    if (!levels.length) return;
    const max = RANK.indexOf(targetQuality());
    const pick = levels.find((q) => RANK.indexOf(q) <= max) || levels[levels.length - 1];
    // Re-requesting the same quality makes the player flush and refetch, so only ask once.
    if (current && current.requested === pick) return;
    if (current) current.requested = pick;
    player.setPlaybackQualityRange?.(pick, pick);
  };

  const scheduleQuality = (player) => {
    qualityTimers.forEach(clearTimeout);
    qualityTimers = [0, 1000, 3000, 7000].map((ms) => setTimeout(() => applyQuality(player), ms));
  };

  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('.ytp-settings-menu, .ytp-popup')) userPickedQuality = true;
  }, true);

  // ---- "Up next" autoplay switch
  // The player restores this switch while it loads, so check it a few times. Clicking the
  // real button is the only method that sticks; setAutonav() doesn't change the switch.
  let autonavTimers = [];
  let lastAutonavClick = 0;
  let userSetAutonav = false;
  const clickAutonavOff = (player) => {
    if (!S.disableAutoplay || isEmbed || userSetAutonav) return;
    const on = player.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    const now = performance.now();
    if (!on || now - lastAutonavClick < 1500) return;
    lastAutonavClick = now;
    on.closest('button')?.click();
  };
  const disableAutonav = (player) => {
    autonavTimers.forEach(clearTimeout);
    autonavTimers = [0, 700, 2000, 5000, 10000].map((ms) => setTimeout(() => clickAutonavOff(player), ms));
  };
  // Respect the switch if it's flipped by hand during this page view.
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('.ytp-autonav-toggle')) userSetAutonav = true;
  }, true);

  // ---- Stop videos starting on their own
  let lastGesture = -Infinity;
  const markUserPlay = () => {
    lastGesture = performance.now();
    if (current) current.armed = false;
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('#movie_player') && e.target.closest(PLAY_TARGETS)) markUserPlay();
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof Element && (t.isContentEditable || t.matches('input, textarea, select'));
    if (!typing && (e.key === 'k' || e.key === 'K' || e.key === ' ')) markUserPlay();
  }, true);

  // A pause requested while the player is still loading can be ignored, so keep
  // re-checking until it has really taken hold (or the user presses play).
  const holdPaused = (player, video, state) => {
    if (state.holding) return;
    state.holding = true;
    const started = performance.now();
    const tick = () => {
      if (current !== state || !state.armed || performance.now() - started > 20000) {
        state.holding = false;
        return;
      }
      if (video.paused && player.getPlayerState?.() === 2) {
        state.heldAt = performance.now();
        state.holding = false;
        return;
      }
      player.pauseVideo?.();
      setTimeout(tick, 150);
    };
    tick();
  };

  const maybeBlock = (player, video, state) => {
    if (!S.blockAutoplay || isEmbed || !state.armed) return;
    if (S.allowPlaylistAutoplay && hasPlaylist()) return;
    // Once paused for a while, a new start is user intent (media keys, etc.).
    if (state.heldAt && performance.now() - state.heldAt > 6000) {
      state.armed = false;
      return;
    }
    state.heldAt = 0;
    holdPaused(player, video, state);
  };

  // ---- Media events (they don't bubble, but they do pass through capture)
  for (const type of ['loadstart', 'loadedmetadata', 'play', 'playing']) {
    document.addEventListener(type, (e) => {
      if (!S) return;
      const player = fromVideo(e.target);
      if (!player) return;
      const state = videoState(player);
      if (!state) return;
      if (type === 'play' || type === 'playing') maybeBlock(player, e.target, state);
      if (type === 'loadedmetadata' || type === 'playing') scheduleQualityOnce(player, state, type);
      // Quality can't be set during an ad, so try again when the video itself starts.
      if (type === 'playing' && !state.requested) applyQuality(player);
    }, true);
  }
  const scheduleQualityOnce = (player, state, type) => {
    if (state[type]) return;
    state[type] = true;
    scheduleQuality(player);
    disableAutonav(player);
  };

  // ---- Controls below the video
  // With the controls moved below the video they stay visible, but YouTube stops updating
  // them once it auto-hides them (and keeping them awake costs a lot: it rewrites them every
  // frame). So while they're asleep, move just the progress bar, dot and time ourselves,
  // about once per pixel of progress. YouTube takes over again as soon as they wake.
  let tickTimer = 0;
  let segments = null;
  const fmt = (t) => {
    const s = Math.floor(t % 60), m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const asleep = (player) => S?.controlsBelow && player && !document.hidden && !document.fullscreenElement
    && player.classList.contains('ytp-autohide') && !player.classList.contains('ad-showing');
  const tick = () => {
    const player = mainPlayer();
    const video = player?.querySelector('video');
    if (!asleep(player) || !video || !Number.isFinite(video.duration) || !video.duration) { stopTicking(); return; }
    if (!segments) {
      const bar = player.querySelector('.ytp-progress-bar');
      if (!bar) { stopTicking(); return; }
      const base = bar.getBoundingClientRect();
      segments = {
        list: [...bar.querySelectorAll('.ytp-chapter-hover-container')].map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left - base.left, width: r.width, play: el.querySelector('.ytp-play-progress'), load: el.querySelector('.ytp-load-progress'), p: -1, l: -1 };
        }),
        scrubber: player.querySelector('.ytp-scrubber-container'),
        time: player.querySelector('.ytp-time-current')
      };
    }
    const { list, scrubber, time } = segments;
    // Chapters are drawn as separate pieces with gaps between them; time maps onto the
    // pieces only, so walk them to find the pixel for a given moment.
    const total = list.reduce((sum, seg) => sum + seg.width, 0);
    const at = (t) => {
      let rest = Math.min(1, Math.max(0, t / video.duration)) * total;
      for (const seg of list) {
        if (rest <= seg.width) return seg.left + rest;
        rest -= seg.width;
      }
      return list.length ? list[list.length - 1].left + list[list.length - 1].width : 0;
    };
    const x = at(video.currentTime);
    const b = video.buffered;
    let loaded = x;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.5) loaded = Math.max(loaded, at(b.end(i)));
    for (const seg of list) {
      const p = Math.round(Math.min(1, Math.max(0, (x - seg.left) / seg.width)) * 1000) / 1000;
      const l = Math.round(Math.min(1, Math.max(0, (loaded - seg.left) / seg.width)) * 1000) / 1000;
      if (p !== seg.p && seg.play) { seg.p = p; seg.play.style.transform = `scaleX(${p})`; }
      if (l !== seg.l && seg.load) { seg.l = l; seg.load.style.transform = `scaleX(${l})`; }
    }
    if (scrubber) scrubber.style.transform = `translateX(${x.toFixed(1)}px)`;
    const text = fmt(video.currentTime);
    if (time && time.textContent !== text) time.textContent = text;
  };
  const stopTicking = () => { clearInterval(tickTimer); tickTimer = 0; segments = null; };
  const startTicking = () => {
    watchPlayer();
    const player = mainPlayer();
    const video = player?.querySelector('video');
    if (tickTimer || !asleep(player) || !video || video.paused) return;
    const width = player.querySelector('.ytp-progress-bar')?.clientWidth || 1000;
    tickTimer = setInterval(tick, Math.min(1000, Math.max(100, 1000 * video.duration / width)));
    tick();
  };
  const autohideWatch = new MutationObserver(() => {
    if (mainPlayer()?.classList.contains('ytp-autohide')) startTicking(); else stopTicking();
  });
  let watchedPlayer = null;
  const watchPlayer = () => {
    const player = mainPlayer();
    if (player === watchedPlayer) return;
    autohideWatch.disconnect();
    watchedPlayer = player;
    if (player) autohideWatch.observe(player, { attributes: true, attributeFilter: ['class'] });
  };
  document.addEventListener('playing', (e) => { if (fromVideo(e.target) === mainPlayer()) startTicking(); }, true);
  for (const type of ['pause', 'seeked']) {
    document.addEventListener(type, (e) => { if (tickTimer && fromVideo(e.target) === mainPlayer()) { tick(); if (e.target.paused) stopTicking(); } }, true);
  }
  document.addEventListener('visibilitychange', startTicking);
  window.addEventListener('resize', () => { segments = null; });

  // ---- Boot / SPA navigation
  const onNavigate = () => {
    if (!S) return;
    userSetAutonav = false;
    redirectShorts();
    const player = mainPlayer();
    if (player) videoState(player);
  };
  document.addEventListener('yt-navigate-start', (e) => {
    const url = e.detail?.url;
    const id = S?.convertShorts && url && shortsId(url);
    if (id) location.replace(`/watch?v=${id}`);
  });
  document.addEventListener('yt-navigate-finish', onNavigate);

  window.addEventListener('ytu:settings', (e) => {
    const first = !S;
    S = JSON.parse(e.detail);
    if (first) onNavigate();
    else {
      const player = mainPlayer();
      if (player) { disableAutonav(player); applyQuality(player); }
      startTicking();
    }
  });
  window.dispatchEvent(new CustomEvent('ytu:request-settings'));
})();
