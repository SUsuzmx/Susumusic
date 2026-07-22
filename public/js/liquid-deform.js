/**
 * liquid-deform.js — Liquid UI Deformation  v1.1
 *
 * 整个播放器界面由音乐能量驱动发生真实物理形变：
 *   - Spring 物理引擎（弹性 / 惯性 / 阻尼 / 二次运动）
 *   - SVG feDisplacementMap 液态置换 → #canvas-container（粒子+歌词层）
 *   - SVG feDisplacementMap 背景折射 → #album-bg / #custom-bg
 *   - Shockwave / Ripple / Snare canvas 冲击波 & 涟漪 & 打击感绘制
 *   - #thumb-wrap Squash & Stretch 果冻物理
 *   - #bottom-bar / controls 弹跳；.ctrl-btn 独立按钮果冻
 *   - Camera Impact：整个渲染层透视推拉 + 旋转
 *   - Chromatic Aberration：封面色散
 *   - Gravity Core：高潮聚拢 → 爆发（驱动 uDropGather / uDropBurst）
 *   - Energy Field Push：UI 元素随能量向外推移
 *   - Shockwave Passthrough：冲击波扫过元素时短暂形变
 *   - Lyric Elastic：歌词层弹性缩放（stageLyrics._liquidScale）
 *   - Snare Ripple：flux 打击感集中涟漪
 *
 * 依赖：
 *   window.AudioReactive  (audio-reactive.js)
 *   window.ParticleBehavior (particle-behavior.js)
 *   window.uniforms       (app.js)
 *   window.audio          (app.js 全局 audio 对象)
 *   window.stageLyrics    (app.js)
 *
 * 调用：
 *   LiquidDeform.init()
 *   LiquidDeform.setEnabled(bool)
 *   LiquidDeform.setParams({ intensity, distort, jelly, chroma, shockwave })
 */
(function (g) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
   *  Spring 物理引擎
   *  stiffness(k) / damping(c) / mass(m) — 模拟弹性材质
   * ════════════════════════════════════════════════════════════ */
  function Spring(opts) {
    this.value    = opts.value    != null ? opts.value    : 0;
    this.target   = opts.target   != null ? opts.target   : (opts.value || 0);
    this.velocity = 0;
    this.k = opts.stiffness || 160;
    this.c = opts.damping   || 18;
    this.m = opts.mass      || 1;
  }
  Spring.prototype.update = function (dt) {
    var f  = -this.k * (this.value - this.target);
    var fd = -this.c * this.velocity;
    this.velocity += (f + fd) / this.m * dt;
    this.value    += this.velocity * dt;
    return this.value;
  };
  Spring.prototype.impulse = function (v) { this.velocity += v; };
  Spring.prototype.reset   = function (v) {
    this.value = v != null ? v : this.target;
    this.velocity = 0;
  };

  /* ══════════════════════════════════════════════════════════════
   *  参数 / 状态
   * ════════════════════════════════════════════════════════════ */
  var PARAMS = {
    intensity:  1.0,   // 总强度倍率
    distort:    1.0,   // SVG 置换幅度倍率
    jelly:      1.0,   // Squash & Stretch 幅度倍率
    chroma:     1.0,   // 色散幅度倍率
    shockwave:  1.0,   // 冲击波不透明度倍率
  };

  var enabled  = true;
  var lastTs   = 0;
  var flowT    = 0;
  var SW = 0, SH = 0;

  /* ── 平滑音频信号 ───────────────────────────────────────── */
  var smKick = 0, smBass = 0, smHihat = 0, smRms = 0;
  var smChorus = 0, smDrop = 0;
  var prevDrop = 0;
  var dropBurstLife = 0;   // Drop 爆发倒计时（秒）

  /* ── Snare / Flux ────────────────────────────────────────── */
  var smFlux  = 0;
  var prevFlux = 0;

  /* ── 重力核心状态（高潮聚拢 → 爆发） ────────────────────── */
  var gravState = 'idle';   // 'idle' | 'gather' | 'burst'
  var gravLife  = 0;
  var gravPhase = 0;        // 0-1 相位

  /* ── 活跃粒子效果列表 ────────────────────────────────────── */
  var shockwaves   = [];   // { cx,cy,r,maxR,strength,life }
  var ripples      = [];   // { r,maxR,strength,life }
  var snareRipples = [];   // { cx,cy,r,maxR,strength,life }  ← 打击感集中涟漪

  /* ── Shockwave 元素穿透计时 ──────────────────────────────── */
  var shockHitTimers = {};  // elementId → 剩余时间(秒)

  /* ── Springs ─────────────────────────────────────────────── */
  var SP = {
    /* 镜头 */
    camZ:    new Spring({ value:0, stiffness:110, damping:13, mass:1.1 }),
    camRX:   new Spring({ value:0, stiffness:95,  damping:11, mass:1.2 }),
    camRY:   new Spring({ value:0, stiffness:95,  damping:11, mass:1.2 }),
    camScale:new Spring({ value:1, target:1, stiffness:130, damping:15, mass:1.0 }),
    /* 封面 */
    cvSX:    new Spring({ value:1, target:1, stiffness:220, damping:20, mass:0.7 }),
    cvSY:    new Spring({ value:1, target:1, stiffness:220, damping:20, mass:0.7 }),
    cvZ:     new Spring({ value:0, stiffness:150, damping:16, mass:0.9 }),
    /* 控制栏 */
    btY:     new Spring({ value:0, stiffness:200, damping:18, mass:0.8 }),
    /* SVG 置换 */
    distAmt: new Spring({ value:0, stiffness:70,  damping:9,  mass:1.5 }),
    /* 色散 */
    chromaV: new Spring({ value:0, stiffness:55,  damping:7,  mass:1.8 }),
    /* 引力核心缩放 */
    gravPull:new Spring({ value:0, stiffness:45,  damping:6,  mass:2.5 }),
  };

  /* ── 扩展弹簧（不修改上方 SP 字面量） ──────────────────── */
  SP.lyricS  = new Spring({ value:1, target:1, stiffness:180, damping:20, mass:0.9 }); // 歌词弹性
  SP.btnSX   = new Spring({ value:1, target:1, stiffness:300, damping:24, mass:0.55 }); // 按钮横向
  SP.btnSY   = new Spring({ value:1, target:1, stiffness:300, damping:24, mass:0.55 }); // 按钮纵向
  SP.bgDist  = new Spring({ value:0, stiffness:55,  damping:8,  mass:2.0 }); // 背景折射
  SP.elemPush= new Spring({ value:0, stiffness:120, damping:14, mass:1.0 }); // 元素推力

  /* ══════════════════════════════════════════════════════════════
   *  SVG 位移滤镜（作用于 #canvas-container）
   * ════════════════════════════════════════════════════════════ */
  var svgEl, turbEl, dispEl;
  var turbSeedT = 0, turbSeedInterval = 4.5;   // 定期变换 seed 让噪声流动

  function initSvgFilter () {
    if (document.getElementById('liquid-deform-svg')) return;
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.id = 'liquid-deform-svg';
    svgEl.setAttribute('aria-hidden', 'true');
    svgEl.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;z-index:0';

    var defs   = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id  = 'liquid-warp';
    filter.setAttribute('x', '-20%');
    filter.setAttribute('y', '-20%');
    filter.setAttribute('width',  '140%');
    filter.setAttribute('height', '140%');
    filter.setAttribute('color-interpolation-filters', 'linearRGB');

    turbEl = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
    turbEl.setAttribute('type', 'turbulence');
    turbEl.setAttribute('baseFrequency', '0.010 0.016');
    turbEl.setAttribute('numOctaves', '3');
    turbEl.setAttribute('seed', '5');
    turbEl.setAttribute('result', 'noise');

    dispEl = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    dispEl.setAttribute('in', 'SourceGraphic');
    dispEl.setAttribute('in2', 'noise');
    dispEl.setAttribute('scale', '0');
    dispEl.setAttribute('xChannelSelector', 'R');
    dispEl.setAttribute('yChannelSelector', 'G');

    filter.appendChild(turbEl);
    filter.appendChild(dispEl);
    defs.appendChild(filter);
    svgEl.appendChild(defs);
    document.body.appendChild(svgEl);
  }

  /* ══════════════════════════════════════════════════════════════
   *  背景折射 SVG 滤镜（作用于 #album-bg / #custom-bg）
   * ════════════════════════════════════════════════════════════ */
  var bgDispEl, bgTurbEl;
  var bgSeedT = 0;

  function initBgFilter () {
    if (document.getElementById('liquid-bg-svg')) return;
    var bsvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bsvg.id = 'liquid-bg-svg';
    bsvg.setAttribute('aria-hidden', 'true');
    bsvg.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;z-index:0';

    var defs   = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id  = 'liquid-bg-warp';
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width',  '120%');
    filter.setAttribute('height', '120%');
    filter.setAttribute('color-interpolation-filters', 'linearRGB');

    bgTurbEl = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
    bgTurbEl.setAttribute('type', 'turbulence');
    bgTurbEl.setAttribute('baseFrequency', '0.006 0.009');
    bgTurbEl.setAttribute('numOctaves', '2');
    bgTurbEl.setAttribute('seed', '12');
    bgTurbEl.setAttribute('result', 'bnoise');

    bgDispEl = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    bgDispEl.setAttribute('in', 'SourceGraphic');
    bgDispEl.setAttribute('in2', 'bnoise');
    bgDispEl.setAttribute('scale', '0');
    bgDispEl.setAttribute('xChannelSelector', 'R');
    bgDispEl.setAttribute('yChannelSelector', 'G');

    filter.appendChild(bgTurbEl);
    filter.appendChild(bgDispEl);
    defs.appendChild(filter);
    bsvg.appendChild(defs);
    document.body.appendChild(bsvg);
  }

  /* ══════════════════════════════════════════════════════════════
   *  Shockwave & Ripple Canvas
   * ════════════════════════════════════════════════════════════ */
  var shockCanvas, shockCtx;

  function initShockCanvas () {
    if (document.getElementById('liquid-shock-canvas')) return;
    shockCanvas = document.createElement('canvas');
    shockCanvas.id = 'liquid-shock-canvas';
    shockCanvas.setAttribute('aria-hidden', 'true');
    shockCanvas.style.cssText = [
      'position:fixed','inset:0','width:100%','height:100%',
      'pointer-events:none','z-index:3',
    ].join(';');
    document.body.appendChild(shockCanvas);
    shockCtx = shockCanvas.getContext('2d');
    doResize();
    window.addEventListener('resize', doResize);
  }

  function doResize () {
    if (!shockCanvas) return;
    SW = shockCanvas.width  = window.innerWidth;
    SH = shockCanvas.height = window.innerHeight;
  }

  /* ══════════════════════════════════════════════════════════════
   *  帧循环
   * ════════════════════════════════════════════════════════════ */
  function tick (now) {
    g.__liquidDeformRaf = requestAnimationFrame(tick);

    var dt = Math.min(0.05, ((now - lastTs) / 1000) || 0.016);
    lastTs = now;

    if (!enabled) {
      clearVisuals();
      return;
    }

    /* ── 暂停时清空效果，恢复播放后自动重启 ──────────────── */
    if (g.audio && (g.audio.paused || g.audio.ended)) {
      clearVisuals();
      smKick = smBass = smHihat = smRms = smChorus = smDrop = smFlux = 0;
      prevDrop = prevFlux = 0;
      dropBurstLife = 0;
      gravState = 'idle';
      return;
    }

    /* ── 读取音频状态 ──────────────────────────────────────── */
    var AR = g.AudioReactive;
    var PB = g.ParticleBehavior;
    var U  = g.uniforms;
    var kick  = 0, bass  = 0, hihat = 0, rms = 0;
    var chorus = 0, dropV = 0, flux = 0;

    if (AR && AR.state) {
      kick  = AR.state.kick  || 0;
      bass  = AR.state.bass  || 0;
      hihat = AR.state.hihat || 0;
      rms   = AR.state.rms   || 0;
      flux  = AR.state.flux  || 0;
    }
    if (PB && PB.state) {
      chorus = PB.state.chorus || 0;
    }
    if (U && U.uDropBurst) dropV = U.uDropBurst.value || 0;

    /* ── 平滑信号 ──────────────────────────────────────────── */
    smKick   += (kick   - smKick)   * Math.min(1, dt * 22);
    smBass   += (bass   - smBass)   * Math.min(1, dt * 10);
    smHihat  += (hihat  - smHihat)  * Math.min(1, dt * 28);
    smRms    += (rms    - smRms)    * Math.min(1, dt * 8);
    smChorus += (chorus - smChorus) * Math.min(1, dt * 5);
    smDrop   += (dropV  - smDrop)   * Math.min(1, dt * 20);
    smFlux   += (flux   - smFlux)   * Math.min(1, dt * 30);

    var M = PARAMS.intensity;   // 总强度

    /* ── Kick 冲击 ─────────────────────────────────────────── */
    var kickImp = Math.max(0, kick - 0.30) / 0.70;
    if (kickImp > 0.04) {
      var ki = kickImp * M;
      SP.camZ.impulse(-ki * 22 * PARAMS.distort);       // 镜头向前冲
      SP.cvSX.impulse(-ki * 0.18 * PARAMS.jelly);       // 封面横向压缩
      SP.cvSY.impulse( ki * 0.22 * PARAMS.jelly);       // 封面纵向拉伸
      SP.btY.impulse(  ki * 3.5  * PARAMS.jelly);       // 控制栏轻弹
      SP.distAmt.impulse(ki * 4  * PARAMS.distort);     // 液态扰动
    }

    /* ── Kick → 按钮果冻 & 歌词弹性 ──────────────────────── */
    if (kickImp > 0.04) {
      var ki2 = kickImp * M;
      SP.btnSX.impulse(-ki2 * 0.14 * PARAMS.jelly);
      SP.btnSY.impulse( ki2 * 0.18 * PARAMS.jelly);
      SP.lyricS.impulse(ki2 * 0.10 * PARAMS.jelly);
    }

    /* ── Bass 下沉 + 涟漪 ─────────────────────────────────── */
    var bassImp = Math.max(0, bass - 0.18) / 0.82;
    if (bassImp > 0.04) {
      var bi = bassImp * M;
      SP.camZ.impulse(   bi * 10 * PARAMS.distort);     // 镜头后退
      SP.camRX.impulse(  bi * 1.2 * PARAMS.distort);    // 轻微前倾
      SP.distAmt.impulse(bi * 5  * PARAMS.distort);
      if (ripples.length < 5) {
        ripples.push({
          r: 0,
          maxR: Math.min(SW, SH) * (0.4 + bi * 0.3),
          strength: bi,
          life: 1.0,
        });
      }
    }

    /* ── HiHat 细小震动 ────────────────────────────────────── */
    if (smHihat > 0.25) {
      SP.distAmt.impulse(smHihat * 0.6 * M * PARAMS.distort);
    }

    /* ── Snare / Flux 打击感 → 集中涟漪 ───────────────────── */
    var fluxSpike = smFlux > 0.20 && (smFlux - prevFlux) > 0.04;
    if (fluxSpike && M > 0.05) {
      var fi = Math.min(1, smFlux) * M;
      /* 随机散布在屏幕中部区域，营造打击质感 */
      if (snareRipples.length < 8) {
        snareRipples.push({
          cx: SW * (0.28 + Math.random() * 0.44),
          cy: SH * (0.38 + Math.random() * 0.28),
          r: 0,
          maxR: Math.min(SW, SH) * (0.06 + fi * 0.10),
          strength: fi * 0.7,
          life: 1.0,
        });
      }
      SP.distAmt.impulse(fi * 1.8 * PARAMS.distort);
    }
    prevFlux = smFlux;

    /* ── Drop 检测（上升沿）→ Shockwave + 引力核心 ─────────── */
    var dropRise = smDrop > 0.25 && prevDrop < 0.15;
    prevDrop = smDrop;
    if (dropRise && M > 0.05) {
      /* 从封面中心发射冲击波 */
      var cx = SW * 0.5, cy = SH * 0.5;
      var coverEl = document.getElementById('thumb-wrap');
      if (coverEl) {
        var r = coverEl.getBoundingClientRect();
        cx = r.left + r.width  * 0.5;
        cy = r.top  + r.height * 0.5;
      }
      shockwaves.push({ cx: cx, cy: cy, r: 0,
        maxR: Math.sqrt(SW*SW+SH*SH) * 0.72,
        strength: 1.0 * PARAMS.shockwave, life: 1.0 });

      /* 二次冲击波（稍晚，更宽，更淡） */
      shockwaves.push({ cx: cx, cy: cy, r: 30,
        maxR: Math.sqrt(SW*SW+SH*SH) * 0.88,
        strength: 0.55 * PARAMS.shockwave, life: 0.85, delay: 0.08 });

      /* 大型冲击 */
      SP.camZ.impulse(-28 * M * PARAMS.distort);
      SP.camScale.impulse(-0.04 * M);
      SP.distAmt.impulse(22 * M * PARAMS.distort);
      SP.chromaV.impulse(1.8 * M * PARAMS.chroma);
      SP.gravPull.impulse(2.0 * M);
      SP.bgDist.impulse(18 * M * PARAMS.distort);
      SP.lyricS.impulse(-0.22 * M * PARAMS.jelly);  // 歌词先压缩再弹出
      dropBurstLife = 1.2;
      gravState = 'burst';
      gravLife  = 0.9;

      /* 记录冲击波穿透目标元素的时机 */
      _scheduleShockHits(cx, cy, Math.sqrt(SW*SW+SH*SH) * 0.72);
    }

    /* ── Drop 持续期 ───────────────────────────────────────── */
    if (dropBurstLife > 0) dropBurstLife = Math.max(0, dropBurstLife - dt);

    /* ── 引力核心（Chorus 聚拢） ───────────────────────────── */
    if (smChorus > 0.45 && gravState === 'idle') {
      gravState = 'gather';
      gravLife  = 1.6;
    }
    if (gravState !== 'idle') {
      gravLife -= dt;
      if (gravLife <= 0) {
        gravState = 'idle';
        SP.gravPull.reset(0);
      }
    }
    var gravTarget = gravState === 'gather' ? smChorus * 0.35 * M
                   : gravState === 'burst'  ? -0.12 * M
                   : 0;
    SP.gravPull.target = gravTarget;

    /* ── Spring 目标值（静息态） ───────────────────────────── */
    SP.camZ.target     =  smRms * -3 * M;
    SP.camRX.target    = 0;
    SP.camRY.target    = Math.sin(flowT * 0.08) * smChorus * 0.6 * M;
    SP.camScale.target = 1 + smChorus * 0.012 * M + smRms * 0.008 * M;
    SP.cvSX.target     = 1;
    SP.cvSY.target     = 1;
    SP.cvZ.target      = smBass * -8 * M * PARAMS.jelly;
    SP.btY.target      = 0;
    SP.distAmt.target  = (smChorus * 8 + dropBurstLife * 14 + smRms * 3) * M * PARAMS.distort;
    SP.chromaV.target  = (smChorus * 0.5 + smDrop * 0.7) * M * PARAMS.chroma;

    /* ── 扩展弹簧目标值 ────────────────────────────────────── */
    SP.lyricS.target  = 1 + smChorus * 0.045 * M + smRms * 0.02 * M;
    SP.btnSX.target   = 1;
    SP.btnSY.target   = 1;
    SP.bgDist.target  = (smChorus * 5 + dropBurstLife * 9 + smRms * 1.5) * M * PARAMS.distort;
    SP.elemPush.target= (smChorus * 0.65 + dropBurstLife * 1.1 + smDrop * 0.45) * M;

    flowT += dt;
    turbSeedT += dt;
    bgSeedT   += dt;

    /* ── 更新所有 Springs ─────────────────────────────────── */
    var keys = Object.keys(SP);
    for (var i = 0; i < keys.length; i++) SP[keys[i]].update(dt);

    /* ── 更新涟漪 / 冲击波 / 打击感涟漪 ──────────────────── */
    for (var j = ripples.length - 1; j >= 0; j--) {
      var rp = ripples[j];
      rp.r += dt * rp.maxR * 2.0;
      rp.life -= dt * 1.5;
      if (rp.life <= 0) ripples.splice(j, 1);
    }
    for (var k = shockwaves.length - 1; k >= 0; k--) {
      var sw = shockwaves[k];
      if (sw.delay && sw.delay > 0) { sw.delay -= dt; continue; }
      sw.r    += dt * sw.maxR * 1.55;
      sw.life -= dt * 1.0;
      if (sw.life <= 0 || sw.r > sw.maxR * 1.1) shockwaves.splice(k, 1);
    }
    for (var s = snareRipples.length - 1; s >= 0; s--) {
      var sr = snareRipples[s];
      sr.r += dt * sr.maxR * 3.5;
      sr.life -= dt * 2.2;
      if (sr.life <= 0) snareRipples.splice(s, 1);
    }

    /* ── 元素穿透计时递减 ─────────────────────────────────── */
    var hitIds = Object.keys(shockHitTimers);
    for (var h = 0; h < hitIds.length; h++) {
      shockHitTimers[hitIds[h]] -= dt;
      if (shockHitTimers[hitIds[h]] <= 0) delete shockHitTimers[hitIds[h]];
    }

    /* ── 粒子 Uniform 增强（在 particle-behavior 基础上叠加） */
    if (g.uniforms) {
      if (g.uniforms.uDropGather && gravState === 'gather') {
        var pgBoost = SP.gravPull.value * 0.45 * M;
        if (pgBoost > 0.01) {
          g.uniforms.uDropGather.value = Math.min(1.0,
            g.uniforms.uDropGather.value + pgBoost * dt * 3);
        }
      }
      if (g.uniforms.uDropBurst && dropBurstLife > 0.1) {
        var pbBoost = dropBurstLife * 0.40 * M;
        g.uniforms.uDropBurst.value = Math.min(1.0,
          Math.max(g.uniforms.uDropBurst.value, pbBoost));
      }
    }

    /* ── 歌词弹性写回 stageLyrics ─────────────────────────── */
    if (g.stageLyrics) {
      g.stageLyrics._liquidScale = SP.lyricS.value;
    }

    applyEffects();
  }

  /* ══════════════════════════════════════════════════════════════
   *  冲击波元素穿透调度
   *  计算冲击波到达各 UI 元素中心的时间，提前注册 hit timer
   * ════════════════════════════════════════════════════════════ */
  var HIT_ELEMS = ['search-area', 'fx-panel', 'thumb-wrap', 'controls'];

  function _scheduleShockHits (ocx, ocy, maxR) {
    var speed = maxR * 1.55; // px/s，与 tick 里 sw.r += dt*maxR*1.55 保持一致
    for (var i = 0; i < HIT_ELEMS.length; i++) {
      var el = document.getElementById(HIT_ELEMS[i]);
      if (!el) continue;
      var rect = el.getBoundingClientRect();
      var ex = rect.left + rect.width  * 0.5;
      var ey = rect.top  + rect.height * 0.5;
      var dist = Math.sqrt((ex - ocx) * (ex - ocx) + (ey - ocy) * (ey - ocy));
      var arrivalT = dist / speed;           // 冲击波抵达时间（秒）
      if (arrivalT < 2.0) {
        /* 使用 setTimeout 在抵达时刻写入 hit timer */
        (function (id, dur) {
          setTimeout(function () {
            shockHitTimers[id] = dur;
          }, arrivalT * 1000);
        })(HIT_ELEMS[i], 0.22 + Math.random() * 0.10);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  应用效果到 DOM / Canvas
   * ════════════════════════════════════════════════════════════ */
  function applyEffects () {
    /* ── 1. #canvas-container：透视 + 3D 旋转 + SVG 置换 ─── */
    var cc = document.getElementById('canvas-container');
    if (cc) {
      var cz  = SP.camZ.value;
      var crx = SP.camRX.value;
      var cry = SP.camRY.value;
      var csc = SP.camScale.value;
      var gp  = SP.gravPull.value;   // 引力核心时缩放拉伸

      cc.style.transform =
        'perspective(1100px)' +
        ' translateZ(' + (cz * 0.55).toFixed(2) + 'px)' +
        ' rotateX(' + (crx * 0.35).toFixed(3) + 'deg)' +
        ' rotateY(' + (cry * 0.28).toFixed(3) + 'deg)' +
        ' scale(' + ((csc + gp * 0.06)).toFixed(4) + ')';

      /* SVG 置换滤镜幅度 */
      var dispScale = SP.distAmt.value;
      if (dispEl) {
        dispEl.setAttribute('scale', dispScale.toFixed(2));
        /* 动态流动 baseFrequency */
        var bf = 0.010 + Math.sin(flowT * 0.22) * 0.003 + smRms * 0.006;
        if (turbEl) turbEl.setAttribute('baseFrequency',
          bf.toFixed(4) + ' ' + (bf * 1.55).toFixed(4));
        /* 定期换 seed 让噪声流动，避免重复感 */
        if (turbSeedT > turbSeedInterval) {
          turbSeedT = 0;
          turbSeedInterval = 3.5 + Math.random() * 3;
          turbEl.setAttribute('seed', String(Math.floor(Math.random() * 99) + 1));
        }
      }

      /* 挂载/移除滤镜（scale 接近 0 时移除以节省 GPU） */
      var needFilter = dispScale > 0.25;
      var hasFilter  = cc.style.filter && cc.style.filter !== 'none';
      if (needFilter && !hasFilter) {
        cc.style.filter = 'url(#liquid-warp)';
      } else if (!needFilter && hasFilter) {
        cc.style.filter = 'none';
      }
    }

    /* ── 2. #thumb-wrap：Squash & Stretch + Chroma ───────── */
    var tw = document.getElementById('thumb-wrap');
    if (tw) {
      var sx = SP.cvSX.value;
      var sy = SP.cvSY.value;
      var tz = SP.cvZ.value;
      tw.style.transform =
        'perspective(600px)' +
        ' translateZ(' + tz.toFixed(2) + 'px)' +
        ' scaleX(' + sx.toFixed(4) + ')' +
        ' scaleY(' + sy.toFixed(4) + ')';

      /* 色散：给封面 img */
      var img = tw.querySelector('img, canvas, .cover-img');
      if (img) {
        var cv = SP.chromaV.value;
        if (cv > 0.015) {
          var cs = (cv * 5).toFixed(1);
          img.style.filter =
            'drop-shadow(' + cs + 'px 0 0 rgba(255,40,80,0.55))' +
            ' drop-shadow(-' + cs + 'px 0 0 rgba(0,180,255,0.55))';
        } else {
          img.style.filter = '';
        }
      }
    }

    /* ── 3. #controls（底栏内部）：果冻弹跳 ─────────────────
     *  注意：#bottom-bar 使用 translateX(-50%) 居中，不可整体覆盖。
     *  改对内部 #controls 施加 translateY，不影响外层定位。
     * ────────────────────────────────────────────────────── */
    var ctrlEl = document.getElementById('controls');
    if (ctrlEl) {
      var by = SP.btY.value;
      ctrlEl.style.transform = by > 0.05 || by < -0.05
        ? 'translateY(' + by.toFixed(2) + 'px)'
        : '';
    }

    /* ── 4. .ctrl-btn 按钮独立果冻 ────────────────────────── */
    var bsx = SP.btnSX.value;
    var bsy = SP.btnSY.value;
    var btnActive = Math.abs(bsx - 1) > 0.004 || Math.abs(bsy - 1) > 0.004;
    var btns = ctrlEl ? ctrlEl.querySelectorAll('.ctrl-btn') : [];
    for (var b = 0; b < btns.length; b++) {
      if (btnActive) {
        btns[b].style.transform =
          'scaleX(' + bsx.toFixed(4) + ') scaleY(' + bsy.toFixed(4) + ')';
      } else {
        btns[b].style.transform = '';
      }
    }


    /* ── 6. Energy Field Push：元素随能量向外推移 ─────────── */
    var pushVal = SP.elemPush.value;
    var PUSH_TARGETS = [
      { id: 'search-area', dx:  0, dy: -1 },
      { id: 'fx-panel',    dx:  1, dy:  0 },
    ];
    for (var p = 0; p < PUSH_TARGETS.length; p++) {
      var pt  = PUSH_TARGETS[p];
      var pel = document.getElementById(pt.id);
      if (!pel) continue;
      var px = (pushVal * pt.dx * 6).toFixed(2);
      var py = (pushVal * pt.dy * 6).toFixed(2);
      if (Math.abs(pushVal) > 0.02) {
        pel.style.transform = 'translate(' + px + 'px,' + py + 'px)';
      } else {
        pel.style.transform = '';
      }
    }

    /* ── 7. Shockwave 元素穿透形变 ────────────────────────── */
    var hitElIds = Object.keys(shockHitTimers);
    for (var hi = 0; hi < hitElIds.length; hi++) {
      var hid  = hitElIds[hi];
      var ht   = shockHitTimers[hid];
      var hel  = document.getElementById(hid);
      if (!hel || hid === 'controls') continue; // controls 已有 btY 处理
      var hp = Math.min(1, ht / 0.22);
      var hsx = 1 + hp * 0.06;
      var hsy = 1 - hp * 0.05;
      hel.style.transform = 'scaleX(' + hsx.toFixed(4) + ') scaleY(' + hsy.toFixed(4) + ')';
    }
    /* 穿透结束时复原 */
    for (var hr = 0; hr < PUSH_TARGETS.length; hr++) {
      var hrid = PUSH_TARGETS[hr].id;
      if (!shockHitTimers[hrid]) {
        /* 已由 push 处理或不需要额外清理（push 会覆盖） */
      }
    }
    /* thumb-wrap 穿透 */
    if (shockHitTimers['thumb-wrap']) {
      var thp = Math.min(1, shockHitTimers['thumb-wrap'] / 0.22);
      if (tw) {
        /* 在现有 squash&stretch 基础上额外叠加穿透脉冲 */
        var hitSX = SP.cvSX.value * (1 + thp * 0.08);
        var hitSY = SP.cvSY.value * (1 - thp * 0.07);
        tw.style.transform =
          'perspective(600px)' +
          ' translateZ(' + SP.cvZ.value.toFixed(2) + 'px)' +
          ' scaleX(' + hitSX.toFixed(4) + ')' +
          ' scaleY(' + hitSY.toFixed(4) + ')';
      }
    }

    /* ── 8. Shockwave & Ripple canvas ──────────────────────── */
    if (shockCtx) {
      shockCtx.clearRect(0, 0, SW, SH);

      /* 涟漪（Bass，从屏幕中心，椭圆水面感） */
      var rcx = SW * 0.5, rcy = SH * 0.52;
      for (var i = 0; i < ripples.length; i++) {
        var rp = ripples[i];
        var ra = rp.life * rp.strength * 0.28;
        if (ra < 0.005) continue;
        shockCtx.beginPath();
        shockCtx.ellipse(rcx, rcy, rp.r, rp.r * 0.42, 0, 0, Math.PI * 2);
        shockCtx.lineWidth = Math.max(1, rp.life * 3.5);
        shockCtx.strokeStyle = 'rgba(120,180,255,' + ra.toFixed(3) + ')';
        shockCtx.stroke();
        /* 二次内圈 */
        if (rp.r > 20) {
          shockCtx.beginPath();
          shockCtx.ellipse(rcx, rcy, rp.r * 0.64, rp.r * 0.27, 0, 0, Math.PI * 2);
          shockCtx.lineWidth = Math.max(0.5, rp.life * 1.8);
          shockCtx.strokeStyle = 'rgba(160,210,255,' + (ra * 0.55).toFixed(3) + ')';
          shockCtx.stroke();
        }
      }

      /* 打击感集中涟漪（Snare/Flux） */
      for (var sn = 0; sn < snareRipples.length; sn++) {
        var snr = snareRipples[sn];
        var sna = snr.life * snr.strength * 0.55;
        if (sna < 0.005) continue;
        shockCtx.beginPath();
        shockCtx.arc(snr.cx, snr.cy, snr.r, 0, Math.PI * 2);
        shockCtx.lineWidth = Math.max(0.8, snr.life * 2.5);
        shockCtx.strokeStyle = 'rgba(255,220,160,' + sna.toFixed(3) + ')';
        shockCtx.stroke();
        if (snr.r > 8) {
          shockCtx.beginPath();
          shockCtx.arc(snr.cx, snr.cy, snr.r * 0.55, 0, Math.PI * 2);
          shockCtx.lineWidth = Math.max(0.5, snr.life * 1.2);
          shockCtx.strokeStyle = 'rgba(255,200,100,' + (sna * 0.4).toFixed(3) + ')';
          shockCtx.stroke();
        }
      }

      /* 冲击波（Drop，从封面中心扩散） */
      for (var j = 0; j < shockwaves.length; j++) {
        var sw = shockwaves[j];
        if (sw.delay && sw.delay > 0) continue;
        var sa = sw.life * sw.strength;
        if (sa < 0.004) continue;
        var thickness = Math.max(1.5, (1 - sw.r / sw.maxR) * 18);
        var grd = shockCtx.createRadialGradient(
          sw.cx, sw.cy, Math.max(0, sw.r - thickness * 1.5),
          sw.cx, sw.cy, sw.r + thickness * 1.5);
        grd.addColorStop(0,   'rgba(255,255,255,0)');
        grd.addColorStop(0.4, 'rgba(210,190,255,' + (sa * 0.55).toFixed(3) + ')');
        grd.addColorStop(0.6, 'rgba(255,255,255,' + (sa * 0.35).toFixed(3) + ')');
        grd.addColorStop(1,   'rgba(255,255,255,0)');
        shockCtx.beginPath();
        shockCtx.arc(sw.cx, sw.cy, sw.r, 0, Math.PI * 2);
        shockCtx.lineWidth = thickness * 3;
        shockCtx.strokeStyle = grd;
        shockCtx.stroke();
      }

      /* 引力核心：高潮时中心微发光 */
      if (SP.gravPull.value > 0.02) {
        var gv = SP.gravPull.value;
        var gcx = SW * 0.5, gcy = SH * 0.5;
        var gr = shockCtx.createRadialGradient(gcx, gcy, 0, gcx, gcy, Math.min(SW, SH) * 0.28);
        gr.addColorStop(0,   'rgba(200,160,255,' + (gv * 0.18).toFixed(3) + ')');
        gr.addColorStop(0.5, 'rgba(140,100,240,' + (gv * 0.08).toFixed(3) + ')');
        gr.addColorStop(1,   'rgba(0,0,0,0)');
        shockCtx.fillStyle = gr;
        shockCtx.beginPath();
        shockCtx.arc(gcx, gcy, Math.min(SW, SH) * 0.28, 0, Math.PI * 2);
        shockCtx.fill();
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  清空 / 重置视觉
   * ════════════════════════════════════════════════════════════ */
  function clearVisuals () {
    var cc = document.getElementById('canvas-container');
    if (cc) { cc.style.transform = ''; cc.style.filter = 'none'; }
    var tw = document.getElementById('thumb-wrap');
    if (tw) {
      tw.style.transform = '';
      var img = tw.querySelector('img, canvas');
      if (img) img.style.filter = '';
    }
    var bb = document.getElementById('bottom-bar');
    if (bb) bb.style.transform = '';
    if (shockCtx) shockCtx.clearRect(0, 0, SW, SH);
    /* 清理扩展效果 */
    var ctrlEl = document.getElementById('controls');
    var btns = ctrlEl ? ctrlEl.querySelectorAll('.ctrl-btn') : [];
    for (var b = 0; b < btns.length; b++) btns[b].style.transform = '';
    var pushEls = ['search-area', 'fx-panel'];
    for (var p = 0; p < pushEls.length; p++) {
      var pel = document.getElementById(pushEls[p]);
      if (pel) pel.style.transform = '';
    }
    if (g.stageLyrics) g.stageLyrics._liquidScale = 1;
  }

  /* ══════════════════════════════════════════════════════════════
   *  公开 API
   * ════════════════════════════════════════════════════════════ */
  g.LiquidDeform = {
    init: function () {
      initSvgFilter();
      initShockCanvas();
      lastTs = performance.now();
      requestAnimationFrame(tick);
    },

    setEnabled: function (on) {
      enabled = !!on;
      if (!enabled) clearVisuals();
    },

    setParams: function (p) {
      if (!p) return;
      if (p.intensity != null) PARAMS.intensity = Math.max(0, p.intensity);
      if (p.distort   != null) PARAMS.distort   = Math.max(0, p.distort);
      if (p.jelly     != null) PARAMS.jelly      = Math.max(0, p.jelly);
      if (p.chroma    != null) PARAMS.chroma     = Math.max(0, p.chroma);
      if (p.shockwave != null) PARAMS.shockwave  = Math.max(0, p.shockwave);
    },
  };

})(window);
