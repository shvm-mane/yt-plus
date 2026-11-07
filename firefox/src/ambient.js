// Ambient glow behind the player.
//
// Rendering tries WebGPU first because it samples a decoded video frame directly, while
// reading a 4K frame any other way makes the browser keep a full-size RGB copy. If WebGPU
// is missing or misbehaves, it drops to WebGL2, and if that fails the glow switches off
// without affecting anything else. The glow redraws at a limited rate, stops when paused
// or off-screen, and releases all GPU resources when leaving a watch page.
(() => {
  if (window.top !== window || location.pathname.startsWith('/embed/')) return;

  const root = document.documentElement;
  const MAX_CANVAS_W = 640;
  const log = (...args) => console.warn('[YT+]', ...args);

  // Shared glow maths. The fade comes before the blur, so the light dissolves with no
  // visible boundary, and colours stay premultiplied so its edge is truly transparent.
  const stretchParams = (g) => [
    g.w, g.h, g.halfW, g.halfH, g.boxW, g.boxH, g.extent, g.fadeStart, g.fadeCurve, 0, 0, 0
  ];

  // ---- WebGPU
  const WGSL_COMMON = `
    struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
    @vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
      let p = vec2f(f32((i << 1) & 2), f32(i & 2));
      return VO(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
    }`;
  const WGSL_STRETCH = `${WGSL_COMMON}
    struct U { size: vec2f, half_: vec2f, box: vec2f, extent: f32, fadeStart: f32, fadeCurve: f32 };
    @group(0) @binding(0) var smp: sampler;
    @group(0) @binding(1) var tex: texture_external;
    @group(0) @binding(2) var<uniform> u: U;
    fn fade(t: f32) -> f32 {
      if (t <= u.fadeStart) { return 1.0; }
      let x = clamp((t - u.fadeStart) / (1.0 - u.fadeStart), 0.0, 1.0);
      return pow(max(0.0, 0.5 + 0.5 * cos(x * 3.14159265)), u.fadeCurve);
    }
    @fragment fn fs(v: VO) -> @location(0) vec4f {
      let p = (v.uv - 0.5) * u.size;
      let over = max(abs(p) - u.half_, vec2f(0.0));
      let s = p / (u.half_ + max(over.x, over.y)) * 0.5 + 0.5;
      var sum = vec3f(0.0);
      for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
          let o = (vec2f(f32(x), f32(y)) - 1.5) * u.box * 0.25;
          sum += textureSampleBaseClampToEdge(tex, smp, s + o).rgb;
        }
      }
      let mask = fade(over.x / u.extent) * fade(over.y / u.extent);
      return vec4f(sum / 16.0 * mask, mask);
    }`;
  const WGSL_BLUR = `${WGSL_COMMON}
    @group(0) @binding(0) var smp: sampler;
    @group(0) @binding(1) var tex: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> dir: vec2f;
    @fragment fn fs(v: VO) -> @location(0) vec4f {
      var sum = vec4f(0.0);
      var total = 0.0;
      for (var i = -12; i <= 12; i++) {
        let x = f32(i) / 6.0;
        let w = exp(-0.5 * x * x);
        sum += textureSampleLevel(tex, smp, v.uv + dir * f32(i), 0.0) * w;
        total += w;
      }
      return sum / total;
    }`;
  const WGSL_FINAL = `${WGSL_COMMON}
    @group(0) @binding(0) var smp: sampler;
    @group(0) @binding(1) var tex: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> adjust: vec4f;
    @fragment fn fs(v: VO) -> @location(0) vec4f {
      let s = textureSampleLevel(tex, smp, v.uv, 0.0);
      var c = select(vec3f(0.0), s.rgb / s.a, s.a > 0.001);
      c = (c - 0.5) * adjust.y + 0.5;
      let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
      c = clamp(mix(vec3f(l), c, adjust.z) * adjust.x, vec3f(0.0), vec3f(1.0));
      return vec4f(c * s.a, s.a);
    }`;

  const createWebGPU = async (canvas, onFailure) => {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    let destroyed = false;
    device.lost.then((info) => { if (!destroyed) onFailure(new Error(`GPU device lost: ${info.message}`)); });
    device.addEventListener('uncapturederror', (e) => { if (!destroyed) onFailure(e.error, true); });

    try {
      const FORMAT = 'rgba16float';
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      const pipeline = (code, format) => {
        const module = device.createShaderModule({ code });
        return device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format }] }
        });
      };
      const [stretch, blur, final] = await Promise.all([
        pipeline(WGSL_STRETCH, FORMAT), pipeline(WGSL_BLUR, FORMAT), pipeline(WGSL_FINAL, canvasFormat)
      ]);
      const ctx = canvas.getContext('webgpu');
      ctx.configure({ device, format: canvasFormat, alphaMode: 'premultiplied' });

      const buffer = (size) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
      const stretchU = buffer(48);
      const blurH = buffer(16);
      const blurV = buffer(16);
      const finalU = buffer(16);
      const stretchLayout = stretch.getBindGroupLayout(0);
      let a = null;
      let b = null;
      let aView = null;
      let bView = null;
      let blurA = null;
      let blurB = null;
      let finalGroup = null;

      const renderPass = (encoder, view, pipe, group) => {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }]
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      };

      return {
        kind: 'webgpu',
        resize(g) {
          if (!a || a.width !== g.gw || a.height !== g.gh) {
            a?.destroy();
            b?.destroy();
            const texture = () => device.createTexture({
              size: [g.gw, g.gh],
              format: FORMAT,
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            });
            a = texture();
            b = texture();
            aView = a.createView();
            bView = b.createView();
            const group = (pipe, view, uniform) => device.createBindGroup({
              layout: pipe.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }, { binding: 2, resource: { buffer: uniform } }]
            });
            blurA = group(blur, aView, blurH);
            blurB = group(blur, bView, blurV);
            finalGroup = group(final, aView, finalU);
          }
          device.queue.writeBuffer(stretchU, 0, new Float32Array(stretchParams(g)));
          device.queue.writeBuffer(blurH, 0, new Float32Array([g.sigma / 6 / g.gw, 0, 0, 0]));
          device.queue.writeBuffer(blurV, 0, new Float32Array([0, g.sigma / 6 / g.gh, 0, 0]));
          device.queue.writeBuffer(finalU, 0, new Float32Array([g.brightness, g.contrast, g.saturation, 0]));
        },
        draw(video) {
          const external = device.importExternalTexture({ source: video });
          const encoder = device.createCommandEncoder();
          renderPass(encoder, aView, stretch, device.createBindGroup({
            layout: stretchLayout,
            entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: external }, { binding: 2, resource: { buffer: stretchU } }]
          }));
          renderPass(encoder, bView, blur, blurA);
          renderPass(encoder, aView, blur, blurB);
          renderPass(encoder, ctx.getCurrentTexture().createView(), final, finalGroup);
          device.queue.submit([encoder.finish()]);
        },
        destroy() {
          destroyed = true;
          device.destroy();
        }
      };
    } catch (err) {
      destroyed = true;
      device.destroy();
      throw err;
    }
  };

  // ---- WebGL2 fallback
  const GLSL_VS = `#version 300 es
    out vec2 uv;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      uv = p;
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
  const GLSL_HEAD = `#version 300 es
    precision highp float;
    in vec2 uv;
    out vec4 color;
    uniform sampler2D tex;`;
  const GLSL_STRETCH = `${GLSL_HEAD}
    uniform vec2 size;
    uniform vec2 half_;
    uniform float lod;
    uniform float extent;
    uniform float fadeStart;
    uniform float fadeCurve;
    float fade(float t) {
      if (t <= fadeStart) return 1.0;
      float x = clamp((t - fadeStart) / (1.0 - fadeStart), 0.0, 1.0);
      return pow(max(0.0, 0.5 + 0.5 * cos(x * 3.14159265)), fadeCurve);
    }
    void main() {
      vec2 p = (uv - 0.5) * size;
      vec2 over = max(abs(p) - half_, vec2(0.0));
      vec2 s = p / (half_ + max(over.x, over.y)) * 0.5 + 0.5;
      float mask = fade(over.x / extent) * fade(over.y / extent);
      color = vec4(textureLod(tex, s, lod).rgb * mask, mask);
    }`;
  const GLSL_BLUR = `${GLSL_HEAD}
    uniform vec2 dir;
    void main() {
      vec4 sum = vec4(0.0);
      float total = 0.0;
      for (int i = -12; i <= 12; i++) {
        float x = float(i) / 6.0;
        float w = exp(-0.5 * x * x);
        sum += texture(tex, uv + dir * float(i)) * w;
        total += w;
      }
      color = sum / total;
    }`;
  const GLSL_FINAL = `${GLSL_HEAD}
    uniform vec3 adjust;
    void main() {
      vec4 s = texture(tex, uv);
      vec3 c = s.a > 0.001 ? s.rgb / s.a : vec3(0.0);
      c = (c - 0.5) * adjust.y + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = clamp(mix(vec3(l), c, adjust.z) * adjust.x, 0.0, 1.0);
      color = vec4(c * s.a, s.a);
    }`;

  const createWebGL = async (canvas, onFailure) => {
    const SMALL_W = 128;
    const SMALL_H = 72;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL2 unavailable');
    let destroyed = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (!destroyed) onFailure(new Error('WebGL context lost'));
    });
    const float = !!gl.getExtension('EXT_color_buffer_float');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(gl.createVertexArray());

    const compile = (fs, names) => {
      const program = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, GLSL_VS], [gl.FRAGMENT_SHADER, fs]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      const u = {};
      for (const name of ['tex', ...names]) u[name] = gl.getUniformLocation(program, name);
      return { program, u };
    };
    const target = (w, h, internal, mips = false) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, internal, w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, w, h };
    };
    const free = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };
    const stretch = compile(GLSL_STRETCH, ['size', 'half_', 'lod', 'extent', 'fadeStart', 'fadeCurve']);
    const blur = compile(GLSL_BLUR, ['dir']);
    const final = compile(GLSL_FINAL, ['adjust']);
    const small = target(SMALL_W, SMALL_H, gl.RGBA8, true);
    const frame = new OffscreenCanvas(SMALL_W, SMALL_H).getContext('2d', { alpha: false });
    let a = null;
    let b = null;
    let geo = null;

    const pass = (prog, tex, dest, w, h) => {
      gl.useProgram(prog.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
      gl.viewport(0, 0, w, h);
    };

    return {
      kind: 'webgl',
      resize(g) {
        geo = g;
        if (!a || a.w !== g.gw || a.h !== g.gh) {
          free(a);
          free(b);
          const format = float ? gl.RGBA16F : gl.RGBA8;
          a = target(g.gw, g.gh, format);
          b = target(g.gw, g.gh, format);
        }
      },
      draw(video) {
        if (gl.isContextLost() || !geo) return;
        frame.drawImage(video, 0, 0, SMALL_W, SMALL_H);
        gl.bindTexture(gl.TEXTURE_2D, small.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        const g = geo;
        pass(stretch, small.tex, a.fbo, g.gw, g.gh);
        gl.uniform2f(stretch.u.size, g.w, g.h);
        gl.uniform2f(stretch.u.half_, g.halfW, g.halfH);
        gl.uniform1f(stretch.u.lod, Math.max(0, Math.log2(SMALL_H * g.boxH)));
        gl.uniform1f(stretch.u.extent, g.extent);
        gl.uniform1f(stretch.u.fadeStart, g.fadeStart);
        gl.uniform1f(stretch.u.fadeCurve, g.fadeCurve);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(blur, a.tex, b.fbo, g.gw, g.gh);
        gl.uniform2f(blur.u.dir, g.sigma / 6 / g.gw, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(blur, b.tex, a.fbo, g.gw, g.gh);
        gl.uniform2f(blur.u.dir, 0, g.sigma / 6 / g.gh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(final, a.tex, null, g.cw, g.ch);
        gl.uniform3f(final.u.adjust, g.brightness, g.contrast, g.saturation);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy() {
        destroyed = true;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    };
  };

  // ---- Page state
  // Firefox: WebGPU is unreliable from extension content scripts, so use WebGL2 only.
  const RENDERERS = [createWebGL];
  let tier = 0;
  let strikes = 0;
  let S = null;
  let R = null;
  let starting = false;
  let wrap = null;
  let canvas = null;
  let shadow = null;
  let topMark = null;
  let video = null;
  let on = false;
  let hasGeometry = false;
  let inView = true;
  let cancelFrame = null;
  let frameTimer = 0;
  let waitTimer = 0;
  let appObserved = false;

  const isWatch = () => location.pathname === '/watch';
  const findVideo = () => document.querySelector('#movie_player video.html5-main-video') || document.querySelector('#movie_player video');
  const app = () => document.querySelector('ytd-app');

  const sizeObserver = new ResizeObserver(() => { layout(); draw(); schedule(); });
  // The page grows as comments load; that only changes how far down the glow may reach.
  const appObserver = new ResizeObserver(() => {
    if (wrap && !document.fullscreenElement && wrap.style.display !== 'none') wrap.style.height = glowHeight();
  });
  let glowBottom = 0;
  const glowHeight = () => `${Math.min(glowBottom, Math.max(app()?.offsetHeight || 0, innerHeight))}px`;
  const viewObserver = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    if (inView) { draw(); schedule(); }
  });
  // Marks the top of the page, where the header goes fully transparent.
  const topObserver = new IntersectionObserver((entries) => {
    root.toggleAttribute('data-ytu-at-top', entries[entries.length - 1].isIntersecting);
  });

  const buildDom = () => {
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.id = 'ytu-ambient';
    canvas = document.createElement('canvas');
    shadow = document.createElement('div');
    shadow.className = 'ytu-shadow';
    topMark = document.createElement('div');
    topMark.className = 'ytu-top';
    wrap.append(topMark, canvas, shadow);
    viewObserver.observe(canvas);
    topObserver.observe(topMark);
  };

  const dropDom = () => {
    if (canvas) viewObserver.unobserve(canvas);
    if (topMark) topObserver.unobserve(topMark);
    attachVideo(null);
    wrap?.remove();
    wrap = canvas = shadow = topMark = null;
    hasGeometry = false;
    root.removeAttribute('data-ytu-at-top');
  };

  const stop = () => {
    const old = R;
    R = null;
    dropDom();
    try { old?.destroy(); } catch { /* already gone */ }
  };

  // A renderer that fails twice, or reports a bad error once, is replaced by the next one.
  const onRendererFailure = (err, serious = false) => {
    log('renderer problem:', err);
    stop();
    strikes += 1;
    if (serious || strikes >= 2) {
      tier += 1;
      strikes = 0;
    }
    if (tier >= RENDERERS.length) {
      log('no working renderer, glow turned off');
      setOn(false);
      return;
    }
    setTimeout(refresh, 500);
  };

  const start = async () => {
    if (R || starting || tier >= RENDERERS.length) return;
    starting = true;
    buildDom();
    try {
      R = await RENDERERS[tier](canvas, onRendererFailure);
    } catch (err) {
      log(`renderer ${tier} unavailable:`, err);
      tier += 1;
      dropDom();
    }
    starting = false;
    refresh();
  };

  // ---- Geometry (runs only when something moved)
  const layout = () => {
    if (!on || !video || !R || !wrap) return;
    const fsEl = document.fullscreenElement;
    const fs = !!fsEl;
    const pic = video.getBoundingClientRect();
    const fills = fs && pic.width >= innerWidth - 2 && pic.height >= innerHeight - 2;
    if (pic.width < 2 || pic.height < 2 || fills) {
      wrap.style.display = 'none';
      hasGeometry = false;
      return;
    }
    wrap.style.display = '';

    // YouTube may fullscreen <html> itself, which can't host a child outside <body>.
    const home = fsEl && fsEl !== root ? fsEl : document.body;
    if (wrap.parentElement !== home) home.prepend(wrap);
    wrap.classList.toggle('ytu-fs', fs);

    const sx = fs ? 0 : scrollX;
    const sy = fs ? 0 : scrollY;
    const extent = Math.max(1, pic.height * S.spread / 200);
    const blurPx = S.blur * (pic.height / 512) * 1.275;
    const reach = Math.ceil(extent + blurPx * 2.64);
    const left = Math.round(pic.left + sx - reach);
    const y = Math.round(pic.top + sy - reach);
    const w = Math.round(pic.width + reach * 2);
    const h = Math.round(pic.height + reach * 2);

    // Never let the glow make the page itself taller.
    glowBottom = y + h;
    wrap.style.height = fs ? '' : glowHeight();
    canvas.style.cssText = `left:${left}px;top:${y}px;width:${w}px;height:${h}px`;
    shadow.style.cssText = `left:${Math.round(pic.left + sx)}px;top:${Math.round(pic.top + sy)}px;width:${Math.round(pic.width)}px;height:${Math.round(pic.height)}px;`
      + (S.videoShadowSize && S.videoShadowOpacity ? `box-shadow:0 0 ${S.videoShadowSize}px rgba(0,0,0,${S.videoShadowOpacity / 100})` : '');
    root.style.setProperty('--ytu-grain-h', `${y + h}px`);
    root.style.setProperty('--ytu-grain-size', `${256 / (devicePixelRatio || 1)}px`);

    // Blur at low resolution so the kernel stays small. The result is soft enough that
    // the canvas can be far below screen resolution; the film grain sits at full resolution.
    const scale = Math.max(4, blurPx / 6);
    const cw = Math.min(MAX_CANVAS_W, Math.ceil(w / 4));
    const ch = Math.ceil(cw * h / w);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }

    const box = 1 / (256 * S.resolution / 100);
    R.resize({
      w, h, cw, ch,
      gw: Math.max(8, Math.ceil(w / scale)),
      gh: Math.max(8, Math.ceil(h / scale)),
      halfW: pic.width / 2,
      halfH: pic.height / 2,
      boxW: box * 9 / 16,
      boxH: box,
      extent,
      sigma: blurPx / scale,
      fadeStart: S.fadeStart / 100,
      fadeCurve: 40 / Math.max(1, S.fadeCurve),
      brightness: S.brightness / 100,
      contrast: S.contrast / 100,
      saturation: S.saturation / 100
    });
    hasGeometry = true;
  };

  // ---- Rendering
  const draw = () => {
    if (!on || !R || !video || !hasGeometry || !inView || video.readyState < 2 || !video.videoWidth) return;
    // Importing a MediaStream-backed video can crash the renderer. YouTube plays through
    // media source URLs, so this only guards against anything unusual.
    if (video.srcObject) return;
    try {
      R.draw(video);
    } catch (err) {
      onRendererFailure(err);
    }
  };

  // Asks for a frame only when one is due instead of being woken for every video frame,
  // and asks for nothing while paused or off-screen.
  const onFrame = () => {
    cancelFrame = null;
    if (!on || !video) return;
    draw();
    frameTimer = setTimeout(() => { frameTimer = 0; schedule(); }, Math.max(0, 1000 / S.glowFps - 17));
  };

  const schedule = () => {
    // Nothing visible to update (e.g. fullscreen video filling the screen): stay asleep
    // until a layout change brings the glow back.
    if (!on || !video || !inView || !hasGeometry || cancelFrame || frameTimer) return;
    const v = video;
    if (v.requestVideoFrameCallback) {
      const id = v.requestVideoFrameCallback(onFrame);
      cancelFrame = () => v.cancelVideoFrameCallback?.(id);
    } else {
      const id = requestAnimationFrame(onFrame);
      cancelFrame = () => cancelAnimationFrame(id);
    }
  };

  const attachVideo = (next) => {
    if (next === video) return;
    if (video) sizeObserver.unobserve(video);
    cancelFrame?.();
    cancelFrame = null;
    clearTimeout(frameTimer);
    frameTimer = 0;
    video = next;
    if (video) sizeObserver.observe(video);
  };

  // ---- Lifecycle
  const setPageVars = () => {
    const set = (k, v) => root.style.setProperty(k, v);
    const textShadow = (size, opacity) => (size && opacity ? `rgba(0,0,0,${Math.min(1, opacity / 100 * 1.8)}) 0 0 ${size / 5 * 2}px` : 'none');
    const fill = (value, rgb) => `rgba(${rgb},${rgb},${rgb},${Math.abs((value + 100) / 100 - 1).toFixed(3)})`;
    set('--ytu-header-fill', fill(S.headerFill, 0));
    set('--ytu-panel', fill(S.contentFill, 255));
    set('--ytu-header-text-shadow', textShadow(S.headerShadowSize, S.headerShadowOpacity));
    set('--ytu-content-images', S.contentImages / 100);
    set('--ytu-content-text-shadow', textShadow(S.contentShadowSize, S.contentShadowOpacity));
    set('--ytu-grain', S.filmGrain / 100);
    root.toggleAttribute('data-ytu-grain', S.filmGrain > 0);
    if (S.filmGrain > 0) grainTile();
  };


  // Film grain tile, drawn once per page instead of shipping an image. Darkening specks
  // are stronger than lightening ones so the glow's average brightness stays put.
  let grainUrl = '';
  const grainTile = () => {
    if (grainUrl) return;
    grainUrl = 'pending';
    const N = 256, img = new ImageData(N, N), px = img.data;
    let seed = 1964;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) + 1) / 4294967297;
    for (let i = 0; i < px.length; i += 4) {
      const n = Math.sqrt(-2 * Math.log(rnd())) * Math.cos(6.283185307 * rnd());
      const v = n >= 0 ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = Math.min(255, Math.round(n >= 0 ? n * 5 : -n * 34));
    }
    const c = new OffscreenCanvas(N, N);
    c.getContext('2d').putImageData(img, 0, 0);
    c.convertToBlob().then((b) => {
      grainUrl = URL.createObjectURL(b);
      root.style.setProperty('--ytu-grain-img', `url("${grainUrl}")`);
    }, () => { grainUrl = ''; });
  };

  const setOn = (value) => {
    on = value;
    root.toggleAttribute('data-ytu-ambient-on', on);
    if (on) {
      root.setAttribute('data-ytu-renderer', R.kind);
      return;
    }
    root.removeAttribute('data-ytu-renderer');
    root.removeAttribute('data-ytu-grain');
    stop();
  };

  const refresh = () => {
    if (!S) return;
    clearTimeout(waitTimer);
    root.toggleAttribute('data-ytu-hide-scrollbar', !!S.hideScrollbar);
    if (!S.ambient || !isWatch() || tier >= RENDERERS.length) {
      if (on || R) setOn(false);
      return;
    }
    const next = findVideo();
    if (!next || !document.body) {
      waitTimer = setTimeout(refresh, 300);
      return;
    }
    if (!R) { start(); return; }

    buildDom();
    setOn(true);
    setPageVars();
    attachVideo(next);
    if (!wrap.isConnected) document.body.prepend(wrap);
    if (!appObserved && app()) {
      appObserver.observe(app());
      appObserved = true;
    }
    layout();
    draw();
    schedule();
  };

  const guarded = (fn) => (...args) => {
    try {
      fn(...args);
    } catch (err) {
      log(err);
    }
  };

  const refreshAndDraw = guarded(() => { refresh(); layout(); draw(); schedule(); });
  for (const type of ['yt-navigate-finish', 'yt-page-data-updated', 'fullscreenchange']) {
    document.addEventListener(type, refreshAndDraw);
  }
  window.addEventListener('popstate', guarded(refresh));
  window.addEventListener('resize', guarded(() => { layout(); draw(); schedule(); }));
  // Media events only pass through capture. A different element here means the player swapped it.
  document.addEventListener('loadstart', guarded((e) => {
    if (S && on && e.target !== video && e.target === findVideo()) refresh();
  }), true);
  for (const type of ['loadeddata', 'seeked']) {
    document.addEventListener(type, guarded((e) => {
      if (e.target === video) { layout(); draw(); schedule(); }
    }), true);
  }

  // A tab left in the background gives its GPU memory back; it's rebuilt on return.
  let hiddenTimer = 0;
  document.addEventListener('visibilitychange', guarded(() => {
    clearTimeout(hiddenTimer);
    if (document.hidden) {
      hiddenTimer = setTimeout(guarded(() => { if (document.hidden && R) stop(); }), 30000);
    } else {
      refreshAndDraw();
    }
  }));

  globalThis.YTU_onSettings((settings) => {
    S = settings;
    refreshAndDraw();
  });
})();
