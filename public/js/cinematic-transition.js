/**
 * cinematic-transition.js — 电影转场系统  v1.2
 *
 * 切歌时提供视觉转场动画。
 * 纯 JS 驱动 overlay，不依赖 CSS transition。
 *
 * 转场类型：
 *   lightLeak  — 暖色光晕扩散
 *   whipPan    — 画面快速横扫
 *   irisWipe   — 圆形遮罩收缩
 *   flashCut   — 闪白
 *
 * 状态机：WIND_DOWN → OVERLAY → REVEAL → IDLE
 */
(function (g) {
  'use strict';

  var phase = 'IDLE';
  var timer = 0;
  var currentType = 'lightLeak';
  var windDownDone = false;

  var DUR = { WIND_DOWN: 0.35, OVERLAY: 0.30, REVEAL: 0.45 };

  var overlayEl = null;

  function getOverlay() {
    if (overlayEl && overlayEl.parentNode) return overlayEl;
    overlayEl = document.getElementById('ct-overlay');
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'ct-overlay';
      document.body.appendChild(overlayEl);
    }
    return overlayEl;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function trigger(type) {
    if (phase !== 'IDLE') return;
    currentType = type || 'lightLeak';
    phase = 'WIND_DOWN';
    timer = 0;
    windDownDone = false;
    getOverlay();
  }

  function tick(dt) {
    if (phase === 'IDLE') return;
    dt = Math.max(0.001, Math.min(0.1, dt || 0.016));
    timer += dt;

    var el = overlayEl;
    if (!el) { phase = 'IDLE'; return; }

    switch (phase) {
      case 'WIND_DOWN': {
        var t = clamp01(timer / DUR.WIND_DOWN);
        var uni = g.uniforms;
        if (uni && uni.uAlpha) uni.uAlpha.value = 1.0 - t;
        if (!windDownDone && t > 0.2) {
          windDownDone = true;
          if (uni && uni.uBurstAmt) uni.uBurstAmt.value = Math.min(1.0, (uni.uBurstAmt.value || 0) + 0.4);
          if (uni && uni.uBloomStrength) uni.uBloomStrength.value = Math.min(2.4, (uni.uBloomStrength.value || 0) + 0.6);
        }
        if (timer >= DUR.WIND_DOWN) { phase = 'OVERLAY'; timer = 0; }
        break;
      }

      case 'OVERLAY': {
        /* overlay 淡入：0→0.3s 内 opacity 0→1 */
        var tIn = clamp01(timer / DUR.OVERLAY);
        applyOverlay(el, tIn, 1);
        if (timer >= DUR.OVERLAY) { phase = 'REVEAL'; timer = 0; }
        break;
      }

      case 'REVEAL': {
        /* overlay 淡出：0→0.45s 内 opacity 1→0 */
        var tOut = clamp01(timer / DUR.REVEAL);
        applyOverlay(el, 1 - tOut, 0);
        var uni = g.uniforms;
        var ease = tOut * tOut * (3 - 2 * tOut);
        if (uni && uni.uAlpha) uni.uAlpha.value = ease;
        if (uni && uni.uBurstAmt) uni.uBurstAmt.value = Math.max(0, (uni.uBurstAmt.value || 0) - dt * 3);
        if (timer >= DUR.REVEAL) finish();
        break;
      }
    }
  }

  /**
   * 纯 JS 驱动 overlay 样式，不依赖 CSS transition
   * progress: 0=起始态  1=结束态
   */
  function applyOverlay(el, progress, targetOpacity) {
    /* 先确保基础类正确 */
    el.className = 'ct-overlay ct-' + currentType;
    el.style.pointerEvents = 'none';
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '350';

    switch (currentType) {
      case 'lightLeak':
        el.style.opacity = String(clamp01(targetOpacity * progress));
        el.style.background = 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(255,200,100,' + (0.80 * clamp01(targetOpacity * progress)) + ') 0%, rgba(255,120,60,' + (0.50 * clamp01(targetOpacity * progress)) + ') 30%, rgba(180,80,40,' + (0.25 * clamp01(targetOpacity * progress)) + ') 55%, transparent 80%)';
        el.style.mixBlendMode = 'screen';
        el.style.transform = '';
        el.style.clipPath = '';
        break;

      case 'whipPan':
        el.style.opacity = '1';
        el.style.background = 'rgba(0,0,0,0.94)';
        el.style.mixBlendMode = '';
        el.style.clipPath = '';
        if (targetOpacity > 0.5) {
          /* 滑入：从左到中 */
          el.style.transform = 'translateX(' + (-100 + progress * 100) + '%)';
        } else {
          /* 滑出：从中到右 */
          el.style.transform = 'translateX(' + (progress * 100) + '%)';
        }
        break;

      case 'irisWipe':
        el.style.opacity = '1';
        el.style.background = '#000';
        el.style.mixBlendMode = '';
        el.style.transform = '';
        if (targetOpacity > 0.5) {
          /* 收缩展开 */
          el.style.clipPath = 'circle(' + (progress * 80) + '% at 50% 50%)';
        } else {
          /* 收回 */
          el.style.clipPath = 'circle(' + ((1 - progress) * 80) + '% at 50% 50%)';
        }
        break;

      case 'flashCut':
        el.style.opacity = String(clamp01(targetOpacity * progress));
        el.style.background = 'rgba(255,255,255,0.98)';
        el.style.mixBlendMode = '';
        el.style.transform = '';
        el.style.clipPath = '';
        break;
    }
  }

  function finish() {
    phase = 'IDLE';
    timer = 0;
    windDownDone = false;
    if (overlayEl) {
      overlayEl.className = 'ct-overlay';
      overlayEl.style.cssText = '';
    }
    var uni = g.uniforms;
    if (uni && uni.uAlpha) uni.uAlpha.value = 1.0;
  }

  g.CinematicTransition = {
    trigger: trigger,
    tick: tick,
    isActive: function() { return phase !== 'IDLE'; },
    reset: function() {
      phase = 'IDLE'; timer = 0; windDownDone = false;
      if (overlayEl) { overlayEl.className = 'ct-overlay'; overlayEl.style.cssText = ''; }
      var uni = g.uniforms;
      if (uni && uni.uAlpha) uni.uAlpha.value = 1.0;
    }
  };

})(window);
