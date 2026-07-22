/**
 * physics-progress.js — 物理化进度条  v1
 *
 * 把底部播放栏 #progress-bar 变成一条有生命的"绳索"：
 *
 *  ① 常态：细绳随播放自然摆动（低频驻波振荡）
 *  ② 拖拽：绳子在指针处形成弹性凸起（高斯隆起），松手后弹性衰减
 *  ③ 松手时有水平惯性：若速度够大，先超射再弹回
 *  ④ 双击任意位置：播放头跳过去 + 扩散涟漪 + 绳子弹跳
 *
 * 不修改已有的 progress-fill / progress-thumb DOM，
 * 叠加一个 canvas（z-index:4）绘制绳索视觉，
 * 原来的 fill/thumb 设为透明，由本 canvas 接管显示。
 *
 * 与 app.js 兼容：
 *   ・audio seek 仍走原有 seekFromProgressPointer / audio.currentTime 路径
 *   ・本模块只替换"进度条视觉"，不改写音频逻辑
 */
(function (g) {
  'use strict';

  var BAR_ID    = 'progress-bar';
  var FILL_ID   = 'progress-fill';
  var THUMB_ID  = 'progress-thumb';
  var CANVAS_ID = 'physics-progress-canvas';

  /* ── 绳索物理参数 ──────────────────────────────────── */
  var SPRING_K   = 18;    /* 弹簧刚度（越大回弹越快） */
  var DAMPING    = 5.2;   /* 阻尼（越大振荡越快消失） */
  var WAVE_AMP   = 6;     /* 常态最大波动幅度（像素） */
  var WAVE_FREQ  = 0.68;  /* 常态振荡频率 Hz */
  var BUMP_SIGMA = 0.12;  /* 高斯凸起宽度（占总宽比例） */
  var BUMP_HEIGHT= 14;    /* 拖拽时最大凸起高度（像素） */
  var ROPE_SEGS  = 100;   /* 绳子采样点数 */
  var ROPE_THICK = 2.4;   /* 绳子线宽 */

  /* ── 状态 ──────────────────────────────────────────── */
  var canvas = null, ctx = null;
  var W = 0, H_BAR = 0;
  var _animId = null;
  var _lastTs = null;
  var _elapsed = 0;

  /* 视觉进度（0-1），跟随音频但有惯性 */
  var _visPos   = 0;   /* 当前视觉位置 */
  var _visTgt   = 0;   /* 目标位置（= 真实播放进度） */
  var _visVel   = 0;   /* 视觉速度（春弹） */

  /* 驻波振幅弹簧 */
  var _waveAmp  = 0;   /* 当前驻波幅度（弹簧目标 = WAVE_AMP 播放时 / 0 暂停时） */
  var _waveAmpV = 0;
  var _wavePhase= 0;

  /* 凸起（Gaussian bump）*/
  var _bumpPos  = 0.5; /* 凸起中心（0-1 归一化） */
  var _bumpH    = 0;   /* 当前凸起高度 */
  var _bumpHV   = 0;   /* 凸起高度速度 */
  var _bumpTgt  = 0;   /* 目标凸起高度 */

  /* 拖拽 */
  var _dragging = false;
  var _dragVelHistory = [];  /* 记录拖拽速度历史（计算松手惯性） */

  /* 涟漪 */
  var _ripples = [];

  /* 双击检测 */
  var _lastClickTime = 0;
  var _lastClickPos  = -1;
  var DBL_CLICK_MS   = 350;

  /* ── 工具 ──────────────────────────────────────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t)    { return a + (b - a) * t; }

  /* 高斯函数 */
  function gauss(x, mu, sigma) {
    var d = (x - mu) / sigma;
    return Math.exp(-0.5 * d * d);
  }

  /* 获取 VibeColor（与 visual-enhancements 相同方案） */
  function getColor() {
    if (g.VibeColor && typeof g.VibeColor.r === 'number') return g.VibeColor;
    try {
      var rgb = getComputedStyle(document.documentElement)
                  .getPropertyValue('--fc-accent-rgb').trim().split(',');
      if (rgb.length === 3) return { r: +rgb[0], g: +rgb[1], b: +rgb[2] };
    } catch (e) {}
    return { r: 0, g: 245, b: 212 };
  }
  function rgba(vc, a) {
    return 'rgba(' + vc.r + ',' + vc.g + ',' + vc.b + ',' + a.toFixed(3) + ')';
  }

  /* 获取真实播放进度（0-1） */
  function _getRealProgress() {
    var aud = g.audio;
    if (aud && isFinite(aud.duration) && aud.duration > 0)
      return clamp(aud.currentTime / aud.duration, 0, 1);
    /* fallback: 读 fill 宽度 */
    var fill = document.getElementById(FILL_ID);
    if (fill) return clamp((parseFloat(fill.style.width) || 0) / 100, 0, 1);
    return 0;
  }

  function _isPlaying() {
    var aud = g.audio;
    return aud && !aud.paused && !aud.ended;
  }

  /* ── Canvas 初始化 ─────────────────────────────────── */
  /* 一次性注入 CSS，使进度条轨道完全透明（覆盖 hover/dragging 状态）*/
  function _injectBarCSS() {
    if (document.getElementById('physics-progress-style')) return;
    var s = document.createElement('style');
    s.id = 'physics-progress-style';
    s.textContent = [
      /* 轨道本体：无背景、无阴影、高度锁定 */
      '#progress-bar,#progress-bar:hover,#progress-bar.is-dragging{',
      '  background:transparent!important;',
      '  box-shadow:none!important;',
      '  height:4px!important;',
      '}',
      /* waveform canvas 和 fill / thumb 全部隐藏 */
      '#waveform-canvas{display:none!important;}',
      '#progress-fill{opacity:0!important;}',
      '#progress-thumb{opacity:0!important;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function _initCanvas() {
    if (canvas) return;
    var bar = document.getElementById(BAR_ID);
    if (!bar) return;

    /* 先注入覆盖 CSS */
    _injectBarCSS();

    canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.style.cssText = [
      'position:absolute', 'left:0', 'right:0',
      'top:50%', 'transform:translateY(-50%)',
      'width:100%', 'height:28px',
      'pointer-events:none', 'z-index:4',
      'border-radius:999px'
    ].join(';');

    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.appendChild(canvas);

    ctx = canvas.getContext('2d');
    _resize();
    g.addEventListener('resize', _resize);
  }

  function _resize() {
    if (!canvas) return;
    var bar = document.getElementById(BAR_ID);
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var newW = Math.round(rect.width) || 400;
    if (newW === W) return;   /* 尺寸未变，跳过（避免每帧重置 canvas 状态）*/
    W     = newW;
    H_BAR = 28;
    canvas.width  = W;
    canvas.height = H_BAR;
    canvas.style.width  = W + 'px';
    canvas.style.height = H_BAR + 'px';
  }

  /* ── 指针事件 ──────────────────────────────────────── */
  function _bindEvents() {
    var bar = document.getElementById(BAR_ID);
    if (!bar || bar._physicsProgressBound) return;
    bar._physicsProgressBound = true;

    /* ── pointerdown ── */
    bar.addEventListener('pointerdown', function (e) {
      /* 双击判断 */
      var now = Date.now();
      var ratio = _eventRatio(e);
      if (now - _lastClickTime < DBL_CLICK_MS && Math.abs(ratio - _lastClickPos) < 0.08) {
        _onDoubleClick(e, ratio);
      }
      _lastClickTime = now;
      _lastClickPos  = ratio;

      _dragging = true;
      _dragVelHistory = [];
      bar.classList.add('is-dragging');
      try { bar.setPointerCapture(e.pointerId); } catch(err) {}
      _onDrag(e);
    });

    /* ── pointermove ── */
    bar.addEventListener('pointermove', function (e) {
      if (!_dragging) return;
      _onDrag(e);
    });

    /* ── pointerup / pointercancel ── */
    function _endDrag(e) {
      if (!_dragging) return;
      _dragging = false;
      bar.classList.remove('is-dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch(err) {}
      _onRelease(e);
    }
    bar.addEventListener('pointerup',     _endDrag);
    bar.addEventListener('pointercancel', _endDrag);
    bar.addEventListener('lostpointercapture', function () {
      _dragging = false;
      bar.classList.remove('is-dragging');
    });
  }

  function _eventRatio(e) {
    var bar = document.getElementById(BAR_ID);
    if (!bar) return 0;
    var rect = bar.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
  }

  function _onDrag(e) {
    var ratio = _eventRatio(e);
    _bumpPos = ratio;
    _bumpTgt = BUMP_HEIGHT;

    /* 只更新视觉凸起位置，实际 seek 由 app.js 原有 pointerdown/pointermove 处理 */
    var now = performance.now();
    _dragVelHistory.push({ t: now, x: ratio });
    if (_dragVelHistory.length > 8) _dragVelHistory.shift();
  }

  function _onRelease(e) {
    _bumpTgt = 0;

    /* 计算松手瞬时水平速度（比例/秒） */
    var vel = 0;
    var h = _dragVelHistory;
    if (h.length >= 2) {
      var dt = (h[h.length-1].t - h[0].t) / 1000;
      if (dt > 0.01) vel = (h[h.length-1].x - h[0].x) / dt;
    }

    /* 若速度较大，给视觉位置施加惯性（超射后弹回） */
    var INERTIA_THRESH = 0.6; /* 比例/秒，超过则触发惯性 */
    if (Math.abs(vel) > INERTIA_THRESH) {
      _visVel += vel * 0.18;  /* 轻微超射 */
    }

    /* 添加弹跳驻波 */
    _waveAmp  = WAVE_AMP * 2.2;  /* 松手时波动增强 */
    _waveAmpV = 0;
  }

  function _onDoubleClick(e, ratio) {
    /* 双击：seek + 涟漪 + 大弹跳 */
    _doSeek(ratio);
    _bumpH   = BUMP_HEIGHT * 1.8;
    _bumpHV  = 0;
    _bumpTgt = 0;
    _addRipple(ratio);
    _waveAmp = WAVE_AMP * 3;
  }

  function _doSeek(ratio) {
    var aud = g.audio;
    if (!aud) return;
    var dur = aud.duration;
    if (!isFinite(dur) || dur <= 0) return;
    aud.currentTime = ratio * dur;
    if (typeof g.setProgressVisual === 'function') g.setProgressVisual(ratio * 100);
    if (typeof g.syncBeatMapPlaybackCursor === 'function') g.syncBeatMapPlaybackCursor(aud.currentTime);
  }

  function _addRipple(x) {
    _ripples.push({ x: x, age: 0, maxAge: 0.70 });
  }

  /* ── 物理更新 ──────────────────────────────────────── */
  function _update(dt) {
    dt = clamp(dt, 0.001, 0.08);
    _elapsed += dt;

    /* 读真实进度 */
    _visTgt = _getRealProgress();

    /* 拖拽时视觉直接跟随真实位置（已 seek） */
    if (_dragging) {
      _visPos = _visTgt;
      _visVel = 0;
    } else {
      /* 弹簧追踪目标 */
      var force = (_visTgt - _visPos) * SPRING_K - _visVel * DAMPING;
      _visVel += force * dt;
      _visPos  = clamp(_visPos + _visVel * dt, 0, 1);
    }

    /* 驻波幅度弹簧 */
    var waveTarget = _isPlaying() ? WAVE_AMP : WAVE_AMP * 0.25;
    var wForce = (waveTarget - _waveAmp) * 6 - _waveAmpV * 3.5;
    _waveAmpV += wForce * dt;
    _waveAmp   = Math.max(0, _waveAmp + _waveAmpV * dt);
    _wavePhase += WAVE_FREQ * 2 * Math.PI * dt;

    /* 凸起弹簧 */
    var bForce = (_bumpTgt - _bumpH) * 16 - _bumpHV * 5.5;
    _bumpHV += bForce * dt;
    _bumpH   = Math.max(0, _bumpH + _bumpHV * dt);

    /* 涟漪 */
    for (var i = _ripples.length - 1; i >= 0; i--) {
      _ripples[i].age += dt;
      if (_ripples[i].age >= _ripples[i].maxAge) _ripples.splice(i, 1);
    }
  }

  /* ── 绘制 ──────────────────────────────────────────── */
  function _draw() {
    if (!ctx || W < 4) return;
    ctx.clearRect(0, 0, W, H_BAR);

    var vc  = getColor();
    var mid = H_BAR / 2;

    /* ── 计算绳子点 ──────────────────────────────────── */
    var pts = [];
    for (var i = 0; i <= ROPE_SEGS; i++) {
      var t = i / ROPE_SEGS;  /* 0-1 归一化 */

      /* 驻波位移（在"已播放"段幅度稍大） */
      var inFill = t <= _visPos;
      var wEnv   = 1.0;  /* 端点处用 0，这里简化为全段均匀 */
      var wave   = _waveAmp * wEnv * Math.sin(_wavePhase * 2 + t * Math.PI * 3.0);

      /* 拖拽凸起（高斯形状） */
      var bump = _bumpH * gauss(t, _bumpPos, BUMP_SIGMA);

      var y = mid - wave - bump;
      pts.push({ x: t * W, y: y });
    }

    /* ── 画填充区（绳子下方色块）─────────────────────── */
    var fillEnd = Math.round(_visPos * W);
    if (fillEnd > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, mid + 3);
      for (var i = 0; i < pts.length; i++) {
        if (pts[i].x > fillEnd + 2) break;
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.lineTo(fillEnd, mid + 3);
      ctx.closePath();
      var fg = ctx.createLinearGradient(0, 0, fillEnd, 0);
      fg.addColorStop(0,   rgba(vc, 0.52));
      fg.addColorStop(0.7, rgba(vc, 0.72));
      fg.addColorStop(1,   rgba(vc, 0.90));
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.restore();
    }

    /* ── 画绳子本体 ──────────────────────────────────── */
    /* 未播放段：只从 fillEnd 对应点起画，避免与已播放段重叠产生重影 */
    ctx.save();
    ctx.beginPath();
    var fillPtIdx = (fillEnd > 1) ? Math.round(_visPos * ROPE_SEGS) : 0;
    fillPtIdx = Math.min(fillPtIdx, pts.length - 1);
    ctx.moveTo(pts[fillPtIdx].x, pts[fillPtIdx].y);
    for (var i = fillPtIdx + 1; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i+1].x) / 2;
      var my = (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    if (fillPtIdx < pts.length - 1) {
      ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = ROPE_THICK;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    /* 已播放段（亮） */
    if (fillEnd > 1) {
      ctx.save();
      ctx.beginPath();
      var clippedPts = pts.filter(function(p) { return p.x <= fillEnd + 2; });
      if (clippedPts.length >= 2) {
        ctx.moveTo(clippedPts[0].x, clippedPts[0].y);
        for (var i = 1; i < clippedPts.length - 1; i++) {
          var mx2 = (clippedPts[i].x + clippedPts[i+1].x) / 2;
          var my2 = (clippedPts[i].y + clippedPts[i+1].y) / 2;
          ctx.quadraticCurveTo(clippedPts[i].x, clippedPts[i].y, mx2, my2);
        }
        ctx.lineTo(clippedPts[clippedPts.length-1].x, clippedPts[clippedPts.length-1].y);
      }
      var sg = ctx.createLinearGradient(0, 0, fillEnd, 0);
      sg.addColorStop(0,   rgba(vc, 0.80));
      sg.addColorStop(0.6, rgba(vc, 1.00));
      sg.addColorStop(1,   rgba(vc, 1.00));
      ctx.strokeStyle = sg;
      ctx.lineWidth   = ROPE_THICK + 0.8;
      ctx.lineCap     = 'round';
      /* 无 shadowBlur——亮白线条本身已足够显眼，shadow 会产生光晕重影 */
      ctx.stroke();
      ctx.restore();
    }

    /* ── 播放头拇指球 ────────────────────────────────── */
    var thumbX = _visPos * W;
    /* 找对应 Y */
    var thumbPtIdx = Math.round(_visPos * ROPE_SEGS);
    var thumbY     = pts[Math.min(thumbPtIdx, pts.length-1)].y;

    ctx.save();
    var thumbR = _dragging ? 7 : 5.5;
    var tg = ctx.createRadialGradient(thumbX - thumbR*0.3, thumbY - thumbR*0.3, 0,
                                       thumbX, thumbY, thumbR);
    tg.addColorStop(0, '#fff');
    tg.addColorStop(0.35, rgba(vc, 1));
    tg.addColorStop(1, rgba(vc, 0.3));
    ctx.fillStyle   = tg;
    ctx.shadowColor = rgba(vc, 0.80);
    ctx.shadowBlur  = _dragging ? 14 : 8;
    ctx.beginPath(); ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    /* ── 涟漪 ────────────────────────────────────────── */
    for (var ri = 0; ri < _ripples.length; ri++) {
      var rp = _ripples[ri];
      var prog = rp.age / rp.maxAge;
      var rx   = rp.x * W;
      var ry   = mid;
      var maxR = W * 0.22 * (1 - prog * 0.5);
      ctx.save();
      ctx.beginPath();
      ctx.arc(rx, ry, prog * maxR, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(vc, (1 - prog) * 0.55);
      ctx.lineWidth   = 1.5 * (1 - prog);
      ctx.stroke();

      /* 二级涟漪 */
      ctx.beginPath();
      ctx.arc(rx, ry, prog * maxR * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(vc, (1 - prog) * 0.35);
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ── 主循环 ────────────────────────────────────────── */
  function _tick(ts) {
    _animId = requestAnimationFrame(_tick);
    if (_lastTs === null) _lastTs = ts;
    var dt = clamp((ts - _lastTs) / 1000, 0, 0.08);
    _lastTs = ts;
    _resize();  /* 轻量 resize 检测 */
    _update(dt);
    _draw();
  }

  /* ── 公开 API ──────────────────────────────────────── */
  var API = {
    init: function () {
      _initCanvas();
      _bindEvents();
      if (!_animId) {
        _lastTs = null;
        _animId = requestAnimationFrame(_tick);
      }
    },

    /** 外部通知：涟漪（如从 app.js seek 回调） */
    triggerRipple: function (ratio) {
      _addRipple(clamp(ratio || 0, 0, 1));
    },

    dispose: function () {
      if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
      var cv = document.getElementById(CANVAS_ID);
      if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
      /* 恢复原 fill/thumb 可见 */
      var fill  = document.getElementById(FILL_ID);
      var thumb = document.getElementById(THUMB_ID);
      if (fill)  fill.style.opacity  = '';
      if (thumb) thumb.style.opacity = '';
      canvas = null; ctx = null;
    }
  };

  g.PhysicsProgress = API;

  /* 自动初始化 */
  function _auto() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(API.init, 300); });
    } else {
      setTimeout(API.init, 300);
    }
  }
  _auto();

})(window);
