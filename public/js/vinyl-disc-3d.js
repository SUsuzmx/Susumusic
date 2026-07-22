/**
 * vinyl-disc-3d.js — 3D 黑胶唱片机面板  v4
 *
 * 依赖：Three.js r128 (vendor/three.r128.min.js)
 * 挂载：window.VinylDisc3D
 *
 * v4 改进：
 *   ① MeshPhysicalMaterial clearcoat 0.95 → 真实漆面光泽
 *   ② 增补 SpotLight（强聚焦高光）+ 橙紫色彩光，虹彩质感
 *   ③ 渲染器启用 toneMapping + outputEncoding 让亮部更饱和
 *   ④ 修复 HTML id 已添加（home-np-disc-wrap），这里直接用
 */
(function (g) {
  'use strict';

  var WRAP_ID   = 'home-np-disc-wrap';
  var DISC_ID   = 'home-np-disc';
  var CANVAS_ID = 'home-vinyl-3d-canvas';

  /* ── 几何常量 ─────────────────────────────────────── */
  var VINYL_R   = 1.00, VINYL_H   = 0.050;
  var PLATTER_R = 1.10, PLATTER_H = 0.030;
  var LABEL_R   = 0.295, HOLE_R   = 0.032;
  var SEGS      = 128;

  /* ── 相机：俯角 51°，FOV 56° ─────────────────────── */
  var CAM_FOV = 56;
  var CAM_POS = [0, 2.0, 1.6];
  var CAM_AT  = [0.06, 0.01, -0.06];

  /* ── 唱臂参数 ─────────────────────────────────────── */
  var AP_X = 1.25, AP_Y = 0.22, AP_Z = -0.35;
  var ARM_LEN       = 1.15;
  var ARM_ANGLE_OUT = 1.07;
  var ARM_ANGLE_IN  = 1.62;
  var ARM_LIFT_H    = 0.44;

  /* ── 运行状态 ─────────────────────────────────────── */
  var _inited   = false, _playing  = false, _progress = 0;
  var _spinAngle= 0,     _spinSpeed= 0;
  var SPIN_RPM  = 0.52;
  var _armAngle = ARM_ANGLE_OUT, _armLift = 0, _armLiftTgt = 0, _changing = false;

  /* ── Three.js 对象 ───────────────────────────────── */
  var renderer, scene, camera, vinylMesh, labelMesh, armGroup;
  var labelTex, _lCv, _lCtx;
  var _animId = null, _lastTs = null, _ro = null;
  /* 动态高光旋转（模拟环境光随时间变化） */
  var _spotLight1, _spotLight2;
  var _spotAngle = 0;

  /* ── 工具 ─────────────────────────────────────────── */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function esm(cur, tgt, dt, tau) { return lerp(cur, tgt, 1 - Math.exp(-dt / Math.max(tau, 1e-6))); }

  /* ════════════════════════════════════════════════════
   *  封面标签贴图（CanvasTexture）
   * ════════════════════════════════════════════════════ */
  var _lpend = null, _lload = false;

  function _initLabel() {
    _lCv = document.createElement('canvas');
    _lCv.width = _lCv.height = 512;
    _lCtx = _lCv.getContext('2d');
    _drawLabel(null);
    labelTex = new THREE.CanvasTexture(_lCv);
    labelTex.minFilter = THREE.LinearFilter;
    labelTex.magFilter = THREE.LinearFilter;
  }

  function _drawLabel(img) {
    var S = 512, cx = 256, cy = 256, r = 255;
    _lCtx.clearRect(0, 0, S, S);
    _lCtx.save();
    _lCtx.beginPath(); _lCtx.arc(cx, cy, r, 0, Math.PI * 2); _lCtx.clip();

    if (img) {
      _lCtx.drawImage(img, 0, 0, S, S);
      /* 轻微暗角，保持唱片质感 */
      var g2 = _lCtx.createRadialGradient(cx, cy, r * 0.28, cx, cy, r);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(0,0,0,0.48)');
      _lCtx.fillStyle = g2; _lCtx.fillRect(0, 0, S, S);
    } else {
      var g3 = _lCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g3.addColorStop(0, '#332f3c'); g3.addColorStop(0.5, '#1e1b25'); g3.addColorStop(1, '#0f0e14');
      _lCtx.fillStyle = g3; _lCtx.fillRect(0, 0, S, S);
      for (var i = 1; i <= 5; i++) {
        _lCtx.beginPath(); _lCtx.arc(cx, cy, r * (0.18 + i * 0.14), 0, Math.PI * 2);
        _lCtx.strokeStyle = 'rgba(255,255,255,0.046)'; _lCtx.lineWidth = 1; _lCtx.stroke();
      }
    }
    _lCtx.globalCompositeOperation = 'destination-out';
    _lCtx.beginPath(); _lCtx.arc(cx, cy, (HOLE_R / LABEL_R) * r, 0, Math.PI * 2); _lCtx.fill();
    _lCtx.globalCompositeOperation = 'source-over';
    _lCtx.restore();
  }

  function _loadCover(url) {
    if (!_lCv) return;
    if (!url) { _drawLabel(null); if (labelTex) labelTex.needsUpdate = true; return; }
    _lpend = url;
    if (_lload) return;
    _lload = true;
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      _drawLabel(img); if (labelTex) labelTex.needsUpdate = true;
      _lload = false;
      if (_lpend !== url) { var n = _lpend; _lpend = null; _loadCover(n); } else _lpend = null;
    };
    img.onerror = function () {
      _lload = false; _drawLabel(null); if (labelTex) labelTex.needsUpdate = true; _lpend = null;
    };
    img.src = url;
  }

  /* ════════════════════════════════════════════════════
   *  黑胶沟槽纹理（带虹彩分层）
   * ════════════════════════════════════════════════════ */
  function _vinylTex() {
    var S = 1024, cx = 512, cy = 512, r = 512; /* 高分辨纹理 */
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d');

    /* 底色 */
    c.fillStyle = '#080808'; c.fillRect(0, 0, S, S);

    var lp = r * (LABEL_R / VINYL_R), op = r * 0.975;

    /* 主沟槽 */
    for (var rr = lp + 3.5; rr < op; rr += 3.5) {
      var a = 0.048 + 0.028 * Math.sin(rr * 0.19);
      c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.lineWidth = 1.4; c.stroke();
    }

    /* 虹彩层：极细彩色线，随半径变色 */
    var hues = [240, 210, 280, 200, 260, 190];
    for (var ri = 0; ri < hues.length; ri++) {
      var h = hues[ri], rrStart = lp + 12 + ri * ((op - lp - 20) / hues.length);
      var rrEnd = rrStart + (op - lp - 20) / hues.length;
      for (var rr2 = rrStart; rr2 < rrEnd; rr2 += 10.5) {
        var ia = 0.018 + 0.012 * Math.sin(rr2 * 0.08 + ri);
        c.beginPath(); c.arc(cx, cy, rr2, 0, Math.PI * 2);
        c.strokeStyle = 'hsla(' + h + ',72%,70%,' + ia.toFixed(3) + ')';
        c.lineWidth = 0.8; c.stroke();
      }
    }

    /* 外缘高光环 */
    var eg = c.createRadialGradient(cx, cy, r * 0.87, cx, cy, r);
    eg.addColorStop(0,   'rgba(220,230,255,0)');
    eg.addColorStop(0.6, 'rgba(220,230,255,0.06)');
    eg.addColorStop(1,   'rgba(200,215,240,0.22)');
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = eg; c.fill();

    /* 标签底色 */
    c.beginPath(); c.arc(cx, cy, lp, 0, Math.PI * 2); c.fillStyle = '#1e1b25'; c.fill();

    /* 中心孔 */
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(cx, cy, r * (HOLE_R / VINYL_R), 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';

    var t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    return t;
  }

  /* ════════════════════════════════════════════════════
   *  场景搭建
   * ════════════════════════════════════════════════════ */
  function _buildScene() {
    scene = new THREE.Scene();

    /* ─── 灯光 ────────────────────────────────────────
     * 目标：在黑胶平面产生 2 个移动高光点，模拟天花板灯 */
    scene.add(new THREE.AmbientLight(0xffffff, 0.30));

    /* 主方向光（漫反射） */
    var dl = new THREE.DirectionalLight(0xffffff, 0.90);
    dl.position.set(-1.5, 3.5, 2.2); scene.add(dl);

    /* 冷蓝补光 */
    var rl = new THREE.DirectionalLight(0xb8d4ff, 0.32);
    rl.position.set(2.8, 1.6, -0.4); scene.add(rl);

    /* 底部紫色反光 */
    var bl = new THREE.PointLight(0x9060c0, 0.20, 8);
    bl.position.set(0.4, -1.8, 0.6); scene.add(bl);

    /* ★ 聚焦高光 SpotLight 1（橙白，绕转） */
    _spotLight1 = new THREE.SpotLight(0xfff5e8, 0.85, 8, 0.38, 0.3, 1.5);
    _spotLight1.position.set(1.6, 2.8, 0.8); scene.add(_spotLight1);
    scene.add(_spotLight1.target);

    /* ★ 聚焦高光 SpotLight 2（蓝紫，相位差 π） */
    _spotLight2 = new THREE.SpotLight(0xd0c8ff, 0.65, 8, 0.42, 0.35, 1.5);
    _spotLight2.position.set(-1.6, 2.8, -0.6); scene.add(_spotLight2);
    scene.add(_spotLight2.target);

    /* ─── 转盘底盘 ─────────────────────────────────── */
    var pm = new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.28, metalness: 0.80 });
    var plat = new THREE.Mesh(new THREE.CylinderGeometry(PLATTER_R, PLATTER_R, PLATTER_H, SEGS), pm);
    plat.position.y = -VINYL_H / 2 - PLATTER_H / 2 + 0.001; scene.add(plat);

    /* ─── 黑胶碟（★ MeshPhysicalMaterial clearcoat）── */
    var vTex = _vinylTex();
    /* 粗糙度贴图 */
    var rCv = document.createElement('canvas'); rCv.width = rCv.height = 256;
    var rc = rCv.getContext('2d');
    var rg = rc.createRadialGradient(128, 128, 12, 128, 128, 128);
    rg.addColorStop(0, '#888'); rg.addColorStop(0.28, '#555'); rg.addColorStop(0.96, '#1c1c1c');
    rc.fillStyle = rg; rc.fillRect(0, 0, 256, 256);
    var roughTex = new THREE.CanvasTexture(rCv);

    /* 顶面：MeshPhysicalMaterial，clearcoat = 漆面 */
    var topMat = new THREE.MeshPhysicalMaterial({
      map:          vTex,
      roughnessMap: roughTex,
      roughness:    0.08,
      metalness:    0.88,
      color:        0x101012,
      clearcoat:         0.95,   /* 漆面强度 */
      clearcoatRoughness:0.04,   /* 高光锐利 */
      reflectivity:      0.92,
    });

    var sideMat = new THREE.MeshStandardMaterial({
      color: 0x111113, roughness: 0.38, metalness: 0.65
    });

    vinylMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(VINYL_R, VINYL_R, VINYL_H, SEGS, 1, false),
      [sideMat, topMat, sideMat]
    );
    scene.add(vinylMesh);

    /* ─── 标签（★ MeshPhysicalMaterial，轻微光泽）────── */
    _initLabel();
    labelMesh = new THREE.Mesh(
      new THREE.CircleGeometry(LABEL_R, SEGS),
      new THREE.MeshPhysicalMaterial({
        map:               labelTex,
        roughness:         0.38,
        metalness:         0.12,
        clearcoat:         0.30,
        clearcoatRoughness:0.22
      })
    );
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.y = VINYL_H / 2 + 0.0015;
    vinylMesh.add(labelMesh);

    /* ─── 唱臂 ─────────────────────────────────────── */
    _buildArm();
  }

  /* ── 唱臂 ─────────────────────────────────────────── */
  function _buildArm() {
    armGroup = new THREE.Group();
    armGroup.position.set(AP_X, AP_Y, AP_Z);
    scene.add(armGroup);

    var chrome = new THREE.MeshPhysicalMaterial({
      color: 0xd8d8e4, roughness: 0.12, metalness: 0.96,
      clearcoat: 0.60, clearcoatRoughness: 0.08
    });
    var silver = new THREE.MeshStandardMaterial({ color: 0xb4b4c0, roughness: 0.24, metalness: 0.90 });
    var dark   = new THREE.MeshStandardMaterial({ color: 0x9090a0, roughness: 0.30, metalness: 0.86 });

    armGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.080, 0.100, 24), chrome));

    var cap = new THREE.Mesh(new THREE.SphereGeometry(0.064, 22, 14), chrome);
    cap.position.y = 0.078; armGroup.add(cap);

    var armCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.038, ARM_LEN, 14),
      chrome
    );
    armCyl.rotation.x = Math.PI / 2;
    armCyl.position.z = -ARM_LEN / 2;
    armGroup.add(armCyl);

    var shell = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.028, 0.096), dark);
    shell.position.set(0, -0.010, -ARM_LEN + 0.016);
    armGroup.add(shell);

    var needle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.001, 0.036, 6),
      new THREE.MeshStandardMaterial({ color: 0xeeeeff, roughness: 0.04, metalness: 0.99 })
    );
    needle.position.set(0, -0.030, 0);
    shell.add(needle);

    var cw = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.064, 18), silver);
    cw.rotation.x = Math.PI / 2;
    cw.position.z = 0.080;
    armGroup.add(cw);

    _applyArm();
  }

  function _applyArm() {
    if (!armGroup) return;
    armGroup.rotation.y = _armAngle;
    armGroup.position.y = AP_Y + _armLift * ARM_LIFT_H;
  }

  /* ════════════════════════════════════════════════════
   *  Renderer / Canvas
   * ════════════════════════════════════════════════════ */
  function _buildRenderer(wrap) {
    var S = Math.max(wrap.offsetWidth, 100);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    renderer.setPixelRatio(Math.min(g.devicePixelRatio || 1, 2));
    renderer.setSize(S, S, false);
    renderer.setClearColor(0x000000, 0);
    /* 色调映射：仅用 toneMapping，不设 outputEncoding（避免 CanvasTexture 双重 gamma 过曝）*/
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.90;

    var cv = renderer.domElement;
    cv.id = CANVAS_ID;
    cv.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'width:' + S + 'px', 'height:' + S + 'px',
      'pointer-events:none', 'z-index:1'
    ].join(';');
    wrap.appendChild(cv);

    camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 20);
    camera.position.set(CAM_POS[0], CAM_POS[1], CAM_POS[2]);
    camera.lookAt(CAM_AT[0], CAM_AT[1], CAM_AT[2]);

    var disc = document.getElementById(DISC_ID);
    if (disc) disc.style.opacity = '0';

    if (g.ResizeObserver) {
      _ro = new g.ResizeObserver(function () { _resize(wrap); });
      _ro.observe(wrap);
    }
  }

  function _resize(wrap) {
    if (!renderer) return;
    var S = Math.max(wrap.offsetWidth, 100);
    renderer.setSize(S, S, false);
    var cv = document.getElementById(CANVAS_ID);
    if (cv) { cv.style.width = S + 'px'; cv.style.height = S + 'px'; }
  }

  /* ════════════════════════════════════════════════════
   *  动画循环
   * ════════════════════════════════════════════════════ */
  function _tick(ts) {
    _animId = requestAnimationFrame(_tick);
    if (!renderer) return;
    if (_lastTs === null) _lastTs = ts;
    var dt = clamp((ts - _lastTs) / 1000, 0, 0.10); _lastTs = ts;

    /* ── 唱片旋转 ─────────────────────────────────── */
    var tgtSpeed = (_playing && !_changing) ? SPIN_RPM : 0;
    _spinSpeed = _changing
      ? esm(_spinSpeed, 0, dt, 0.12)
      : esm(_spinSpeed, tgtSpeed, dt, _playing ? 0.55 : 0.20);
    _spinAngle += _spinSpeed * dt;
    if (vinylMesh) vinylMesh.rotation.y = _spinAngle;

    /* ── 唱臂 ─────────────────────────────────────── */
    /* 播放中 → 臂落下(0)；暂停 → 臂抬起至 0.55；切歌动画期间不干预 */
    if (!_changing) {
      _armLiftTgt = _playing ? 0 : 0.55;
    }
    _armLift = esm(_armLift, _armLiftTgt, dt, _changing ? 0.09 : 0.18);
    if (!_changing) {
      var tgt = lerp(ARM_ANGLE_OUT, ARM_ANGLE_IN, clamp(_progress, 0, 1));
      _armAngle = esm(_armAngle, tgt, dt, _playing ? 3.8 : 1.6);
    }
    _applyArm();

    /* ── ★ 高光旋转（慢速绕行） ────────────────────── */
    _spotAngle += dt * 0.14;   /* ~2.5 秒一圈 */
    var r1 = 2.2, h1 = 2.8;
    if (_spotLight1) {
      _spotLight1.position.set(
        Math.cos(_spotAngle) * r1,  h1,  Math.sin(_spotAngle) * r1
      );
      _spotLight1.target.position.set(0, 0, 0);
      _spotLight1.target.updateMatrixWorld();
    }
    if (_spotLight2) {
      _spotLight2.position.set(
        Math.cos(_spotAngle + Math.PI) * r1, h1, Math.sin(_spotAngle + Math.PI) * r1
      );
      _spotLight2.target.position.set(0, 0, 0);
      _spotLight2.target.updateMatrixWorld();
    }

    renderer.render(scene, camera);
  }

  /* ════════════════════════════════════════════════════
   *  切歌动画
   * ════════════════════════════════════════════════════ */
  function _doChange() {
    if (_changing) return;
    _changing = true;
    _armLiftTgt = 1;
    setTimeout(function () {
      _armAngle   = ARM_ANGLE_OUT;
      _armLiftTgt = 0;
      setTimeout(function () { _changing = false; }, 400);
    }, 660);
  }

  /* ════════════════════════════════════════════════════
   *  公开 API
   * ════════════════════════════════════════════════════ */
  var API = {
    init: function () {
      if (_inited) return;
      if (typeof THREE === 'undefined') return;
      var wrap = document.getElementById(WRAP_ID);
      if (!wrap || wrap.offsetWidth === 0) return;
      if (document.getElementById(CANVAS_ID)) return;
      _inited = true;
      _buildScene();
      _buildRenderer(wrap);
      requestAnimationFrame(_tick);
    },

    setCover: function (url) {
      if (!_inited) API.init();
      _loadCover(url || '');
    },

    setPlaying: function (v) {
      if (!_inited) API.init();
      _playing = !!v;
    },

    onTrackChange: function () {
      _progress = 0; _doChange();
    },

    setProgress: function (p) {
      _progress = clamp(+p || 0, 0, 1);
    },

    dispose: function () {
      if (_animId) cancelAnimationFrame(_animId);
      if (_ro) _ro.disconnect();
      if (renderer) { renderer.dispose(); renderer = null; }
      var cv = document.getElementById(CANVAS_ID);
      if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
      var disc = document.getElementById(DISC_ID);
      if (disc) disc.style.opacity = '';
      _inited = false; scene = null;
    },

    isInited: function () { return _inited; }
  };

  g.VinylDisc3D = API;

  function _auto() { requestAnimationFrame(API.init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _auto);
  else _auto();

}(window));
