/**
 * Lyric3 — Per-Character Reactive Typography System
 * Susumusic v10 · 逐字级音频驱动动画
 *
 * 每个字符都是独立的能量粒子，按音乐节奏依次被激活。
 * 支持 YRC 逐词精确时间轴 + LRC progress 估算双模式。
 *
 * 依赖: GSAP 3, app.js 全局:
 *   audio, bass, mid, beatPulse, beatCam, uniforms.uTime, fx,
 *   lyricsLines, stageLyrics, camera, THREE, lyricFontStackForKey()
 */
(function (root) {
  'use strict';

  /* ═══════════════════════════════════════════════════
   * 工具
   * ═══════════════════════════════════════════════════ */
  function clamp(v, lo, hi) {
    var n = Number(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hexToRgba(hex, a) {
    hex = String(hex||'').replace(/^#/,'');
    if (hex.length===3) hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length!==6) return 'rgba(156,255,223,'+a+')';
    return 'rgba('+parseInt(hex.slice(0,2),16)+','+parseInt(hex.slice(2,4),16)+','+parseInt(hex.slice(4,6),16)+','+a+')';
  }

  /* ═══════════════════════════════════════════════════
   * CSS
   * ═══════════════════════════════════════════════════ */
  var STYLE_ID = 'lyric3-css';
  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = [
      '#lyric3-panel{',
      '  position:fixed;inset:0;z-index:15;pointer-events:none;display:none;',
      '  perspective:1200px;overflow:visible;',
      '}',
      '#lyric3-panel.l3-active{display:block;}',
      '.l3-slot{',
      '  position:absolute;left:0;right:0;top:0;',
      '  display:flex;align-items:center;justify-content:center;',
      '  padding:0 clamp(24px,6vw,96px);box-sizing:border-box;',
      '  will-change:transform,opacity,filter;',
      '}',
      '.l3-text{',
      '  display:block;width:100%;max-width:min(1100px,calc(100vw - 48px));',
      '  text-align:center;white-space:nowrap;overflow:visible;',
      '  font-family:var(--l3-font,"PingFang SC","Microsoft YaHei",sans-serif);',
      '  font-weight:var(--l3-weight,900);font-size:var(--l3-size,46px);',
      '  letter-spacing:var(--l3-spacing,0px);line-height:1.1;',
      '  color:var(--l3-color,#f6fdff);',
      '  -webkit-text-stroke:.18px rgba(255,255,255,.68);paint-order:stroke fill;',
      '  user-select:none;pointer-events:none;',
      '}',
      /* 当前行基础溢光(slot 级) */
      '.l3-slot[data-role="current"] .l3-text{',
      '  text-shadow:0 0 1px rgba(255,255,255,.36),',
      '    0 0 var(--l3-gs,8px) var(--l3-gc1,rgba(156,255,223,.38)),',
      '    0 0 var(--l3-gw,20px) var(--l3-gc2,rgba(156,255,223,.20));',
      '  filter:brightness(var(--l3-br,1));',
      '}',
      /* 单字 */
      '.l3-char{',
      '  display:inline-block;will-change:transform,opacity;',
      '  transform-style:preserve-3d;',
      '  transition:none;',
      '}',
      '.l3-space{opacity:0;width:.25em;}',
      /* 波纹背景 */
      '.l3-ripple{',
      '  position:absolute;inset:0;pointer-events:none;',
      '  opacity:var(--l3-ripple,0);transition:opacity .8s;',
      '  background:radial-gradient(ellipse 60% 30% at 50% 50%,',
      '    var(--l3-gc2,rgba(156,255,223,.08)),transparent 70%);',
      '  filter:blur(22px);z-index:-1;',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════
   * DOM
   * ═══════════════════════════════════════════════════ */
  var panel=null, slotEls=[], slotTexts=[];

  function injectHTML() {
    if (document.getElementById('lyric3-panel')) {
      panel = document.getElementById('lyric3-panel');
      slotEls  = [].slice.call(panel.querySelectorAll('.l3-slot'));
      slotTexts= [].slice.call(panel.querySelectorAll('.l3-text'));
      return;
    }
    panel = document.createElement('div'); panel.id='lyric3-panel';
    var rip = document.createElement('div'); rip.className='l3-ripple'; panel.appendChild(rip);
    var roles = ['prev','current','next'];
    for (var i=0;i<3;i++){
      var sl = document.createElement('div'); sl.className='l3-slot'; sl.setAttribute('data-role',roles[i]);
      var tx = document.createElement('div'); tx.className='l3-text';
      sl.appendChild(tx); panel.appendChild(sl);
      slotEls.push(sl); slotTexts.push(tx);
    }
    document.body.appendChild(panel);
  }

  /* ═══════════════════════════════════════════════════
   * 状态
   * ═══════════════════════════════════════════════════ */
  var enabled=false, curLyricIdx=-99, transitioning=false;
  var slots=[0,1,2];
  var energyS=0, beatS=0, bassS=0;
  var centerY=null;

  /* 每个 slot 的逐字数据:
   *   slotChars[slotIdx] = {
   *     spans: [<span>, ...],       DOM
   *     timing: [{tStart, tEnd}, ...]   绝对秒
   *     states: [0=idle,1=preglow,2=burst,3=settle,4=done, ...]
   *     burstAge: [float, ...]      burst 开始后的秒数
   *     lyricIdx: number            对应的 lyricsLines 索引
   *   }
   */
  var slotChars = [{},{},{}];

  /* ═══════════════════════════════════════════════════
   * FX
   * ═══════════════════════════════════════════════════ */
  function getFx(k,d){ return root.fx&&root.fx[k]!=null?root.fx[k]:d; }
  function fxGap()   { return clamp(getFx('lyric3Gap',1),  .2,2.5); }
  function fxDepth() { return clamp(getFx('lyric3Depth',1), 0,2); }
  function fxBreath(){ return clamp(getFx('lyric3Breath',1),0,2.5); }
  function fxScale() { return clamp(getFx('lyric3Scale',1),.4,1.6); }

  /* ═══════════════════════════════════════════════════
   * 字体 / 尺寸
   * ═══════════════════════════════════════════════════ */
  var FONT_RATIO = {prev:.72, current:1, next:.75};
  function baseFontPx(){ return Math.round(clamp((window.innerWidth||1200)*.042,22,56)*fxScale()); }
  function fontPxForRole(r){ return Math.round(baseFontPx()*FONT_RATIO[r]); }
  function applyFont(si,role){ slotTexts[si].style.fontSize=fontPxForRole(role)+'px'; }

  /* ═══════════════════════════════════════════════════
   * centerY — 跟随 3D 歌词投影
   * ═══════════════════════════════════════════════════ */
  function getCenterY(){ return centerY!=null?centerY:(window.innerHeight||800)*.5; }
  function updateCenterY(){
    var h=window.innerHeight||800;
    var ly=root.fx&&root.fx.lyricOffsetY!=null?clamp(Number(root.fx.lyricOffsetY),-1.2,1.35):0;
    var tgt=h*.5-ly*h*.20;
    try{
      var sl=root.stageLyrics,cam=root.camera,T=root.THREE;
      if(sl&&sl.group&&cam&&T){
        var v=new T.Vector3().copy(sl.group.position).project(cam);
        var p=(1-v.y)*.5*h;
        if(isFinite(p)&&p>h*.04&&p<h*.96) tgt=p;
      }
    }catch(e){}
    centerY = centerY==null ? tgt : centerY+(tgt-centerY)*.12;
  }

  /* ═══════════════════════════════════════════════════
   * roleProps
   * ═══════════════════════════════════════════════════ */
  function roleProps(role){
    var g=fxGap()*clamp(window.innerHeight*.095,60,130), d=fxDepth();
    if(role==='prev')    return {y:-g,scale:.88,opacity:.28,blur:1.8,br:.60,z:-75*d};
    if(role==='current') return {y:0, scale:1,  opacity:1,  blur:0,  br:1,  z:0};
    return                      {y:g, scale:.90,opacity:.44,blur:1,  br:.74,z:-48*d};
  }
  function filterStr(bl,br){ return 'blur('+bl.toFixed(2)+'px) brightness('+br.toFixed(3)+')'; }

  /* ═══════════════════════════════════════════════════
   * 逐字 DOM 构建
   * ═══════════════════════════════════════════════════ */
  function populateSlotChars(si, text, lyricIdx, role) {
    var container = slotTexts[si];
    container.textContent = '';
    var chars = String(text||'').split('');
    var spans=[], states=[], burstAge=[], burstFired=[];
    for (var i=0;i<chars.length;i++){
      var ch = chars[i];
      var sp = document.createElement('span');
      if (/\s/.test(ch)) {
        sp.className='l3-char l3-space';
        sp.textContent=' ';
      } else {
        sp.className='l3-char';
        sp.textContent=ch;
      }
      // 非 current 的 slot 直接全亮
      var isActive = (role!=='current');
      sp.style.opacity = isActive ? '1' : '0.22';
      sp.style.transform = 'translateZ(0px) scaleX(1) scaleY(1)';
      container.appendChild(sp);
      spans.push(sp);
      states.push(isActive ? 4 : 0);
      burstAge.push(0);
      burstFired.push(false);
    }
    var timing = buildCharTiming(lyricIdx, chars.length);
    slotChars[si] = {
      spans:spans, timing:timing, states:states, burstAge:burstAge, burstFired:burstFired,
      lyricIdx:lyricIdx, text:text
    };
  }

  /* ═══════════════════════════════════════════════════
   * 逐字时间轴构建
   *
   * YRC: words[] 有精确 t/d/c0/c1，拆分到每个字符
   * LRC: 按行的 t ~ nextLine.t 均匀分布
   * ═══════════════════════════════════════════════════ */
  function buildCharTiming(lyricIdx, charCount) {
    var lines = root.lyricsLines;
    if (!lines||lyricIdx<0||lyricIdx>=lines.length||!charCount) return [];
    var line = lines[lyricIdx];
    var result = [];
    // YRC 有 words
    if (line.words && line.words.length) {
      // 先为每个字符分配 -1 表示未覆盖
      for (var i=0;i<charCount;i++) result.push({tStart:-1,tEnd:-1});
      for (var w=0;w<line.words.length;w++){
        var wd = line.words[w];
        var wLen = wd.c1 - wd.c0;
        if (wLen<=0) continue;
        var perChar = Math.max(0.04, (wd.d||0.24) / wLen);
        for (var c=0;c<wLen;c++){
          var ci = wd.c0 + c;
          if (ci>=0 && ci<charCount){
            result[ci] = {
              tStart: wd.t + c * perChar,
              tEnd:   wd.t + (c+1) * perChar
            };
          }
        }
      }
      // 填补未覆盖的字符
      var lastEnd = line.t;
      for (var i=0;i<result.length;i++){
        if (result[i].tStart<0){
          result[i].tStart = lastEnd;
          result[i].tEnd   = lastEnd + 0.12;
        }
        lastEnd = result[i].tEnd;
      }
      return result;
    }
    // LRC: 均匀分布
    var nextLine = lines[lyricIdx+1];
    var lineEnd  = nextLine ? nextLine.t : line.t + (line.duration||4.8);
    var span     = Math.max(0.5, lineEnd - line.t);
    var perChar  = span / charCount;
    for (var i=0;i<charCount;i++){
      result.push({
        tStart: line.t + i * perChar,
        tEnd:   line.t + (i+1) * perChar
      });
    }
    return result;
  }

  /* ═══════════════════════════════════════════════════
   * 挤牙膏 Toothpaste 连续动画系统
   *
   * 用单一 animAge 驱动三段无缝曲线，彻底消除状态硬跳：
   *   WARMUP : 淡入 + 纵向轻压 (蓄力)
   *   BURST  : 弹出伸展 + 溢光峰值 (挤出)
   *   SETTLE : 弹性衰减平滑落定
   * 所有相位边界处属性值精确连续。
   * ═══════════════════════════════════════════════════ */
  var A_WARMUP = 0.30;   // 蓄力阶段
  var A_BURST  = 0.26;   // 弹出阶段
  var A_SETTLE = 0.62;   // 衰减阶段
  var A_TOTAL  = A_WARMUP + A_BURST + A_SETTLE;  // 1.18s

  /* easing */
  function easeInCubic(t)  { return t * t * t; }
  function easeOutCubic(t) { var u=1-t; return 1 - u*u*u; }
  function easeInOutCubic(t){ return t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
  function easeOutBack(t, c){ c = c||1.5; var c1=c, c3=c1+1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); }

  /* ── 动画核心: 根据 animAge 计算单字所有视觉属性 ──
   * animAge: now - (tm.tStart - A_WARMUP - lookahead)
   * burstStr: 1.0 ~ 1.6  高能量时更强烈
   * depth   : fxDepth()  景深倍率
   */
  function toothpasteAnim(animAge, burstStr, depth) {
    var bs = clamp(burstStr, 1, 1.7);

    // ── 未到预热 → 暗淡静止 ──
    if (animAge < 0) {
      return { opacity: 0.22, sx: 1, sy: 1, z: -3*depth, glow: 0, done: false };
    }
    // ── 动画结束 → 全亮静止 ──
    if (animAge >= A_TOTAL) {
      return { opacity: 1, sx: 1, sy: 1, z: 0, glow: 0, done: true };
    }

    var opacity, sx, sy, z, glow;

    if (animAge < A_WARMUP) {
      /* ────── WARMUP: 缓入 + 纵向蓄力压缩 ────── */
      var w = animAge / A_WARMUP;
      var we = easeInOutCubic(w);
      opacity = lerp(0.22, 0.68, we);
      // 纵向轻压 (最大压缩 9%)
      sy  = 1 - 0.09 * easeInCubic(w);
      // 横向因泊松效应略微扩张
      sx  = 1 + 0.025 * easeInCubic(w);
      z   = lerp(-3, -1, we) * depth;
      glow = 0.08 * we;

    } else if (animAge < A_WARMUP + A_BURST) {
      /* ────── BURST: 弹出 + easeOutBack 过冲 ────── */
      var b = (animAge - A_WARMUP) / A_BURST;
      var be = easeOutBack(b, 1.4);
      opacity = lerp(0.68, 1.0, easeOutCubic(b));
      // 纵向: 从压缩态 0.91 弹出到 1 + overshoot
      var syPeak = 1 + 0.11 * bs;
      sy  = lerp(0.91, syPeak, be);
      // 横向: 伸展时相应内缩，落定归 1
      sx  = lerp(1.025, 1 - 0.04 * (be - 1) * bs, easeOutCubic(b));
      // Z 轴: 弹出到 20px 然后随 be 收回
      z   = lerp(-1, 20 * depth, Math.sin(b * Math.PI * 0.85));
      // 溢光峰值在 b≈0.5，连续过渡
      glow = Math.sin(b * Math.PI) * 0.92 + 0.08 * (1 - b);

    } else {
      /* ────── SETTLE: 弹性衰减落定 ────── */
      var s = (animAge - A_WARMUP - A_BURST) / A_SETTLE;
      var se = easeOutCubic(s);
      opacity = 1;
      // 从 BURST 末端的过冲态平滑衰减至 1
      var syStart = 1 + 0.11 * bs;
      sy  = 1 + (syStart - 1) * Math.pow(1 - s, 2.2);
      sx  = 1 + (1.025 - 1) * Math.exp(-5 * s) * (1-s);  // 快速恢复
      z   = 20 * depth * Math.pow(1 - s, 3);
      glow = 0.08 * Math.pow(1 - s, 1.5);
    }

    return {
      opacity: clamp(opacity, 0, 1),
      sx: clamp(sx, 0.7, 1.5),
      sy: clamp(sy, 0.7, 1.5),
      z:  z,
      glow: clamp(glow, 0, 1),
      done: false
    };
  }

  /* ═══════════════════════════════════════════════════
   * 逐字帧更新 (只作用于 current slot)
   *
   * 音频时间轴驱动: 每字在 tm.tStart 前 A_WARMUP+lookahead
   * 秒开始预热, 以 toothpasteAnim 计算所有视觉属性。
   * ═══════════════════════════════════════════════════ */
  function tickChars(dt) {
    var si = slots[1];
    var cd = slotChars[si];
    if (!cd||!cd.spans||!cd.spans.length) return;

    var now = root.audio ? root.audio.currentTime : 0;
    var depth = fxDepth();

    // 能量因子: 0~1
    var ef = clamp(energyS * 1.2 + beatS * 0.6, 0, 1);
    // 高能量时提前启动预热 (最多提前 0.20s)
    var lookahead = ef * 0.20;
    // 高能量时 burst 更强 (1.0 ~ 1.55)
    var burstStr = 1 + ef * 0.55;

    var charBurstCount = 0;

    for (var i=0; i<cd.spans.length; i++) {
      var sp = cd.spans[i];
      if (sp.classList.contains('l3-space')) continue;

      var st = cd.states[i];
      if (st===4) continue;   // done, skip

      var tm = cd.timing[i];
      if (!tm || tm.tStart < 0) continue;

      // animAge: 以 tm.tStart 为"burst零点"，提前 A_WARMUP+lookahead 开始
      var animAge = now - (tm.tStart - A_WARMUP - lookahead);

      // ── 状态管理 ──
      if (st===0 && animAge >= 0) {
        cd.states[i] = 1; st = 1;  // 进入动画
      }
      if (st===1) {
        // burst 触发点: animAge >= A_WARMUP
        if (!cd.burstFired[i] && animAge >= A_WARMUP) {
          cd.burstFired[i] = true;
          charBurstCount++;
        }
        // 动画完成
        if (animAge >= A_TOTAL) {
          cd.states[i] = 4; st = 4;
        }
      }

      // ── 视觉计算 ──
      if (st === 4) {
        sp.style.opacity = '1';
        sp.style.transform = 'translateZ(0px) scaleX(1) scaleY(1)';
        if (sp.style.textShadow) sp.style.textShadow = '';
        continue;
      }

      var v = toothpasteAnim(animAge, burstStr, depth);

      sp.style.opacity = v.opacity.toFixed(3);
      sp.style.transform =
        'translateZ(' + v.z.toFixed(1) + 'px) scaleX(' + v.sx.toFixed(4) + ') scaleY(' + v.sy.toFixed(4) + ')';

      // 个体溢光
      if (v.glow > 0.02) {
        var gs = (3 + v.glow * 14).toFixed(1);
        var gw = (6 + v.glow * 28).toFixed(1);
        sp.style.textShadow =
          '0 0 '+gs+'px var(--l3-gc1,rgba(156,255,223,.6)), 0 0 '+gw+'px var(--l3-gc2,rgba(156,255,223,.35))';
      } else {
        if (sp.style.textShadow) sp.style.textShadow = '';
      }
    }

    // 跨系统回调: 字符 burst 事件
    if (charBurstCount > 0 && root.Lyric3 && root.Lyric3._onCharBurst) {
      root.Lyric3._onCharBurst(charBurstCount, ef);
    }
  }

  /* ═══════════════════════════════════════════════════
   * snapSlotToRole
   * ═══════════════════════════════════════════════════ */
  function snapSlotToRole(si, role) {
    var p=roleProps(role), cy=getCenterY();
    if(root.gsap) root.gsap.set(slotEls[si],{
      y:cy+p.y, scale:p.scale, opacity:p.opacity,
      filter:filterStr(p.blur,p.br), z:p.z
    });
    slotEls[si].setAttribute('data-role',role);
    applyFont(si,role);
  }
  function snapAll(){
    snapSlotToRole(slots[0],'prev');
    snapSlotToRole(slots[1],'current');
    snapSlotToRole(slots[2],'next');
  }

  /* ═══════════════════════════════════════════════════
   * 歌词文本获取
   * ═══════════════════════════════════════════════════ */
  function lyricText(idx){
    var l=root.lyricsLines;
    if(!l||idx<0||idx>=l.length) return '';
    return String(l[idx].text||'').replace(/\s+/g,' ').trim();
  }
  function nextValidIdx(idx){
    var l=root.lyricsLines; if(!l) return -1;
    for(var i=idx+1;i<l.length;i++) if(l[i]&&String(l[i].text||'').trim()) return i;
    return -1;
  }
  function prevValidIdx(idx){
    var l=root.lyricsLines; if(!l) return -1;
    for(var i=idx-1;i>=0;i--) if(l[i]&&String(l[i].text||'').trim()) return i;
    return -1;
  }

  /* ═══════════════════════════════════════════════════
   * doTransition — slot 旋转 + 逐字重建
   *
   * tl.call 第二参数必须是 Array!
   * ═══════════════════════════════════════════════════ */
  function doTransition(newNextText, newNextIdx) {
    if (!root.gsap) {
      populateSlotChars(slots[2], newNextText, newNextIdx, 'next');
      var t=slots[0]; slots[0]=slots[1]; slots[1]=slots[2]; slots[2]=t;
      snapAll();
      return;
    }

    transitioning=true;
    var cy=getCenterY();
    var oi=slots[0],ci=slots[1],ni=slots[2];
    var oe=slotEls[oi],ce=slotEls[ci],ne=slotEls[ni];
    var pp=roleProps('prev'),cp=roleProps('current'),np=roleProps('next');

    var tl=root.gsap.timeline({
      onComplete:function(){
        var tmp=slots[0]; slots[0]=slots[1]; slots[1]=slots[2]; slots[2]=tmp;
        slotEls[slots[0]].setAttribute('data-role','prev');
        slotEls[slots[1]].setAttribute('data-role','current');
        slotEls[slots[2]].setAttribute('data-role','next');
        transitioning=false;
        // 新 current slot 的逐字数据: 重置所有字符为 idle
        resetSlotCharsToIdle(slots[1]);
      }
    });

    /* ① old-prev → 淡出 → 变成 new-next */
    tl.to(oe,{opacity:0,duration:.14,ease:'power1.in'},0);
    tl.call(function(){
      populateSlotChars(oi, newNextText, newNextIdx, 'next');
      applyFont(oi,'next');
      root.gsap.set(oe,{
        y:cy+np.y+70, scale:np.scale*.84, z:np.z,
        filter:filterStr(3.5,.48)
      });
    },[],0.15);
    tl.to(oe,{
      y:cy+np.y, scale:np.scale, opacity:np.opacity,
      filter:filterStr(np.blur,np.br), z:np.z,
      duration:.70, ease:'power3.out'
    },0.16);

    /* ② old-current → prev (所有字符标为 done/全亮) */
    markSlotCharsDone(ci);
    applyFont(ci,'prev');
    tl.to(ce,{
      y:cy+pp.y, scale:pp.scale, opacity:pp.opacity,
      filter:filterStr(pp.blur,pp.br), z:pp.z,
      duration:.52, ease:'power2.inOut', overwrite:'auto'
    },0.03);

    /* ③ old-next → current (逐字数据重置为 idle) */
    applyFont(ni,'current');
    tl.to(ne,{
      y:cy+cp.y, scale:cp.scale, opacity:cp.opacity,
      filter:filterStr(0,1), z:cp.z,
      duration:.68, ease:'power3.out', overwrite:'auto'
    },0.06);
  }

  function resetSlotCharsToIdle(si) {
    var cd=slotChars[si]; if(!cd||!cd.spans) return;
    for(var i=0;i<cd.states.length;i++){
      cd.states[i]=0;
      cd.burstAge[i]=0;
      if(cd.burstFired) cd.burstFired[i]=false;
      cd.spans[i].style.opacity='0.22';
      cd.spans[i].style.transform='translateZ(0px) scaleX(1) scaleY(1)';
      cd.spans[i].style.textShadow='';
    }
  }
  function markSlotCharsDone(si) {
    var cd=slotChars[si]; if(!cd||!cd.spans) return;
    for(var i=0;i<cd.states.length;i++){
      cd.states[i]=4;
      cd.burstAge[i]=1;
      if(cd.burstFired) cd.burstFired[i]=true;
      cd.spans[i].style.opacity='1';
      cd.spans[i].style.transform='translateZ(0px) scaleX(1) scaleY(1)';
      cd.spans[i].style.textShadow='';
    }
  }

  /* ═══════════════════════════════════════════════════
   * update — 外部调用: 更新当前歌词索引
   * ═══════════════════════════════════════════════════ */
  function update(newIdx) {
    if (!enabled) return;
    if (newIdx===curLyricIdx) return;

    var pi=prevValidIdx(newIdx);
    var ni=nextValidIdx(newIdx);

    if (curLyricIdx===-99) {
      curLyricIdx = newIdx;
      populateSlotChars(slots[0], lyricText(pi), pi, 'prev');
      populateSlotChars(slots[1], lyricText(newIdx), newIdx, 'current');
      populateSlotChars(slots[2], lyricText(ni), ni, 'next');
      snapAll();
      return;
    }

    curLyricIdx = newIdx;
    doTransition(lyricText(ni), ni);
  }

  /* ═══════════════════════════════════════════════════
   * 调色板 / 字体 同步
   * ═══════════════════════════════════════════════════ */
  var lastPalKey='';
  function syncPalette(){
    if(!panel) return;
    var pal=(root.stageLyrics&&root.stageLyrics.palette)||{};
    var pri=pal.primary||'#f6fdff', sec=pal.secondary||'#9cffdf';
    var k=pri+sec; if(k===lastPalKey) return; lastPalKey=k;
    panel.style.setProperty('--l3-color',pri);
    panel.style.setProperty('--l3-gc1',hexToRgba(sec,.38));
    panel.style.setProperty('--l3-gc2',hexToRgba(sec,.22));
  }
  var lastFontKey='';
  function syncFont(){
    if(!panel) return;
    var f=getFx('lyricFont','hei'), sp=getFx('lyricLetterSpacing',0), w=getFx('lyricWeight',900);
    var k=f+'|'+sp+'|'+w; if(k===lastFontKey) return; lastFontKey=k;
    var st=root.lyricFontStackForKey&&f?root.lyricFontStackForKey(f):'"PingFang SC","Microsoft YaHei",sans-serif';
    panel.style.setProperty('--l3-font',st);
    panel.style.setProperty('--l3-weight',String(w||900));
    panel.style.setProperty('--l3-spacing',(baseFontPx()*clamp(sp,-.08,.20)).toFixed(2)+'px');
  }

  /* ═══════════════════════════════════════════════════
   * tick — 每帧: 逐字更新 + 呼吸 + 溢光 + CSS vars
   * ═══════════════════════════════════════════════════ */
  var lastGapKey='';
  function tick(dt) {
    if (!enabled||!panel) return;
    dt=clamp(dt,.001,.10);
    updateCenterY();

    var rawBeat=clamp(root.beatPulse||0,0,1.6);
    var rawBass=clamp(root.bass||0,0,1.2);
    var rawMid =clamp(root.mid||0,0,1.2);
    var rawE=rawBass*.55+rawBeat*.35+rawMid*.10;
    energyS+=(rawE-energyS)*(rawE>energyS?clamp(dt*9,0,1):clamp(dt*3.5,0,1));
    beatS  +=(rawBeat-beatS)*(rawBeat>beatS?clamp(dt*16,0,1):clamp(dt*4.5,0,1));
    bassS  +=(rawBass-bassS)*clamp(dt*7,0,1);

    var t=(root.uniforms&&root.uniforms.uTime&&root.uniforms.uTime.value)||(performance.now()*.001);

    // ── 逐字帧更新 ──
    tickChars(dt);

    // ── slot 级呼吸 + 位置跟踪 ──
    if (!transitioning && root.gsap) {
      var cy=getCenterY();
      var ba=fxBreath()*(0.009+energyS*.020+beatS*.013);
      var bs=1+Math.sin(t*.93)*ba+Math.sin(t*.41+1.14)*ba*.35+beatS*.014*fxBreath();

      var curP=roleProps('current'),prevP=roleProps('prev'),nextP=roleProps('next');
      root.gsap.set(slotEls[slots[1]],{y:cy+curP.y, scale:curP.scale*bs, overwrite:false});
      root.gsap.set(slotEls[slots[0]],{y:cy+prevP.y, overwrite:false});
      root.gsap.set(slotEls[slots[2]],{y:cy+nextP.y, overwrite:false});
    }

    // ── CSS vars ──
    panel.style.setProperty('--l3-gs',(5+energyS*20+beatS*28).toFixed(1)+'px');
    panel.style.setProperty('--l3-gw',(12+energyS*38+beatS*48).toFixed(1)+'px');
    panel.style.setProperty('--l3-br',(1+energyS*.20+beatS*.14).toFixed(4));
    panel.style.setProperty('--l3-ripple',clamp(energyS*.60+beatS*.40,0,.72).toFixed(3));

    if(Math.random()<.065) syncPalette();
    if(Math.random()<.045) syncFont();

    var gk=fxGap().toFixed(2)+'|'+fxDepth().toFixed(2)+'|'+fxScale().toFixed(2)+'|'+(window.innerWidth||0);
    if(gk!==lastGapKey&&!transitioning){ lastGapKey=gk; snapAll(); }
  }

  /* ═══════════════════════════════════════════════════
   * reset / enable / disable
   * ═══════════════════════════════════════════════════ */
  function reset(){
    curLyricIdx=-99; transitioning=false;
    energyS=0; beatS=0; bassS=0;
    if(root.gsap&&slotEls.length) root.gsap.killTweensOf(slotEls);
    slots=[0,1,2];
    for(var i=0;i<3;i++){
      slotTexts[i].textContent='';
      slotChars[i]={};
    }
    if(enabled) snapAll();
  }
  function enable(){
    if(!panel) _init();
    enabled=true;
    panel.classList.add('l3-active');
    centerY=null;
    reset(); syncPalette(); syncFont(); lastGapKey='';
  }
  function disable(){
    enabled=false;
    if(panel) panel.classList.remove('l3-active');
    curLyricIdx=-99;
  }

  /* ═══════════════════════════════════════════════════
   * _init
   * ═══════════════════════════════════════════════════ */
  function _init(){
    injectCSS(); injectHTML();
    if(!root.gsap||!slotEls.length) return;
    root.gsap.set(slotEls,{yPercent:-50});
    var cy=getCenterY();
    var pp=roleProps('prev'),cp=roleProps('current'),np=roleProps('next');
    root.gsap.set(slotEls[0],{y:cy+pp.y,scale:pp.scale,opacity:pp.opacity,filter:filterStr(pp.blur,pp.br),z:pp.z});
    root.gsap.set(slotEls[1],{y:cy+cp.y,scale:cp.scale,opacity:cp.opacity,filter:filterStr(0,1),z:cp.z});
    root.gsap.set(slotEls[2],{y:cy+np.y,scale:np.scale,opacity:np.opacity,filter:filterStr(np.blur,np.br),z:np.z});
  }

  /* ═══════════════════════════════════════════════════
   * 公开 API
   * ═══════════════════════════════════════════════════ */
  root.Lyric3 = {
    init:_init, enable:enable, disable:disable,
    update:update, reset:reset, tick:tick,
    isEnabled:function(){return enabled;},
    syncPalette:syncPalette,
    _onCharBurst: null   // app.js 可注册回调: function(count, energyFactor){}
  };

  function _autoStart(){
    _init();
    if(root.fx&&root.fx.lyric3){
      enable();
      requestAnimationFrame(function(){
        var sl=root.stageLyrics;
        if(sl&&sl.currentIdx>=0) update(sl.currentIdx);
      });
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',_autoStart);
  else _autoStart();

})(window);
