/**
 * particle-reactive-panel.js — 粒子反应控制台面板  v2.0
 *
 * 职责：
 *   1. 将 fx 存档中的 pb* 参数同步到 ParticleBehavior（含 Module B/C/D 新参数）
 *   2. 为粒子反应折叠面板中的每个滑块提供实时颜色 badge
 *   3. 负责预设选择器、微动画开关、过渡强度滑块的 DOM 绑定
 *
 * 新增 fx 键：
 *   pbPreset       — 'none'|'pulse'|'flow'|'shatter'|'glow'|'wave'
 *   pbMicro        — boolean  是否启用安静微动画
 *   pbTransStrength— number 0-2  段落过渡动画强度
 *
 * 依赖：
 *   window.ParticleBehavior  (particle-behavior.js)
 *   window.fx                (app.js 中的全局 fx 对象)
 *
 * 调用：
 *   ParticleReactivePanel.init(fx)   — app.js 完成 loadFx 后调用
 */
(function (g) {
  'use strict';

  /* ── fx key → ParticleBehavior params key 映射 ────────────── */
  var KEY_MAP = {
    pbMaster : 'master',
    pbKick   : 'kick',
    pbBreath : 'breath',
    pbBass   : 'bass',
    pbHiHat  : 'hihat',
    pbVocal  : 'vocal',
    pbChorus : 'chorus',
    pbDrop   : 'drop',
    pbSnare  : 'snare',
  };

  /* ── 从 fx 对象读取全部 pb* 参数并推送到 ParticleBehavior ─── */
  function syncFromFx(fx) {
    if (!g.ParticleBehavior || !fx) return;
    var p = {
      enabled      : !!fx.pbEnabled,
      adapt        : fx.pbAdapt !== false,
      preset       : fx.pbPreset       || 'none',
      microEnabled : fx.pbMicro        !== false,   // 默认开启
      transStrength: (fx.pbTransStrength != null)
                      ? parseFloat(fx.pbTransStrength) : 1.0,
    };
    Object.keys(KEY_MAP).forEach(function (k) {
      if (fx[k] != null) p[KEY_MAP[k]] = parseFloat(fx[k]) || 1.0;
    });
    g.ParticleBehavior.setParams(p);

    // 同步现有开关 DOM
    var toggle = document.getElementById('t-pbEnabled');
    if (toggle) toggle.classList.toggle('on', !!fx.pbEnabled);
    var adaptToggle = document.getElementById('t-pbAdapt');
    if (adaptToggle) adaptToggle.classList.toggle('on', fx.pbAdapt !== false);
    var microToggle = document.getElementById('t-pbMicro');
    if (microToggle) microToggle.classList.toggle('on', fx.pbMicro !== false);

    // 同步预设按钮高亮
    _highlightPreset(fx.pbPreset || 'none');

    // 同步过渡强度滑块
    var tsInput = document.getElementById('fx-pb-trans-strength');
    if (tsInput) tsInput.value = String(p.transStrength);
    var tsOut = tsInput && tsInput.parentElement && tsInput.parentElement.querySelector('output');
    if (tsOut) tsOut.value = p.transStrength.toFixed(2);
  }

  /* ── 预设按钮高亮 ──────────────────────────────────────────── */
  function _highlightPreset(name) {
    var btns = document.querySelectorAll('[data-pb-preset]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.pbPreset === name);
    }
  }

  /* ── 注入预设按钮 HTML 到 DOM ─────────────────────────────── */
  function _injectPresetUI() {
    // 找到"副歌 / Drop"分组，在其下方插入新 UI
    var dropSlider = document.getElementById('fx-pb-drop');
    if (!dropSlider) return;
    var fold = dropSlider.closest('.fx-fold-body');
    if (!fold) return;

    // 若已注入则跳过
    if (document.getElementById('pb-preset-section')) return;

    var presetHtml = [
      '<div id="pb-preset-section">',

      /* ── 预设选择器 ── */
      '<div class="fx-section-label">节奏预设 <small style="opacity:.55;font-size:10px">根据音乐风格一键调整</small></div>',
      '<div class="pb-preset-grid" style="',
        'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;',
        'margin:4px 0 8px;',
      '">',
        _presetBtn('none',    '无预设', '不使用预设，维持手动参数'),
        _presetBtn('pulse',   'Pulse',  'EDM / 电子舞曲：强劲 Kick + Bass'),
        _presetBtn('flow',    'Flow',   '古典 / 环境音乐：柔和呼吸主导'),
        _presetBtn('shatter', 'Shatter','摇滚 / 金属：Snare 冲击主导'),
        _presetBtn('glow',    'Glow',   'Lo-Fi / 慢摇：低能微光氛围'),
        _presetBtn('wave',    'Wave',   '流行 / R&B：均衡节奏律动'),
      '</div>',

      /* ── 微动画开关 ── */
      '<div class="fx-toggle-grid" style="margin-bottom:6px">',
        '<div class="fx-toggle on" id="t-pbMicro"',
          ' onclick="toggleFx(\'pbMicro\')"',
          ' title="安静段落时播放量子闪烁/呼吸漂移/星尘等微动画">',
          '<span>安静微动画</span><span class="dot"></span>',
        '</div>',
      '</div>',

      /* ── 过渡强度滑块 ── */
      '<div class="fx-slider">',
        '<label>段落过渡强度</label>',
        '<input id="fx-pb-trans-strength" type="range" min="0" max="2" step="0.01" value="1">',
        '<output>1.00</output>',
      '</div>',

      '</div>', // #pb-preset-section
    ].join('');

    // 追加到 fold body 末尾
    fold.insertAdjacentHTML('beforeend', presetHtml);

    // 绑定预设按钮点击
    var btns = document.querySelectorAll('[data-pb-preset]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.dataset.pbPreset;
          _highlightPreset(name);
          if (g.ParticleBehavior) g.ParticleBehavior.setParams({ preset: name });
          if (g.fx) {
            g.fx.pbPreset = name;
            if (g.saveLyricLayout) g.saveLyricLayout();
          }
        });
      })(btns[i]);
    }

    // 绑定过渡强度滑块
    var tsInput = document.getElementById('fx-pb-trans-strength');
    if (tsInput) {
      tsInput.addEventListener('input', function () {
        var v = parseFloat(tsInput.value);
        var out = tsInput.parentElement.querySelector('output');
        if (out) out.value = v.toFixed(2);
        if (g.ParticleBehavior) g.ParticleBehavior.setParams({ transStrength: v });
        if (g.fx) {
          g.fx.pbTransStrength = v;
          if (g.saveLyricLayout) g.saveLyricLayout();
        }
      });
    }
  }

  /* ── 生成单个预设按钮 HTML ─────────────────────────────────── */
  function _presetBtn(name, label, title) {
    return [
      '<button data-pb-preset="' + name + '"',
        ' title="' + title + '"',
        ' style="',
          'padding:5px 2px;font-size:10px;border-radius:5px;',
          'border:1px solid rgba(255,255,255,0.12);',
          'background:rgba(255,255,255,0.06);',
          'color:rgba(255,255,255,0.65);cursor:pointer;',
          'transition:background .15s,color .15s,border-color .15s;',
        '">',
        label,
      '</button>',
    ].join('');
  }

  /* ── 为所有 slider 加颜色 badge ────────────────────────────── */
  function decorateSliders() {
    var sliderIds = [
      'fx-pb-master','fx-pb-kick','fx-pb-breath',
      'fx-pb-bass','fx-pb-hihat','fx-pb-vocal',
      'fx-pb-chorus','fx-pb-drop','fx-pb-snare',
      'fx-pb-trans-strength',
    ];
    sliderIds.forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      var out = input.parentElement && input.parentElement.querySelector('output');
      if (!out) return;
      function updateColor() {
        var v = parseFloat(input.value);
        if (v <= 0.02) {
          out.style.color = 'rgba(255,80,80,0.72)';
        } else if (v < 0.85) {
          out.style.color = 'rgba(244,180,80,0.80)';
        } else if (v > 1.45) {
          out.style.color = 'rgba(100,220,200,0.90)';
        } else {
          out.style.color = '';
        }
      }
      input.addEventListener('input', updateColor);
      updateColor();
    });

    /* 预设按钮悬停样式（纯 CSS 无法覆盖 active 状态，用 JS 加） */
    var style = document.createElement('style');
    style.textContent = [
      '[data-pb-preset]:hover{',
        'background:rgba(255,255,255,0.12)!important;',
        'color:rgba(255,255,255,0.9)!important;',
      '}',
      '[data-pb-preset].active{',
        'background:rgba(130,180,255,0.22)!important;',
        'border-color:rgba(130,180,255,0.55)!important;',
        'color:rgba(180,210,255,1)!important;',
        'font-weight:600;',
      '}',
    ].join('');
    document.head.appendChild(style);
  }

  /* ── 公开 init ──────────────────────────────────────────────── */
  function init(fx) {
    // 注入 UI（稍延迟等 organizeFxPanel 整理完 DOM）
    setTimeout(function () {
      _injectPresetUI();
      syncFromFx(fx);
      decorateSliders();
    }, 150);
  }

  g.ParticleReactivePanel = { init: init, syncFromFx: syncFromFx };

})(window);
