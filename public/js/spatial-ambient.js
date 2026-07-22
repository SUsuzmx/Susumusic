/**
 * spatial-ambient.js — 空间环境光  v1.0
 *
 * 根据专辑封面实时提取主色/次色/高光色，通过 Canvas 在 Three.js 层之上
 * 绘制多层柔性光晕，配合音乐节拍呼吸、脉冲、色散，营造沉浸式空间环境光。
 *
 * 技术方案：
 *   - position:fixed canvas, z-index:2, mix-blend-mode:screen
 *   - 3 层渐变（内层 / 中层 / 室内环境）× 每层 4 边线性 + 4 角径向 = 立体感
 *   - 呼吸由 window.uniforms.uBreath 驱动，与粒子完全同步
 *   - 颜色过渡 900ms smoothstep cross-fade
 *   - chorus/drop 触发 RGB 色散（极光色边）
 *
 * 依赖：
 *   window.AudioReactive  (audio-reactive.js)
 *   window.ParticleBehavior (particle-behavior.js)
 *   window.uniforms       (app.js)
 *
 * 调用：
 *   SpatialAmbient.init()              — 启动（app.js 初始化后）
 *   SpatialAmbient.onCoverCanvas(cv)   — 封面 canvas 变更时（app.js applyCoverCanvas）
 *   SpatialAmbient.setEnabled(bool)    — 开关
 */
(function (g) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
   *  配置
   * ════════════════════════════════════════════════════════════ */
  var CFG = {
    transMs:    900,    // 颜色交叉淡入时间（ms）
    flowSpeed:  0.20,   // 流动速度（rad/s 等效）
    breathBase: 0.86,   // 基础呼吸系数（最暗时）
    breathRange:0.16,   // 呼吸幅度
    layers: [
      { spread: 0.10, alpha: 0.46 },   // L1 内层：细腻，最亮
      { spread: 0.17, alpha: 0.18 },   // L2 中层：向外扩散
      { spread: 0.26, alpha: 0.07 },   // L3 室内：最淡，最宽
    ],
  };

  /* ══════════════════════════════════════════════════════════════
   *  状态
   * ════════════════════════════════════════════════════════════ */
  var canvas, ctx;
  var W = 0, H = 0;
  var enabled = true;

  /** 当前颜色 A（起点）和 B（目标），格式 [r,g,b] */
  var colA = [[80,120,190],[60,90,170],[100,140,210]];
  var colB = [[80,120,190],[60,90,170],[100,140,210]];
  var transStart = -1;

  /** 平滑音频信号 */
  var kickPulse  = 0;
  var bassPulse  = 0;
  var chorusLv   = 0;
  var dropBurst  = 0;
  var chromaAmt  = 0;

  var flowT = 0;
  var lastFrame = 0;

  /** 外部可调参数（乘数，默认=1） */
  var saAlpha  = 0.05;  // 整体亮度倍率
  var saSpread = 1.0;   // 扩散范围倍率
  var saFlow   = 1.0;   // 流动速度倍率
  var saChroma = 1.0;   // 色散强度倍率

  /* ══════════════════════════════════════════════════════════════
   *  工具
   * ════════════════════════════════════════════════════════════ */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

  function lerpRgb(a, b, t) {
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
    ];
  }

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp01(a).toFixed(3) + ')';
  }

  /* ══════════════════════════════════════════════════════════════
   *  封面颜色提取（12 色相桶 → 前3主色 + 饱和度增强）
   * ════════════════════════════════════════════════════════════ */
  function extractColors(cv) {
    if (!cv || !cv.width || !cv.height) return null;
    try {
      var data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      var NUM_BUCKETS = 12;
      var buckets = [];
      for (var b = 0; b < NUM_BUCKETS; b++) buckets.push({ r:0, g:0, b:0, w:0 });

      /* 每隔 step 像素采样一次，避免大图慢 */
      var pixels = cv.width * cv.height;
      var stride = Math.max(1, Math.floor(pixels / 500)) * 4;

      for (var i = 0; i < data.length; i += stride) {
        var r = data[i], g = data[i+1], b2 = data[i+2], a = data[i+3];
        if (a < 100) continue;

        var mx = Math.max(r, g, b2), mn = Math.min(r, g, b2), d = mx - mn;
        if (d < 22) continue;  // 灰色跳过

        var lum = (r * 299 + g * 587 + b2 * 114) / 255000;
        if (lum < 0.07 || lum > 0.93) continue;  // 极暗/极亮跳过

        /* 计算色相 (0-6) */
        var hue = 0;
        if (mx === r)       hue = ((g - b2) / d + 6) % 6;
        else if (mx === g)  hue = (b2 - r)  / d + 2;
        else                hue = (r - g)   / d + 4;

        var bi  = Math.floor(hue / 6 * NUM_BUCKETS) % NUM_BUCKETS;
        var wt  = (d / 255) * (0.5 + lum * 0.5);   // 饱和度 × 亮度权重
        buckets[bi].r += r * wt;
        buckets[bi].g += g * wt;
        buckets[bi].b += b2 * wt;
        buckets[bi].w += wt;
      }

      /* 按权重排序，取前3 */
      buckets.sort(function(a, x) { return x.w - a.w; });
      var res = [];
      for (var j = 0; j < buckets.length && res.length < 3; j++) {
        if (buckets[j].w < 0.4) continue;
        var rc = Math.round(buckets[j].r / buckets[j].w);
        var gc = Math.round(buckets[j].g / buckets[j].w);
        var bc = Math.round(buckets[j].b / buckets[j].w);
        /* 饱和度 Boost：向色相方向推离灰轴 */
        var avg = (rc + gc + bc) / 3, boost = 1.45;
        rc = Math.max(0, Math.min(255, Math.round(avg + (rc - avg) * boost)));
        gc = Math.max(0, Math.min(255, Math.round(avg + (gc - avg) * boost)));
        bc = Math.max(0, Math.min(255, Math.round(avg + (bc - avg) * boost)));
        res.push([rc, gc, bc]);
      }
      while (res.length < 3) res.push(res[0] || [80, 120, 190]);
      return res;
    } catch (e) { return null; }
  }

  /* ══════════════════════════════════════════════════════════════
   *  Canvas 初始化 & resize
   * ════════════════════════════════════════════════════════════ */
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'spatial-ambient-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = [
      'position:fixed', 'inset:0', 'width:100%', 'height:100%',
      'pointer-events:none',
      'z-index:1',
    ].join(';');

    /* 插到 #canvas-container 之后，保证在 Three.js canvas 上方 */
    var cc = document.getElementById('canvas-container');
    if (cc && cc.parentNode) {
      cc.parentNode.insertBefore(canvas, cc.nextSibling);
    } else {
      document.body.appendChild(canvas);
    }

    ctx = canvas.getContext('2d');
    doResize();
    window.addEventListener('resize', doResize);
  }

  function doResize() {
    if (!canvas) return;
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  /* ══════════════════════════════════════════════════════════════
   *  绘制：单层边缘光晕（4边线性 + 4角径向）
   *
   *  spread  ：向屏幕内扩散的比例（相对于宽/高）
   *  alpha   ：最大不透明度
   *  fi      ：流动相位偏移（使各层流动不同步）
   * ════════════════════════════════════════════════════════════ */
  function drawEdge(color, spread, alpha, fi) {
    var sw = W * spread;
    var sh = H * spread;
    var fo = fi || 0;

    /* 流动偏移：极光效果，各边/角缓慢漂移 */
    var ox = Math.sin(flowT * 0.22 + fo)        * W * 0.042;
    var oy = Math.cos(flowT * 0.18 + fo + 1.1)  * H * 0.036;

    /* ── 4 边线性渐变 ──────────────────────────────────────── */
    var stops = [
      [0, alpha],
      [0.30, alpha * 0.58],
      [0.62, alpha * 0.18],
      [1,    0],
    ];

    function applyStops(grd) {
      stops.forEach(function(s) { grd.addColorStop(s[0], rgba(color, s[1])); });
    }

    // Top
    var g1 = ctx.createLinearGradient(0, 0, 0, sh);
    applyStops(g1);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, sh);

    // Bottom
    var g2 = ctx.createLinearGradient(0, H, 0, H - sh);
    applyStops(g2);
    ctx.fillStyle = g2;
    ctx.fillRect(0, H - sh, W, sh);

    // Left
    var g3 = ctx.createLinearGradient(0, 0, sw, 0);
    applyStops(g3);
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, sw, H);

    // Right
    var g4 = ctx.createLinearGradient(W, 0, W - sw, 0);
    applyStops(g4);
    ctx.fillStyle = g4;
    ctx.fillRect(W - sw, 0, sw, H);

    /* ── 4 角径向渐变（强化角落感，增加立体） ─────────────── */
    var cr = Math.max(sw, sh) * 1.35;
    var corners = [
      [ox * 0.40,        oy * 0.40],
      [W + ox * 0.30,    oy * 0.45],
      [W + ox * 0.45,    H + oy * 0.30],
      [ox * 0.45,        H + oy * 0.38],
    ];
    for (var i = 0; i < corners.length; i++) {
      var cx = corners[i][0], cy = corners[i][1];
      var grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      grd.addColorStop(0,    rgba(color, alpha * 0.72));
      grd.addColorStop(0.35, rgba(color, alpha * 0.30));
      grd.addColorStop(0.72, rgba(color, alpha * 0.07));
      grd.addColorStop(1,    rgba(color, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  色散（高潮/Drop 时 RGB 通道轻微分离）
   * ════════════════════════════════════════════════════════════ */
  function drawChromatic(amt) {
    if (amt < 0.018) return;
    var s = 10 * amt;
    ctx.save();
    /* 红移：向外扩 */
    ctx.translate(s * 0.8, s * 0.6);
    drawEdge([255, 45, 75], 0.26, amt * 0.26, 10.5);
    /* 蓝移：向内缩 */
    ctx.translate(-s * 1.6, -s * 1.2);
    drawEdge([30, 90, 255], 0.24, amt * 0.26, 11.3);
    /* 青移：轻微垂直 */
    ctx.translate(s * 0.8, -s * 0.4);
    drawEdge([0, 210, 185], 0.20, amt * 0.16, 12.1);
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════
   *  主帧循环
   * ════════════════════════════════════════════════════════════ */
  function tick(now) {
    g.__spatialAmbientRaf = requestAnimationFrame(tick);
    if (!enabled || !ctx) return;

    /* 未播放 / 暂停时清空画布并退出 */
    var audioEl = g.audio;   /* app.js 全局 audio 对象 */
    var isPlaying = audioEl && !audioEl.paused && !audioEl.ended;
    if (!isPlaying) {
      ctx.clearRect(0, 0, W, H);
      /* 重置平滑信号，避免恢复播放时突变 */
      kickPulse = bassPulse = chorusLv = dropBurst = chromaAmt = 0;
      return;
    }

    var dt = Math.min(0.05, ((now - lastFrame) / 1000) || 0.016);
    lastFrame = now;

    /* 颜色过渡进度 */
    var tNorm = 1;
    if (transStart >= 0) {
      tNorm = smoothstep((now - transStart) / CFG.transMs);
      if (tNorm >= 1) transStart = -1;
    }
    var cols = [
      lerpRgb(colA[0], colB[0], tNorm),
      lerpRgb(colA[1], colB[1], tNorm),
      lerpRgb(colA[2], colB[2], tNorm),
    ];

    /* 读取音频/粒子状态 */
    var AR = g.AudioReactive;
    var PB = g.ParticleBehavior;
    var U  = g.uniforms;
    var rms = 0, kick = 0, bass = 0;
    var chorus = 0, dropV = 0, breathAmt = 0;
    var bPhase = U && U.uBreath ? U.uBreath.value
                 : (now * 0.00042 * Math.PI * 2);   // fallback
    if (AR && AR.state) {
      rms  = AR.state.rms  || 0;
      kick = AR.state.kick || 0;
      bass = AR.state.bass || 0;
    }
    if (PB && PB.state) {
      chorus    = PB.state.chorus   || 0;
      breathAmt = PB.state.breathAmt|| 0;
    }
    if (U && U.uDropBurst) dropV = U.uDropBurst.value || 0;

    /* 平滑信号 */
    var dk = Math.min(1, dt * 24);
    var db = Math.min(1, dt * 9);
    var dc = Math.min(1, dt * 5);
    kickPulse  += (Math.max(kick - 0.28, 0) / 0.72 - kickPulse)  * dk;
    bassPulse  += (Math.max(bass - 0.12, 0) / 0.88 - bassPulse)  * db;
    chorusLv   += (chorus  - chorusLv)  * dc;
    dropBurst  += (Math.max(dropV, 0)   - dropBurst) * Math.min(1, dt * 15);
    chromaAmt  += ((chorusLv * 0.52 + dropBurst * 0.88) - chromaAmt) * Math.min(1, dt * 7);
    chromaAmt   = clamp01(chromaAmt);

    /* 呼吸调制 */
    var breathVal = Math.sin(bPhase) * 0.5 + 0.5;          // 0..1
    var breathMod = CFG.breathBase + breathVal * (CFG.breathRange + breathAmt * 0.30);

    /* 能量调制 */
    var energyMod = 1.0
      + rms      * 0.20
      + kickPulse* 0.22
      + bassPulse* 0.12
      + chorusLv * 0.26
      + dropBurst* 0.42;

    flowT += dt * CFG.flowSpeed * saFlow;

    ctx.clearRect(0, 0, W, H);

    var M = breathMod * energyMod * saAlpha;
    var L = CFG.layers;
    var ss = saSpread;   // 扩散范围乘数

    /* Layer 3 — 室内环境光（最外，极淡，构成 Room Ambient） */
    drawEdge(cols[2], L[2].spread * ss,        L[2].alpha * M * 0.82, 3.8);
    drawEdge(cols[1], L[2].spread * ss * 0.84, L[2].alpha * M * 0.44, 5.2);

    /* Layer 2 — 中层扩散（半透明，范围更大） */
    drawEdge(cols[0], L[1].spread * ss,        L[1].alpha * M,         0.0);
    drawEdge(cols[2], L[1].spread * ss * 0.80, L[1].alpha * M * 0.54,  2.0);

    /* Layer 1 — 内层贴近屏幕（最亮，最细腻） */
    drawEdge(cols[1], L[0].spread * ss,        L[0].alpha * M * 1.12,  0.9);
    drawEdge(cols[0], L[0].spread * ss * 0.62, L[0].alpha * M * 0.70, -0.5);

    /* 色散层 */
    drawChromatic(chromaAmt * 0.58 * saChroma);
  }

  /* ══════════════════════════════════════════════════════════════
   *  公开 API
   * ════════════════════════════════════════════════════════════ */
  function onCoverCanvas(cv) {
    var nc = extractColors(cv);
    if (!nc) return;
    /* 将 A 快照到当前混合值，再开启新过渡 */
    var now = performance.now();
    var t = transStart >= 0 ? smoothstep((now - transStart) / CFG.transMs) : 1;
    colA = [lerpRgb(colA[0],colB[0],t), lerpRgb(colA[1],colB[1],t), lerpRgb(colA[2],colB[2],t)];
    colB = nc;
    transStart = performance.now();
  }

  g.SpatialAmbient = {
    init: function () {
      ensureCanvas();
      lastFrame = performance.now();
      requestAnimationFrame(tick);
    },
    onCoverCanvas: onCoverCanvas,
    setEnabled: function (on) {
      enabled = !!on;
      if (!enabled && ctx) ctx.clearRect(0, 0, W, H);
    },
    setParams: function (p) {
      if (p == null) return;
      if (p.alpha   != null) saAlpha  = Math.max(0, p.alpha);
      if (p.spread  != null) saSpread = Math.max(0.1, p.spread);
      if (p.flow    != null) saFlow   = Math.max(0, p.flow);
      if (p.chroma  != null) saChroma = Math.max(0, p.chroma);
      if (p.enabled != null) {
        enabled = !!p.enabled;
        if (!enabled && ctx) ctx.clearRect(0, 0, W, H);
      }
    },
  };

})(window);
