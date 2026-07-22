/**
 * lyric-scene.js — 歌词场景化视觉效果  v1
 *
 * 根据当前歌词关键词匹配对应自然场景：
 *   雨  → 飘落雨丝（canvas 粒子）
 *   海/浪/波 → 底部波浪
 *   夜/黑夜/星 → 界面变暗 + 星空
 *   火/燃 → 上升火花
 *   雪/霜 → 飘落雪花
 *   风  → 斜向飘丝
 *
 * 无依赖，纯 Canvas + rAF
 * 挂载：window.LyricScene
 *
 * 与 app.js 集成方式：
 *   在 showStageLine(text) 调用后追加 LyricScene.onLyric(text)
 *   并在主循环里 LyricScene.tick(dt)
 */
(function (g) {
  'use strict';

  /* ════════════════════════════════════════════════════
   *  关键词字典
   *  每个 scene: { keywords: [...], type }
   *  优先级从高到低
   * ════════════════════════════════════════════════════ */
  var SCENES = [
    {
      type: 'firefly',
      keywords: [
        '萤火虫','萤火','萤光','萤',
        'firefly','fireflies','glowworm','bioluminescence'
      ]
    },
    {
      type: 'meteor',
      keywords: [
        '流星','流星雨','许愿','星愿','划破','坠落','陨落','陨石',
        'meteor','shooting star','falling star','wish upon','comet'
      ]
    },
    {
      type: 'sakura',
      keywords: [
        '樱花','花瓣','樱','花朵','桃花','梨花','梅花','花落','芬芳',
        '盛开','繁花','落花','飞花','春花','百花','鲜花',
        'blossom','petal','petals','cherry','sakura','bloom','flower','floral'
      ]
    },
    {
      type: 'night',
      keywords: [
        '夜','黑夜','深夜','午夜','夜晚','星','星空','星光','星辰',
        '月','月光','月亮','明月','繁星','银河',
        'night','dark','star','stars','moon','midnight','galaxy','sky'
      ]
    },
    {
      type: 'rain',
      keywords: [
        '雨','下雨','雨水','雨滴','细雨','暴雨','泪','泪水','泪珠',
        '哭泣','哭','泣','流泪','雨季','梅雨','倾盆',
        'rain','rainy','tears','tear','cry','crying','drizzle','shower','weeping'
      ]
    },
    {
      type: 'ocean',
      keywords: [
        '海','大海','海浪','波浪','浪','涛','海洋','波涛','碧海',
        '波','浪潮','潮汐','潮水','海边','海岸','沙滩','海风',
        'sea','ocean','wave','waves','tide','surf','shore','beach','coast'
      ]
    },
    {
      type: 'fire',
      keywords: [
        '火','燃烧','炙热','烈火','火焰','灼烧','热情','燃','炽',
        '温度','温暖','暖','煤','炭','熔','炎',
        'fire','flame','burn','burning','hot','heat','blaze','passion'
      ]
    },
    {
      type: 'snow',
      keywords: [
        '雪','下雪','雪花','雪白','白雪','冰雪','霜','冰','冷','寒',
        '冬','寒冬','冰冷','严寒','凛',
        'snow','snowy','ice','cold','frost','winter','freeze','frozen','blizzard'
      ]
    },
    {
      type: 'wind',
      keywords: [
        '风','微风','清风','狂风','风吹','飞','飘','飘零','随风',
        '自由','轻盈','漂浮','自在',
        'wind','breeze','gust','blow','drift','float','freedom','free','fly','soar'
      ]
    },
    {
      type: 'rainbow',
      keywords: [
        '彩虹','虹','七彩','彩色','绚烂','绚丽','五彩','多彩','斑斓',
        '色彩','七色','光芒','绽放','明媚','晴',
        'rainbow','colorful','colours','colors','vivid','prism','radiant','bright'
      ]
    },
    {
      type: 'sunset',
      keywords: [
        '落日','夕阳','余晖','黄昏','晚霞','暮色','夕照','暮光',
        '彩霞','晚风','傍晚','日暮','残阳','霞光','彩云','暮云',
        'sunset','dusk','twilight','golden hour','afterglow','evening glow','sundown'
      ]
    },
    {
      type: 'sun',
      keywords: [
        '太阳','阳光','日出','晨光','朝阳','暖阳','旭日','朝晖',
        '金光','阳','日照','骄阳','灿烂','光明','照耀','曙光',
        'sun','sunshine','sunlight','sunrise','sunny','dawn','daylight','solar','radiance'
      ]
    },
    {
      type: 'leaves',
      keywords: [
        '落叶','叶子','树叶','枫叶','秋叶','黄叶','金叶','红叶',
        '凋零','凋落','枫','秋意','叶落','金秋',
        'leaf','leaves','autumn','fall foliage','maple','wither','withered','foliage'
      ]
    },
    {
      type: 'mist',
      keywords: [
        '雾','迷雾','朦胧','薄雾','氤氲','迷离','缥缈','雾气','烟雾',
        '如梦','如烟','云雾','迷蒙','飘渺','虚无',
        'mist','fog','foggy','haze','hazy','misty','ethereal','dreamy','blur'
      ]
    }
  ];

  /* ════════════════════════════════════════════════════
   *  工具
   * ════════════════════════════════════════════════════ */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t)    { return a + (b - a) * t; }
  function rand(lo, hi)     { return lo + Math.random() * (hi - lo); }
  function randInt(lo, hi)  { return Math.floor(rand(lo, hi + 0.999)); }

  /* ════════════════════════════════════════════════════
   *  状态
   * ════════════════════════════════════════════════════ */
  var canvas = null, ctx = null;
  var W = 0, H = 0;

  /* 当前场景强度（0→1），每次歌词变化会目标设为 1，然后缓慢衰减 */
  var sceneIntensity = 0, sceneTarget = 0;
  var currentType = 'none';

  /* 夜晚叠层 */
  var nightOverlay = 0, nightOverlayTarget = 0;

  /* 粒子池 */
  var particles = [];
  var MAX_PARTICLES = 220;

  /* 波浪状态（ocean） */
  var wavePhase = 0;
  /* 彩虹相位（呼吸动画） */
  var _rainbowPhase = 0;
  /* 太阳动画相位 */
  var _sunRayPhase = 0;

  /* 星星（night） */
  var stars = [];
  var starsInited = false;

  /* 帧计时 */
  var _elapsed = 0;
  var _lastTime = 0;
  var _animId = null;
  var _enabled = false;

  /* 内部歌词追踪（独立于 app.js 钩子，直接轮询 lyricsLines）*/
  var _lastLyricIdx = -99;
  var _lastAudioSrc  = '';

  /* ════════════════════════════════════════════════════
   *  Canvas 初始化
   * ════════════════════════════════════════════════════ */
  function _initCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'lyric-scene-canvas';
    canvas.style.cssText = [
      'position:fixed', 'inset:0', 'width:100%', 'height:100%',
      'pointer-events:none',
      'z-index:5',   /* #empty-home 是 z-index:4，必须 ≥5 才能叠在它之上；底部栏是 10 */
      'will-change:opacity'
    ].join(';');
    document.body.appendChild(canvas);
    _resize();
    g.addEventListener('resize', _resize);
  }

  function _resize() {
    if (!canvas) return;
    W = canvas.width  = g.innerWidth  || 1280;
    H = canvas.height = g.innerHeight || 800;
    starsInited = false;
  }

  /* ════════════════════════════════════════════════════
   *  关键词匹配
   * ════════════════════════════════════════════════════ */
  function _detectScene(text) {
    if (!text) return 'none';
    var t = text.toLowerCase();
    for (var i = 0; i < SCENES.length; i++) {
      var sc = SCENES[i];
      for (var j = 0; j < sc.keywords.length; j++) {
        if (t.indexOf(sc.keywords[j]) !== -1) return sc.type;
      }
    }
    return 'none';
  }

  /* ════════════════════════════════════════════════════
   *  粒子生成器
   * ════════════════════════════════════════════════════ */
  function _spawnRain() {
    if (particles.length >= MAX_PARTICLES) return;
    var x = rand(0, W);
    particles.push({
      type: 'rain',
      x: x, y: rand(-40, 0),
      vx: rand(-0.4, 0.4) + rand(-0.3, 0.3),
      vy: rand(8, 14),
      len: rand(12, 22),
      alpha: rand(0.25, 0.55),
      life: 1, maxLife: rand(0.8, 1.8)
    });
  }

  function _spawnFire() {
    if (particles.length >= MAX_PARTICLES) return;
    var x = rand(W * 0.1, W * 0.9);
    particles.push({
      type: 'fire',
      x: x, y: H + rand(0, 30),
      vx: rand(-1.2, 1.2),
      vy: rand(-3.5, -1.8),
      r:  rand(2, 5),
      hue: rand(10, 42),    /* 橙红色区间 */
      alpha: rand(0.5, 0.9),
      life: 1, maxLife: rand(0.6, 1.4)
    });
  }

  function _spawnSnow() {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      type: 'snow',
      x: rand(0, W), y: rand(-20, 0),
      vx: rand(-0.5, 0.5),
      vy: rand(0.8, 2.2),
      r:  rand(2, 5),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.8, 2.2),
      alpha: rand(0.45, 0.90),
      life: 1, maxLife: rand(2.5, 5.5)
    });
  }

  function _spawnWind() {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      type: 'wind',
      x: rand(-90, 0), y: rand(H * 0.04, H * 0.88),
      vx: rand(7, 16),
      vy: rand(-1.5, 1.5),
      len: rand(55, 150),
      alpha: rand(0.22, 0.52),
      lineW: rand(0.9, 2.6),
      curveY: rand(-22, 22),
      life: 1, maxLife: rand(0.36, 0.95)
    });
  }

  function _spawnBubble() {
    if (particles.length >= MAX_PARTICLES) return;
    /* 从屏幕下半段随机位置向上漂浮 */
    var layer = rand(0, 3) | 0;  /* 0-2 对应三层波高度 */
    var baseYs = [H * 0.60, H * 0.73, H * 0.85];
    var by = baseYs[layer] + rand(-H * 0.05, H * 0.04);
    particles.push({
      type: 'bubble',
      x: rand(0, W),
      y: by,
      vx: rand(-0.30, 0.30),
      vy: rand(-0.60, -0.18),
      r:  rand(1.2, 3.8),
      alpha: rand(0.35, 0.75),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.6, 1.8),
      life: 1, maxLife: rand(1.8, 4.2)
    });
  }

  function _spawnLeaf() {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      type: 'leaf',
      x: rand(-20, W + 20), y: rand(-60, -5),
      vx: rand(-1.0, 1.0),
      vy: rand(0.7, 1.8),
      angle: rand(0, Math.PI * 2),
      angleV: rand(-1.2, 1.2),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.6, 1.6),
      size: rand(7, 15),
      hue: randInt(5, 52),       /* 红→橙→黄 秋叶色域 */
      sat: randInt(62, 90),
      lit: randInt(38, 58),
      alpha: rand(0.65, 0.92),
      life: 1, maxLife: rand(4.5, 9.0)
    });
  }

  function _spawnSakura() {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      type: 'sakura',
      x: rand(-20, W + 20), y: rand(-40, -5),
      vx: rand(-0.7, 0.7),
      vy: rand(0.5, 1.5),
      angle: rand(0, Math.PI * 2),
      angleV: rand(-0.9, 0.9),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.5, 1.5),
      size: rand(4, 9),
      alpha: rand(0.55, 0.88),
      life: 1, maxLife: rand(3.5, 7.0)
    });
  }

  function _spawnFirefly() {
    if (particles.length >= MAX_PARTICLES * 0.6) return;
    particles.push({
      type: 'firefly',
      x: rand(W * 0.05, W * 0.95),
      y: rand(H * 0.30, H * 0.88),
      vx: rand(-0.25, 0.25),
      vy: rand(-0.45, -0.08),
      glowPhase: rand(0, Math.PI * 2),
      glowSpeed: rand(0.9, 2.8),
      r: rand(1.5, 3.2),
      alpha: rand(0.55, 0.92),
      life: 1, maxLife: rand(3.5, 7.5)
    });
  }

  function _spawnMeteor() {
    if (particles.length >= MAX_PARTICLES) return;
    var ang   = rand(Math.PI * 0.20, Math.PI * 0.32);
    var speed = rand(280, 550);
    particles.push({
      type: 'meteor',
      x: rand(W * 0.05, W * 0.85),
      y: rand(0, H * 0.28),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      len: rand(55, 130),
      alpha: rand(0.65, 0.95),
      life: 1, maxLife: rand(0.14, 0.32)
    });
  }

  /* ════════════════════════════════════════════════════
   *  更新粒子
   * ════════════════════════════════════════════════════ */
  function _spawnTick(dt) {
    var rate = sceneIntensity;
    if (rate < 0.05) return;

    if (currentType === 'rain') {
      var n = Math.floor(rate * 5 + 1);
      for (var i = 0; i < n; i++) _spawnRain();
    } else if (currentType === 'fire') {
      var n2 = Math.floor(rate * 4 + 1);
      for (var i = 0; i < n2; i++) _spawnFire();
    } else if (currentType === 'snow') {
      if (Math.random() < rate * 0.7) _spawnSnow();
    } else if (currentType === 'wind') {
      var nw = Math.floor(rate * 3.2 + 0.5);
      for (var ww = 0; ww < nw; ww++) _spawnWind();
      if (Math.random() < rate * 1.5) _spawnWind();
    } else if (currentType === 'leaves') {
      if (Math.random() < rate * 0.55) _spawnLeaf();
    } else if (currentType === 'sakura') {
      if (Math.random() < rate * 0.65) _spawnSakura();
    } else if (currentType === 'firefly') {
      if (Math.random() < rate * 0.18) _spawnFirefly();
    } else if (currentType === 'meteor') {
      if (Math.random() < rate * 0.06) _spawnMeteor();
    } else if (currentType === 'ocean') {
      var nb = Math.floor(rate * 1.8 + 0.5);
      for (var ob = 0; ob < nb; ob++) _spawnBubble();
    }
  }

  function _updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt / p.maxLife;
      if (p.life <= 0 || p.x < -100 || p.x > W + 100 || p.y < -100 || p.y > H + 100) {
        particles.splice(i, 1);
        continue;
      }
      if (p.type === 'rain') {
        p.x += p.vx; p.y += p.vy;
      } else if (p.type === 'fire') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.97;
        p.r  *= 0.98;
      } else if (p.type === 'snow') {
        p.wobble += p.wobbleSpeed * dt;
        p.x += p.vx + Math.sin(p.wobble) * 0.8;
        p.y += p.vy;
      } else if (p.type === 'wind') {
        p.x += p.vx; p.y += p.vy;
      } else if (p.type === 'leaf') {
        p.wobble += p.wobbleSpeed * dt;
        p.x += p.vx + Math.sin(p.wobble) * 1.1;
        p.y += p.vy;
        p.angle += p.angleV * dt;
      } else if (p.type === 'sakura') {
        p.wobble += p.wobbleSpeed * dt;
        p.x += p.vx + Math.sin(p.wobble) * 0.85;
        p.y += p.vy;
        p.angle += p.angleV * dt;
      } else if (p.type === 'firefly') {
        p.glowPhase += p.glowSpeed * dt;
        p.x += p.vx + Math.sin(p.glowPhase * 0.65) * 0.45;
        p.y += p.vy;
        p.vx += (Math.random() - 0.5) * 0.06;
        p.vx  = clamp(p.vx, -0.5, 0.5);
      } else if (p.type === 'meteor') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.type === 'bubble') {
        p.wobble += p.wobbleSpeed * dt;
        p.x += p.vx + Math.sin(p.wobble) * 0.5;
        p.y += p.vy;
      }
    }
  }

  /* ════════════════════════════════════════════════════
   *  彩虹绘制（Canvas 2D arc 两遍描边）
   *
   *  圆心在屏幕底部稍下方（H*1.05），外径 W*0.62，
   *  弧顶刚好出现在屏幕上方 ~10%，形成自然全幅彩虹。
   *
   *  两遍绘制：
   *    ① 宽条低透明度 → 大气散射晕染（柔边）
   *    ② 窄条 + shadowBlur → 鲜亮核心色带（发光）
   * ════════════════════════════════════════════════════ */
  function _drawRainbow(intensity) {
    var cx     = W / 2;
    var cy     = H * 1.05;           /* 圆心在屏幕下方 5% */
    var outerR = W * 0.62;           /* 外圆半径 */
    var bandW  = outerR * 0.028;     /* 每条色带宽度 */

    /* ROYGBIV 七色：红橙黄绿蓝靛紫 */
    var bands = [
      [255,  45,  45],
      [255, 148,  20],
      [255, 228,  25],
      [ 50, 200,  60],
      [ 25, 125, 255],
      [105,  55, 215],
      [185,  55, 230]
    ];

    _rainbowPhase += 0.006;
    var breath    = 0.94 + 0.06 * Math.sin(_rainbowPhase);
    var baseAlpha = intensity * 0.75 * breath;

    ctx.save();

    /* ── 第一遍：宽条低透明度 → 大气散射晕染 ────── */
    for (var i = 0; i < bands.length; i++) {
      var r1 = outerR - i * bandW;
      if (r1 < bandW) break;
      var b = bands[i];
      ctx.beginPath();
      ctx.arc(cx, cy, r1, Math.PI, 0, true);
      ctx.strokeStyle = 'rgba(' + b[0] + ',' + b[1] + ',' + b[2] + ',' +
                        (baseAlpha * 0.28).toFixed(3) + ')';
      ctx.lineWidth = bandW * 3.5;
      ctx.stroke();
    }

    /* ── 第二遍：窄条 + shadowBlur → 鲜亮核心色带 ── */
    for (var i = 0; i < bands.length; i++) {
      var r2 = outerR - i * bandW;
      if (r2 < bandW) break;
      var b2 = bands[i];
      ctx.shadowColor = 'rgba(' + b2[0] + ',' + b2[1] + ',' + b2[2] + ',' +
                        (baseAlpha * 0.60).toFixed(3) + ')';
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r2, Math.PI, 0, true);
      ctx.strokeStyle = 'rgba(' + b2[0] + ',' + b2[1] + ',' + b2[2] + ',' +
                        baseAlpha.toFixed(3) + ')';
      ctx.lineWidth = bandW * 0.80;
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ════════════════════════════════════════════════════
   *  绘制
   * ════════════════════════════════════════════════════ */
  function _draw(dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    var si = sceneIntensity;
    if (si < 0.01 && nightOverlay < 0.01) return;

    /* ── 夜晚遮罩 ──────────────────────────────────── */
    if (nightOverlay > 0.005) {
      ctx.fillStyle = 'rgba(2,4,18,' + (nightOverlay * 0.42).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    /* ── 星星（night） ─────────────────────────────── */
    if (currentType === 'night' && nightOverlay > 0.05) {
      if (!starsInited) _buildStars();
      _drawStars(dt);
    }

    /* ── 粒子 ───────────────────────────────────────── */
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = p.alpha * p.life * si;
      if (a < 0.01) continue;

      if (p.type === 'rain') {
        ctx.save();
        ctx.strokeStyle = 'rgba(160,195,255,' + a.toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * p.len * 0.12, p.y + p.len);
        ctx.stroke();
        ctx.restore();

      } else if (p.type === 'fire') {
        var gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.5);
        gr.addColorStop(0, 'hsla(' + p.hue + ',100%,90%,' + Math.min(1, a * 1.4).toFixed(3) + ')');
        gr.addColorStop(0.4, 'hsla(' + p.hue + ',100%,58%,' + a.toFixed(3) + ')');
        gr.addColorStop(1, 'hsla(' + p.hue + ',90%,28%,0)');
        ctx.save();
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

      } else if (p.type === 'snow') {
        ctx.save();
        ctx.fillStyle = 'rgba(230,240,255,' + a.toFixed(3) + ')';
        ctx.shadowColor = 'rgba(200,220,255,' + (a * 0.6).toFixed(3) + ')';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

      } else if (p.type === 'wind') {
        if (a < 0.01) continue;
        ctx.save();
        var ex  = p.x + p.len;
        var ey  = p.y + p.curveY;
        var cpx = p.x + p.len * 0.5;
        var cpy = p.y + p.curveY * 0.42;
        var wGrad = ctx.createLinearGradient(p.x, p.y, ex, ey);
        wGrad.addColorStop(0,    'rgba(210,230,255,0)');
        wGrad.addColorStop(0.22, 'rgba(215,232,255,' + a.toFixed(3) + ')');
        wGrad.addColorStop(0.78, 'rgba(215,232,255,' + (a * 0.48).toFixed(3) + ')');
        wGrad.addColorStop(1,    'rgba(210,230,255,0)');
        ctx.strokeStyle = wGrad;
        ctx.lineWidth = p.lineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(cpx, cpy, ex, ey);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'leaf') {
        ctx.save();
        ctx.globalAlpha = Math.max(0, a);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        /* 椭圆叶形 */
        var s = p.size;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.55);
        ctx.bezierCurveTo( s * 0.55, -s * 0.45,  s * 0.60, s * 0.30, 0, s * 0.55);
        ctx.bezierCurveTo(-s * 0.60, s * 0.30, -s * 0.55, -s * 0.45, 0, -s * 0.55);
        ctx.fillStyle = 'hsl(' + p.hue + ',' + p.sat + '%,' + p.lit + '%)';
        ctx.fill();
        /* 叶脉 */
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.50);
        ctx.lineTo(0,  s * 0.50);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore();

      } else if (p.type === 'sakura') {
        ctx.save();
        ctx.globalAlpha = Math.max(0, a);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        /* 5 瓣花朵 */
        var ps = p.size;
        for (var k = 0; k < 5; k++) {
          var pa = (k / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(
            Math.cos(pa) * ps * 0.50,
            Math.sin(pa) * ps * 0.50,
            ps * 0.42, ps * 0.28, pa, 0, Math.PI * 2
          );
          ctx.fillStyle = 'rgba(255,185,200,' + a.toFixed(3) + ')';
          ctx.fill();
        }
        /* 花心 */
        ctx.beginPath();
        ctx.arc(0, 0, ps * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,220,230,' + Math.min(1, a * 1.2).toFixed(3) + ')';
        ctx.fill();
        ctx.restore();

      } else if (p.type === 'firefly') {
        var glow = 0.5 + 0.5 * Math.sin(p.glowPhase);
        var fa = a * glow;
        if (fa < 0.02) continue;
        ctx.save();
        var gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
        gr.addColorStop(0,   'rgba(200,255,120,' + Math.min(1, fa * 1.5).toFixed(3) + ')');
        gr.addColorStop(0.35,'rgba(160,255,80,'  + fa.toFixed(3) + ')');
        gr.addColorStop(1,   'rgba(100,220,60,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

      } else if (p.type === 'meteor') {
        var ma = a * p.life;
        if (ma < 0.02) continue;
        var nx = -p.vy / (Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1);
        var ny =  p.vx / (Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1);
        var tailX = p.x - (p.vx / (Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1)) * p.len;
        var tailY = p.y - (p.vy / (Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1)) * p.len;
        ctx.save();
        var mg = ctx.createLinearGradient(p.x, p.y, tailX, tailY);
        mg.addColorStop(0,   'rgba(255,255,255,' + ma.toFixed(3) + ')');
        mg.addColorStop(0.30,'rgba(200,220,255,' + (ma * 0.6).toFixed(3) + ')');
        mg.addColorStop(1,   'rgba(150,180,255,0)');
        ctx.strokeStyle = mg;
        ctx.lineWidth = 2.0;
        ctx.shadowColor = 'rgba(200,220,255,0.8)';
        ctx.shadowBlur  = 6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'bubble') {
        if (a < 0.01) continue;
        ctx.save();
        /* 外圈柔光晕 */
        var br2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.5);
        br2.addColorStop(0,    'rgba(180,220,255,' + Math.min(1, a * 1.1).toFixed(3) + ')');
        br2.addColorStop(0.4,  'rgba(140,200,255,' + (a * 0.55).toFixed(3) + ')');
        br2.addColorStop(1,    'rgba(100,170,255,0)');
        ctx.fillStyle = br2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4.5, 0, Math.PI * 2);
        ctx.fill();
        /* 核心亮点 */
        ctx.shadowColor = 'rgba(200,235,255,' + (a * 0.7).toFixed(3) + ')';
        ctx.shadowBlur  = p.r * 3;
        ctx.fillStyle   = 'rgba(220,240,255,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    /* ── 海浪（ocean） ─────────────────────────────── */
    if (currentType === 'ocean' && si > 0.05) {
      _drawWaves(si);
    }

    /* ── 彩虹（rainbow）────────────────────────────── */
    if (currentType === 'rainbow' && si > 0.01) {
      _drawRainbow(si);
    }

    /* ── 落日（sunset）──────────────────────────────── */
    if (currentType === 'sunset' && si > 0.02) {
      _drawSunset(si);
    }

    /* ── 阳光（sun）─────────────────────────────────── */
    if (currentType === 'sun' && si > 0.02) {
      _drawSun(si);
    }

    /* ── 迷雾（mist）────────────────────────────────── */
    if (currentType === 'mist' && si > 0.02) {
      _drawMist(si);
    }

    /* ── 风（wind）全屏扫带 ─────────────────────────── */
    if (currentType === 'wind' && si > 0.02) {
      _drawWindBg(si);
    }
  }

  /* ── 星星 ─────────────────────────────────────────── */
  function _buildStars() {
    stars = [];
    var count = Math.floor(W * H / 3200);
    count = clamp(count, 60, 280);
    for (var i = 0; i < count; i++) {
      stars.push({
        x: rand(0, W), y: rand(0, H * 0.72),
        r: rand(0.5, 2.2),
        baseAlpha: rand(0.30, 0.90),
        twinkleSpeed: rand(0.5, 2.5),
        twinklePhase: rand(0, Math.PI * 2)
      });
    }
    starsInited = true;
  }

  function _drawStars(dt) {
    _elapsed += dt;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var flicker = s.baseAlpha * (0.65 + 0.35 * Math.sin(_elapsed * s.twinkleSpeed + s.twinklePhase));
      var a = flicker * nightOverlay * sceneIntensity;
      if (a < 0.01) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(230,240,255,' + a.toFixed(3) + ')';
      if (s.r > 1.6) {
        ctx.shadowColor = 'rgba(200,220,255,' + (a * 0.7).toFixed(3) + ')';
        ctx.shadowBlur = s.r * 3;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ── 海浪（柔光线条风格，无实心填充）──────────── */
  function _drawWaves(intensity) {
    wavePhase += 0.014;
    ctx.save();

    /* 三层波浪参数：远(淡小)→近(亮大) */
    var layers = [
      { baseY: H * 0.58, amp: H * 0.028, fq1: 6.0, fq2: 11.8, ph: 2.1, pm: 1.8,
        lineW: 1.2, blur: 5,  lineA: 0.22, glowA: 0.10 },
      { baseY: H * 0.72, amp: H * 0.042, fq1: 4.8, fq2:  9.5, ph: 1.0, pm: 1.4,
        lineW: 1.8, blur: 9,  lineA: 0.38, glowA: 0.17 },
      { baseY: H * 0.84, amp: H * 0.055, fq1: 3.8, fq2:  7.8, ph: 0.0, pm: 1.0,
        lineW: 2.4, blur: 14, lineA: 0.55, glowA: 0.25 }
    ];

    for (var L = 0; L < layers.length; L++) {
      var lyr = layers[L];

      /* 计算波峰轮廓路径（复用两遍：发光层 + 线条层） */
      var pts = [];
      for (var x = 0; x <= W; x += 3) {
        var wt = x / W;
        var yw = lyr.baseY
               - lyr.amp * 0.62 * (0.5 + 0.5 * Math.sin(wt * Math.PI * lyr.fq1 + wavePhase * lyr.pm + lyr.ph))
               - lyr.amp * 0.22 * Math.sin(wt * Math.PI * lyr.fq2 + wavePhase * (lyr.pm + 0.85));
        pts.push([x, yw]);
      }

      /* ① 宽发光层（大 blur，低透明度） */
      ctx.save();
      ctx.shadowColor = 'rgba(120,190,255,' + (intensity * lyr.glowA).toFixed(3) + ')';
      ctx.shadowBlur  = lyr.blur;
      ctx.strokeStyle = 'rgba(160,215,255,' + (intensity * lyr.lineA * 0.45).toFixed(3) + ')';
      ctx.lineWidth   = lyr.lineW * 3.5;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var pi = 1; pi < pts.length - 1; pi++) {
        var mx = (pts[pi][0] + pts[pi+1][0]) / 2;
        var my = (pts[pi][1] + pts[pi+1][1]) / 2;
        ctx.quadraticCurveTo(pts[pi][0], pts[pi][1], mx, my);
      }
      ctx.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]);
      ctx.stroke();
      ctx.restore();

      /* ② 细亮线芯（小 blur，高透明度） */
      ctx.save();
      ctx.shadowColor = 'rgba(200,235,255,' + (intensity * lyr.glowA * 0.8).toFixed(3) + ')';
      ctx.shadowBlur  = lyr.blur * 0.4;
      ctx.strokeStyle = 'rgba(210,238,255,' + (intensity * lyr.lineA).toFixed(3) + ')';
      ctx.lineWidth   = lyr.lineW;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var pi = 1; pi < pts.length - 1; pi++) {
        var mx2 = (pts[pi][0] + pts[pi+1][0]) / 2;
        var my2 = (pts[pi][1] + pts[pi+1][1]) / 2;
        ctx.quadraticCurveTo(pts[pi][0], pts[pi][1], mx2, my2);
      }
      ctx.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /* ── 阳光（右上角射出的扇形光束，无日轮）────────── */
  function _drawSun(intensity) {
    _sunRayPhase += 0.014;

    /* 光源固定在右上角画布外，只射出光线不显示圆盘 */
    var ox = W * 1.04;   /* 稍超出画布右边 */
    var oy = -H * 0.04;  /* 稍超出画布顶部 */
    var rayLen = Math.sqrt(W * W + H * H) * 1.1;

    /* 扇形范围：从右上角向左下方 — 约 150°~260°（弧度） */
    var FAN_START = Math.PI * 0.83;   /* ~150° 偏左下 */
    var FAN_END   = Math.PI * 1.44;   /* ~260° 偏正下 */
    var RAY_CNT   = 10;               /* 10 束光线 */

    ctx.save();
    /* screen 混合让光线自然叠加发光，不产生硬边 */
    ctx.globalCompositeOperation = 'screen';

    for (var i = 0; i < RAY_CNT; i++) {
      var t     = i / (RAY_CNT - 1);
      var ang   = FAN_START + (FAN_END - FAN_START) * t
                + Math.sin(_sunRayPhase * 0.7 + i * 0.55) * 0.04;
      var pulse = 0.70 + 0.30 * Math.sin(_sunRayPhase * 1.1 + i * 0.72);
      var midness = Math.max(0, 1 - Math.abs(t - 0.5) * 1.6);
      /* alpha 整体降低，避免硬白线感 */
      var alpha = intensity * (0.10 + midness * 0.13) * pulse;
      var ex = ox + Math.cos(ang) * rayLen;
      var ey = oy + Math.sin(ang) * rayLen;

      /* 三层叠绘：宽→中→细，模拟光线从中心向边缘柔化 */
      var widths = [
        (55 + midness * 90) * intensity,
        (25 + midness * 45) * intensity,
        (8  + midness * 16) * intensity
      ];
      var alphas = [alpha * 0.28, alpha * 0.55, alpha * 0.85];

      for (var L = 0; L < 3; L++) {
        var rg = ctx.createLinearGradient(ox, oy, ex, ey);
        rg.addColorStop(0,    'rgba(255,240,180,' + Math.min(0.60, alphas[L] * 1.3).toFixed(3) + ')');
        rg.addColorStop(0.12, 'rgba(255,225,130,' + alphas[L].toFixed(3) + ')');
        rg.addColorStop(0.45, 'rgba(255,205,90,'  + (alphas[L] * 0.40).toFixed(3) + ')');
        rg.addColorStop(1,    'rgba(255,185,60,0)');
        ctx.strokeStyle = rg;
        ctx.lineWidth   = widths[L] * pulse;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }

    /* 角落柔光晕，alpha 降低避免过曝 */
    ctx.globalCompositeOperation = 'source-over';
    var corner = ctx.createRadialGradient(ox, oy, 0, ox, oy, W * 0.38);
    corner.addColorStop(0,   'rgba(255,245,180,' + (intensity * 0.32).toFixed(3) + ')');
    corner.addColorStop(0.30,'rgba(255,215,100,' + (intensity * 0.12).toFixed(3) + ')');
    corner.addColorStop(1,   'rgba(255,190,60,0)');
    ctx.fillStyle = corner;
    ctx.beginPath();
    ctx.arc(ox, oy, W * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /* ── 落日（底部天空彩霞 + 半沉日轮 + 地平线光晕）── */
  function _drawSunset(intensity) {
    _sunRayPhase += 0.010;   /* 复用同一相位变量做呼吸 */
    var breath = 0.94 + 0.06 * Math.sin(_sunRayPhase * 0.8);

    /* ① 全屏暮色渐变：底部深橙红 → 中部橙粉 → 顶部深蓝紫 */
    var sky = ctx.createLinearGradient(0, H, 0, 0);
    sky.addColorStop(0,    'rgba(180,50,15,'   + (intensity * 0.72 * breath).toFixed(3) + ')');
    sky.addColorStop(0.12, 'rgba(220,90,20,'   + (intensity * 0.60).toFixed(3) + ')');
    sky.addColorStop(0.28, 'rgba(240,140,55,'  + (intensity * 0.42).toFixed(3) + ')');
    sky.addColorStop(0.48, 'rgba(210,110,90,'  + (intensity * 0.28).toFixed(3) + ')');
    sky.addColorStop(0.70, 'rgba(100,60,120,'  + (intensity * 0.16).toFixed(3) + ')');
    sky.addColorStop(1,    'rgba(30,20,60,'    + (intensity * 0.10).toFixed(3) + ')');
    ctx.save();
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* ② 地平线橙光带 */
    var horizon = H * 0.68;
    var hg = ctx.createLinearGradient(0, horizon - H * 0.12, 0, horizon + H * 0.10);
    hg.addColorStop(0,   'rgba(255,170,50,0)');
    hg.addColorStop(0.45,'rgba(255,135,30,' + (intensity * 0.50 * breath).toFixed(3) + ')');
    hg.addColorStop(0.70,'rgba(220,80,15,'  + (intensity * 0.38).toFixed(3) + ')');
    hg.addColorStop(1,   'rgba(160,40,10,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, horizon - H * 0.12, W, H * 0.22);

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /* ── 迷雾（全屏柔性蒙版 + 横向飘移）────────────── */
  function _drawMist(intensity) {
    ctx.save();
    /* 底层：均匀淡雾 */
    ctx.fillStyle = 'rgba(200,210,225,' + (intensity * 0.18).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
    /* 两条渐变带，制造雾气层次感 */
    var t = performance.now() * 0.0003;
    for (var m = 0; m < 2; m++) {
      var yOff = H * (0.32 + m * 0.28) + Math.sin(t + m * 1.8) * H * 0.05;
      var mg = ctx.createLinearGradient(0, yOff - H * 0.22, 0, yOff + H * 0.22);
      mg.addColorStop(0,   'rgba(220,228,238,0)');
      mg.addColorStop(0.5, 'rgba(220,228,238,' + (intensity * 0.22).toFixed(3) + ')');
      mg.addColorStop(1,   'rgba(220,228,238,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, yOff - H * 0.22, W, H * 0.44);
    }
    ctx.restore();
  }

  /* ── 风（全屏扫带 + 方向感）──────────────────────── */
  function _drawWindBg(intensity) {
    var t = performance.now() * 0.00036;
    ctx.save();
    /* 4 条宽度不同、速度不同的横向风带，循环扫过屏幕 */
    for (var wi = 0; wi < 4; wi++) {
      var spd   = 0.52 + wi * 0.20;
      var phase = (t * spd + wi * 0.80) % 2.8;
      var cx    = (phase / 2.8) * W * 2.6 - W * 0.3;
      var bw    = W * (0.22 + wi * 0.07);
      var by    = H * (0.10 + wi * 0.20);
      var bh    = H * (0.22 + wi * 0.06);
      var br    = 0.78 + 0.22 * Math.sin(t * 2.2 + wi * 1.4);
      var pa    = intensity * 0.045 * br;
      if (pa < 0.004) continue;
      var bg = ctx.createLinearGradient(cx - bw * 0.5, 0, cx + bw * 0.5, 0);
      bg.addColorStop(0,   'rgba(218,238,255,0)');
      bg.addColorStop(0.5, 'rgba(218,238,255,' + pa.toFixed(3) + ')');
      bg.addColorStop(1,   'rgba(218,238,255,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(cx - bw * 0.5, by, bw, bh);
    }
    ctx.restore();
  }

  /* ════════════════════════════════════════════════════
   *  _trackLyrics — 自主轮询，无需外部钩子
   *
   *  每帧检查 window.audio.currentTime 与 window.lyricsLines，
   *  歌词行变化时调用 _onLyric()，覆盖默认/粒子/Lyric3 所有模式。
   * ════════════════════════════════════════════════════ */
  function _trackLyrics() {
    var aud   = g.audio;
    var lines = g.lyricsLines;
    if (!aud || !lines || !lines.length) return;

    /* 换曲时重置索引 */
    var src = aud.src || '';
    if (src !== _lastAudioSrc) {
      _lastAudioSrc  = src;
      _lastLyricIdx  = -99;
    }

    if (aud.paused || aud.ended) return;

    var t = aud.currentTime;
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.05) idx = i; else break;
    }
    if (idx < 0 || idx === _lastLyricIdx) return;
    _lastLyricIdx = idx;
    _onLyric(lines[idx].text || '');
  }

  /* ════════════════════════════════════════════════════
   *  主 tick（由外部主循环调用，或内部 rAF）
   * ════════════════════════════════════════════════════ */
  var _internalLoop = false;

  function _internalTick(now) {
    if (!_internalLoop) return;
    _animId = requestAnimationFrame(_internalTick);
    var dt = Math.min(0.08, (now - _lastTime) / 1000);
    _lastTime = now;
    _tickImpl(dt);
  }

  function _tickImpl(dt) {
    _trackLyrics();   /* 自主歌词检测，每帧运行 */
    if (!_enabled) {
      /* 淡出 */
      sceneIntensity = lerp(sceneIntensity, 0, 1 - Math.exp(-dt / 0.6));
      nightOverlay   = lerp(nightOverlay, 0, 1 - Math.exp(-dt / 0.6));
      if (sceneIntensity > 0.005 || nightOverlay > 0.005) _draw(dt);
      return;
    }

    /* 强度衰减（歌词场景只保持几秒，然后淡出等待下一句） */
    sceneTarget = Math.max(0, sceneTarget - dt * 0.07);
    sceneIntensity = lerp(sceneIntensity, sceneTarget, 1 - Math.exp(-dt / (sceneTarget > sceneIntensity ? 0.35 : 0.80)));
    sceneIntensity = clamp(sceneIntensity, 0, 1);

    nightOverlayTarget = (currentType === 'night') ? sceneIntensity : 0;
    nightOverlay = lerp(nightOverlay, nightOverlayTarget, 1 - Math.exp(-dt / (currentType === 'night' ? 0.5 : 0.8)));

    _spawnTick(dt);
    _updateParticles(dt);
    _draw(dt);
  }

  /* ════════════════════════════════════════════════════
   *  公开 API
   * ════════════════════════════════════════════════════ */
  function _onLyric(text) {
    if (!_enabled) return;
    var type = _detectScene(text);
    if (type === 'none') {
      /* 无命中时让场景缓慢淡出，不重置当前类型，保持过渡自然 */
      sceneTarget = Math.max(0, sceneTarget - 0.25);
      return;
    }
    if (type !== currentType) {
      /* 切换场景：清空粒子，重置波浪 */
      particles = [];
      wavePhase = 0;
      starsInited = false;
      currentType = type;
    }
    /* 每次命中场景，强度直接设定目标值 */
    if (type === 'rainbow' || type === 'sun' || type === 'sunset' || type === 'ocean' || type === 'wind') {
      sceneTarget = 1.0;   /* 彩虹/太阳/落日/海浪/风：直接满强度，确保可见 */
    } else if (type === 'night') {
      sceneTarget = Math.min(1.0, sceneTarget + 0.60);
    } else {
      sceneTarget = Math.min(1.0, sceneTarget + 0.40);
      if (sceneTarget > 0.85) sceneTarget = 0.85;
    }
  }

  var API = {
    init: function () {
      _initCanvas();
      ctx = canvas.getContext('2d');
      _enabled = true;
      /* 自驱动内部循环 */
      if (!_internalLoop) {
        _internalLoop = true;
        _lastTime = performance.now();
        requestAnimationFrame(_internalTick);
      }
    },

    /** 由 app.js 在歌词切换时调用 */
    onLyric: function (text) {
      if (!canvas) API.init();
      _onLyric(String(text || ''));
    },

    /** 可选：由外部主循环调用（如果 app.js 有统一 tick） */
    tick: function (dt) {
      if (canvas && ctx) _tickImpl(dt);
    },

    enable: function ()  { _enabled = true; },
    disable: function () { _enabled = false; },

    /* 调试 */
    getState: function () {
      return { type: currentType, intensity: sceneIntensity, particles: particles.length };
    }
  };

  g.LyricScene = API;

  /* 自动初始化 */
  function _auto() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(API.init, 200); });
    } else {
      setTimeout(API.init, 200);
    }
  }
  _auto();

})(window);
