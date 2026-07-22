/**
 * visual-enhancements.js  v1.1
 *
 * 三项视觉增强（全部全局生效，无需手动开启）：
 *
 *  1. WaveformBar  — 波形进度条（底部播放栏 + 主页面板各一个实例）
 *  2. CoverGlow    — 封面/圆盘流光（底部方形封面 + 主页圆形黑胶各一个实例）
 *  3. BgAura       — 背景径向色彩场（全局单例）
 *
 *  颜色来源：window.VibeColor（由 app.js 在封面更新时写入 {r,g,b}）
 *            fallback 到 CSS --fc-accent-rgb
 */
(function (g) {
  'use strict';

  /* ═══════════════════════════════════════════════════
   *  工具
   * ═══════════════════════════════════════════════════ */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t)    { return a + (b - a) * t; }

  function getVibeColor() {
    if (g.VibeColor && typeof g.VibeColor.r === 'number') return g.VibeColor;
    try {
      var rgb = getComputedStyle(document.documentElement)
                  .getPropertyValue('--fc-accent-rgb').trim().split(',');
      if (rgb.length === 3) return { r: +rgb[0], g: +rgb[1], b: +rgb[2] };
    } catch (e) {}
    return { r: 0, g: 245, b: 212 };
  }

  function getBeat() {
    return (g.AudioReactive && g.AudioReactive.state)
      ? (g.AudioReactive.state.kick || 0) : 0;
  }
  function getRms() {
    return (g.AudioReactive && g.AudioReactive.state)
      ? (g.AudioReactive.state.rms  || 0) : 0;
  }

  function rgba(vc, a) {
    return 'rgba(' + vc.r + ',' + vc.g + ',' + vc.b + ',' + a.toFixed(3) + ')';
  }

  /* ═══════════════════════════════════════════════════
   *  共享 FFT — 每帧只 getByteFrequencyData 一次
   * ═══════════════════════════════════════════════════ */
  var _fftSmooth = null;
  var _fftBinCount = 0;

  function updateFFT(dt) {
    var an  = g.analyser;
    var aud = g.audio;
    var playing = an && aud && !aud.paused;
    var bins = an ? an.frequencyBinCount : 64;

    if (_fftBinCount !== bins) {
      _fftSmooth   = new Float32Array(bins);
      _fftBinCount = bins;
    }

    if (playing) {
      var raw = new Uint8Array(bins);
      an.getByteFrequencyData(raw);
      var atk = 1 - Math.exp(-dt / 0.030);
      var rel = 1 - Math.exp(-dt / 0.120);
      for (var i = 0; i < bins; i++) {
        var v = raw[i] / 255;
        _fftSmooth[i] += (v - _fftSmooth[i]) * (v > _fftSmooth[i] ? atk : rel);
      }
    } else {
      var decay = Math.pow(0.05, dt);
      for (var i = 0; i < _fftBinCount; i++) _fftSmooth[i] *= decay;
    }
  }

  /* ═══════════════════════════════════════════════════
   *  1. WaveformBar 工厂
   *     barId      — 进度条容器 id
   *     canvasId   — 要创建的 canvas id
   *     getProgress— 返回 0-1 播放进度的函数
   *     onPointer  — 是否监听指针事件（底部进度条已有原生事件，主页需自行绑定）
   * ═══════════════════════════════════════════════════ */
  function makeWaveformInstance(barId, canvasId, getProgress, barH) {
    var canvas = null;
    var ctx    = null;
    var ripples = [];
    barH = barH || 24;

    function init() {
      var bar = document.getElementById(barId);
      if (!bar || document.getElementById(canvasId)) return;

      canvas = document.createElement('canvas');
      canvas.id = canvasId;
      canvas.style.cssText = [
        'position:absolute', 'left:0', 'right:0', 'top:50%',
        'transform:translateY(-50%)',
        'width:100%', 'height:' + barH + 'px',
        'pointer-events:none', 'z-index:2', 'border-radius:999px',
      ].join(';');
      if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
      bar.appendChild(canvas);

      // 涟漪：监听该 bar 上的指针事件
      bar.addEventListener('pointerdown', addRippleFromEvent);
      bar.addEventListener('pointermove',  function(e){ if (e.buttons) addRippleFromEvent(e); });
    }

    function addRippleFromEvent(e) {
      var bar = document.getElementById(barId);
      if (!bar) return;
      var rect = bar.getBoundingClientRect();
      var x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      ripples.push({ x: x, age: 0, maxAge: 0.55 });
    }

    function draw(dt) {
      if (!canvas) { init(); if (!canvas) return; }

      var bar = document.getElementById(barId);
      if (!bar) return;
      var rect = bar.getBoundingClientRect();
      var W = Math.round(rect.width), H = barH;
      if (W < 4) return;
      if (canvas.width !== W)  canvas.width  = W;
      if (canvas.height !== H) canvas.height = H;

      ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      var vc   = getVibeColor();
      var beat = getBeat();
      var pct  = getProgress ? clamp(getProgress(), 0, 1) : 0;
      var bins = _fftSmooth;
      if (!bins) return;

      // ── 波浪点 ──────────────────────────────────────
      var midY     = H / 2;
      var useBins  = Math.max(8, Math.floor(_fftBinCount * 0.40));
      var step     = W / Math.max(1, useBins - 1);
      var beatAmp  = 1.0 + beat * 1.0;
      var pts = [];
      for (var i = 0; i < useBins; i++) {
        pts.push({ x: i * step, y: bins[i] * midY * 0.55 * beatAmp });
      }

      function drawWave(colorStr, xFrom, xTo) {
        if (xFrom >= xTo) return;
        ctx.save();
        ctx.beginPath(); ctx.rect(xFrom, 0, xTo - xFrom, H); ctx.clip();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, midY - pts[0].y);
        for (var j = 1; j < pts.length - 1; j++) {
          ctx.quadraticCurveTo(pts[j].x, midY - pts[j].y,
            (pts[j].x + pts[j+1].x) / 2, midY - (pts[j].y + pts[j+1].y) / 2);
        }
        ctx.lineTo(pts[pts.length-1].x, midY - pts[pts.length-1].y);
        for (var j = pts.length-1; j >= 1; j--) {
          ctx.quadraticCurveTo(pts[j].x, midY + pts[j].y,
            (pts[j].x + pts[j-1].x) / 2, midY + (pts[j].y + pts[j-1].y) / 2);
        }
        ctx.lineTo(pts[0].x, midY + pts[0].y);
        ctx.closePath();
        ctx.fillStyle = colorStr;
        ctx.fill();
        ctx.restore();
      }

      drawWave(rgba(vc, 0.22),             0, W);
      drawWave(rgba(vc, 0.72 + beat*0.22), 0, pct * W);

      // ── 进度指示竖线 ──────────────────────────────
      if (pct > 0.002 && pct < 0.998) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pct * W, 0); ctx.lineTo(pct * W, H);
        ctx.strokeStyle = rgba(vc, 0.90);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // ── 涟漪 ──────────────────────────────────────
      for (var ri = ripples.length - 1; ri >= 0; ri--) {
        var r = ripples[ri];
        r.age += dt;
        if (r.age >= r.maxAge) { ripples.splice(ri, 1); continue; }
        var prog = r.age / r.maxAge;
        ctx.save();
        ctx.beginPath();
        ctx.arc(r.x * W, midY, prog * H * 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(vc, (1 - prog) * 0.70);
        ctx.lineWidth = 1.2 * (1 - prog);
        ctx.stroke();
        ctx.restore();
      }
    }

    return { init: init, draw: draw };
  }

  /* ═══════════════════════════════════════════════════
   *  2a. RectGlow — 方形封面流光（底部播放栏）
   * ═══════════════════════════════════════════════════ */
  function makeRectGlow(coverId, canvasId, cornerR) {
    var canvas = null, ctx = null;
    var flowOffset = 0, glowPulse = 0;

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x+r, y); c.lineTo(x+w-r, y); c.quadraticCurveTo(x+w,y,x+w,y+r);
      c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
      c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y);
      c.closePath();
    }
    function borderPt(t, W, H) {
      var d = t * 2 * (W + H);
      if (d < W) return { x: d, y: 0 };
      d -= W; if (d < H) return { x: W, y: d };
      d -= H; if (d < W) return { x: W-d, y: H };
      d -= W; return { x: 0, y: H-d };
    }

    function init() {
      var cover = document.getElementById(coverId);
      if (!cover || document.getElementById(canvasId)) return;
      canvas = document.createElement('canvas');
      canvas.id = canvasId;
      canvas.style.cssText = 'position:absolute;inset:-4px;pointer-events:none;z-index:2;border-radius:' + (cornerR+2) + 'px';
      if (getComputedStyle(cover).position === 'static') cover.style.position = 'relative';
      cover.style.overflow = 'visible';
      cover.appendChild(canvas);
    }

    function draw(dt) {
      if (!canvas) { init(); if (!canvas) return; }
      var cover = document.getElementById(coverId);
      if (!cover) return;
      var rect = cover.getBoundingClientRect();
      var W = Math.round(rect.width + 8), H = Math.round(rect.height + 8);
      if (W < 4 || H < 4) return;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      var vc = getVibeColor(), beat = getBeat(), rms = getRms();
      glowPulse = lerp(glowPulse, 0.45 + rms*0.35 + beat*0.55, 1-Math.exp(-dt/0.08));
      flowOffset = (flowOffset + lerp(0.08, 0.22, clamp(rms*3+beat*1.5,0,1)) * dt) % 1;
      var alpha = clamp(glowPulse, 0, 1);

      // 底线呼吸
      ctx.save(); roundRect(ctx, 0, 0, W, H, cornerR+2);
      ctx.strokeStyle = rgba(vc, 0.18 + alpha*0.32);
      ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();

      // 流光点
      for (var i = 0; i < 4; i++) {
        var t = (flowOffset + i/4) % 1;
        var p = borderPt(t, W, H);
        var da = alpha * (0.85 + 0.15*Math.sin(t*Math.PI*4 + flowOffset*8));
        var gr = ctx.createRadialGradient(p.x,p.y,0, p.x,p.y, 7+beat*4);
        gr.addColorStop(0, rgba(vc, da));
        gr.addColorStop(0.5, rgba(vc, da*0.35));
        gr.addColorStop(1, rgba(vc, 0));
        ctx.save(); ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(p.x,p.y, 7+beat*4, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }

      // beat 全边框脉冲
      if (beat > 0.45) {
        ctx.save(); roundRect(ctx, 0, 0, W, H, cornerR+2);
        ctx.strokeStyle = rgba(vc, beat*0.55);
        ctx.lineWidth = 2 + beat*1.5; ctx.stroke(); ctx.restore();
      }
    }

    return { init: init, draw: draw };
  }

  /* ═══════════════════════════════════════════════════
   *  2b. DiscGlow — 圆形黑胶流光（主页 home-np-disc）
   *      canvas 挂在 disc-wrap 上（disc 本身 overflow:hidden 会裁剪）
   * ═══════════════════════════════════════════════════ */
  function makeDiscGlow(wrapId, discId, canvasId) {
    var canvas = null, ctx = null;
    var flowAngle = 0, glowPulse = 0;

    function init() {
      var wrap = document.getElementById(wrapId);
      if (!wrap || document.getElementById(canvasId)) return;
      canvas = document.createElement('canvas');
      canvas.id = canvasId;
      // 绝对定位在 wrap 中央，比 disc 大 12px（各边 6px）
      canvas.style.cssText = [
        'position:absolute',
        'top:50%', 'left:50%',
        'transform:translate(-50%,-50%)',
        'pointer-events:none', 'z-index:3',
        'border-radius:50%',
      ].join(';');
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      wrap.appendChild(canvas);
    }

    function draw(dt) {
      if (!canvas) { init(); if (!canvas) return; }
      var disc = document.getElementById(discId);
      var wrap = document.getElementById(wrapId);
      if (!disc || !wrap) return;

      /* ── 播放状态检测：无歌曲或已暂停 → 淡出清空 ── */
      var aud = g.audio;
      var isPlaying = aud && !aud.paused && !aud.ended
                      && aud.readyState >= 2 && aud.currentTime > 0;
      if (!isPlaying) {
        glowPulse = lerp(glowPulse, 0, 1 - Math.exp(-dt / 0.25));
        if (glowPulse < 0.005) {
          glowPulse = 0;
          /* canvas 存在就清空，避免残影 */
          if (canvas.width > 0) {
            (canvas.getContext('2d')).clearRect(0, 0, canvas.width, canvas.height);
          }
          return;
        }
        /* 仍在淡出阶段：只衰减，不更新 flowAngle */
      }

      var rect = disc.getBoundingClientRect();
      var wrapRect = wrap.getBoundingClientRect();
      // canvas 尺寸取 disc+16px 与 wrap 较小值，保证不超出 wrap（避免被祖先 overflow:hidden 截断）
      var S = Math.min(
        Math.round(Math.max(rect.width, rect.height)) + 16,
        Math.floor(Math.min(wrapRect.width, wrapRect.height))
      );
      if (S < 10) return;
      if (canvas.width !== S)  { canvas.width  = S; canvas.style.width  = S + 'px'; }
      if (canvas.height !== S) { canvas.height = S; canvas.style.height = S + 'px'; }

      ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, S, S);

      var vc = getVibeColor(), beat = getBeat(), rms = getRms();
      var cx = S / 2, cy = S / 2;
      var discR = Math.round(Math.max(rect.width, rect.height)) / 2;  // 真实 disc 半径
      var glowR = Math.min(discR + 4, S / 2 - 2);     // 流光所在半径（disc 外侧，不超出 canvas）

      glowPulse = lerp(glowPulse, 0.40 + rms*0.35 + beat*0.60, 1-Math.exp(-dt/0.08));
      var speed = lerp(0.12, 0.35, clamp(rms*3+beat*1.5,0,1));
      flowAngle = (flowAngle + speed * dt * Math.PI * 2) % (Math.PI * 2);

      var alpha = clamp(glowPulse, 0, 1);

      // ── 底圆弧（呼吸）──────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI*2);
      ctx.strokeStyle = rgba(vc, 0.15 + alpha*0.28);
      ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();

      // ── 流光弧段（绕圆一圈，3 段均匀分布）──────────
      var numArcs = 3;
      var arcLen  = Math.PI * 0.55;   // 每段弧长（约 99°）
      for (var i = 0; i < numArcs; i++) {
        var startA = flowAngle + (i / numArcs) * Math.PI * 2;
        var endA   = startA + arcLen;
        var da = alpha * (0.80 + 0.20 * Math.sin(flowAngle * 3 + i * 2));

        // 沿弧渐变（头亮尾暗）
        var gx1 = cx + glowR * Math.cos(startA), gy1 = cy + glowR * Math.sin(startA);
        var gx2 = cx + glowR * Math.cos(endA),   gy2 = cy + glowR * Math.sin(endA);
        var grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        grad.addColorStop(0,   rgba(vc, da));
        grad.addColorStop(0.5, rgba(vc, da * 0.55));
        grad.addColorStop(1,   rgba(vc, 0.04));

        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, glowR, startA, endA);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3 + beat * 3;
        ctx.lineCap = 'round';
        ctx.stroke(); ctx.restore();

        // 弧头亮点
        var dotX = cx + glowR * Math.cos(startA);
        var dotY = cy + glowR * Math.sin(startA);
        var dotGr = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 6 + beat*3);
        dotGr.addColorStop(0, rgba(vc, da * 0.95));
        dotGr.addColorStop(1, rgba(vc, 0));
        ctx.save(); ctx.fillStyle = dotGr;
        ctx.beginPath(); ctx.arc(dotX, dotY, 6 + beat*3, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }

      // ── beat 全圆脉冲 ──────────────────────────────
      if (beat > 0.42) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, glowR + beat*2, 0, Math.PI*2);
        ctx.strokeStyle = rgba(vc, beat * 0.60);
        ctx.lineWidth = 1.5 + beat*2; ctx.stroke(); ctx.restore();
      }
    }

    return { init: init, draw: draw };
  }

  /* ═══════════════════════════════════════════════════
   *  3. BgAura — 背景径向色彩场
   * ═══════════════════════════════════════════════════ */
  var BgAura = (function () {
    var el = null, auraRadius = 0.35, auraOpacity = 0;

    function init() {
      el = document.createElement('div');
      el.id = 'bg-aura';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0;will-change:opacity,background';
      if (document.body.firstChild) document.body.insertBefore(el, document.body.firstChild);
      else document.body.appendChild(el);
    }

    function draw(dt) {
      if (!el) { init(); return; }
      var vc = getVibeColor(), beat = getBeat(), rms = getRms();
      auraRadius  = lerp(auraRadius,  0.30+rms*0.20+beat*0.15, 1-Math.exp(-dt/(beat>0.5?0.06:0.45)));
      auraOpacity = lerp(auraOpacity, 0.055+rms*0.045+beat*0.055, 1-Math.exp(-dt/(beat>0.5?0.05:0.50)));
      auraOpacity = clamp(auraOpacity, 0, 0.18);
      var r1 = Math.round(auraRadius*100), r2 = Math.round(auraRadius*200);
      el.style.background = 'radial-gradient(ellipse '+r1+'% '+r2+'% at 50% 46%,'
        +rgba(vc,0.55)+' 0%,'+rgba(vc,0.18)+' 40%,transparent 75%)';
      el.style.opacity = auraOpacity.toFixed(3);
    }

    return { init: init, draw: draw };
  })();

  /* ═══════════════════════════════════════════════════
   *  进度获取辅助函数
   * ═══════════════════════════════════════════════════ */
  function getBottomBarProgress() {
    var aud = g.audio;
    if (aud && isFinite(aud.duration) && aud.duration > 0)
      return aud.currentTime / aud.duration;
    return 0;
  }

  function getHomeBarProgress() {
    // 从 home-np-bar-fill 的 width 样式读（避免重复维护 getPlaybackCurrentSeconds）
    var fill = document.getElementById('home-np-bar-fill');
    if (!fill) return getBottomBarProgress();
    var w = parseFloat(fill.style.width) || 0;
    return w / 100;
  }

  /* ═══════════════════════════════════════════════════
   *  实例化
   * ═══════════════════════════════════════════════════ */
  // 波形进度条
  var waveBottom = makeWaveformInstance('progress-bar',       'waveform-canvas',      getBottomBarProgress, 16);
  var waveHome   = makeWaveformInstance('home-np-bar-track',  'home-waveform-canvas', getHomeBarProgress,    9);

  // 封面流光
  var glowRect   = { init: function(){}, draw: function(){} }; // makeRectGlow 已禁用
  var glowDisc   = makeDiscGlow('home-np-disc-wrap', 'home-np-disc', 'home-disc-glow-canvas');

  /* ═══════════════════════════════════════════════════
   *  主循环
   * ═══════════════════════════════════════════════════ */
  var _lastTime = 0;

  function tick(now) {
    var dt = Math.max(0.001, Math.min(0.08, (now - _lastTime) / 1000));
    _lastTime = now;

    updateFFT(dt);           // 共享 FFT，只读一次

    waveBottom.draw(dt);
    waveHome.draw(dt);
    // glowRect.draw(dt);  // 已移除控制栏封面外圈流光
    glowDisc.draw(dt);
    BgAura.draw(dt);

    requestAnimationFrame(tick);
  }

  function start() {
    waveBottom.init();
    waveHome.init();
    // glowRect.init();  // 已移除控制栏封面外圈流光
    glowDisc.init();
    BgAura.init();
    _lastTime = performance.now();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    setTimeout(start, 0);
  }

  g.VisualEnhancements = { waveBottom: waveBottom, waveHome: waveHome,
                            glowRect: glowRect, glowDisc: glowDisc, BgAura: BgAura };

})(window);
