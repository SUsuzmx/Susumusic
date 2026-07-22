/**
 * particle-behavior.js — 粒子行为系统  v1.1
 *
 * 负责将 AudioReactive.js 提供的原始音频特征（kick/drop/rms/bass/flux）
 * 转化为完整的粒子动画语言，写入 window.uniforms：
 *
 *  uBreath       呼吸相位  0-2π         → 粒子整体缩放的正弦驱动
 *  uBreathAmt    呼吸幅度  0-1          → 低能柔和 / 高潮剧烈
 *  uSpring       弹簧位移  -1 to 1      → Beat Pulse 弹性冲击
 *  uHiHat        高频闪烁  0-1          → Treble 驱动微粒 Spark
 *  uVocal        人声流场  0-1          → 中频驱动丝绸旋转
 *  uDropGather   聚集强度  0-1          → Drop 前粒子向心聚集
 *  uDropBurst    爆发强度  0-1          → Drop 爆炸释放
 *  uChorus       副歌强度  0-1          → 副歌扩张 + 额外粒子淡入
 *  uShockRing    冲击波强度 0-1         → Bass 驱动环形冲击波
 *  uShockRadius  冲击波半径 0-4         → 冲击波当前半径（世界坐标）
 *
 * 依赖：
 *   window.AudioReactive  (audio-reactive.js 必须先加载)
 *   window.uniforms       (app.js 中的 Three.js uniforms)
 *
 * API：
 *   ParticleBehavior.tick(dt)   每帧调用（在 AudioReactive.tick 之后）
 *   ParticleBehavior.reset()    切歌时调用
 *   ParticleBehavior.state      只读状态快照
 */
(function (g) {
  'use strict';

  // 订阅 AudioReactive 段落切换事件 → 触发段落转场层
  // （tickTransition 内的 _lastKnownSection diff 作为 AudioReactive 未就绪时的兜底）
  if (g.AudioReactive && g.AudioReactive.onSectionChange) {
    g.AudioReactive.onSectionChange(function (from, to) {
      if (typeof _triggerTransition === 'function') _triggerTransition(from, to);
    });
  }

  /* ══════════════════════════════════════════════════════════════
   *  工具
   * ════════════════════════════════════════════════════════════ */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clamp01(v) { return clamp(v, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /** 非对称一阶 IIR（模拟 A/R 包络） */
  function follow(cur, tgt, attackTau, releaseTau, dt) {
    var tau = tgt > cur ? attackTau : releaseTau;
    return cur + (tgt - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
  }

  /* ══════════════════════════════════════════════════════════════
   *  弹簧物理  (underdamped harmonic oscillator)
   *
   *  ω₀ = 20 rad/s → 自然频率约 3Hz，视觉弹感明显
   *  ζ  = 0.24     → 欠阻尼，Overshoot 约 1.4 倍峰值
   * ════════════════════════════════════════════════════════════ */
  var SP_OMEGA  = 20;    // rad/s
  var SP_ZETA   = 0.24;  // 降低阻尼 → 更明显的回弹
  var springPos = 0;
  var springVel = 0;

  function tickSpring(dt) {
    var a = -SP_OMEGA * SP_OMEGA * springPos - 2 * SP_ZETA * SP_OMEGA * springVel;
    springVel += a * dt;
    springPos += springVel * dt;
    springPos = clamp(springPos, -1.0, 2.2);   // 允许更大位移
    springVel = clamp(springVel, -18, 18);
  }

  /** 给弹簧施加一个速度冲量（kick → 粒子向外弹） */
  function kickSpring(strength) {
    springVel += strength * 14.0;   // 冲量加大
  }

  /* ══════════════════════════════════════════════════════════════
   *  呼吸系统
   * ════════════════════════════════════════════════════════════ */
  var breathPhase  = 0;
  var breathRate   = 0.35;
  var breathAmt    = 0.06;

  function tickBreath(dt, energy, bpm) {
    var energyRate = 0.22 + energy * 1.10;              // 更高上限
    var bpmRate    = bpm > 30 ? bpm / 240 : 0.40;
    var targetRate = lerp(energyRate, bpmRate, 0.45);
    breathRate = follow(breathRate, targetRate, 1.5, 2.5, dt);

    if (energy > 0.65) {
      var fastRate = bpm > 30 ? bpm / 120 : 0.8;
      breathRate = follow(breathRate, fastRate, 0.7, 2.0, dt);
    }

    breathPhase += breathRate * dt * 2 * Math.PI;
    if (breathPhase > 2 * Math.PI) breathPhase -= 2 * Math.PI;

    // 幅度：平时极轻柔(0.05)，高潮最大约 0.38（足够驱动明显的噪声漂移）
    var targetAmt = 0.05 + energy * 0.85;
    breathAmt = follow(breathAmt, targetAmt, 0.40, 0.80, dt);
  }

  /* ══════════════════════════════════════════════════════════════
   *  BPM 估算
   * ════════════════════════════════════════════════════════════ */
  var bpmEstimate  = 120;
  var bpmKickTimes = [];
  var prevKickVal  = 0;
  var globalTime   = 0;

  function updateBpmFromKick(kickVal, dt) {
    globalTime += dt;
    var threshold = 0.45;   // 降低触发阈值
    if (kickVal > threshold && prevKickVal <= threshold) {
      bpmKickTimes.push(globalTime);
      if (bpmKickTimes.length > 8) bpmKickTimes.shift();
      if (bpmKickTimes.length >= 3) {
        var intervals = [];
        for (var i = 1; i < bpmKickTimes.length; i++) {
          var gap = bpmKickTimes[i] - bpmKickTimes[i - 1];
          if (gap > 0.25 && gap < 2.0) intervals.push(gap);
        }
        if (intervals.length >= 2) {
          var avg = intervals.reduce(function(a,b){return a+b;}) / intervals.length;
          var newBpm = 60 / avg;
          bpmEstimate = follow(bpmEstimate, clamp(newBpm, 40, 200), 2.0, 5.0, dt);
        }
      }
    }
    prevKickVal = kickVal;
  }

  /* ══════════════════════════════════════════════════════════════
   *  Hi-Hat 闪烁追踪
   * ════════════════════════════════════════════════════════════ */
  var hihatSmooth = 0;

  function tickHiHat(treble, dt) {
    // 降低起跳阈值，更容易触发
    var target = clamp01((treble - 0.04) / 0.32);
    hihatSmooth = follow(hihatSmooth, target, 0.03, 0.14, dt);
  }

  /* ══════════════════════════════════════════════════════════════
   *  人声流场追踪
   * ════════════════════════════════════════════════════════════ */
  var vocalSmooth = 0;

  function tickVocal(mid, bass, dt) {
    var vocalRaw = clamp01((mid - 0.10) / 0.30) * clamp01(1.0 - bass * 1.0);
    vocalSmooth = follow(vocalSmooth, vocalRaw, 0.18, 0.45, dt);
  }

  /* ══════════════════════════════════════════════════════════════
   *  Bass 冲击波环系统（最多 4 个并发）
   * ════════════════════════════════════════════════════════════ */
  var SHOCK_SPEED = 3.5;    // 加快扩散速度
  var shockwaves  = [];
  var prevBassVal = 0;
  var bassOnsetCooldown = 0;

  function tickShockwaves(bassVal, dt) {
    bassOnsetCooldown = Math.max(0, bassOnsetCooldown - dt);

    var bassRise = Math.max(0, bassVal - prevBassVal);
    // 降低触发门限，让冲击波更容易出现
    if (bassRise > 0.040 && bassVal > 0.18 && bassOnsetCooldown <= 0) {
      shockwaves.push({
        radius: 0.05,
        strength: clamp01(bassRise * 7.0 + bassVal * 0.6),   // 更强初始强度
        age: 0
      });
      if (shockwaves.length > 4) shockwaves.shift();
      bassOnsetCooldown = 0.14;  // 140ms 冷却
    }
    prevBassVal = lerp(prevBassVal, bassVal, 0.28);

    for (var i = shockwaves.length - 1; i >= 0; i--) {
      var sw = shockwaves[i];
      sw.radius += SHOCK_SPEED * dt;
      sw.strength *= Math.pow(0.08, dt);   // 稍快衰减，让每次冲击更清晰
      sw.age += dt;
      if (sw.strength < 0.006 || sw.radius > 5.0) {
        shockwaves.splice(i, 1);
      }
    }

    var best = null;
    for (var j = 0; j < shockwaves.length; j++) {
      if (!best || shockwaves[j].strength > best.strength) best = shockwaves[j];
    }
    if (best) return { ring: best.strength, radius: best.radius };
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
   *  副歌状态追踪 + 新高潮段检测
   * ══════════════════════════════════════════════════════════════ */
  var chorusLevel = 0;
  var chorusPeak  = 0;
  var chorusWasBelow = true;   // 上帧是否在阈值下方（用于检测穿越）
  var chorusEntryFired = false; // 本次高潮段是否已触发过入场爆发
  var CHORUS_ENTRY_THRESHOLD = 0.30; // 穿越此值视为「进入高潮段」

  function tickChorus(dropVal, energy, dt) {
    // 降低触发阈值：0.18 开始，0.55 达到满值
    var target = dropVal > 0.18 ? clamp01((dropVal - 0.18) / 0.37) : 0;
    chorusLevel = follow(chorusLevel, target, 0.45, 1.2, dt);
    chorusPeak = Math.max(chorusPeak * Math.pow(0.992, dt * 60), chorusLevel);

    // 检测「从下方穿越到上方」= 进入新高潮段
    var isAbove = chorusLevel >= CHORUS_ENTRY_THRESHOLD;
    if (isAbove && chorusWasBelow) {
      // 新高潮段开始，标记可以触发
      chorusEntryFired = false;
    }
    if (!isAbove) {
      chorusEntryFired = false; // 退出高潮段后重置
    }
    chorusWasBelow = !isAbove;
  }

  /* ══════════════════════════════════════════════════════════════
   *  Drop 序列状态机
   *
   *  触发条件：drop > 0.60，kick > 0.42，持续 0.8s，冷却 6s
   * ════════════════════════════════════════════════════════════ */
  var DROP_PHASE_DUR = { GATHER: 0.22, HOLD: 0.14, BURST: 0.22, RELEASE: 1.40 };

  var dropState         = 'IDLE';
  var dropPhaseTimer    = 0;
  var dropGatherVal     = 0;
  var dropBurstVal      = 0;
  var lastDropAt        = -20;
  var chorusSustainTime = 0;

  /* ── 爆发残留 / 热焰色温 / 涡旋 ─────────────────────────────── */
  var burstResidue      = 0;   // Drop 爆发后缓慢衰减（~2.8s），驱动粒子漂移恢复
  var heatGlow          = 0;   // 色温：1=炽白橙，→0=冷却蓝（爆发后渐冷）
  var vortexSpin        = 0;   // 副歌涡旋强度 0-1
  var _prevDropVal      = 0;   // 上帧 dropVal，用于快速上升沿检测

  function triggerDrop() {
    if (dropState !== 'IDLE') return;
    dropState      = 'GATHER';
    dropPhaseTimer = 0;
    lastDropAt     = globalTime;
    _triggerFlash(1.0);
  }

  function tickDropSequence(dropVal, kickVal, dt) {
    dropPhaseTimer += dt;

    if (dropState === 'IDLE') {
      // 降低触发阈值：drop > 0.32，kick > 0.30，副歌持续 0.5s，冷却 4s
      if (chorusSustainTime > 0.50 && dropVal > 0.32 && kickVal > 0.30 &&
          globalTime - lastDropAt > 4.0) {
        triggerDrop();
      }
      chorusSustainTime = dropVal > 0.18 ? chorusSustainTime + dt : 0;
    }

    // ── 补充路径：uDrop 快速上升时直接 spike burstResidue/heatGlow ──
    // 不依赖状态机，保证任何高潮时刻都能看到色温和残留效果
    // 注意：使用「每秒上升速率」而非每帧绝对差值，确保 60fps/30fps 行为一致
    var dropRise = Math.max(0, dropVal - _prevDropVal);
    var dropRiseRate = dropRise / dt;    // 每秒速率，消除帧率依赖
    if (dropRiseRate > 0.30 && dropVal > 0.18) {
      // spikeStrength：速率越快、当前值越高，spike 越大（0-1）
      var spikeStrength = clamp01(dropRiseRate * 0.55 + dropVal * 0.45);
      if (spikeStrength > burstResidue * 0.6) {
        burstResidue = Math.max(burstResidue, spikeStrength * 0.78);
      }
      if (spikeStrength > heatGlow * 0.6) {
        heatGlow = Math.max(heatGlow, spikeStrength * 0.68);
      }
    }
    _prevDropVal = dropVal;

    switch (dropState) {
      case 'GATHER':
        dropGatherVal = clamp01(dropPhaseTimer / DROP_PHASE_DUR.GATHER);
        dropBurstVal  = 0;
        if (dropPhaseTimer >= DROP_PHASE_DUR.GATHER) {
          dropState = 'HOLD'; dropPhaseTimer = 0;
        }
        break;

      case 'HOLD':
        dropGatherVal = 1.0;
        dropBurstVal  = 0;
        if (dropPhaseTimer >= DROP_PHASE_DUR.HOLD) {
          dropState = 'BURST'; dropPhaseTimer = 0;
          kickSpring(7.0);     // 大幅增强爆发弹簧冲量
          _triggerFlash(1.0);
          // ── 触发爆发残留 & 热焰色温 ───────────────────────────
          burstResidue = 1.0;
          heatGlow     = 1.0;
        }
        break;

      case 'BURST':
        var burstT     = clamp01(dropPhaseTimer / DROP_PHASE_DUR.BURST);
        dropGatherVal  = 1.0 - burstT;
        dropBurstVal   = clamp01(burstT * 3.8);   // 爆发峰值更高
        if (dropPhaseTimer >= DROP_PHASE_DUR.BURST) {
          dropState = 'RELEASE'; dropPhaseTimer = 0;
        }
        break;

      case 'RELEASE':
        dropGatherVal = 0;
        dropBurstVal  = follow(dropBurstVal, 0, 0.001, DROP_PHASE_DUR.RELEASE, dt);
        if (dropPhaseTimer >= DROP_PHASE_DUR.RELEASE) {
          dropState    = 'IDLE';
          dropGatherVal = 0;
          dropBurstVal  = 0;
        }
        break;

      default:
        dropState = 'IDLE';
        dropGatherVal = 0;
        dropBurstVal  = 0;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  ★ 高潮爆炸再生系统（Chorus Burst System）
   *
   *  触发逻辑（双路径，互为补充）：
   *    路径 A：uDrop 快速上升沿（dropRiseRate > 0.45 且 dropVal > 0.25）
   *            → 任何高潮开始时都能捕获
   *    路径 B：长期高潮维持（chorusLevel > 0.55 持续 1.5s）
   *            → 副歌段落稳定时周期性触发（最小间隔 3s）
   *
   *  状态机：IDLE → BURST（0.28s 快速衰减）→ REGATHER（2.2s 慢回位）→ IDLE
   *
   *  输出 uniforms：
   *    uCBurst    : 爆炸脉冲 0-1
   *    uCWhite    : 曝白强度 0-1（快速 flash）
   *    uCRegather : 内聚再生 0-1（慢衰减）
   *    uCKickBoost: 副歌 kick 增强 0-1
   * ════════════════════════════════════════════════════════════ */
  var CB_STATE    = 'IDLE';   // IDLE / BURST / REGATHER
  var cbTimer     = 0;
  var cBurstVal   = 0;        // uCBurst 原始值（快速脉冲）
  var cWhiteVal   = 0;        // uCWhite（DOM + shader 双重曝白）
  var cRegatherVal= 0;        // uCRegather（慢回位）
  var cKickBoost  = 0;        // uCKickBoost（chorus 期间 kick 增强）
  var lastCBurstAt= -30;      // 上次触发时间，用于冷却
  var cbChorusSustain = 0;    // 高潮维持计时（路径 B）
  var _cbDropPrev = 0;        // 上帧 dropVal

  var CB_BURST_DUR    = 0.70; // 爆炸脉冲持续时间（秒）0.28→0.70，让效果有时间显现
  var CB_REGATHER_DUR = 2.80; // 内聚再生持续时间（秒）2.20→2.80
  var CB_COOLDOWN     = 1.50; // 最小触发间隔（秒）入场爆发无冷却，此值用于高潮段内重触发

  function _triggerChorusBurst(strength, bypassCooldown) {
    if (CB_STATE !== 'IDLE') return;
    if (!bypassCooldown && globalTime - lastCBurstAt < CB_COOLDOWN) return;
    CB_STATE       = 'BURST';
    cbTimer        = 0;
    lastCBurstAt   = globalTime;
    // 爆炸初始强度
    cBurstVal      = clamp01(strength);
    cWhiteVal      = clamp01(strength * 0.92);
    // 触发 DOM 屏幕曝白（叠加到现有 flash）
    _triggerFlash(strength * 0.85);
    _triggerVignette(strength * 0.60);
  }

  function tickChorusBurst(dropVal, kickVal, dt) {
    // ── uCKickBoost：副歌期间 kick 增强（与状态机无关）────────
    var kickBoostTarget = clamp01((chorusLevel - 0.20) / 0.45) * 1.0;
    cKickBoost = follow(cKickBoost, kickBoostTarget, 0.20, 0.60, dt);

    // ── 触发路径 0：新高潮段入场 —— 立即爆发，跳过冷却 ─────────
    if (!chorusEntryFired && CB_STATE === 'IDLE' && chorusLevel >= CHORUS_ENTRY_THRESHOLD) {
      chorusEntryFired = true;
      var entryStrength = clamp01(chorusLevel * 0.95 + (kickVal > 0.30 ? 0.20 : 0.05));
      _triggerChorusBurst(Math.max(0.70, entryStrength), true); // bypassCooldown = true
    }

    // ── 触发路径 A：drop 快速上升沿 ─────────────────────────
    var dropRise = Math.max(0, dropVal - _cbDropPrev);
    var dropRiseRate = dropRise / Math.max(0.001, dt);
    // 阈值降低：0.45→0.18，dropVal 要求：0.25→0.12，覆盖更多风格的音乐
    if (CB_STATE === 'IDLE' && dropRiseRate > 0.18 && dropVal > 0.12) {
      var sA = clamp01(dropRiseRate * 0.55 + dropVal * 0.65);
      _triggerChorusBurst(Math.max(0.65, sA)); // 最低强度 0.65，保证效果明显
    }

    // ── 触发路径 B：高潮维持触发 ────────────────────────────
    // chorusLevel 阈值：0.55→0.28，持续要求：1.5s→0.8s
    if (chorusLevel > 0.28) {
      cbChorusSustain += dt;
    } else {
      cbChorusSustain *= Math.pow(0.40, dt); // 衰减放慢：0.12→0.40
    }
    if (CB_STATE === 'IDLE' && cbChorusSustain > 0.8 &&
        globalTime - lastCBurstAt > CB_COOLDOWN * 1.2) {
      var sB = clamp01(chorusLevel * 0.90 + (kickVal > 0.30 ? 0.25 : 0.10));
      _triggerChorusBurst(Math.max(0.60, sB));
    }

    // ── 触发路径 C（新增）：kick 强命中且处于副歌期间 ───────
    // 当 chorusLevel > 0.25 且 kick 很强时直接触发，对重拍音乐更敏感
    if (CB_STATE === 'IDLE' && chorusLevel > 0.25 && kickVal > 0.65 &&
        globalTime - lastCBurstAt > CB_COOLDOWN) {
      _triggerChorusBurst(clamp01(kickVal * 0.80 + chorusLevel * 0.40));
    }
    _cbDropPrev = dropVal;

    // ── 状态机推进 ────────────────────────────────────────────
    cbTimer += dt;
    if (CB_STATE === 'BURST') {
      // 爆炸脉冲：快速衰减（pow 曲线，快速收缩感）
      var burstT  = clamp01(cbTimer / CB_BURST_DUR);
      // ease-out: 1 → 0 加速衰减
      cBurstVal   = clamp01((1.0 - burstT) * (1.0 - burstT));
      // 白色 flash 比爆炸衰减更快（先白后散）
      cWhiteVal   = clamp01((1.0 - burstT * 1.6));
      if (cbTimer >= CB_BURST_DUR) {
        CB_STATE     = 'REGATHER';
        cbTimer      = 0;
        cBurstVal    = 0;
        cWhiteVal    = 0;
        cRegatherVal = 1.0;  // 内聚再生从满值开始慢衰减
      }
    } else if (CB_STATE === 'REGATHER') {
      // 内聚再生：线性慢衰减
      var regatherT = clamp01(cbTimer / CB_REGATHER_DUR);
      cRegatherVal  = 1.0 - regatherT;
      if (cbTimer >= CB_REGATHER_DUR) {
        CB_STATE     = 'IDLE';
        cRegatherVal = 0;
      }
    } else {
      // IDLE 时快速清零（防止残留）
      cBurstVal    *= Math.pow(0.01, dt);
      cWhiteVal    *= Math.pow(0.01, dt);
      cRegatherVal *= Math.pow(0.05, dt);
    }
  }


  var _flashEl = null;
  function _getFlashEl() {
    if (_flashEl && _flashEl.parentNode) return _flashEl;
    _flashEl = document.createElement('div');
    _flashEl.id = 'pb-drop-flash';
    _flashEl.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:9999',
      'opacity:0',
      'background:radial-gradient(ellipse 90% 70% at 50% 50%,',
      '  rgba(255,255,255,0.28) 0%, rgba(200,220,255,0.14) 35%, transparent 70%)',
    ].join(';');
    document.body.appendChild(_flashEl);
    return _flashEl;
  }

  /** 暗晕脉冲：边缘加深 / 中心突显，与亮闪形成对比 */
  var _vignetteEl = null;
  function _getVignetteEl() {
    if (_vignetteEl && _vignetteEl.parentNode) return _vignetteEl;
    _vignetteEl = document.createElement('div');
    _vignetteEl.id = 'pb-vignette';
    _vignetteEl.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:9998',
      'opacity:0',
      'background:radial-gradient(ellipse 80% 75% at 50% 50%,',
      '  transparent 30%, rgba(0,0,0,0.38) 68%, rgba(0,0,0,0.72) 100%)',
    ].join(';');
    document.body.appendChild(_vignetteEl);
    return _vignetteEl;
  }

  /** 触发暗晕（Bass / Kick 命中时调用）
   *  strength 0-1；与亮闪同触发但衰减更慢，营造心跳收缩感
   */
  function _triggerVignette(strength) {
    var el = _getVignetteEl();
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(0.90, (strength || 0.5) * 0.85));
    clearTimeout(el._vt);
    el._vt = setTimeout(function () {
      el.style.transition = 'opacity 0.80s cubic-bezier(0.16,1,0.3,1)';
      el.style.opacity = '0';
    }, 40);
  }

  function _triggerFlash(strength) {
    var el = _getFlashEl();
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(0.98, (strength || 1) * 0.95));
    clearTimeout(el._ft);
    el._ft = setTimeout(function () {
      el.style.transition = 'opacity 0.55s cubic-bezier(0.16,1,0.3,1)';
      el.style.opacity = '0';
    }, 35);
    var uni = g.uniforms;
    if (uni && uni.uBloomStrength) {
      uni.uBloomStrength.value = Math.min(2.4, uni.uBloomStrength.value + strength * 1.10);
    }
    if (uni && uni.uBurstAmt) {
      uni.uBurstAmt.value = Math.min(1.0, uni.uBurstAmt.value + strength * 0.95);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  写入 uniforms
   *  效果强度 = params（用户手动调节）× adapt（音乐自适应）× M（总开关）
   * ════════════════════════════════════════════════════════════ */
  function _writeUniforms(shock, dt) {
    var uni = g.uniforms;
    if (!uni) return;
    var M = params.enabled ? params.master : 0;
    var AR = g.AudioReactive;
    if (uni.uBreath)      uni.uBreath.value      = breathPhase;
    if (uni.uBreathAmt)   uni.uBreathAmt.value    = breathAmt  * params.breath  * adapt.breath  * M;
    if (uni.uSpring)      uni.uSpring.value       = springPos  * params.kick    * adapt.kick    * M;
    if (uni.uHiHat)       uni.uHiHat.value        = hihatSmooth * params.hihat  * adapt.hihat   * M;
    if (uni.uVocal)       uni.uVocal.value        = vocalSmooth * params.vocal  * adapt.vocal   * M;
    if (uni.uDropGather)  uni.uDropGather.value   = dropGatherVal * params.drop * M;
    if (uni.uDropBurst)   uni.uDropBurst.value    = dropBurstVal  * params.drop * M;
    if (uni.uChorus)      uni.uChorus.value       = chorusLevel   * params.chorus * adapt.chorus * M;
    // 新：爆发残留 / 热焰色温 / 副歌涡旋
    if (uni.uBurstResidue) uni.uBurstResidue.value = burstResidue * params.drop   * M;
    if (uni.uHeatGlow)     uni.uHeatGlow.value     = heatGlow     * params.drop   * M;
    if (uni.uVortex)       uni.uVortex.value        = vortexSpin   * params.chorus * adapt.chorus * M;
    // uSnare：从 AudioReactive.state 读原始值，乘用户乘数后写入
    if (uni.uSnare && AR && AR.state) {
      uni.uSnare.value = AR.state.snare * params.snare * M;
    }
    // ★ 高潮爆炸再生系统 uniforms（全局，不受 params 压制）
    if (uni.uCBurst)     uni.uCBurst.value     = cBurstVal    * M;
    if (uni.uCWhite)     uni.uCWhite.value      = cWhiteVal    * M;
    if (uni.uCRegather)  uni.uCRegather.value   = cRegatherVal * M;
    if (uni.uCKickBoost) uni.uCKickBoost.value  = cKickBoost   * M;
    // ★ 段落级电影转场层 uniforms（独立通道，叠加但不压制 drop/chorus）
    if (uni.uSecGather) uni.uSecGather.value = secGatherVal * M;
    if (uni.uSecBurst)  uni.uSecBurst.value  = secBurstVal  * M;
    if (uni.uSecDarken) uni.uSecDarken.value = secDarkenVal * M;
    if (shock) {
      if (uni.uShockRing)   uni.uShockRing.value   = shock.ring * params.bass * adapt.bass * M;
      if (uni.uShockRadius) uni.uShockRadius.value  = shock.radius;
    } else {
      if (uni.uShockRing)   uni.uShockRing.value  *= Math.pow(0.04, dt || 0.016);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  外部可控参数（由视觉控制台写入）
   *  所有值均为乘数：0=关闭  1=默认  2=双倍
   * ════════════════════════════════════════════════════════════ */
  var params = {
    enabled : true,   // 总开关
    master  : 1.0,    // 整体强度
    kick    : 1.0,    // 鼓点冲击
    breath  : 1.0,    // 呼吸幅度
    bass    : 1.0,    // Bass 冲击波
    hihat   : 1.0,    // 高频闪烁
    vocal   : 1.0,    // 人声流场
    chorus  : 1.0,    // 副歌扩张
    drop    : 1.0,    // Drop 爆发
    snare   : 1.0,    // Snare 打击扭切
    adapt   : true,   // 音乐自适应（自动调整效果乘数）
  };

  /** 外部调用：覆盖部分参数 */
  function setParams(p) {
    if (p && typeof p === 'object') Object.keys(p).forEach(function(k){ if (k in params) params[k] = p[k]; });
  }

  /* ══════════════════════════════════════════════════════════════
   *  音乐自适应行为
   *
   *  根据实时 BPM、能量分布、bass 特征自动调整 params 乘数，
   *  实现不同风格音乐的差异化视觉响应：
   *
   *  慢歌（BPM<90, 低 RMS）：柔和呼吸，弱鼓点，淡 hihat
   *  流行/EDM（BPM>120, 高能）：强劲 kick，快速呼吸，高 hihat
   *  摇滚/重金属（中高 BPM, 高 RMS, 高 bass-to-mid）：强 kick, bass
   *  Dubstep/低频（低 BPM, 极高 bass burst）：夸张 bass 冲击波
   *
   *  所有适配值通过低通滤波平滑过渡（tau ~3-5s），避免突变
   * ════════════════════════════════════════════════════════════ */
  var adapt = {
    breath : 1.0,   // 呼吸幅度乘数
    kick   : 1.0,   // 鼓点强度乘数
    bass   : 1.0,   // Bass 冲击波乘数
    hihat  : 1.0,   // 高频闪烁乘数
    vocal  : 1.0,   // 人声流场乘数
    chorus : 1.0,   // 副歌扩张乘数
  };

  /** 记录中期平均统计（用于风格推断）*/
  var adaptStats = {
    bassAvg    : 0.10,   // bass 中期平均
    rmsAvg     : 0.06,   // RMS 中期平均
    kickRate   : 0,      // kick 触发频率（每帧事件均值）
    snareAvg   : 0,      // snare 中期平均
  };

  function tickAdapt(dt, arState, bpm) {
    var rms   = arState.rms  || 0;
    var bass  = arState.bass || 0;
    var snare = arState.snare|| 0;
    var kick  = arState.kick || 0;

    /* 中期统计（tau 4s）*/
    var tau3 = Math.min(1, dt / 4.0);
    var tau8 = Math.min(1, dt / 8.0);
    adaptStats.rmsAvg   += (rms   - adaptStats.rmsAvg)   * tau3;
    adaptStats.bassAvg  += (bass  - adaptStats.bassAvg)  * tau3;
    adaptStats.snareAvg += (snare - adaptStats.snareAvg) * tau3;
    adaptStats.kickRate += (kick  - adaptStats.kickRate) * tau3;

    /* ── 风格特征计算 ── */
    var energy = adaptStats.rmsAvg;

    // 速度系数：BPM 归一化 (60→0, 180→1)
    var tempo = Math.max(0, Math.min(1, (bpm - 60) / 120));

    // bass 主导度：bass 平均 vs RMS 的比值（越高→更 bass-heavy）
    var bassDom = Math.max(0, Math.min(1,
      (adaptStats.bassAvg / Math.max(0.02, adaptStats.rmsAvg) - 0.5) / 1.2));

    // snare 存在感：normalized snare 平均（rock/pop 特征）
    var snarePresence = Math.min(1, adaptStats.snareAvg * 8.0);

    /* ── 目标参数计算（压缩范围，减少过度补偿） ── */
    var targetBreath = 0.80 + energy * 0.60 + tempo * 0.20;     // 0.80~1.60
    var targetKick   = 0.75 + energy * 0.70 + bassDom * 0.20;   // 0.75~1.65
    var targetBass   = 0.70 + bassDom * 0.60 + energy * 0.40;   // 0.70~1.70
    var targetHihat  = 0.70 + tempo * 0.50 + energy * 0.25;     // 0.70~1.45
    var targetVocal  = 0.85 + (1.0 - snarePresence) * 0.30 + energy * 0.15;  // 0.85~1.30
    var targetChorus = 0.80 + energy * 0.40 + bassDom * 0.15;   // 0.80~1.35

    /* 钳制：最低 0.6，最高 1.5（更保守的范围） */
    function ca(v) { return Math.max(0.6, Math.min(1.5, v)); }
    targetBreath = ca(targetBreath);
    targetKick   = ca(targetKick);
    targetBass   = ca(targetBass);
    targetHihat  = ca(targetHihat);
    targetVocal  = ca(targetVocal);
    targetChorus = ca(targetChorus);

    /* 低通平滑（tau 8s → 约 8 秒缓慢跟随） */
    adapt.breath  += (targetBreath  - adapt.breath)  * tau8;
    adapt.kick    += (targetKick    - adapt.kick)    * tau8;
    adapt.bass    += (targetBass    - adapt.bass)    * tau8;
    adapt.hihat   += (targetHihat   - adapt.hihat)   * tau8;
    adapt.vocal   += (targetVocal   - adapt.vocal)   * tau8;
    adapt.chorus  += (targetChorus  - adapt.chorus)  * tau8;
  }

  /* ══════════════════════════════════════════════════════════════
   *  公开 state 快照
   * ════════════════════════════════════════════════════════════ */
  var state = {
    dropState: 'IDLE',
    breathRate: 0, breathAmt: 0,
    bpm: 120,
    spring: 0,
    chorus: 0,
    isChorus: false,
    isDrop: false,
    adapt: adapt,       // 只读：当前自适应乘数（可在调试面板展示）
  };

  /* ══════════════════════════════════════════════════════════════
   *  主 tick
   * ════════════════════════════════════════════════════════════ */
  function tick(dt) {
    dt = Math.max(0.001, Math.min(0.08, dt || 0.016));

    var AR  = g.AudioReactive;
    var uni = g.uniforms;
    if (!AR || !uni) return;

    var arState = AR.state;
    var kickVal = arState.kick  || 0;
    var dropVal = arState.drop  || 0;
    var rmsVal  = arState.rms   || 0;
    var bassVal = arState.bass  || 0;
    var fluxVal = arState.flux  || 0;

    var midVal    = uni.uMid    ? uni.uMid.value    : 0;
    var trebleVal = uni.uTreble ? uni.uTreble.value : 0;
    var energyVal = uni.uEnergy ? uni.uEnergy.value : rmsVal;

    updateBpmFromKick(kickVal, dt);

    // Beat Pulse → 弹簧冲量（降低触发阈值，加大冲量）
    if (kickVal > 0.38 && kickVal > prevKickVal * 1.10) {
      kickSpring(clamp01(kickVal) * 1.6);
    }
    tickSpring(dt);

    tickBreath(dt, energyVal, bpmEstimate);
    tickHiHat(trebleVal, dt);
    tickVocal(midVal, bassVal, dt);
    tickChorus(dropVal, energyVal, dt);

    var shock = tickShockwaves(bassVal, dt);
    tickDropSequence(dropVal, kickVal, dt);
    tickChorusBurst(dropVal, kickVal, dt);   // ★ 高潮爆炸再生系统

    // ── 爆发残留衰减（tau 2.8s → 粒子缓缓漂回）────────────────
    burstResidue = follow(burstResidue, 0, 0.001, 2.8, dt);
    // ── 热焰色温冷却（tau 1.8s → 橙白 → 冷蓝过渡）─────────────
    heatGlow     = follow(heatGlow,     0, 0.001, 1.8, dt);
    // ── 副歌涡旋：跟随 chorusLevel，快升慢降 ─────────────────
    vortexSpin   = follow(vortexSpin, chorusLevel, 0.55, 2.2, dt);

    // ── 暗晕脉冲：kick 强命中时触发边缘压暗 ──────────────────
    if (kickVal > 0.52 && kickVal > prevKickVal * 1.15) {
      _triggerVignette(kickVal * 0.80);
    }

    // 音乐自适应：根据风格特征自动调整效果乘数（可由 params.adapt 关闭）
    if (params.adapt) {
      tickAdapt(dt, arState, bpmEstimate);
    }

    _writeUniforms(shock, dt);

    state.dropState  = dropState;
    state.breathRate = breathRate;
    state.breathAmt  = breathAmt;
    state.bpm        = Math.round(bpmEstimate);
    state.spring     = springPos;
    state.chorus     = chorusLevel;
    state.isChorus   = chorusLevel > 0.20;
    state.isDrop     = dropState !== 'IDLE';

    prevKickVal = kickVal;
  }

  /* ══════════════════════════════════════════════════════════════
   *  reset
   * ════════════════════════════════════════════════════════════ */
  function reset() {
    springPos    = 0;  springVel    = 0;
    breathPhase  = 0;  breathRate   = 0.35;  breathAmt = 0.06;
    hihatSmooth  = 0;  vocalSmooth  = 0;
    chorusLevel  = 0;  chorusPeak   = 0;  chorusWasBelow = true;  chorusEntryFired = false;
    dropState    = 'IDLE';
    dropPhaseTimer = 0;
    dropGatherVal  = 0;  dropBurstVal = 0;
    chorusSustainTime = 0;
    burstResidue = 0;  heatGlow = 0;  vortexSpin = 0;  _prevDropVal = 0;
    shockwaves   = [];
    bassOnsetCooldown = 0;
    prevBassVal  = 0;
    prevKickVal  = 0;
    bpmKickTimes = [];
    globalTime   = 0;
    // ★ 高潮爆炸再生系统重置
    CB_STATE      = 'IDLE';
    cbTimer       = 0;
    cBurstVal     = 0;  cWhiteVal    = 0;
    cRegatherVal  = 0;  cKickBoost   = 0;
    lastCBurstAt  = -30;
    cbChorusSustain = 0; _cbDropPrev = 0;
    // 自适应参数重置为中性值（1.0），切歌时不保留上一首的风格特征
    adapt.breath = 1.0; adapt.kick = 1.0; adapt.bass = 1.0;
    adapt.hihat  = 1.0; adapt.vocal = 1.0; adapt.chorus = 1.0;
    adaptStats.rmsAvg = 0.06; adaptStats.bassAvg = 0.10;
    adaptStats.snareAvg = 0;  adaptStats.kickRate = 0;
    _writeUniforms(null, 0.016);
  }


  /* ══════════════════════════════════════════════════════════════
   * ██████╗     ██████╗     ██████╗
   * ██╔══██╗   ██╔════╝    ██╔══██╗
   * ██████╔╝   ██║         ██║  ██║
   * ██╔══██╗   ██║         ██║  ██║
   * ██████╔╝   ╚██████╗    ██████╔╝
   *  Module B — 节奏预设系统
   *  Module C — 安静段落微动画
   *  Module D — 段落过渡动画
   * ════════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════
   *  Module B — 5 种节奏预设
   *
   *  每种预设定义：
   *    paramBias  : 对 params 各通道的乘数偏置（1 = 不变）
   *    adaptBias  : 对 adapt 各通道的额外偏置
   *    onKick     : function(strength, barPhase) → 可选额外冲量
   *    onSnare    : function(strength, barPhase) → 可选额外冲量
   *    onChorus   : function(intensity)
   *    onQuiet    : function(rms, duration) → 选择微动画
   *    onTransition: function(from, to, progress)
   *
   *  预设类型：
   *    pulse   — EDM/电子：强劲 kick，快速弹簧，爆发冲击波
   *    flow    — 古典/环境：柔和呼吸主导，bass 和 kick 减弱
   *    shatter — 摇滚/金属：snare 主导，粗暴冲击，chorusBurst 频繁
   *    glow    — Lo-Fi/慢摇：低能微动画为主，人声流场
   *    wave    — 流行/R&B：均衡，vocal 和 breath 增强
   * ════════════════════════════════════════════════════════════ */

  var PRESETS = {
    pulse: {
      label: 'Pulse — EDM',
      paramBias: { kick:1.6, breath:1.0, bass:1.5, hihat:1.3, vocal:0.8, chorus:1.2, drop:1.4, snare:1.0 },
      adaptBias: { kick:0.4, bass:0.3, breath:0, hihat:0.2, vocal:0, chorus:0.2 },
      onKick: function(str, phase) {
        // 强 kick 时，spring 额外冲量 × 1.3
        if (str > 0.55) kickSpring(str * 1.3);
      },
      onSnare: function(str, phase) { /* pulse 预设 snare 正常 */ },
      onChorus: function(intensity) {
        // 副歌时额外 vortexSpin boost（通过 heatGlow 通道传递信号）
        if (intensity > 0.5) heatGlow = Math.max(heatGlow, intensity * 0.5);
      },
      onQuiet: function(rms, dur) { return dur > 1.5 ? 'quantum' : null; },
      onTransition: function(from, to, progress) {
        if (to === 'chorus' && progress < 0.3) kickSpring(3.0 * progress);
      },
    },

    flow: {
      label: 'Flow — 古典/环境',
      paramBias: { kick:0.55, breath:1.8, bass:0.5, hihat:0.4, vocal:1.4, chorus:1.0, drop:0.7, snare:0.4 },
      adaptBias: { kick:-0.2, bass:-0.2, breath:0.5, hihat:-0.1, vocal:0.3, chorus:0 },
      onKick: function(str, phase) {
        // flow 预设只在强 kick(>0.65) 时才给弹簧冲量，且减半
        if (str > 0.65) kickSpring(str * 0.55);
      },
      onSnare: function(str, phase) { /* flow 预设 snare 静音 */ },
      onChorus: function(intensity) { /* 只靠 breath 传达 */ },
      onQuiet: function(rms, dur) { return dur > 0.8 ? 'breathDrift' : null; },
      onTransition: function(from, to, progress) {
        // 过渡时延长呼吸（在 tickTransition 里实现）
      },
    },

    shatter: {
      label: 'Shatter — 摇滚/金属',
      paramBias: { kick:1.4, breath:0.9, bass:1.3, hihat:1.2, vocal:0.7, chorus:1.3, drop:1.2, snare:1.8 },
      adaptBias: { kick:0.3, bass:0.2, breath:0, hihat:0.2, vocal:-0.1, chorus:0.2 },
      onKick: function(str, phase) {
        // shatter：每个 kick 都带 vignette（通过 _triggerVignette 已存在）
        if (str > 0.45) kickSpring(str * 1.5);
      },
      onSnare: function(str, phase) {
        // shatter：snare 也给弹簧强冲量
        if (str > 0.40) kickSpring(str * 2.2);
      },
      onChorus: function(intensity) {
        if (intensity > 0.4) {
          burstResidue = Math.max(burstResidue, intensity * 0.7);
          heatGlow     = Math.max(heatGlow,     intensity * 0.6);
        }
      },
      onQuiet: function(rms, dur) { return dur > 2.0 ? 'brownian' : null; },
      onTransition: function(from, to, progress) {
        if (to === 'chorus') burstResidue = Math.max(burstResidue, progress * 0.6);
      },
    },

    glow: {
      label: 'Glow — Lo-Fi',
      paramBias: { kick:0.6, breath:1.5, bass:0.7, hihat:0.5, vocal:1.6, chorus:0.9, drop:0.8, snare:0.5 },
      adaptBias: { kick:-0.1, bass:0, breath:0.4, hihat:-0.1, vocal:0.4, chorus:0 },
      onKick: function(str, phase) {
        if (str > 0.50) kickSpring(str * 0.6);
      },
      onSnare: function(str, phase) { /* glow 无 snare 冲量 */ },
      onChorus: function(intensity) {
        vortexSpin = Math.max(vortexSpin, intensity * 0.55);
      },
      onQuiet: function(rms, dur) {
        if (dur > 0.5) return 'stardust';
        return null;
      },
      onTransition: function(from, to, progress) {
        // glow 的过渡：增强 vocal 流场
        _microTargetBoost = Math.max(_microTargetBoost, progress * 0.4);
      },
    },

    wave: {
      label: 'Wave — 流行/R&B',
      paramBias: { kick:1.1, breath:1.3, bass:1.0, hihat:1.0, vocal:1.3, chorus:1.1, drop:1.0, snare:1.0 },
      adaptBias: { kick:0.1, bass:0, breath:0.2, hihat:0, vocal:0.2, chorus:0.1 },
      onKick: function(str, phase) {
        // wave：kick 根据小节相位变化（强拍多、弱拍少）
        var phaseBonus = (phase < 0.15 || (phase > 0.48 && phase < 0.55)) ? 1.2 : 0.85;
        kickSpring(str * phaseBonus);
      },
      onSnare: function(str, phase) {
        if (str > 0.38) kickSpring(str * 0.8);
      },
      onChorus: function(intensity) {
        if (intensity > 0.45) vortexSpin = Math.max(vortexSpin, intensity * 0.5);
      },
      onQuiet: function(rms, dur) { return dur > 1.0 ? 'breathDrift' : null; },
      onTransition: function(from, to, progress) {
        if (to === 'chorus' || to === 'preChorus') {
          vocalSmooth = Math.min(1.0, vocalSmooth + progress * 0.3);
        }
      },
    },
  };

  // 当前激活预设（默认 null = 不使用预设，保持原有逻辑）
  var _activePreset     = null;   // null | 'pulse'|'flow'|'shatter'|'glow'|'wave'
  var _presetObj        = null;   // 指向 PRESETS[_activePreset]

  /** 设置预设（外部调用） */
  function setPreset(name) {
    if (name === null || name === 'none') {
      _activePreset = null;
      _presetObj    = null;
      return;
    }
    if (PRESETS[name]) {
      _activePreset = name;
      _presetObj    = PRESETS[name];
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  Module C — 安静段落微动画
   *
   *  当 silence > 0.55 或 rms 持续低于阈值时激活。
   *  通过微幅调制现有 uniforms 而非新增 uniform，
   *  不依赖 shader 修改。
   *
   *  四种类型（由预设 onQuiet 返回）：
   *    quantum    — 高频量子闪烁（微幅 hihat 噪声）
   *    breathDrift— 低频漂移呼吸（放大 breathAmt 周期）
   *    stardust   — 星尘闪烁（稀疏 hihat 脉冲）
   *    brownian   — 布朗运动（随机 spring 微冲量）
   * ════════════════════════════════════════════════════════════ */
  var _quietDuration     = 0;      // 持续安静时间（秒）
  var _microType         = null;   // 当前微动画类型
  var _microIntensity    = 0;      // 微动画强度 0-1
  var _microTargetBoost  = 0;      // 外部注入的临时加成（由 Transition/preset 写入）
  var _microPhase        = 0;      // 微动画内部相位（多用途）
  var _microEnabled      = true;   // 用户开关

  // Stardust：随机脉冲定时器
  var _stardustTimer     = 0;
  var _stardustInterval  = 1.8;    // 下次闪烁秒数（随机）

  // Brownian：随机冲量定时器
  var _brownianTimer     = 0;
  var _brownianInterval  = 0.9;

  function _seededRand(seed) {
    // 简单 LCG 伪随机（不依赖 Math.random）
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return ((seed >>> 0) / 4294967295);
  }

  function tickMicroAnimations(dt, arState) {
    var silence = arState ? (arState.silence || 0) : 0;
    var rms     = arState ? (arState.rms     || 0) : 0;
    var uni     = g.uniforms;
    if (!uni || !_microEnabled) {
      _quietDuration = 0;
      return;
    }

    // 安静条件：silence > 0.5 OR rms < 0.018
    var isQuiet = silence > 0.50 || rms < 0.018;
    if (isQuiet) {
      _quietDuration += dt;
    } else {
      _quietDuration = Math.max(0, _quietDuration - dt * 2.0);
    }

    // 预设决定微动画类型
    var newType = null;
    if (_presetObj && _presetObj.onQuiet) {
      newType = _presetObj.onQuiet(rms, _quietDuration);
    } else if (_quietDuration > 1.2) {
      // 无预设时默认 breathDrift
      newType = 'breathDrift';
    }

    if (newType !== _microType) {
      _microType  = newType;
      _microPhase = 0;
      _stardustTimer = 0;
      _brownianTimer = 0;
    }

    // 微动画强度：平滑进入/退出
    var targetIntensity = (_microType && _quietDuration > 0.5)
      ? clamp01(_quietDuration / 2.5)
      : 0;
    targetIntensity += _microTargetBoost;
    _microTargetBoost *= Math.pow(0.05, dt); // 快速衰减
    _microIntensity = follow(_microIntensity, clamp01(targetIntensity), 0.6, 0.8, dt);

    if (_microIntensity < 0.02) return;
    var I = _microIntensity * params.master;

    _microPhase += dt;

    switch (_microType) {
      /* ── quantum：高频随机闪烁，微调 hihatSmooth ── */
      case 'quantum':
        var qn = _seededRand(Math.floor(_microPhase * 31) + 1001);
        var qFlicker = (qn - 0.5) * 0.18 * I;
        hihatSmooth = clamp01(hihatSmooth + qFlicker);
        // 每 ~50ms 随机弹一次弱冲量
        if (Math.floor(_microPhase * 20) !== Math.floor((_microPhase - dt) * 20)) {
          if (_seededRand(Math.floor(_microPhase * 20) + 777) > 0.72) {
            kickSpring(0.08 * I);
          }
        }
        break;

      /* ── breathDrift：放大呼吸相位漂移，增加余韵 ── */
      case 'breathDrift':
        // 在呼吸幅度基础上叠加一个慢速正弦漂移
        var drift = Math.sin(_microPhase * 0.65) * 0.12 * I;
        breathAmt = clamp01(breathAmt + drift);
        break;

      /* ── stardust：稀疏随机 hihat 闪光脉冲 ── */
      case 'stardust':
        _stardustTimer -= dt;
        if (_stardustTimer <= 0) {
          // 随机下次间隔 [0.6, 2.4] 秒
          var rr = _seededRand(Math.floor(_microPhase * 100) + 3333);
          _stardustInterval = 0.6 + rr * 1.8;
          _stardustTimer    = _stardustInterval;
          // 触发一次短暂 hihat 脉冲
          var pulse = (0.25 + rr * 0.45) * I;
          hihatSmooth = clamp01(hihatSmooth + pulse);
          // 偶尔触发弱冲量
          if (rr > 0.60) kickSpring(0.05 * I);
        }
        break;

      /* ── brownian：随机小冲量模拟布朗运动 ── */
      case 'brownian':
        _brownianTimer -= dt;
        if (_brownianTimer <= 0) {
          var br = _seededRand(Math.floor(_microPhase * 77) + 5555);
          _brownianInterval = 0.5 + br * 1.0;
          _brownianTimer    = _brownianInterval;
          // 正负随机冲量
          var impulse = (br * 2 - 1) * 0.22 * I;
          springVel += impulse;
          springPos = clamp(springPos, -1.0, 2.2);
        }
        break;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  Module D — 段落过渡动画
   *
   *  检测 AudioReactive.state.section 变化，
   *  执行对应的视觉序列（通过调制现有内部状态变量）。
   *
   *  过渡序列定义（from → to）：
   *    * → intro       : 渐入，静默，breath 极低
   *    intro → verse   : 呼吸加强 + vocal 渐入
   *    verse → preChorus: vocal + breathAmt 快速上升
   *    preChorus → chorus: spring 大冲量 + flash + burstResidue
   *    chorus → verse  : shockwave ring + 慢速衰减
   *    chorus → bridge : bass ring + 涡旋停止 + 呼吸放缓
   *    bridge → chorus : gather 效果 + 再度爆发
   *    * → outro       : 一切缓慢淡出
   * ════════════════════════════════════════════════════════════ */
  var _transActive       = false;
  var _transProgress     = 0;      // 0 → 1
  var _transFrom         = null;
  var _transTo           = null;
  var _transDuration     = 1.5;    // 秒
  var _transStrength     = 1.0;    // 用户控制强度 0-2
  var _lastKnownSection  = null;   // 上次已处理的 section，用于变化检测

  // ── 段落级电影转场层（独立于 drop/chorus 状态机）──────────────
  //   蓄力期 GATHER：粒子向心收缩 + 暗化
  //   爆发期 BURST ：径向炸开 + 轻微闪光
  //   释放期 RELEASE：余烬漂回
  //   与 tickDropSequence 叠加，强度分层（远小于 drop 爆发）
  var _secLayer          = { active: false, phase: 'IDLE', t: 0, dur: 0, from: null, to: null, flashed: false };
  var secGatherVal       = 0;
  var secBurstVal        = 0;
  var secDarkenVal       = 0;
  var SEC_PHASE = { GATHER: 0.50, BURST: 0.30, RELEASE: 1.20 };

  // 过渡时长配置（各目标段落）
  var TRANS_DUR = {
    intro:     1.2,
    verse:     1.5,
    preChorus: 1.0,
    chorus:    0.8,   // 快速爆发
    bridge:    1.8,
    outro:     2.5,
  };

  function _triggerTransition(from, to) {
    _transActive   = true;
    _transProgress = 0;
    _transFrom     = from;
    _transTo       = to;
    _transDuration = TRANS_DUR[to] || 1.5;
    // 启动段落级电影转场层：蓄力 → 爆发 → 释放
    _secLayer = { active: true, phase: 'GATHER', t: 0, dur: SEC_PHASE.GATHER, from: from, to: to, flashed: false };
  }

  // ── 段落级电影转场层 tick ──────────────────────────────────────
  //   S = 总强度：用户强度 × master × 目标段落权重
  //     chorus/preChorus 1.0（爆发最强），bridge/verse 0.8，intro/outro 0.5
  function tickSecLayer(dt) {
    if (!_secLayer.active) {
      secGatherVal = 0; secBurstVal = 0; secDarkenVal = 0;
      return;
    }
    var to = _secLayer.to;
    var weight = (to === 'chorus' || to === 'preChorus') ? 1.0
               : (to === 'intro' || to === 'outro')      ? 0.5
               : 0.8;
    var S = _transStrength * params.master * weight;

    _secLayer.t += dt;
    var p = clamp01(_secLayer.t / Math.max(0.05, _secLayer.dur));

    if (_secLayer.phase === 'GATHER') {
      // 蓄力：向心收缩 + 暗化
      secGatherVal = p * S;
      secDarkenVal = p * 0.6 * S;
      secBurstVal  = 0;
      if (p >= 1.0) {
        _secLayer.phase = 'BURST';
        _secLayer.t = 0;
        _secLayer.dur = SEC_PHASE.BURST;
      }
    } else if (_secLayer.phase === 'BURST') {
      // 爆发：径向炸开 + 轻微闪光（仅一次，强度远小于 drop 爆发）
      secGatherVal = (1 - p) * S;
      secBurstVal  = Math.sin(p * Math.PI) * S;
      secDarkenVal = (1 - p) * 0.6 * S;
      if (p < 0.08 && !_secLayer.flashed) {
        _triggerFlash(0.5 * S);
        _triggerVignette(0.4 * S);
        _secLayer.flashed = true;
      }
      if (p >= 1.0) {
        _secLayer.phase = 'RELEASE';
        _secLayer.t = 0;
        _secLayer.dur = SEC_PHASE.RELEASE;
      }
    } else if (_secLayer.phase === 'RELEASE') {
      // 释放：余烬缓慢漂回
      secBurstVal  = (1 - p) * 0.3 * S;
      secGatherVal = 0;
      secDarkenVal = 0;
      if (p >= 1.0) {
        _secLayer.active = false;
        _secLayer.phase = 'IDLE';
      }
    }
  }

  function tickTransition(dt, arState) {
    if (!arState) return;
    var curSection = arState.section;

    // 检测段落变化
    if (_lastKnownSection === null) {
      _lastKnownSection = curSection;
    } else if (curSection !== _lastKnownSection) {
      _triggerTransition(_lastKnownSection, curSection);
      _lastKnownSection = curSection;
    }

    if (!_transActive) return;

    _transProgress += dt / Math.max(0.1, _transDuration);
    var p = clamp01(_transProgress);
    var S = _transStrength * params.master;

    // 通知预设
    if (_presetObj && _presetObj.onTransition) {
      _presetObj.onTransition(_transFrom, _transTo, p);
    }

    // ── 段落过渡视觉序列 ────────────────────────────────────
    var from = _transFrom, to = _transTo;
    var easeIn  = p * p;                              // ease-in
    var easeOut = 1 - (1 - p) * (1 - p);             // ease-out
    var bell    = Math.sin(p * Math.PI);              // 0→1→0 钟形

    if (to === 'intro') {
      // 进入 intro：一切安静下来
      breathAmt    = lerp(breathAmt,    0.06, easeOut * 0.3);
      vortexSpin   = lerp(vortexSpin,   0,    easeOut * 0.4);
      burstResidue = lerp(burstResidue, 0,    easeOut * 0.5);

    } else if (to === 'verse') {
      // intro→verse 或 bridge→verse：呼吸加强，vocal 渐入
      if (from === 'intro') {
        breathAmt   = lerp(breathAmt,   0.15 + easeIn * 0.10,  0.12);
        vocalSmooth = lerp(vocalSmooth, easeIn * 0.25 * S,     0.10);
      } else if (from === 'chorus') {
        // 副歌退出：shockwave 尾迹 + 慢衰减
        if (p < 0.4) kickSpring(bell * 2.5 * S * 0.2);
      }

    } else if (to === 'preChorus') {
      // verse→preChorus：紧张感累积，vocal + breath 上升
      breathAmt   = lerp(breathAmt,   breathAmt * (1 + easeIn * 0.35 * S),  0.15);
      vocalSmooth = lerp(vocalSmooth, easeIn * 0.45 * S, 0.12);
      // 接近顶点时弱冲量
      if (p > 0.70 && p < 0.80) kickSpring(0.8 * S);

    } else if (to === 'chorus') {
      // preChorus→chorus 或 bridge→chorus：大冲量 + 爆发
      if (p < 0.12) {
        // 进入瞬间：一次大冲量 + flash
        kickSpring(5.0 * S);
        burstResidue = Math.max(burstResidue, 0.85 * S);
        heatGlow     = Math.max(heatGlow,     0.75 * S);
        _triggerFlash(0.7 * S);
        _triggerVignette(0.5 * S);
      }
      // 0.1-0.5s 内 vortex 快速建立
      if (p < 0.45) {
        vortexSpin = lerp(vortexSpin, easeIn * 0.9 * S, 0.18);
      }

    } else if (to === 'bridge') {
      // chorus→bridge：涡旋减速，bass ring，呼吸变慢
      if (p < 0.15) {
        // 进入时一次 bass ring（靠 springVel 模拟）
        kickSpring(-2.0 * S);  // 负冲量：粒子向内收缩
        burstResidue = Math.max(burstResidue, 0.3 * S);
      }
      vortexSpin = lerp(vortexSpin, vortexSpin * (1 - easeIn * 0.8 * S * 0.5), 0.12);
      breathAmt  = lerp(breathAmt,  0.10 + (1 - easeIn) * 0.10, 0.08);

    } else if (to === 'outro') {
      // * → outro：一切缓慢淡出
      var fadeOut = 1 - easeIn;
      breathAmt   = lerp(breathAmt,   breathAmt   * fadeOut, 0.06);
      vortexSpin  = lerp(vortexSpin,  vortexSpin  * fadeOut, 0.05);
      burstResidue= lerp(burstResidue,burstResidue * fadeOut, 0.06);
      heatGlow    = lerp(heatGlow,    heatGlow    * fadeOut, 0.08);
    }

    // 预设 chorus 通知（在进入副歌时）
    if (to === 'chorus' && _presetObj && _presetObj.onChorus) {
      _presetObj.onChorus(bell);
    }

    if (p >= 1.0) {
      _transActive = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  预设 paramBias 写入到 params（临时覆盖）
   *
   *  只在 _activePreset 有效时生效，通过 _applyPresetBias() 在
   *  tick 末尾调用，直接调整 params 对象（setParams 是持久写入，
   *  这里改用一个临时乘数层，reset 时恢复原始 params）
   * ════════════════════════════════════════════════════════════ */
  // 保存用户原始 params 值（在 setPreset 时快照，reset 时恢复）
  var _userParams = null;

  function _snapshotUserParams() {
    _userParams = {};
    var keys = ['kick','breath','bass','hihat','vocal','chorus','drop','snare'];
    for (var k = 0; k < keys.length; k++) {
      _userParams[keys[k]] = params[keys[k]];
    }
  }

  function _restoreUserParams() {
    if (!_userParams) return;
    var keys = Object.keys(_userParams);
    for (var k = 0; k < keys.length; k++) {
      params[keys[k]] = _userParams[keys[k]];
    }
  }

  // 已应用预设偏置的 params 快照（避免每帧覆盖）
  var _presetApplied = false;

  function _applyPresetBias() {
    if (!_presetObj || !_userParams) return;
    var bias = _presetObj.paramBias || {};
    var keys = Object.keys(bias);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (_userParams[key] !== undefined) {
        params[key] = _userParams[key] * bias[key];
      }
    }
    // adapt 偏置注入 adapt 对象
    var abias = _presetObj.adaptBias || {};
    var akeys = Object.keys(abias);
    for (var j = 0; j < akeys.length; j++) {
      var ak = akeys[j];
      if (adapt[ak] !== undefined) {
        adapt[ak] = clamp(adapt[ak] + abias[ak] * 0.04, 0.4, 2.0);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  预设 kick/snare 事件派发
   * ════════════════════════════════════════════════════════════ */
  var _prevKickForPreset  = 0;
  var _prevSnareForPreset = 0;

  function _dispatchPresetEvents(arState) {
    if (!_presetObj || !arState) return;
    var kick  = arState.kick  || 0;
    var snare = arState.snare || 0;
    var bar   = arState.barPhase || 0;

    // kick 上升沿
    if (kick > 0.40 && _prevKickForPreset <= 0.40) {
      if (_presetObj.onKick) _presetObj.onKick(kick, bar);
    }
    // snare 上升沿
    if (snare > 0.38 && _prevSnareForPreset <= 0.38) {
      if (_presetObj.onSnare) _presetObj.onSnare(snare, bar);
    }
    _prevKickForPreset  = kick;
    _prevSnareForPreset = snare;
  }

  /* ══════════════════════════════════════════════════════════════
   *  扩展 setParams — 支持 preset 字段
   * ════════════════════════════════════════════════════════════ */
  function setParamsEx(p) {
    setParams(p);
    if (!p) return;
    if (p.preset !== undefined) {
      if (!_presetApplied) _snapshotUserParams();
      setPreset(p.preset);
      _presetApplied = true;
    }
    if (p.microEnabled !== undefined) {
      _microEnabled = !!p.microEnabled;
    }
    if (p.transStrength !== undefined) {
      _transStrength = parseFloat(p.transStrength) || 1.0;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  注入到主 tick — Module B/C/D 子 tick
   *  在原有 tick 的最后（_writeUniforms 之后）调用
   * ════════════════════════════════════════════════════════════ */
  function tickEx(dt) {
    tick(dt);
    var arState = g.AudioReactive ? g.AudioReactive.state : null;

    // Module B — 预设偏置
    if (_activePreset && _userParams) {
      _applyPresetBias();
    }
    // Module B — 事件派发
    _dispatchPresetEvents(arState);

    // Module C — 微动画
    tickMicroAnimations(dt, arState);

    // Module D — 段落过渡
    tickTransition(dt, arState);
    // Module D+ — 段落级电影转场层（蓄力→爆发→释放）
    tickSecLayer(dt);
  }

  /* ══════════════════════════════════════════════════════════════
   *  注入到 reset
   * ════════════════════════════════════════════════════════════ */
  function resetEx() {
    reset();
    // Module C/D 重置
    _quietDuration    = 0;
    _microType        = null;
    _microIntensity   = 0;
    _microTargetBoost = 0;
    _microPhase       = 0;
    _stardustTimer    = 0;
    _brownianTimer    = 0;
    _transActive      = false;
    _transProgress    = 0;
    _transFrom        = null;
    _transTo          = null;
    _lastKnownSection = null;
    // 段落级电影转场层复位
    _secLayer = { active: false, phase: 'IDLE', t: 0, dur: 0, from: null, to: null, flashed: false };
    secGatherVal = 0; secBurstVal = 0; secDarkenVal = 0;
    _prevKickForPreset  = 0;
    _prevSnareForPreset = 0;
    // 如有预设，恢复用户原始 params
    if (_presetApplied) _restoreUserParams();
  }

  /* ── 导出 ─────────────────────────────────────────────────── */
  g.ParticleBehavior = { tick: tickEx, reset: resetEx, state: state, setParams: setParamsEx, params: params, setPreset: setPreset, presets: PRESETS };

})(window);
