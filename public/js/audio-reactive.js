/**
 * audio-reactive.js  —  音频实时分析模块  v2.0
 *
 * 职责：在 app.js 现有粗粒度分析之上提供精细音频特征。
 *
 * 写入 window.uniforms：
 *   uKick  — 鼓点脉冲   0-1 (50-165 Hz 上升沿)
 *   uDrop  — 副歌强度   0-1 (短期能量超出基线 + bass + flux)
 *   uSnare — 军鼓脉冲   0-1 (通过 state.snare 暴露，由 particle-behavior 写入)
 *
 * state 快照 (AudioReactive.state)：
 *   kick / drop / rms / bass / flux / snare / isChorus   ← 原有
 *   section      — 'intro'|'verse'|'preChorus'|'chorus'|'bridge'|'outro'
 *   sectionConf  — 置信度 0-1
 *   barPhase     — 小节相位 0-1（4 拍）
 *   beatPhase    — 拍相位 0-1
 *   bpm          — 估算 BPM
 *   dynamicRange — 30s 最大/最小 RMS 对比度 0-1
 *   silence      — 静音程度 0-1
 *
 * API：
 *   AudioReactive.tick(dt)   每帧调用
 *   AudioReactive.reset()    切歌时重置
 *   AudioReactive.state      只读快照
 *   AudioReactive.debug      调试数据
 */
(function (g) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
   *  内部缓冲区
   * ════════════════════════════════════════════════════════════ */
  var _binCount = 0;
  var _freqBuf  = null;
  var _timeBuf  = null;
  var _prevFreq = null;

  /* ══════════════════════════════════════════════════════════════
   *  Kick 检测
   * ════════════════════════════════════════════════════════════ */
  var kickFast  = 0;
  var kickSlow  = 0;
  var kickPeak  = 0.06;
  var kickPulse = 0;

  /* ══════════════════════════════════════════════════════════════
   *  Snare 检测
   * ════════════════════════════════════════════════════════════ */
  var snareFast  = 0;
  var snareSlow  = 0;
  var snarePeak  = 0.06;
  var snarePulse = 0;

  /* ══════════════════════════════════════════════════════════════
   *  Drop / Chorus 检测
   * ════════════════════════════════════════════════════════════ */
  var longEnergy  = 0.10;
  var midEnergy   = 0.10;
  var shortEnergy = 0.10;
  var dropScore   = 0;
  var dropLevel   = 0;

  /* ══════════════════════════════════════════════════════════════
   *  辅助平滑
   * ════════════════════════════════════════════════════════════ */
  var rmsSmooth  = 0;
  var bassSmooth = 0;
  var fluxSmooth = 0;

  /* ══════════════════════════════════════════════════════════════
   *  Module A — BPM + Beat/Bar 相位追踪
   * ════════════════════════════════════════════════════════════ */
  var _bpmEstimate    = 120;      // 当前 BPM 估算
  var _bpmKickTimes   = [];       // 最近 kick 时间戳（用于 BPM 估算）
  var _globalTime     = 0;        // 自 reset 起累计时间
  var _prevKickForBpm = 0;        // 上帧 kickPulse，用于上升沿检测

  // 拍/小节相位
  var _beatPhase      = 0;        // 当前拍内相位 0-1
  var _barBeatCount   = 0;        // 当前小节内拍计数 0-3
  var _barPhase       = 0;        // 小节相位 0-1（4拍一循环）
  var _lastKickTime   = -99;      // 上次 kick 时间，用于相位同步
  var _beatDuration   = 0.5;      // 当前一拍时长（秒），由 BPM 派生

  /* ══════════════════════════════════════════════════════════════
   *  Module A — 能量滑窗（段落感知）
   *
   *  _energyWindow  ：10s 循环缓冲，每 200ms 存一次 rmsSmooth
   *                   共 50 格，用于计算均值/趋势/加速度
   *  _dynWindow     ：30s 循环缓冲，每 600ms 存一次 rmsSmooth
   *                   共 50 格，用于 dynamicRange
   * ════════════════════════════════════════════════════════════ */
  var ENERGY_WIN_SIZE = 50;   // 10s @ 200ms interval
  var DYN_WIN_SIZE    = 50;   // 30s @ 600ms interval
  var _energyBuf      = new Float32Array(ENERGY_WIN_SIZE);
  var _energyWinHead  = 0;
  var _energyWinFill  = 0;    // 已填充格数（< SIZE 时为初始阶段）
  var _energyTimer    = 0;    // 距上次采样经过的时间
  var ENERGY_INTERVAL = 0.20; // 200ms 采一次

  var _dynBuf         = new Float32Array(DYN_WIN_SIZE);
  var _dynHead        = 0;
  var _dynFill        = 0;
  var _dynTimer       = 0;
  var DYN_INTERVAL    = 0.60; // 600ms 采一次

  // 衍生特征（帧间平滑）
  var _energySlope    = 0;    // 10s 窗口内能量斜率（正=上升段，负=下降段）
  var _energyAccel    = 0;    // 斜率的变化率（加速/减速）
  var _dynamicRange   = 0;    // 30s 动态范围 0-1
  var _silenceLevel   = 0;    // 静音程度 0-1

  /* ══════════════════════════════════════════════════════════════
   *  Module A — 段落状态机
   * ════════════════════════════════════════════════════════════ */
  var _section        = 'intro';
  var _sectionConf    = 0.5;
  var _sectionHold    = 0;    // 当前段落已持续时间（秒）
  var _sectionTimer   = 0;    // 段落检测节流定时器
  var SECTION_DETECT_INTERVAL = 0.5;   // 每 500ms 跑一次段落检测
  var SECTION_MIN_HOLD        = 3.0;   // 段落最短停留 3s，防止抖动
  var _prevSection    = 'intro';       // 上一段落，供 particle-behavior 检测过渡
  var _sectionListeners = [];          // 段落切换事件订阅者

  /* ══════════════════════════════════════════════════════════════
   *  公开状态快照
   * ════════════════════════════════════════════════════════════ */
  var state = {
    kick: 0, drop: 0, rms: 0, bass: 0, flux: 0, snare: 0, isChorus: false,
    // Module A 新增
    section:      'intro',
    sectionConf:  0.5,
    barPhase:     0,
    beatPhase:    0,
    bpm:          120,
    dynamicRange: 0,
    silence:      0,
  };

  var debug = {
    kickFast: 0, kickSlow: 0, kickPeak: 0, kickRise: 0,
    snareFast: 0, snareSlow: 0, snareRise: 0,
    energyExcess: 0, bassProminence: 0, fluxBoost: 0,
    longEnergy: 0, shortEnergy: 0, dropScore: 0,
    // Module A
    bpm: 120, beatPhase: 0, barPhase: 0,
    energySlope: 0, energyAccel: 0, dynamicRange: 0,
    section: 'intro', sectionConf: 0.5,
  };

  /* ══════════════════════════════════════════════════════════════
   *  工具函数
   * ════════════════════════════════════════════════════════════ */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function follow(cur, target, attackTau, releaseTau, dt) {
    var tau = target > cur ? attackTau : releaseTau;
    return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
  }

  function bandRms(buf, sr, fftSz, fLow, fHigh) {
    var binW = sr / fftSz;
    var lo   = Math.max(0,             Math.floor(fLow  / binW));
    var hi   = Math.min(buf.length - 1, Math.ceil(fHigh / binW));
    if (hi <= lo) return 0;
    var sum = 0;
    for (var i = lo; i <= hi; i++) sum += buf[i] / 255;
    return sum / (hi - lo + 1);
  }

  function ensureBuffers(an) {
    var bins = an.frequencyBinCount;
    if (_binCount !== bins) {
      _binCount = bins;
      _freqBuf  = new Uint8Array(bins);
      _timeBuf  = new Uint8Array(an.fftSize);
      _prevFreq = new Uint8Array(bins);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  Module A — BPM 估算 + Beat/Bar 相位更新
   * ════════════════════════════════════════════════════════════ */
  function _updateBpm(kickVal, dt) {
    var threshold = 0.42;
    if (kickVal > threshold && _prevKickForBpm <= threshold) {
      // kick 上升沿
      _bpmKickTimes.push(_globalTime);
      if (_bpmKickTimes.length > 8) _bpmKickTimes.shift();

      if (_bpmKickTimes.length >= 3) {
        var intervals = [];
        for (var i = 1; i < _bpmKickTimes.length; i++) {
          var gap = _bpmKickTimes[i] - _bpmKickTimes[i - 1];
          if (gap > 0.20 && gap < 2.2) intervals.push(gap);
        }
        if (intervals.length >= 2) {
          var sum = 0;
          for (var j = 0; j < intervals.length; j++) sum += intervals[j];
          var avg = sum / intervals.length;
          var newBpm = 60 / avg;
          _bpmEstimate = follow(_bpmEstimate, clamp(newBpm, 40, 200), 1.5, 5.0, dt);
          _beatDuration = 60 / _bpmEstimate;
        }
      }

      // 拍同步：kick 时重置拍相位，累计小节拍数
      var timeSinceLast = _globalTime - _lastKickTime;
      if (timeSinceLast > _beatDuration * 0.5 && timeSinceLast < _beatDuration * 2.2) {
        // 在预期拍窗口内 → 正常计拍
        _barBeatCount = (_barBeatCount + 1) % 4;
      } else if (timeSinceLast > _beatDuration * 2.2) {
        // 间隔太长，可能是停顿/切段 → 重置到拍1
        _barBeatCount = 0;
      }
      _beatPhase    = 0;
      _lastKickTime = _globalTime;
    }
    _prevKickForBpm = kickVal;

    // 按 BPM 推进拍相位
    _beatDuration = 60.0 / Math.max(40, _bpmEstimate);
    _beatPhase += dt / _beatDuration;
    if (_beatPhase >= 1.0) {
      _beatPhase -= 1.0;
      if (_lastKickTime < _globalTime - _beatDuration * 1.8) {
        // 长时间没有 kick → 靠 BPM 自动计拍
        _barBeatCount = (_barBeatCount + 1) % 4;
      }
    }
    _barPhase = (_barBeatCount + _beatPhase) / 4.0;
  }

  /* ══════════════════════════════════════════════════════════════
   *  Module A — 能量滑窗采样
   * ════════════════════════════════════════════════════════════ */
  function _sampleEnergyWindows(dt) {
    // 10s 窗口
    _energyTimer += dt;
    if (_energyTimer >= ENERGY_INTERVAL) {
      _energyTimer -= ENERGY_INTERVAL;
      _energyBuf[_energyWinHead] = rmsSmooth;
      _energyWinHead = (_energyWinHead + 1) % ENERGY_WIN_SIZE;
      if (_energyWinFill < ENERGY_WIN_SIZE) _energyWinFill++;
      _calcWindowRaw(); // 新样本写入后立即更新原始目标值
    }

    // 30s 窗口
    _dynTimer += dt;
    if (_dynTimer >= DYN_INTERVAL) {
      _dynTimer -= DYN_INTERVAL;
      _dynBuf[_dynHead] = rmsSmooth;
      _dynHead = (_dynHead + 1) % DYN_WIN_SIZE;
      if (_dynFill < DYN_WIN_SIZE) _dynFill++;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  Module A — 从能量窗口计算衍生特征
   * ════════════════════════════════════════════════════════════ */
  // 原始目标值（由窗口采样时刻更新）
  var _rawSlopeTarget    = 0;
  var _rawDynRangeTarget = 0;

  /** 纯计算：从能量窗口提取原始特征目标值（每 200ms 采样时调用一次）*/
  function _calcWindowRaw() {
    var n = _energyWinFill;
    if (n < 6) return;

    // 前1/3 均值 vs 后1/3 均值 → 斜率
    var third = Math.max(2, Math.floor(n / 3));
    var sumEarly = 0, sumLate = 0;
    var start = (_energyWinHead - n + ENERGY_WIN_SIZE) % ENERGY_WIN_SIZE;
    for (var i = 0; i < third; i++) {
      var idxE = (start + i)          % ENERGY_WIN_SIZE;
      var idxL = (start + n - 1 - i) % ENERGY_WIN_SIZE;
      sumEarly += _energyBuf[idxE];
      sumLate  += _energyBuf[idxL];
    }
    var earlyMean = sumEarly / third;
    var lateMean  = sumLate  / third;
    var baseline  = Math.max(0.01, (earlyMean + lateMean) * 0.5);
    _rawSlopeTarget = clamp((lateMean - earlyMean) / baseline, -2, 2);

    // 动态范围：30s 窗口最大值/最小值
    if (_dynFill >= 4) {
      var mn = 1, mx = 0;
      var ds = (_dynHead - _dynFill + DYN_WIN_SIZE) % DYN_WIN_SIZE;
      for (var d = 0; d < _dynFill; d++) {
        var v = _dynBuf[(ds + d) % DYN_WIN_SIZE];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      mn = Math.max(mn, mx * 0.01);
      var ratio = mx / mn;
      _rawDynRangeTarget = clamp01((ratio - 1.0) / 9.0);
    }
  }

  /** 每帧平滑更新衍生特征（传入真实 dt）*/
  function _smoothWindowFeatures(dt) {
    var prevSlope  = _energySlope;
    _energySlope   = follow(_energySlope,  _rawSlopeTarget,    0.5, 0.8, dt);
    _energyAccel   = follow(_energyAccel,  _energySlope - prevSlope, 0.3, 0.5, dt);
    _dynamicRange  = follow(_dynamicRange, _rawDynRangeTarget, 0.5, 1.5, dt);

    // 静音程度：每帧实时计算，不依赖窗口
    var silenceTarget = (rmsSmooth > 0.015) ? 0
      : clamp01(1.0 - rmsSmooth / Math.max(0.008, longEnergy * 0.8));
    _silenceLevel  = follow(_silenceLevel, silenceTarget, 0.3, 1.5, dt);
  }

  /* ══════════════════════════════════════════════════════════════
   *  Module A — 段落分类器
   *
   *  特征向量（每 500ms 运算一次）：
   *    ① energyRatio = shortEnergy / longEnergy  （即时 vs 长期均值）
   *    ② dropLevel   = uDrop 输出（副歌检测器信号）
   *    ③ bassRatio   = bassSmooth / rmsSmooth     （bass 占比）
   *    ④ energySlope                              （10s 能量趋势）
   *    ⑤ trackPos    = currentTime / duration     （歌曲相对位置）
   *
   *  各段落标型：
   *    intro     位置早(<20%)、能量低-中、斜率上升
   *    verse     中等能量、bass 中等、相对平稳
   *    preChorus 能量上升明显（slope>0.3）、bass 增加
   *    chorus    高能、高drop、高bass
   *    bridge    能量下降（slope<-0.2）、中段后(>45%)
   *    outro     位置晚(>80%)、能量下降
   * ════════════════════════════════════════════════════════════ */
  function _detectSection() {
    var aud = g.audio;
    var dur = (aud && aud.duration > 0) ? aud.duration : 300;
    var pos = (aud && aud.currentTime > 0) ? (aud.currentTime / dur) : 0;

    var eRatio  = clamp01(shortEnergy / Math.max(0.015, longEnergy));
    var bRatio  = clamp01(bassSmooth  / Math.max(0.01,  rmsSmooth));
    var slope   = _energySlope;
    var drop    = dropLevel;

    // 各段落得分（0-1，越高越匹配）
    var scores = {};

    // intro：位置 < 22%，能量比 < 1.2，斜率正向
    scores.intro = (
      (pos < 0.22 ? 1.0 : Math.max(0, 1 - (pos - 0.22) / 0.08)) *
      (eRatio < 1.15 ? 1.0 : Math.max(0, 1 - (eRatio - 1.15) / 0.5)) *
      (slope > -0.1 ? 1.0 : 0.4)
    );

    // outro：位置 > 80%，能量下降
    scores.outro = (
      (pos > 0.80 ? 1.0 : Math.max(0, (pos - 0.72) / 0.08)) *
      (slope < 0  ? 0.85 + Math.min(0.15, -slope * 0.3) : 0.35)
    );

    // chorus：高drop(>0.35) + 高能 + 高bass
    scores.chorus = (
      clamp01(drop / 0.40) *
      clamp01((eRatio - 1.0) / 0.5) *
      clamp01((bRatio - 0.3) / 0.35)
    );

    // preChorus：斜率陡升(>0.25)，drop 中等偏低，位置中段
    scores.preChorus = (
      clamp01((slope - 0.20) / 0.30) *
      clamp01(1 - drop / 0.50) *   // 还没到真副歌
      (pos > 0.12 && pos < 0.88 ? 1.0 : 0.3)
    );

    // bridge：能量降（slope<-0.15），drop<0.35，位置中后段
    scores.bridge = (
      clamp01((-slope - 0.10) / 0.30) *
      clamp01(1 - drop / 0.45) *
      (pos > 0.40 && pos < 0.85 ? 1.0 : 0.2)
    );

    // verse：兜底 — 扣掉其余段落的最高分后的剩余
    scores.verse = clamp01(
      0.55 -
      Math.max(scores.chorus, scores.preChorus, scores.bridge) * 0.7
    );
    // 位置很早(< 0.10) 时 verse 更难
    if (pos < 0.10) scores.verse *= 0.3;

    // 找最高分段落
    var best = 'verse', bestScore = 0, second = 0;
    var SECTIONS = ['intro','verse','preChorus','chorus','bridge','outro'];
    for (var si = 0; si < SECTIONS.length; si++) {
      var s = SECTIONS[si];
      if (scores[s] > bestScore) {
        second    = bestScore;
        bestScore = scores[s];
        best      = s;
      } else if (scores[s] > second) {
        second = scores[s];
      }
    }

    // 置信度：赢家领先第二名的比例
    var conf = (bestScore + second > 0.01)
      ? clamp01((bestScore - second) / (bestScore + second))
      : 0.5;

    // ── 迟滞：只有新赢家置信度 > 0.32 且超出当前段落分 15% 才切换 ──
    var curScore = scores[_section] || 0;
    var doSwitch = (_sectionHold >= SECTION_MIN_HOLD) &&
                   (conf > 0.32) &&
                   (bestScore > curScore + 0.15);

    if (best !== _section && doSwitch) {
      var _fromSec = _section;
      _prevSection  = _fromSec;
      _section      = best;
      _sectionHold  = 0;
      _sectionConf  = conf;
      // 派发段落切换事件（修复原 _prevSection 被立即清零导致外部拿不到信号的问题）
      for (var _si = 0; _si < _sectionListeners.length; _si++) {
        try { _sectionListeners[_si](_fromSec, best, conf); } catch (_se) {}
      }
    } else {
      // 持续强化置信度
      if (best === _section) {
        _sectionConf = follow(_sectionConf, conf, 0.5, 1.0, 0.5);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  写入 uniforms
   * ════════════════════════════════════════════════════════════ */
  function _writeUniforms(uni) {
    if (!uni) return;
    if (uni.uKick)  uni.uKick.value  = kickPulse;
    if (uni.uDrop)  uni.uDrop.value  = dropLevel;
  }

  function _updateState() {
    state.kick        = kickPulse;
    state.drop        = dropLevel;
    state.rms         = rmsSmooth;
    state.bass        = bassSmooth;
    state.flux        = fluxSmooth;
    state.snare       = snarePulse;
    state.isChorus    = dropLevel > 0.35;
    // Module A
    state.section     = _section;
    state.sectionConf = _sectionConf;
    state.barPhase    = _barPhase;
    state.beatPhase   = _beatPhase;
    state.bpm         = Math.round(_bpmEstimate);
    state.dynamicRange= _dynamicRange;
    state.silence     = _silenceLevel;
    // 供 particle-behavior 检测过渡
    state._prevSection = _prevSection;
  }

  /* ══════════════════════════════════════════════════════════════
   *  主 tick
   * ════════════════════════════════════════════════════════════ */
  function tick(dt) {
    dt = Math.max(0.001, Math.min(0.08, dt || 0.016));
    _globalTime += dt;

    var an  = g.analyser;
    var aud = g.audio;
    var uni = g.uniforms;

    /* 静音 / 暂停 */
    if (!an || !aud || aud.paused || !uni) {
      kickPulse  *= Math.pow(0.10, dt);
      snarePulse *= Math.pow(0.05, dt);
      dropLevel  += (0 - dropLevel) * Math.min(1, dt / 2.0);
      // 暂停时相位仍按 BPM 推进
      _beatPhase += dt / Math.max(0.25, _beatDuration);
      if (_beatPhase >= 1.0) { _beatPhase -= 1.0; _barBeatCount = (_barBeatCount + 1) % 4; }
      _barPhase = (_barBeatCount + _beatPhase) / 4.0;
      // 静音时段落强化
      _silenceLevel = follow(_silenceLevel, 1.0, 0.3, 2.0, dt);
      _writeUniforms(uni);
      _updateState();
      return;
    }

    ensureBuffers(an);
    an.getByteFrequencyData(_freqBuf);
    an.getByteTimeDomainData(_timeBuf);

    var sr    = (g.audioCtx && g.audioCtx.sampleRate) || 44100;
    var fftSz = an.fftSize;

    /* 1. RMS */
    var rmsRaw = 0;
    for (var j = 0; j < _timeBuf.length; j++) {
      var tv = (_timeBuf[j] - 128) / 128;
      rmsRaw += tv * tv;
    }
    rmsRaw = Math.sqrt(rmsRaw / _timeBuf.length);

    /* 2. 频段 RMS */
    var subBand   = bandRms(_freqBuf, sr, fftSz,  30,   55);
    var kickBand  = bandRms(_freqBuf, sr, fftSz,  55,  165);
    var bassBand  = bandRms(_freqBuf, sr, fftSz,  55,  300);
    var snareBand = bandRms(_freqBuf, sr, fftSz, 800, 4000);

    /* 3. 频谱流量 */
    var flux = 0;
    for (var i = 0; i < _binCount; i++) {
      var diff = (_freqBuf[i] - _prevFreq[i]) / 255;
      if (diff > 0) flux += diff;
    }
    flux /= _binCount;
    _prevFreq.set(_freqBuf);

    /* 4. 平滑 */
    rmsSmooth  = follow(rmsSmooth,  rmsRaw,   0.05,  0.25, dt);
    bassSmooth = follow(bassSmooth, bassBand, 0.04,  0.20, dt);
    fluxSmooth = follow(fluxSmooth, flux,     0.04,  0.30, dt);

    /* 5. Kick */
    var kickInput = kickBand + subBand * 0.45;
    kickFast  = follow(kickFast, kickInput, 0.010, 0.055, dt);
    kickSlow  = follow(kickSlow, kickInput, 0.280, 0.520, dt);
    kickPeak  = Math.max(kickPeak * Math.pow(0.990, dt * 60), kickFast, 0.060);
    var kickRise = Math.max(0, kickFast - kickSlow);
    var kickNorm = clamp01(kickFast / Math.max(0.05, kickPeak * 0.72));
    var isKick   = kickRise > Math.max(0.018, kickSlow * 0.42) && kickNorm > 0.38;
    if (isKick && kickRise > kickPulse * 0.28) {
      kickPulse = clamp01(kickRise * 4.2 + kickNorm * 0.30);
    }
    kickPulse *= Math.pow(0.015, dt);

    /* 6. Snare */
    snareFast = follow(snareFast, snareBand, 0.008, 0.045, dt);
    snareSlow = follow(snareSlow, snareBand, 0.230, 0.480, dt);
    snarePeak = Math.max(snarePeak * Math.pow(0.992, dt * 60), snareFast, 0.055);
    var snareRise = Math.max(0, snareFast - snareSlow);
    var snareNorm = clamp01(snareFast / Math.max(0.04, snarePeak * 0.70));
    var snareBassGate = clamp01(1.0 - kickBand * 2.8);
    var isSnare = snareRise > Math.max(0.016, snareSlow * 0.38)
               && snareNorm > 0.36
               && snareBassGate > 0.30;
    if (isSnare && snareRise > snarePulse * 0.24) {
      snarePulse = clamp01(snareRise * 5.0 + snareNorm * 0.25) * snareBassGate;
    }
    snarePulse *= Math.pow(0.003, dt);

    /* 7. Drop / Chorus */
    longEnergy  = follow(longEnergy,  rmsSmooth, 8.0,  8.0,  dt);
    midEnergy   = follow(midEnergy,   rmsSmooth, 1.2,  1.8,  dt);
    shortEnergy = follow(shortEnergy, rmsRaw,    0.12, 0.30, dt);
    var baseline       = Math.max(longEnergy, 0.028);
    var energyExcess   = clamp01((shortEnergy / baseline - 1.0) / 1.2);
    var bassProminence = clamp01((bassSmooth  - 0.10) / 0.35);
    var fluxBoost      = clamp01((fluxSmooth  - 0.002) / 0.018);
    var rawScore = energyExcess * 0.60 + bassProminence * 0.25 + fluxBoost * 0.15;
    dropScore = follow(dropScore, rawScore, 0.18, 0.40, dt);
    var dropTarget;
    if      (dropScore > 0.52) dropTarget = clamp01((dropScore - 0.52) / 0.48);
    else if (dropScore < 0.22) dropTarget = 0;
    else                        dropTarget = dropLevel;
    dropLevel = follow(dropLevel, dropTarget, 0.60, 1.50, dt);

    /* ── Module A tick ─────────────────────────────────────── */
    _updateBpm(kickPulse, dt);
    _sampleEnergyWindows(dt);   // 内部在采样时刻调 _calcWindowRaw()
    _smoothWindowFeatures(dt);  // 每帧平滑，使用真实 dt

    // 段落持续计时
    _sectionHold += dt;

    // 每 500ms 跑段落检测
    _sectionTimer += dt;
    if (_sectionTimer >= SECTION_DETECT_INTERVAL) {
      _sectionTimer -= SECTION_DETECT_INTERVAL;
      _detectSection();
      // 注：不再在此清零 _prevSection —— 它只在真实切换时由 _detectSection 设置，
      // 保留到下次切换，供外部读取段落过渡信号（修复历史 bug）
    }

    /* 写 uniforms + 更新快照 */
    _writeUniforms(uni);
    _updateState();

    // 调试快照
    debug.kickFast       = kickFast;
    debug.kickSlow       = kickSlow;
    debug.kickPeak       = kickPeak;
    debug.kickRise       = kickRise;
    debug.snareFast      = snareFast;
    debug.snareSlow      = snareSlow;
    debug.snareRise      = snareRise;
    debug.energyExcess   = energyExcess;
    debug.bassProminence = bassProminence;
    debug.fluxBoost      = fluxBoost;
    debug.longEnergy     = longEnergy;
    debug.shortEnergy    = shortEnergy;
    debug.dropScore      = dropScore;
    debug.bpm            = Math.round(_bpmEstimate);
    debug.beatPhase      = _beatPhase;
    debug.barPhase       = _barPhase;
    debug.energySlope    = _energySlope;
    debug.energyAccel    = _energyAccel;
    debug.dynamicRange   = _dynamicRange;
    debug.section        = _section;
    debug.sectionConf    = _sectionConf;
  }

  /* ══════════════════════════════════════════════════════════════
   *  reset
   * ════════════════════════════════════════════════════════════ */
  function reset() {
    kickFast  = 0; kickSlow  = 0; kickPeak  = 0.06; kickPulse  = 0;
    snareFast = 0; snareSlow = 0; snarePeak = 0.06; snarePulse = 0;
    dropLevel = 0; dropScore = 0;
    midEnergy   = longEnergy;
    shortEnergy = longEnergy;
    rmsSmooth   = 0; bassSmooth = 0; fluxSmooth = 0;
    if (_prevFreq) _prevFreq.fill(0);
    // Module A reset
    _globalTime     = 0;
    _bpmKickTimes   = [];
    _prevKickForBpm = 0;
    _beatPhase      = 0;
    _barBeatCount   = 0;
    _barPhase       = 0;
    _lastKickTime   = -99;
    _beatDuration   = 60.0 / _bpmEstimate;
    _energyBuf.fill(0); _energyWinHead = 0; _energyWinFill = 0; _energyTimer = 0;
    _dynBuf.fill(0);    _dynHead = 0;       _dynFill = 0;       _dynTimer = 0;
    _energySlope  = 0;  _energyAccel  = 0;
    _dynamicRange = 0;  _silenceLevel = 0;
    _section      = 'intro'; _sectionConf = 0.5;
    _sectionHold  = 0;       _sectionTimer = 0;
    _prevSection  = 'intro';
    _writeUniforms(g.uniforms);
    _updateState();
  }

  /* ── 导出 ──────────────────────────────────────────────── */
  g.AudioReactive = {
    tick: tick, reset: reset, state: state, debug: debug,
    // 订阅段落切换事件，回调签名 fn(from, to, conf)；返回取消订阅函数
    onSectionChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      _sectionListeners.push(fn);
      return function () {
        var i = _sectionListeners.indexOf(fn);
        if (i >= 0) _sectionListeners.splice(i, 1);
      };
    }
  };

})(window);
