/**
 * ThreeEffectsEngine
 * ------------------
 * A comprehensive, self-contained Three.js 3D effects engine for a personal
 * blog homepage. Replaces Canvas 2D effects (starfield, aurora, jellyfish,
 * fish school, sky, sparkle, weather) with GPU-accelerated 3D equivalents,
 * and adds new effects (nebula, crystal shards, bioluminescence).
 *
 * Requires Three.js r160+ loaded globally as `window.THREE` (CDN).
 *
 * Global API (window.ThreeEffectsEngine):
 *   init(canvasId)              Initialize WebGL renderer on a <canvas>
 *   setEffect(type)             'aurora'|'jellyfish'|'fish'|'sky'|'sparkle'
 *                               |'starfield'|'nebula'|'crystals'|'bioluminescence'
 *   setMouse(x, y)              Normalized mouse (-1..1, y up) for interactivity
 *   resize()                    Handle window resize
 *   start()                     Start the animation loop
 *   stop()                      Stop the animation loop
 *   dispose()                   Clean up all resources
 *   setParticleBoost(bool)      Dramatically increase particle counts
 *   setWeather(type)            'rainy'|'snow'|'storm'|null
 *
 * Gracefully degrades to a no-op if WebGL is unavailable.
 */
(function () {
  'use strict';

  if (window.ThreeEffectsEngine) return; // guard against double-load

  var THREE = window.THREE;

  // ============================================================
  // WebGL detection
  // ============================================================
  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  // Color / texture helpers
  // ============================================================
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgba(rgb, a) {
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
  }

  /**
   * Creates a radial-gradient canvas texture for sprite glows.
   * @param {string} hex - hex color, e.g. '#88ccff'
   * @returns {THREE.CanvasTexture}
   */
  function createGlowTexture(hex) {
    var rgb = hexToRgb(hex || '#ffffff');
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0.0, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.15, rgba(rgb, 0.35));
    g.addColorStop(0.4, rgba(rgb, 0.15));
    g.addColorStop(1.0, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Creates a soft cloud-puff texture (multiple offset radial gradients).
   * @returns {THREE.CanvasTexture}
   */
  function createCloudTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    var i, x, y, r, g;
    for (i = 0; i < 10; i++) {
      x = 128 + (Math.random() - 0.5) * 130;
      y = 128 + (Math.random() - 0.5) * 90;
      r = 40 + Math.random() * 70;
      g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Creates a star point texture (bright core + cross flare).
   * @returns {THREE.CanvasTexture}
   */
  function createStarTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(32, 3); ctx.lineTo(32, 61);
    ctx.moveTo(3, 32); ctx.lineTo(61, 32);
    ctx.stroke();
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Creates a gaussian-ish soft disk texture for nebula / haze.
   * @returns {THREE.CanvasTexture}
   */
  function createSoftDiskTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  // Recursively dispose geometries / materials of an object subtree.
  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          // dispose textures attached to the material
          for (var key in m) {
            if (m[key] && m[key].isTexture) m[key].dispose();
          }
          m.dispose();
        });
      }
    });
  }

  // ============================================================
  // Shader sources (self-contained, inline)
  // ============================================================
  var SHADERS = {
    star: {
      vertex: [
        'attribute float aSize;',
        'attribute float aOffset;',
        'attribute vec3 aColor;',
        'varying vec3 vColor;',
        'varying float vTwinkle;',
        'uniform float uTime;',
        'void main() {',
        '  vColor = aColor;',
        '  vec3 pos = position;',
        '  pos.x += sin(uTime * 0.05 + aOffset) * 2.5;',
        '  pos.y += cos(uTime * 0.04 + aOffset * 1.3) * 1.8;',
        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  float tw = 0.5 + 0.5 * sin(uTime * 2.2 + aOffset * 6.2831);',
        '  vTwinkle = tw;',
        '  gl_PointSize = aSize * (320.0 / -mv.z) * (0.35 + 0.65 * tw);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform float uDim;',
        'varying vec3 vColor;',
        'varying float vTwinkle;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv);',
        '  float core = smoothstep(0.5, 0.0, d);',
        '  float glow = smoothstep(0.5, 0.15, d) * 0.5;',
        '  float a = (core + glow) * (vTwinkle * 0.85 + 0.15) * uDim;',
        '  gl_FragColor = vec4(vColor, a);',
        '}'
      ].join('\n')
    },
    aurora: {
      vertex: [
        'uniform float uTime;',
        'uniform float uAmp;',
        'varying vec2 vUv;',
        'varying float vWave;',
        'void main() {',
        '  vUv = uv;',
        '  vec3 pos = position;',
        '  float w = sin(pos.x * 0.30 + uTime * 0.9) * 0.6',
        '          + sin(pos.x * 0.75 + uTime * 1.4) * 0.35',
        '          + sin(pos.y * 0.5  + uTime * 0.7) * 0.25;',
        '  pos.z += w * uAmp;',
        '  pos.y += w * uAmp * 0.35;',
        '  vWave = w;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
        '}'
      ].join('\n'),
      fragment: [
        'uniform float uTime;',
        'uniform vec3 uColorTop;',
        'uniform vec3 uColorBottom;',
        'uniform float uOpacity;',
        'varying vec2 vUv;',
        'varying float vWave;',
        'void main() {',
        '  float grad = pow(vUv.y, 1.6);',
        '  vec3 col = mix(uColorBottom, uColorTop, grad);',
        '  float breathe = 0.55 + 0.45 * sin(uTime * 0.8 + vUv.x * 3.5);',
        '  float edge = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.65, vUv.y);',
        '  float streak = 0.6 + 0.4 * sin(vUv.x * 18.0 + uTime * 1.2);',
        '  float a = edge * breathe * uOpacity * streak;',
        '  col += vWave * 0.25;',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n')
    },
    sky: {
      vertex: [
        'varying vec3 vWorldPos;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorldPos = wp.xyz;',
        '  vDir = normalize(wp.xyz);',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform vec3 uZenith;',
        'uniform vec3 uMid;',
        'uniform vec3 uHorizon;',
        'uniform vec3 uGround;',
        'uniform vec3 uSunDir;',
        'uniform vec3 uSunColor;',
        'uniform float uTime;',
        'uniform float uOpacity;',
        'varying vec3 vWorldPos;',
        'varying vec3 vDir;',
        '// --- cheap value-noise for cloud shadows ---',
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float vnoise(vec2 p){',
        '  vec2 i=floor(p),f=fract(p);',
        '  float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));',
        '  vec2 u=f*f*(3.-2.*f);',
        '  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);',
        '}',
        'void main() {',
        '  vec3 dir = normalize(vWorldPos);',
        '  float h = dir.y;',
        '  vec3 col;',
        '  // multi-stop gradient: zenith → upper → mid → horizon → ground',
        '  if (h > 0.5) {',
        '    col = mix(uMid, uZenith, smoothstep(0.5, 0.98, h));',
        '  } else if (h > 0.08) {',
        '    col = mix(uHorizon, uMid, smoothstep(0.08, 0.5, h));',
        '  } else if (h > 0.0) {',
        '    col = mix(uHorizon * 0.7, uHorizon, smoothstep(0.0, 0.08, h));',
        '  } else {',
        '    col = mix(uGround, uHorizon * 0.6, smoothstep(-0.5, 0.0, h));',
        '  }',
        '  // Rayleigh-like sun scattering',
        '  float sd = dot(dir, normalize(uSunDir));',
        '  float sunDist = acos(clamp(sd, -1.0, 1.0));',
        '  float corona = pow(smoothstep(1.4, 0.0, sunDist), 2.2);',
        '  float glow   = smoothstep(0.9, 0.0, sunDist);',
        '  float core   = smoothstep(0.10, 0.0, sunDist);',
        '  col += uSunColor * corona * 0.35;',
        '  col += uSunColor * glow   * 0.55;',
        '  col += uSunColor * core   * 1.8;',
        '  // warm atmospheric band hugging the horizon',
        '  float band = smoothstep(0.0, 0.12, h) * smoothstep(0.45, 0.12, h);',
        '  col += vec3(0.6, 0.45, 0.35) * band * 0.35;',
        '  // procedural drifting cloud shadows in upper sky',
        '  if (h > 0.05) {',
        '    vec2 cuv = dir.xz / (abs(h) + 0.15) * 0.6;',
        '    float n  = vnoise(cuv + uTime * 0.015);',
        '    n = smoothstep(0.35, 0.85, n);',
        '    col *= 1.0 - n * 0.14 * smoothstep(0.6, 0.1, h);',
        '  }',
        '  gl_FragColor = vec4(col, uOpacity);',
        '}'
      ].join('\n')
    },
    jellyBell: {
      vertex: [
        'uniform float uTime;',
        'uniform float uPulse;',
        'varying vec3 vNormal;',
        'varying vec2 vUv;',
        'varying vec3 vViewDir;',
        'varying vec3 vWorldPos;',
        'void main() {',
        '  vUv = uv;',
        '  vec3 pos = position;',
        '  // locomotion pulse: contract radially, push down slightly',
        '  float r = length(pos.xy);',
        '  float contract = 1.0 - uPulse * 0.18;',
        '  pos.xy *= contract;',
        '  pos.y -= uPulse * 0.08 * r;',
        '  // subtle surface ripple',
        '  pos.z += sin(vUv.x * 14.0 + uTime * 2.0) * 0.015;',
        '  vNormal = normalize(normalMatrix * normal);',
        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  vViewDir = normalize(-mv.xyz);',
        '  vWorldPos = pos;',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform float uTime;',
        'uniform vec3 uColorA;',
        'uniform vec3 uColorB;',
        'uniform vec3 uColorC;',
        'uniform float uPulse;',
        'varying vec3 vNormal;',
        'varying vec2 vUv;',
        'varying vec3 vViewDir;',
        'varying vec3 vWorldPos;',
        'void main() {',
        '  float fres = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);',
        '  // iridescent bands flowing across bell',
        '  float irid = 0.5 + 0.5 * sin(vUv.x * 10.0 + uTime * 1.0);',
        '  float irid2 = 0.5 + 0.5 * sin(vUv.y * 6.0 - uTime * 0.7);',
        '  vec3 col = mix(uColorA, uColorB, irid);',
        '  col = mix(col, uColorC, irid2 * 0.45);',
        '  // subsurface glow: brighter when pulsing (contracted)',
        '  float sss = (0.3 + uPulse * 0.4) * (1.0 - fres * 0.5);',
        '  col += uColorC * sss * 0.5;',
        '  // rim light',
        '  col += fres * vec3(0.5, 0.6, 0.7) * 0.6;',
        '  // center bright spot (gastric cavity glow)',
        '  float r = length(vUv - 0.5);',
        '  col += uColorC * smoothstep(0.25, 0.0, r) * (0.4 + uPulse * 0.3);',
        '  float alpha = 0.18 + fres * 0.55 + sss * 0.15;',
        '  gl_FragColor = vec4(col, alpha);',
        '}'
      ].join('\n')
    },
    tentacle: {
      vertex: [
        'uniform float uTime;',
        'uniform float uPhase;',
        'uniform float uLength;',
        'uniform float uSpeed;',
        'uniform float uAmp;',
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  vec3 pos = position;',
        '  float t = 1.0 - vUv.y;', // 0 at top (bell), 1 at tip
        '  // organic taper: thicker near top, wispy at tip',
        '  pos.x *= (1.0 - t * 0.78);',
        '  // multi-harmonic wave motion (amplitude scaled by per-limb uAmp)',
        '  float wave  = sin(t * 5.5 + uTime * uSpeed + uPhase) * t * 2.2 * uAmp;',
        '  float wave2 = cos(t * 3.5 + uTime * uSpeed * 0.7 + uPhase) * t * 1.5 * uAmp;',
        '  float wave3 = sin(t * 9.0 + uTime * uSpeed * 1.3 + uPhase * 2.0) * t * 0.6 * uAmp;',
        '  pos.x += wave + wave3;',
        '  pos.z += wave2;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
        '}'
      ].join('\n'),
      fragment: [
        'uniform vec3 uColor;',
        'uniform float uAmp;',
        'uniform float uTime;',
        'uniform float uPhase;',
        'varying vec2 vUv;',
        'void main() {',
        '  float t = 1.0 - vUv.y;',
        '  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);',
        '  float fade = 1.0 - t * 0.88;',
        '  // bioluminescent nodes along tentacle',
        '  float node = sin(t * 12.0 + uPhase) * 0.5 + 0.5;',
        '  node = pow(node, 8.0);',
        '  vec3 col = uColor + vec3(0.2, 0.25, 0.3) * node * 0.5;',
        '  float a = edge * fade * (0.4 + node * 0.3);',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n')
    },
    sparkle: {
      vertex: [
        'attribute float aSize;',
        'attribute float aOffset;',
        'attribute float aColorMix;',
        'uniform float uTime;',
        'uniform float uHeight;',
        'varying float vAlpha;',
        'varying float vMix;',
        'void main() {',
        '  vec3 pos = position;',
        '  pos.x += sin(uTime * 0.6 + aOffset * 2.0) * 4.0;',
        '  pos.z += cos(uTime * 0.5 + aOffset * 1.7) * 3.0;',
        '  pos.y = mod(pos.y + uTime * 10.0 + aOffset * 30.0, uHeight) - uHeight * 0.5;',
        '  vMix = aColorMix;',
        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  float breathe = 0.5 + 0.5 * sin(uTime * 1.6 + aOffset * 4.0);',
        '  vAlpha = breathe;',
        '  gl_PointSize = aSize * (340.0 / -mv.z) * (0.5 + 0.8 * breathe);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform vec3 uColorA;',  // warm amber
        'uniform vec3 uColorB;',  // soft azure
        'uniform vec3 uColorC;',  // dusty rose
        'varying float vAlpha;',
        'varying float vMix;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv);',
        '  float core = smoothstep(0.5, 0.0, d);',
        '  float halo = smoothstep(0.5, 0.16, d) * 0.8;',
        '  float spike = max(0.0, 1.0 - abs(uv.x) * 16.0) * max(0.0, 1.0 - abs(uv.y) * 4.0);',
        '  spike += max(0.0, 1.0 - abs(uv.y) * 16.0) * max(0.0, 1.0 - abs(uv.x) * 4.0);',
        '  // 3-stop palette selection (no pure white)',
        '  vec3 col;',
        '  if (vMix < 0.5) col = mix(uColorA, uColorB, vMix * 2.0);',
        '  else col = mix(uColorB, uColorC, (vMix - 0.5) * 2.0);',
        '  // soft tinted highlight: brighten toward a warm cream, not pure white',
        '  vec3 highlight = mix(col, vec3(0.96, 0.93, 0.88), 0.5);',
        '  col = mix(col, highlight, core * 0.55);',
        '  float a = (core + halo + spike * 0.3) * (vAlpha * 0.9 + 0.18);',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n')
    },
    biolum: {
      vertex: [
        'attribute float aSize;',
        'attribute float aOffset;',
        'attribute float aSpeed;',
        'attribute vec3 aColor;',
        'uniform float uTime;',
        'varying float vGlow;',
        'varying vec3 vColor;',
        'void main() {',
        '  vec3 pos = position;',
        '  pos.x += sin(uTime * 0.3 + aOffset) * 2.0;',
        '  pos.y += cos(uTime * 0.25 + aOffset * 1.4) * 1.6;',
        '  vColor = aColor;',
        '  float pulse = 0.5 + 0.5 * sin(uTime * aSpeed + aOffset * 6.2831);',
        '  pulse = pow(pulse, 3.0);',
        '  vGlow = pulse;',
        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  gl_PointSize = aSize * (300.0 / -mv.z) * (0.3 + pulse);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragment: [
        'varying float vGlow;',
        'varying vec3 vColor;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv);',
        '  float core = smoothstep(0.5, 0.0, d);',
        '  float a = core * vGlow;',
        '  gl_FragColor = vec4(vColor, a);',
        '}'
      ].join('\n')
    },
    rainStreak: {
      vertex: [
        'attribute float aSize;',
        'attribute float aSeed;',
        'uniform float uTime;',
        'uniform float uHeight;',
        'varying float vDepth;',
        'varying float vSeed;',
        'void main() {',
        '  vec3 pos = position;',
        '  float speed = 380.0 + aSeed * 140.0;',
        '  pos.y = mod(pos.y - uTime * speed, uHeight) - uHeight * 0.5;',
        '  float windX = uTime * 28.0 + sin(uTime * 0.3 + aSeed * 2.0) * 10.0;',
        '  pos.x += windX;',
        '  pos.x = mod(pos.x + 300.0, 600.0) - 300.0;',
        '  pos.z += sin(uTime * 0.4 + aSeed * 1.5) * 4.0;',
        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  vDepth = -mv.z;',
        '  vSeed = aSeed;',
        '  float h = aSize * (520.0 / vDepth);',
        '  gl_PointSize = clamp(h, 3.0, 60.0);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform vec3 uColor;',
        'varying float vDepth;',
        'varying float vSeed;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  // narrow vertical streak: thin in x, elongated in y',
        '  float xw = 1.0 - smoothstep(0.0, 0.04, abs(uv.x));',
        '  float yf = smoothstep(0.5, 0.0, abs(uv.y));',
        '  float a = xw * yf;',
        '  // depth fog: keep close rain visible, fade distant rain',
        '  float fog = 1.0 - smoothstep(80.0, 500.0, vDepth);',
        '  a *= fog * 0.85;',
        '  // realistic rain color: light blue-gray with highlight',
        '  vec3 col = mix(vec3(0.75, 0.82, 0.92), uColor, 0.3);',
        '  col += vec3(0.15, 0.18, 0.22) * yf;',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n')
    },
    snowFlake: {
      vertex: [
        'attribute float aSize;',
        'attribute float aSeed;',
        'uniform float uTime;',
        'uniform float uHeight;',
        'varying float vDepth;',
        'varying float vSeed;',
        'void main() {',
        '  vec3 pos = position;',
        '  float speed = 16.0 + aSeed * 30.0;',
        '  pos.y = mod(pos.y - uTime * speed, uHeight) - uHeight * 0.5;',
        '  pos.x += sin(uTime * 0.8 + aSeed * 1.7) * 14.0 + sin(uTime * 0.3 + aSeed) * 7.0;',
        '  pos.z += cos(uTime * 0.6 + aSeed * 1.2) * 8.0;',
        '  pos.y += sin(uTime * 1.2 + aSeed * 2.5) * 3.0;',
        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  vDepth = -mv.z;',
        '  vSeed = aSeed;',
        '  float s = aSize * (400.0 / vDepth);',
        '  gl_PointSize = clamp(s, 2.0, 22.0);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform vec3 uColor;',
        'varying float vDepth;',
        'varying float vSeed;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv);',
        '  // bright core + soft halo + crystalline ring',
        '  float core = smoothstep(0.14, 0.0, d);',
        '  float halo = smoothstep(0.5, 0.1, d);',
        '  float ring = smoothstep(0.24, 0.20, d) - smoothstep(0.20, 0.16, d);',
        '  float a = core * 0.95 + halo * 0.45 + ring * 0.25;',
        '  float fog = 1.0 - smoothstep(100.0, 550.0, vDepth);',
        '  a *= fog;',
        '  // bright white snow with subtle tint',
        '  vec3 tint = mix(vec3(0.95, 0.97, 1.0), uColor, 0.15);',
        '  vec3 col = mix(tint, vec3(1.0, 1.0, 0.98), core * 0.6);',
        '  col += vec3(0.08, 0.09, 0.11) * ring;',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n')
    },
    deepSeaBg: {
      vertex: [
        'varying vec3 vWorldPos;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorldPos = wp.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragment: [
        'uniform vec3 uDeep;',
        'uniform vec3 uMid;',
        'uniform vec3 uSurface;',
        'uniform float uTime;',
        'uniform float uOpacity;',
        'varying vec3 vWorldPos;',
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));vec2 u=f*f*(3.-2.*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}',
        'void main() {',
        '  vec3 dir = normalize(vWorldPos);',
        '  float h = dir.y;',
        '  vec3 col;',
        '  if (h > 0.0) col = mix(uMid, uSurface, smoothstep(0.0, 1.0, h));',
        '  else col = mix(uMid, uDeep, smoothstep(0.0, -1.0, h));',
        '  float cTop = smoothstep(0.0, 0.9, h);',
        '  vec2 cuv = dir.xz / (abs(h) + 0.1) * 1.2;',
        '  float n = vnoise(cuv + uTime * 0.15);',
        '  float n2 = vnoise(cuv * 1.7 - uTime * 0.1);',
        '  float caust = pow(n * n2, 1.5);',
        '  col += uSurface * caust * cTop * 0.6;',
        '  gl_FragColor = vec4(col, uOpacity);',
        '}'
      ].join('\n')
    }
  };

  // ============================================================
  // Base effect interface
  //   constructor(opts)  -> opts: { scene, camera, boost }
  //   update(t, dt, mouse)
  //   dispose()
  // Each effect adds its own Object3D root to the scene.
  // ============================================================
  function makeRoot() {
    var root = new THREE.Group();
    root.name = 'effectRoot';
    return root;
  }

  // ============================================================
  // A. Starfield3D (always-on background)
  // ============================================================
  function Starfield3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    var count = this.boost ? 6000 : 4200;
    var spread = 520;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var offsets = new Float32Array(count);
    var colors = new Float32Array(count * 3);

    var palette = [
      [1.0, 1.0, 1.0],        // white
      [0.75, 0.85, 1.0],      // blue-white
      [1.0, 0.92, 0.78],      // warm white
      [0.85, 0.9, 1.0]        // pale blue
    ];

    for (var i = 0; i < count; i++) {
      var layer = Math.random();
      var depth;
      if (layer < 0.45) depth = -spread * 0.6 + Math.random() * spread * 0.4;       // far
      else if (layer < 0.8) depth = -spread * 0.2 + Math.random() * spread * 0.4;   // mid
      else depth = spread * 0.2 + Math.random() * spread * 0.4;                     // near

      positions[i * 3] = (Math.random() - 0.5) * spread * 2.4;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 1.6;
      positions[i * 3 + 2] = depth;

      // size by depth
      var s = depth < -spread * 0.2 ? 0.6 + Math.random() * 0.8
            : depth < spread * 0.2 ? 1.1 + Math.random() * 1.4
            : 1.8 + Math.random() * 2.0;
      sizes[i] = s;
      offsets[i] = Math.random() * 100;

      var c = palette[(Math.random() * palette.length) | 0];
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDim: { value: 1.0 } },
      vertexShader: SHADERS.star.vertex,
      fragmentShader: SHADERS.star.fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, this.material);
    this.root.add(this.points);

    // Shooting stars
    this.shooters = [];
    var n = this.boost ? 8 : 4;
    for (var s = 0; s < n; s++) {
      this.shooters.push(this._createShooter());
    }
    this._nextShooter = 1.5 + Math.random() * 2;
  }

  Starfield3D.prototype._createShooter = function () {
    var pts = 18;
    var positions = new Float32Array(pts * 3);
    var colors = new Float32Array(pts * 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    this.root.add(line);
    var sh = {
      line: line,
      geo: geo,
      mat: mat,
      pts: pts,
      history: [],
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 0,
      active: false
    };
    this._resetShooter(sh, true);
    return sh;
  };

  Starfield3D.prototype._resetShooter = function (sh, randomLife) {
    sh.pos.set(
      (Math.random() - 0.5) * 900,
      180 + Math.random() * 120,
      (Math.random() - 0.5) * 300
    );
    var angle = -Math.PI / 4 + (Math.random() - 0.5) * 0.6;
    var speed = 260 + Math.random() * 200;
    sh.vel.set(Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
               Math.sin(angle) * speed, 0);
    sh.history = [];
    sh.life = randomLife ? -Math.random() * 4 : 0;
    sh.maxLife = 1.0 + Math.random() * 0.8;
    sh.active = false;
  };

  Starfield3D.prototype.update = function (t, dt) {
    this.material.uniforms.uTime.value = t;

    // occasional shooter launch
    this._nextShooter -= dt;
    if (this._nextShooter <= 0) {
      for (var i = 0; i < this.shooters.length; i++) {
        if (!this.shooters[i].active) {
          this._resetShooter(this.shooters[i], false);
          this.shooters[i].active = true;
          break;
        }
      }
      this._nextShooter = 2.5 + Math.random() * 4;
    }

    for (var j = 0; j < this.shooters.length; j++) {
      var sh = this.shooters[j];
      if (!sh.active) {
        // hide
        var arr = sh.geo.attributes.position.array;
        for (var k = 0; k < arr.length; k++) arr[k] = 0;
        sh.geo.attributes.position.needsUpdate = true;
        continue;
      }
      sh.life += dt;
      if (sh.life > sh.maxLife) {
        sh.active = false;
        this._resetShooter(sh, true);
        continue;
      }
      sh.pos.addScaledVector(sh.vel, dt);
      sh.history.unshift(sh.pos.clone());
      if (sh.history.length > sh.pts) sh.history.length = sh.pts;
      var pa = sh.geo.attributes.position.array;
      var ca = sh.geo.attributes.color.array;
      var fade = 1.0 - (sh.life / sh.maxLife);
      for (var p = 0; p < sh.pts; p++) {
        var hp = sh.history[p] || sh.pos;
        pa[p * 3] = hp.x;
        pa[p * 3 + 1] = hp.y;
        pa[p * 3 + 2] = hp.z;
        var tailFade = (1.0 - p / sh.pts) * fade;
        ca[p * 3] = 1.0 * tailFade;
        ca[p * 3 + 1] = 0.95 * tailFade;
        ca[p * 3 + 2] = 0.85 * tailFade;
      }
      sh.geo.attributes.position.needsUpdate = true;
      sh.geo.attributes.color.needsUpdate = true;
    }
  };

  Starfield3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root = null;
  };

  // ============================================================
  // B. Aurora3D
  // ============================================================
  function Aurora3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    var palettes = [
      { top: new THREE.Color(0x4a7a6a), bottom: new THREE.Color(0x1a3a30) }, // muted teal
      { top: new THREE.Color(0x4a6a8a), bottom: new THREE.Color(0x1a2a40) }, // muted blue
      { top: new THREE.Color(0x6a5a7a), bottom: new THREE.Color(0x2a2038) }, // muted purple
      { top: new THREE.Color(0x7a5a6a), bottom: new THREE.Color(0x382030) }  // muted mauve
    ];
    this.curtains = [];
    var n = this.boost ? 7 : 5;
    for (var i = 0; i < n; i++) {
      var p = palettes[i % palettes.length];
      var geo = new THREE.PlaneGeometry(700, 320, 60, 24);
      var mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: 22 + Math.random() * 14 },
          uColorTop: { value: p.top },
          uColorBottom: { value: p.bottom },
          uOpacity: { value: 0.55 + Math.random() * 0.25 }
        },
        vertexShader: SHADERS.aurora.vertex,
        fragmentShader: SHADERS.aurora.fragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random() - 0.5) * 240, 20 + Math.random() * 60, -120 - i * 50);
      mesh.rotation.x = -0.25;
      this.root.add(mesh);
      this.curtains.push(mat);
    }

    // crystal particles
    var ccount = this.boost ? 420 : 220;
    var cpos = new Float32Array(ccount * 3);
    var csize = new Float32Array(ccount);
    var coff = new Float32Array(ccount);
    var ccol = new Float32Array(ccount * 3);
    for (var c = 0; c < ccount; c++) {
      cpos[c * 3] = (Math.random() - 0.5) * 700;
      cpos[c * 3 + 1] = (Math.random() - 0.5) * 360;
      cpos[c * 3 + 2] = (Math.random() - 0.5) * 240 - 40;
      csize[c] = 1.2 + Math.random() * 2.4;
      coff[c] = Math.random() * 100;
      var cc = new THREE.Color().setHSL(0.45 + Math.random() * 0.25, 0.8, 0.7);
      ccol[c * 3] = cc.r; ccol[c * 3 + 1] = cc.g; ccol[c * 3 + 2] = cc.b;
    }
    var cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    cgeo.setAttribute('aSize', new THREE.BufferAttribute(csize, 1));
    cgeo.setAttribute('aOffset', new THREE.BufferAttribute(coff, 1));
    cgeo.setAttribute('aColor', new THREE.BufferAttribute(ccol, 3));
    this.crystalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SHADERS.star.vertex,
      fragmentShader: SHADERS.star.fragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.crystals = new THREE.Points(cgeo, this.crystalMat);
    this.root.add(this.crystals);
  }

  Aurora3D.prototype.update = function (t) {
    for (var i = 0; i < this.curtains.length; i++) this.curtains[i].uniforms.uTime.value = t;
    this.crystalMat.uniforms.uTime.value = t;
  };

  Aurora3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root = null;
  };

  // ============================================================
  // C. Jellyfish3D
  // ============================================================
  function Jellyfish3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    this.glowTex = createGlowTexture('#8899aa');
    this.jellies = [];
    var n = this.boost ? 14 : 9;
    // 淡色系调色板：浅青/浅蓝/淡紫/浅粉/薄荷等柔光色，每只水母独立配色
    var palette = opts.palette || [
      0xa8dce8, 0xe0b0d0, 0xc8b8e8, 0xa8e0cc, 0xcce8b8,
      0xe8d0b0, 0xb8e0f0, 0xe8b8d8, 0xb0c8f0, 0xd8e8c0
    ];
    for (var i = 0; i < n; i++) {
      var j = this._createJelly(palette[i % palette.length], i);
      this.root.add(j.group);
      this.jellies.push(j);
    }

    // shared trail particle system
    this._initTrails();
  }

  Jellyfish3D.prototype._createJelly = function (colorHex, idx) {
    var group = new THREE.Group();
    var col = new THREE.Color(colorHex);
    var colorA = col.clone();
    var colorB = col.clone().offsetHSL(0.08, 0, -0.12);
    var colorC = col.clone().offsetHSL(-0.1, 0.15, 0.2);

    var scale = 5 + Math.random() * 9;

    // ── organic bell via LatheGeometry (dome profile) ──
    var profile = [];
    var segs = 24;
    for (var s = 0; s <= segs; s++) {
      var u = s / segs;
      var ang = u * Math.PI * 0.52;
      var x = Math.sin(ang);
      var y = Math.cos(ang) * 0.82;
      // slight rim flare near the opening
      if (u > 0.78) x += (u - 0.78) * 0.6;
      profile.push(new THREE.Vector2(Math.max(x, 0.001), y));
    }
    var bellGeo = new THREE.LatheGeometry(profile, 48);
    var bellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uColorA: { value: colorA },
        uColorB: { value: colorB },
        uColorC: { value: colorC }
      },
      vertexShader: SHADERS.jellyBell.vertex,
      fragmentShader: SHADERS.jellyBell.fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
    var bell = new THREE.Mesh(bellGeo, bellMat);
    bell.scale.set(scale, scale, scale);
    group.add(bell);

    // ── inner glow cavity ──
    var innerGeo = new THREE.SphereGeometry(0.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    var innerMat = new THREE.MeshBasicMaterial({
      color: colorC, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var inner = new THREE.Mesh(innerGeo, innerMat);
    inner.scale.set(scale * 0.65, scale * 0.45, scale * 0.65);
    inner.position.y = scale * 0.1;
    group.add(inner);

    // ── oral arms: 4-6 thick, wide, long flowing ribbons ──
    var oralArms = [];
    var oralCount = 4 + ((Math.random() * 3) | 0);
    var oralLen = scale * 5.5 + Math.random() * scale * 1.5;
    for (var oa = 0; oa < oralCount; oa++) {
      var ogeo = new THREE.PlaneGeometry(scale * 0.45, oralLen, 1, 16);
      var omat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: Math.random() * 6.28 },
          uLength: { value: oralLen },
          uSpeed: { value: 1.8 + Math.random() * 0.8 },
          uAmp: { value: 0.8 + Math.random() * 0.5 },
          uColor: { value: col.clone().offsetHSL(0, 0, 0.12) }
        },
        vertexShader: SHADERS.tentacle.vertex,
        fragmentShader: SHADERS.tentacle.fragment,
        transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending
      });
      var omesh = new THREE.Mesh(ogeo, omat);
      var oang = (oa / oralCount) * Math.PI * 2 + Math.random() * 0.3;
      var orad = scale * 0.45;
      omesh.position.set(Math.cos(oang) * orad, -oralLen / 2, Math.sin(oang) * orad);
      omesh.rotation.y = -oang;
      group.add(omesh);
      oralArms.push(omat);
    }

    // ── fine tentacles: 10-14 thin, shorter ──
    var tentacles = [];
    var tentCount = 10 + ((Math.random() * 5) | 0);
    var tlen = scale * 3.2 + Math.random() * scale * 0.8;
    for (var t = 0; t < tentCount; t++) {
      var tgeo = new THREE.PlaneGeometry(scale * 0.18, tlen, 1, 10);
      var tmat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: Math.random() * 6.28 },
          uLength: { value: tlen },
          uSpeed: { value: 2.5 + Math.random() * 1.0 },
          uAmp: { value: 0.7 + Math.random() * 0.6 },
          uColor: { value: col.clone().offsetHSL(0, 0, 0.05) }
        },
        vertexShader: SHADERS.tentacle.vertex,
        fragmentShader: SHADERS.tentacle.fragment,
        transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending
      });
      var tmesh = new THREE.Mesh(tgeo, tmat);
      var ang = (t / tentCount) * Math.PI * 2;
      var rad = scale * 0.75;
      tmesh.position.set(Math.cos(ang) * rad, -tlen / 2, Math.sin(ang) * rad);
      tmesh.rotation.y = -ang;
      group.add(tmesh);
      tentacles.push(tmat);
    }

    // ── bioluminescent spot sprites along rim ──
    var spotCount = 6 + ((Math.random() * 4) | 0);
    var spots = [];
    for (var sp = 0; sp < spotCount; sp++) {
      var spat = Math.random() * Math.PI * 2;
      var sprad = scale * 0.9;
      var smat = new THREE.SpriteMaterial({
        map: this.glowTex, color: colorC.getHex(), transparent: true,
        opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false
      });
      var sprite = new THREE.Sprite(smat);
      sprite.position.set(Math.cos(spat) * sprad, 0, Math.sin(spat) * sprad);
      sprite.scale.set(scale * 0.8, scale * 0.8, 1);
      group.add(sprite);
      spots.push({ sprite: sprite, mat: smat, phase: Math.random() * 6.28 });
    }

    // ── outer glow sprite ──
    var glowMat = new THREE.SpriteMaterial({
      map: this.glowTex, color: colorHex, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var glow = new THREE.Sprite(glowMat);
    glow.scale.set(scale * 7, scale * 7, 1);
    group.add(glow);

    // ── point light ──
    var light = new THREE.PointLight(colorHex, 1.2, scale * 16, 2);
    group.add(light);

    // ── 全画布均匀分布 ──
    // 先按屏幕分格(分层抖动)采样，再沿各自深度反投影到世界坐标，
    // 保证左右/上下/中央屏幕密度均衡，避免扎堆集中。
    var n = this.boost ? 14 : 9;
    var aspect = (window.innerWidth / window.innerHeight) || 1.78;
    var grid = Math.ceil(Math.sqrt(n));
    var cellX = 2 / grid;
    var cellY = 2 / grid;
    var col_ = idx % grid;
    var row = (idx / grid) | 0;
    var jit = 0.35;
    var nx = (col_ + 0.5 + (Math.random() - 0.5) * jit) * cellX - 1; // -1..1 横向视口
    var ny = (row + 0.5 + (Math.random() - 0.5) * jit) * cellY - 1; // -1..1 纵向视口
    // 随机深度（距离相机）
    var z = -130 + Math.random() * 190; // 深度层: -130 .. 60
    var dist = 160 - z;                  // 距离相机
    var halfH = Math.tan(Math.PI / 6) * dist;
    var halfW = halfH * aspect;
    group.position.set(nx * halfW, ny * halfH, z);

    // ── 漂移运动参数（每只水母独立、缓慢漂流） ──
    var baseAngle = Math.random() * Math.PI * 2;
    var wanderSpeed = 3 + Math.random() * 4; // 基础漂移速度
    var vel = new THREE.Vector3();
    // 肢体摆动基础幅度（经由 uAmp 着色器，每个水母/每个触须有区别）
    var limbAmp = 0.6 + Math.random() * 0.7;

    return {
      group: group,
      bellMat: bellMat,
      oralArms: oralArms,
      tentacles: tentacles,
      spots: spots,
      glow: glow,
      glowMat: glowMat,
      light: light,
      // 漂移/游动
      vel: vel,
      basePos: group.position.clone(),
      yOffset: 0,
      // 缓和漠游轨迹
      baseAngle: baseAngle,
      wanderFreq1: 0.04 + Math.random() * 0.06,
      wanderFreq2: 0.1 + Math.random() * 0.1,
      wanderAmp1: 0.4 + Math.random() * 0.6,
      wanderAmp2: 0.2 + Math.random() * 0.4,
      speed: wanderSpeed,
      // 垂直柔和上浮/下潜
      yDriftFreq: 0.03 + Math.random() * 0.05,
      yDriftAmp: 2 + Math.random() * 3,
      // 周期参数
      phase: Math.random() * 6.28,
      pulsePhase: Math.random() * 6.28,
      pulseSpeed: 0.8 + Math.random() * 0.5,
      bobSpeed: 0.5 + Math.random() * 0.5,
      limbAmp: limbAmp,
      scale: scale,
      trailOffset: idx * 6
    };
  };

  Jellyfish3D.prototype._initTrails = function () {
    var tcount = (this.boost ? 14 : 9) * 8; // 8 trail particles per jelly
    var pos = new Float32Array(tcount * 3);
    var off = new Float32Array(tcount);
    var sz  = new Float32Array(tcount);
    for (var i = 0; i < tcount; i++) {
      pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
      off[i] = Math.random() * 6.28;
      sz[i] = 2 + Math.random() * 3;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(off, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: [
        'attribute float aOffset;',
        'attribute float aSize;',
        'uniform float uTime;',
        'varying float vA;',
        'void main(){',
        '  vA=0.3+0.7*sin(uTime*1.5+aOffset*3.0);',
        '  vA=pow(max(vA,0.0),2.0);',
        '  vec4 mv=modelViewMatrix*vec4(position,1.0);',
        '  gl_PointSize=aSize*(260.0/-mv.z);',
        '  gl_Position=projectionMatrix*mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying float vA;',
        'void main(){',
        '  float d=length(gl_PointCoord-0.5);',
        '  float a=smoothstep(0.5,0.0,d)*vA*0.5;',
        '  gl_FragColor=vec4(0.4,0.5,0.6,a);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.trailPoints = new THREE.Points(geo, this.trailMat);
    this.root.add(this.trailPoints);
    this._trailGeo = geo;
    this._trailCount = tcount;
  };

  Jellyfish3D.prototype.update = function (t, dt, mouse) {
    var trailArr = this._trailGeo.attributes.position.array;
    var trailPerJelly = 8;
    var sepN = this.jellies.length;

    // 屏幕视口参数（用于深度自适应环绕）
    var aspect = (window.innerWidth / window.innerHeight) || 1.78;
    var fovHalf = Math.tan(Math.PI / 6);

    // ── soft pairwise separation: 保持水母互不重叠 ──
    for (var a = 0; a < sepN; a++) {
      var ja = this.jellies[a];
      var minD = ja.scale * 6;
      for (var b = a + 1; b < sepN; b++) {
        var jb = this.jellies[b];
        var dx = jb.group.position.x - ja.group.position.x;
        var dy = (jb.basePos.y + jb.yOffset) - (ja.basePos.y + ja.yOffset);
        var dz = jb.group.position.z - ja.group.position.z;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minD * minD && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var push = (1 - d / minD) * 0.9;
          var inv = 1 / d;
          ja.vel.x -= dx * inv * push * 0.5;
          ja.vel.y -= dy * inv * push * 0.5;
          ja.vel.z -= dz * inv * push * 0.5;
          jb.vel.x += dx * inv * push * 0.5;
          jb.vel.y += dy * inv * push * 0.5;
          jb.vel.z += dz * inv * push * 0.5;
        }
      }
    }

    for (var i = 0; i < sepN; i++) {
      var j = this.jellies[i];
      j.bellMat.uniforms.uTime.value = t;
      for (var k = 0; k < j.oralArms.length; k++) j.oralArms[k].uniforms.uTime.value = t;
      for (var k2 = 0; k2 < j.tentacles.length; k2++) j.tentacles[k2].uniforms.uTime.value = t;

      // ── pulse locomotion: 0→1→0 cycle (contract → relax) ──
      var pulseRaw = Math.sin(t * j.pulseSpeed + j.pulsePhase);
      var pulse = Math.max(0, pulseRaw); // only positive half = contract phase
      j.bellMat.uniforms.uPulse.value = pulse;

      // 缓和漠游：缓慢改变航向，产生柔和曲折的游动轨迹
      var wander = j.baseAngle
        + Math.sin(t * j.wanderFreq1 + j.phase) * j.wanderAmp1
        + Math.sin(t * j.wanderFreq2 + j.phase * 1.7) * j.wanderAmp2;
      var spd = j.speed * (0.8 + 0.2 * Math.sin(t * 0.25 + j.phase));
      // 目标速度（漂流方向随时间平滑拐弯）
      var tvx = Math.cos(wander) * spd;
      var tvz = Math.sin(wander) * spd;
      // 缓动向目标速度靠近 → 轨迹柔和而非生硬
      var relax = Math.min(1, dt * 1.0);
      j.vel.x += (tvx - j.vel.x) * relax;
      j.vel.z += (tvz - j.vel.z) * relax;
      // 垂直缓慢上浮/下潜（深度层浮动）
      var tvy = Math.sin(t * j.yDriftFreq + j.phase * 1.3) * j.yDriftAmp;
      j.vel.y += (tvy - j.vel.y) * relax;

      // 限速，避免分离推力叠成飞速
      var maxSpd = j.speed * 2.2;
      var mag = Math.sqrt(j.vel.x * j.vel.x + j.vel.y * j.vel.y + j.vel.z * j.vel.z);
      if (mag > maxSpd) { var sc = maxSpd / mag; j.vel.x *= sc; j.vel.y *= sc; j.vel.z *= sc; }

      j.group.position.x += j.vel.x * dt;
      j.yOffset += j.vel.y * dt;
      if (j.yOffset > 80) j.yOffset = 80;
      if (j.yOffset < -80) j.yOffset = -80;
      j.group.position.z += j.vel.z * dt;

      // drift + bob (bob stronger during pulse = propulsion)
      var bob = Math.sin(t * j.bobSpeed + j.phase) * 14;
      j.group.position.y = j.basePos.y + j.yOffset + bob + Math.sin(t * 0.3 + j.phase) * 20 + pulse * 6;

      // 深度自适应环绕：始终贴近屏幕边缘重新进入，保证全屏分布
      var dist = 160 - j.group.position.z;
      if (dist < 1) dist = 1;
      var halfH = fovHalf * dist;
      var halfW = halfH * aspect;
      var margin = j.scale * 3;
      if (j.group.position.x > halfW + margin) j.group.position.x = -halfW - margin;
      else if (j.group.position.x < -halfW - margin) j.group.position.x = halfW + margin;
      // 纵向软裹：轻微反弹回可见范围，避免贴边后消失
      if (j.group.position.z > 60) {
        j.group.position.z = 120 - j.group.position.z;
        j.vel.z = Math.abs(j.vel.z) * 0.6;
      } else if (j.group.position.z < -130) {
        j.group.position.z = -260 - j.group.position.z;
        j.vel.z = Math.abs(j.vel.z) * 0.6;
      }

      // 自然摆动：身体随速度倾斜 + 低频摇摆
      var lean = j.vel.x * 0.03;
      j.group.rotation.z = lean + Math.sin(t * 0.45 + j.phase) * 0.13;
      j.group.rotation.x = Math.sin(t * 0.28 + j.phase * 1.31) * 0.1 + j.vel.z * 0.012;
      j.group.rotation.y = Math.sin(t * 0.18 + j.phase * 0.7) * 0.25;

      // 触须/口臂摆动幅度随收缩脉动微微变化（生物节律感）
      var ampMod = j.limbAmp * (0.85 + 0.15 * pulse);
      for (var k3 = 0; k3 < j.oralArms.length; k3++) j.oralArms[k3].uniforms.uAmp.value = ampMod;
      for (var k4 = 0; k4 < j.tentacles.length; k4++) j.tentacles[k4].uniforms.uAmp.value = ampMod * (0.85 + 0.15 * Math.sin(t * 0.9 + k4));

      // gentle scale breathing synced to pulse
      var breathe = 1.0 + pulse * 0.06;
      j.group.scale.setScalar(breathe);

      // mouse avoidance
      if (mouse) {
        var dx = j.group.position.x - mouse.world.x;
        var dy = j.group.position.y - mouse.world.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 6400) {
          var f = (1 - d2 / 6400) * 18;
          var dl = Math.sqrt(d2) || 1;
          j.vel.x += (dx / dl) * f * dt * 4;
          j.vel.y += (dy / dl) * f * dt * 4;
        }
        j.vel.multiplyScalar(0.985);
      } else {
        // 无鼠标时轻微阻尼，保持柔和漂流
        j.vel.multiplyScalar(0.997);
      }

      // glow + spot pulse
      var glowPulse = 0.35 + 0.3 * pulse;
      j.glowMat.opacity = glowPulse;
      j.light.intensity = 0.8 + pulse * 0.8;
      for (var si = 0; si < j.spots.length; si++) {
        var s = j.spots[si];
        s.mat.opacity = 0.4 + 0.5 * Math.sin(t * 2.0 + s.phase) * 0.5 + 0.3;
        s.mat.opacity = Math.max(0.2, Math.min(0.9, s.mat.opacity));
      }

      // ── trail particles: offset behind jellyfish position ──
      for (var tp = 0; tp < trailPerJelly; tp++) {
        var idx2 = (i * trailPerJelly + tp) * 3;
        var lag = (tp + 1) * 0.5;
        trailArr[idx2]     = j.group.position.x - j.vel.x * lag + (Math.random() - 0.5) * 4;
        trailArr[idx2 + 1] = j.group.position.y - j.scale * 2 - lag * 3 + (Math.random() - 0.5) * 4;
        trailArr[idx2 + 2] = j.group.position.z + (Math.random() - 0.5) * 4;
      }
    }
    this._trailGeo.attributes.position.needsUpdate = true;
    this.trailMat.uniforms.uTime.value = t;
  };

  Jellyfish3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this.glowTex) this.glowTex.dispose();
    this.root = null;
  };

  // ============================================================
  // D. FishSchool3D
  // ============================================================
  function FishSchool3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    // ── lights ──
    this.dirLight = new THREE.DirectionalLight(0xbcd2ff, 0.9);
    this.dirLight.position.set(40, 80, 60);
    this.root.add(this.dirLight);
    this.ambLight = new THREE.AmbientLight(0x335577, 0.6);
    this.root.add(this.ambLight);

    // ── fish iridescent shader (inline) ──
    var fishVS = [
      'varying vec3 vNormal;',
      'varying vec3 vViewDir;',
      'varying vec2 vUv;',
      'void main(){',
      '  vUv=uv;',
      '  vNormal=normalize(normalMatrix*normal);',
      '  vec4 mv=modelViewMatrix*vec4(position,1.0);',
      '  vViewDir=normalize(-mv.xyz);',
      '  gl_Position=projectionMatrix*mv;',
      '}'
    ].join('\n');
    var fishFS = [
      'uniform float uTime;',
      'uniform vec3 uColor;',
      'uniform vec3 uIrid;',
      'varying vec3 vNormal;',
      'varying vec3 vViewDir;',
      'varying vec2 vUv;',
      'void main(){',
      '  float ndv=max(dot(vNormal,vViewDir),0.0);',
      '  float fres=pow(1.0-ndv,2.5);',
      '  float irid=sin(ndv*8.0+uTime*0.5)*0.5+0.5;',
      '  vec3 col=mix(uColor,uIrid,irid*0.45);',
      '  col+=fres*uIrid*0.7;',
      '  float shimmer=sin(vUv.y*18.0+uTime*1.8)*0.5+0.5;',
      '  col+=shimmer*0.08*uIrid;',
      '  gl_FragColor=vec4(col,0.88);',
      '}'
    ].join('\n');

    // ── species: tropical, deep-sea, silver, exotic ──
    this.species = opts.species || [
      { body: 0x8a7a6a, irid: 0xaa9888, sz: 1.0 },
      { body: 0x6a7a8a, irid: 0x889aaa, sz: 0.85 },
      { body: 0x9a9a9a, irid: 0xbbbbbb, sz: 1.1 },
      { body: 0x7a6a8a, irid: 0x9a8aaa, sz: 0.9 }
    ];

    // ── shared geometries ──
    this.bodyGeo     = new THREE.SphereGeometry(1, 16, 12);
    this.dorsalGeo   = new THREE.ConeGeometry(0.35, 0.9, 4);
    this.tailStalkGeo= new THREE.ConeGeometry(0.3, 0.8, 6);
    this.tailFinGeo  = new THREE.PlaneGeometry(0.7, 1.1);
    this.pectoralGeo = new THREE.PlaneGeometry(0.7, 0.35);
    this.eyeGeo      = new THREE.SphereGeometry(0.1, 8, 8);
    this.eyeMat      = new THREE.MeshBasicMaterial({ color: 0x0a1020 });

    // ── shared materials per species ──
    this.bodyMats = [];
    this.finMats  = [];
    for (var si = 0; si < this.species.length; si++) {
      var sp = this.species[si];
      this.bodyMats.push(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(sp.body) },
          uIrid: { value: new THREE.Color(sp.irid) }
        },
        vertexShader: fishVS,
        fragmentShader: fishFS,
        transparent: true, depthWrite: false
      }));
      this.finMats.push(new THREE.MeshBasicMaterial({
        color: sp.body, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
    }

    // ── create fish ──
    this.fish = [];
    var n = this.boost ? 60 : 42;
    var bounds = 160;
    for (var i = 0; i < n; i++) {
      var f = this._createFish(i % this.species.length, bounds);
      this.root.add(f.group);
      this.fish.push(f);
    }
    this.bounds = bounds;

    // ── bubble trail system ──
    this._initBubbles(n);
  }

  FishSchool3D.prototype._createFish = function (speciesIdx, bounds) {
    var sp = this.species[speciesIdx];
    var bodyMat = this.bodyMats[speciesIdx];
    var finMat = this.finMats[speciesIdx];
    var sz = sp.sz * (0.8 + Math.random() * 0.5);

    var g = new THREE.Group();

    // body: elongated, flattened sphere
    var body = new THREE.Mesh(this.bodyGeo, bodyMat);
    body.scale.set(2.6 * sz, 1.2 * sz, 0.8 * sz);
    g.add(body);

    // dorsal fin (top)
    var dorsal = new THREE.Mesh(this.dorsalGeo, finMat);
    dorsal.position.set(-0.3 * sz, 1.0 * sz, 0);
    dorsal.scale.set(0.6 * sz, 1.0 * sz, 0.08 * sz);
    dorsal.rotation.z = -0.2;
    g.add(dorsal);

    // pectoral fins (sides)
    var pectL = new THREE.Mesh(this.pectoralGeo, finMat);
    pectL.position.set(0.9 * sz, 0, 0.55 * sz);
    pectL.rotation.y = -0.6;
    pectL.scale.setScalar(sz);
    g.add(pectL);
    var pectR = new THREE.Mesh(this.pectoralGeo, finMat);
    pectR.position.set(0.9 * sz, 0, -0.55 * sz);
    pectR.rotation.y = 0.6;
    pectR.scale.setScalar(sz);
    g.add(pectR);

    // tail group (wags around Y)
    var tailGroup = new THREE.Group();
    tailGroup.position.set(-2.6 * sz, 0, 0);
    // tail stalk
    var stalk = new THREE.Mesh(this.tailStalkGeo, finMat);
    stalk.rotation.z = -Math.PI / 2;
    stalk.position.x = -0.3 * sz;
    stalk.scale.setScalar(sz);
    tailGroup.add(stalk);
    // caudal fin (vertical fan)
    var tailFin = new THREE.Mesh(this.tailFinGeo, finMat);
    tailFin.position.x = -0.8 * sz;
    tailFin.scale.set(0.7 * sz, 1.3 * sz, 1);
    tailGroup.add(tailFin);
    g.add(tailGroup);

    // eyes
    var e1 = new THREE.Mesh(this.eyeGeo, this.eyeMat);
    e1.position.set(1.8 * sz, 0.35 * sz, 0.45 * sz);
    var e2 = new THREE.Mesh(this.eyeGeo, this.eyeMat);
    e2.position.set(1.8 * sz, 0.35 * sz, -0.45 * sz);
    g.add(e1); g.add(e2);

    g.position.set(
      (Math.random() - 0.5) * bounds * 2,
      (Math.random() - 0.5) * bounds,
      (Math.random() - 0.5) * bounds * 2
    );

    return {
      group: g,
      tailGroup: tailGroup,
      pos: g.position.clone(),
      vel: new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5)
      ).normalize().multiplyScalar(20),
      wagPhase: Math.random() * 6.28,
      speciesIdx: speciesIdx,
      size: sz
    };
  };

  FishSchool3D.prototype._initBubbles = function (fishCount) {
    var bcount = fishCount * 4;
    var bpos = new Float32Array(bcount * 3);
    var boff = new Float32Array(bcount);
    var bsize = new Float32Array(bcount);
    for (var i = 0; i < bcount; i++) {
      bpos[i * 3] = 0; bpos[i * 3 + 1] = 0; bpos[i * 3 + 2] = 0;
      boff[i] = Math.random() * 6.28;
      bsize[i] = 1.5 + Math.random() * 2.0;
    }
    var bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bgeo.setAttribute('aOffset', new THREE.BufferAttribute(boff, 1));
    bgeo.setAttribute('aSize', new THREE.BufferAttribute(bsize, 1));
    this.bubbleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: [
        'attribute float aOffset;',
        'attribute float aSize;',
        'uniform float uTime;',
        'varying float vA;',
        'void main(){',
        '  vA=0.3+0.7*sin(uTime*1.2+aOffset*3.0);',
        '  vA=pow(max(vA,0.0),1.5);',
        '  vec4 mv=modelViewMatrix*vec4(position,1.0);',
        '  gl_PointSize=aSize*(200.0/-mv.z);',
        '  gl_Position=projectionMatrix*mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying float vA;',
        'void main(){',
        '  float d=length(gl_PointCoord-0.5);',
        '  float ring=smoothstep(0.5,0.35,d)*smoothstep(0.2,0.35,d);',
        '  float core=smoothstep(0.25,0.0,d)*0.3;',
        '  float a=(ring+core)*vA*0.4;',
        '  gl_FragColor=vec4(0.6,0.7,0.8,a);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.bubbles = new THREE.Points(bgeo, this.bubbleMat);
    this.root.add(this.bubbles);
    this._bubbleGeo = bgeo;
  };

  FishSchool3D.prototype.update = function (t, dt, mouse) {
    dt = Math.min(dt, 0.05);
    var fish = this.fish;
    var n = fish.length;
    var b = this.bounds;
    var mouseTarget = mouse && mouse.world ? mouse.world : null;
    var bubbleArr = this._bubbleGeo.attributes.position.array;
    var bubblesPerFish = 4;

    // update iridescent shader time for all species
    for (var mi = 0; mi < this.bodyMats.length; mi++) {
      this.bodyMats[mi].uniforms.uTime.value = t;
    }

    for (var i = 0; i < n; i++) {
      var f = fish[i];
      var sep = new THREE.Vector3();
      var ali = new THREE.Vector3();
      var coh = new THREE.Vector3();
      var count = 0;
      for (var j = 0; j < n; j++) {
        if (i === j) continue;
        var d = fish[j].pos.distanceTo(f.pos);
        if (d > 0 && d < 22) {
          var diff = new THREE.Vector3().subVectors(f.pos, fish[j].pos).divideScalar(d);
          sep.add(diff);
          ali.add(fish[j].vel);
          coh.add(fish[j].pos);
          count++;
        }
      }
      if (count > 0) {
        sep.multiplyScalar(1.5 / count);
        ali.divideScalar(count).normalize().multiplyScalar(20);
        coh.divideScalar(count).sub(f.pos).normalize().multiplyScalar(8);
      }
      var acc = new THREE.Vector3();
      acc.add(sep.multiplyScalar(1.4));
      acc.add(ali.multiplyScalar(0.9));
      acc.add(coh.multiplyScalar(0.8));

      if (mouseTarget) {
        var md = f.pos.distanceTo(mouseTarget);
        if (md < 220) {
          var pull = new THREE.Vector3().subVectors(mouseTarget, f.pos).normalize()
            .multiplyScalar((1 - md / 220) * 40);
          acc.add(pull);
        }
      }

      if (f.pos.x > b) acc.x -= (f.pos.x - b) * 0.4;
      if (f.pos.x < -b) acc.x -= (f.pos.x + b) * 0.4;
      if (f.pos.y > b * 0.7) acc.y -= (f.pos.y - b * 0.7) * 0.4;
      if (f.pos.y < -b * 0.7) acc.y -= (f.pos.y + b * 0.7) * 0.4;
      if (f.pos.z > b) acc.z -= (f.pos.z - b) * 0.4;
      if (f.pos.z < -b) acc.z -= (f.pos.z + b) * 0.4;

      f.vel.addScaledVector(acc, dt);
      var speed = f.vel.length();
      var maxS = 38, minS = 12;
      if (speed > maxS) f.vel.multiplyScalar(maxS / speed);
      if (speed < minS && speed > 0) f.vel.multiplyScalar(minS / speed);

      f.pos.addScaledVector(f.vel, dt);
      f.group.position.copy(f.pos);

      var dir = f.vel.clone().normalize();
      var yaw = Math.atan2(dir.z, dir.x);
      var pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      f.group.rotation.set(0, -yaw, pitch);

      // tail wag based on speed
      var wag = Math.sin(t * 12 + f.wagPhase) * (0.3 + speed / 38 * 0.7);
      f.tailGroup.rotation.y = wag;

      // bubble trail
      for (var bp = 0; bp < bubblesPerFish; bp++) {
        var bidx = (i * bubblesPerFish + bp) * 3;
        var blag = (bp + 1) * 0.3;
        bubbleArr[bidx]     = f.pos.x - dir.x * blag * 3 + (Math.random() - 0.5) * 2;
        bubbleArr[bidx + 1] = f.pos.y + blag * 2 + (Math.random() - 0.5) * 2;
        bubbleArr[bidx + 2] = f.pos.z - dir.z * blag * 3 + (Math.random() - 0.5) * 2;
      }
    }

    this._bubbleGeo.attributes.position.needsUpdate = true;
    this.bubbleMat.uniforms.uTime.value = t;
  };

  FishSchool3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root = null;
  };

  // ============================================================
  // E. Sky3D
  // ============================================================
  function Sky3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.skyless = !!opts.skyless;
    this.root = makeRoot();
    this.scene.add(this.root);

    // ── sky dome ──
    var sunDir;
    if (!this.skyless) {
      var domeGeo = new THREE.SphereGeometry(900, 64, 48);
      this.domeMat = new THREE.ShaderMaterial({
        uniforms: {
          uZenith:   { value: new THREE.Color(0x1a1a30) },
          uMid:      { value: new THREE.Color(0x2a3850) },
          uHorizon:  { value: new THREE.Color(0x8a5a4a) },
          uGround:   { value: new THREE.Color(0x2a1a14) },
          uSunDir:   { value: new THREE.Vector3(0.35, 0.18, -1).normalize() },
          uSunColor: { value: new THREE.Color(0xaa9a7a) },
          uTime:     { value: 0 },
          uOpacity:  { value: 0.35 }
        },
        vertexShader: SHADERS.sky.vertex,
        fragmentShader: SHADERS.sky.fragment,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true
      });
      this.dome = new THREE.Mesh(domeGeo, this.domeMat);
      this.dome.renderOrder = 1;
      this.root.add(this.dome);
      sunDir = this.domeMat.uniforms.uSunDir.value;
    } else {
      // skyless 叠加模式：不渲染天空穹顶，仅保留云层/阳光/光线叠加在页面背景上
      this.dome = null;
      this.domeMat = null;
      sunDir = new THREE.Vector3(0.35, 0.18, -1).normalize();
    }

    // ── multi-layer sun: core + corona + halo ──
    this.sunTex      = createGlowTexture('#aaa090');
    this.sunCoronaTex = createGlowTexture('#9a8a7a');

    this.sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.sunTex, color: 0xc4b8a8, transparent: true,
      opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sunCore.position.copy(sunDir.clone().multiplyScalar(820));
    this.sunCore.scale.set(120, 120, 1);
    this.root.add(this.sunCore);

    this.sunCorona = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.sunCoronaTex, color: 0xaa9888, transparent: true,
      opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sunCorona.position.copy(this.sunCore.position);
    this.sunCorona.scale.set(420, 420, 1);
    this.root.add(this.sunCorona);

    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.sunCoronaTex, color: 0x8a7a6a, transparent: true,
      opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sunHalo.position.copy(this.sunCore.position);
    this.sunHalo.scale.set(820, 820, 1);
    this.root.add(this.sunHalo);

    // ── volumetric cloud layers (3 depth layers, parallax drift) ──
    this.cloudTex = createCloudTexture();
    this.clouds = [];
    var layers = [
      { count: this.boost ? 18 : 12, yMin: 60,  yMax: 140, rMin: 300, rMax: 560, scMin: 200, scMax: 380, op: 0.30, speed: 1.2 },
      { count: this.boost ? 14 : 10, yMin: 20,  yMax: 80,  rMin: 200, rMax: 420, scMin: 260, scMax: 480, op: 0.38, speed: 2.5 },
      { count: this.boost ? 10 : 7,  yMin: 0,   yMax: 40,  rMin: 120, rMax: 280, scMin: 320, scMax: 560, op: 0.42, speed: 4.0 }
    ];
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      for (var i = 0; i < L.count; i++) {
        var tint = new THREE.Color(0xffffff).lerp(new THREE.Color(0x9a8a7a), Math.random() * 0.3);
        var cm = new THREE.SpriteMaterial({
          map: this.cloudTex, transparent: true,
          opacity: L.op + Math.random() * 0.2,
          depthWrite: false, color: tint
        });
        var sp = new THREE.Sprite(cm);
        var ang = Math.random() * Math.PI * 2;
        var rad = L.rMin + Math.random() * (L.rMax - L.rMin);
        var cy  = L.yMin + Math.random() * (L.yMax - L.yMin);
        sp.position.set(Math.cos(ang) * rad, cy, Math.sin(ang) * rad - 80);
        var sc  = L.scMin + Math.random() * (L.scMax - L.scMin);
        sp.scale.set(sc, sc * 0.5, 1);
        this.root.add(sp);
        this.clouds.push({
          sprite: sp, speed: L.speed * (0.7 + Math.random() * 0.6),
          ang: ang, rad: rad, y: cy, layer: li
        });
      }
    }

    // ── volumetric god rays (conical beam planes) ──
    this.rays = new THREE.Group();
    var rn = this.boost ? 14 : 9;
    for (var r = 0; r < rn; r++) {
      var rg = new THREE.PlaneGeometry(30 + Math.random() * 30, 700);
      var rm = new THREE.MeshBasicMaterial({
        color: 0xaa9a8a, transparent: true, opacity: 0.04 + Math.random() * 0.04,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      var ray = new THREE.Mesh(rg, rm);
      var spread = (r / rn - 0.5) * 2.2;
      ray.position.copy(sunDir.clone().multiplyScalar(320));
      ray.position.x += spread * 180;
      ray.position.z += (Math.random() - 0.5) * 120;
      ray.position.y -= 100 + Math.random() * 100;
      ray.lookAt(0, -50, 0);
      ray.rotateZ(Math.random() * 0.3);
      ray.userData.baseOp = rm.opacity;
      this.rays.add(ray);
    }
    this.root.add(this.rays);

    // ── atmospheric dust motes ──
    var dcount = this.boost ? 800 : 500;
    var dpos = new Float32Array(dcount * 3);
    var dsize = new Float32Array(dcount);
    var doff = new Float32Array(dcount);
    for (var d = 0; d < dcount; d++) {
      dpos[d * 3]     = (Math.random() - 0.5) * 800;
      dpos[d * 3 + 1] = Math.random() * 300 - 50;
      dpos[d * 3 + 2] = (Math.random() - 0.5) * 500 - 50;
      dsize[d] = 0.4 + Math.random() * 1.2;
      doff[d]  = Math.random() * 100;
    }
    var dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    dgeo.setAttribute('aSize',    new THREE.BufferAttribute(dsize, 1));
    dgeo.setAttribute('aOffset',  new THREE.BufferAttribute(doff, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aOffset;',
        'uniform float uTime;',
        'varying float vA;',
        'void main(){',
        '  vec3 p=position;',
        '  p.x+=sin(uTime*0.3+aOffset)*3.0;',
        '  p.y+=cos(uTime*0.2+aOffset*1.3)*2.0;',
        '  vA=0.4+0.6*sin(uTime*0.8+aOffset*3.0);',
        '  vec4 mv=modelViewMatrix*vec4(p,1.0);',
        '  gl_PointSize=aSize*(200.0/-mv.z);',
        '  gl_Position=projectionMatrix*mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying float vA;',
        'void main(){',
        '  float d=length(gl_PointCoord-0.5);',
        '  float a=smoothstep(0.5,0.0,d)*vA*0.35;',
        '  gl_FragColor=vec4(0.7,0.65,0.6,a);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.dust = new THREE.Points(dgeo, this.dustMat);
    this.root.add(this.dust);
  }

  Sky3D.prototype.update = function (t, dt) {
    if (this.domeMat) this.domeMat.uniforms.uTime.value = t;
    this.dustMat.uniforms.uTime.value = t;

    // layered cloud parallax drift
    for (var i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      c.ang += c.speed * dt * 0.003;
      c.sprite.position.x = Math.cos(c.ang) * c.rad;
      c.sprite.position.z = Math.sin(c.ang) * c.rad - 80;
      c.sprite.position.y = c.y + Math.sin(t * 0.15 + i * 0.7) * (6 + c.layer * 3);
    }

    // sun pulsing (skyless 叠加模式下减弱，避免过曝背景)
    var sMul = this.skyless ? 0.45 : 1.0;
    var pulse = 0.5 + 0.5 * Math.sin(t * 0.5);
    this.sunCore.material.opacity   = (0.35 + pulse * 0.15) * sMul;
    this.sunCorona.material.opacity = (0.25 + pulse * 0.15) * sMul;
    this.sunHalo.material.opacity   = (0.08 + pulse * 0.08) * sMul;
    this.sunCorona.scale.setScalar(420 + pulse * 30);

    // god ray flicker
    for (var k = 0; k < this.rays.children.length; k++) {
      var base = parseFloat(this.rays.children[k].userData.baseOp || 0.05);
      this.rays.children[k].material.opacity = base + 0.04 * Math.sin(t * 0.8 + k * 1.3);
    }
  };

  Sky3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this.sunTex) this.sunTex.dispose();
    if (this.sunCoronaTex) this.sunCoronaTex.dispose();
    if (this.cloudTex) this.cloudTex.dispose();
    this.root = null;
  };

  // ============================================================
  // F. Sparkle3D
  // ============================================================
  function Sparkle3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    var count = this.boost ? 2400 : 1600;
    var width = 560, height = 400;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var offsets = new Float32Array(count);
    var mix = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * width;
      positions[i * 3 + 1] = (Math.random() - 0.5) * height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200 - 30;
      sizes[i] = 3.5 + Math.random() * 6.5;
      offsets[i] = Math.random() * 100;
      mix[i] = Math.random();
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('aColorMix', new THREE.BufferAttribute(mix, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: height },
        uColorA: { value: new THREE.Color(0xd9b27a) }, // warm amber
        uColorB: { value: new THREE.Color(0x7aa5d9) }, // soft azure
        uColorC: { value: new THREE.Color(0xc99ac0) }  // dusty rose
      },
      vertexShader: SHADERS.sparkle.vertex,
      fragmentShader: SHADERS.sparkle.fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(geo, this.material);
    this.root.add(this.points);

    // a few large glow sprites for intense highlights (tinted, not pure white)
    this.glowTex = createGlowTexture('#c9b89a');
    this.glows = [];
    var glowColors = [0xd9b27a, 0x7aa5d9, 0xc99ac0];
    var gn = this.boost ? 30 : 20;
    for (var g = 0; g < gn; g++) {
      var gm = new THREE.SpriteMaterial({
        map: this.glowTex, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false,
        color: glowColors[g % 3]
      });
      var sp = new THREE.Sprite(gm);
      sp.position.set((Math.random() - 0.5) * width, (Math.random() - 0.5) * height, -20);
      sp.scale.set(45 + Math.random() * 60, 45 + Math.random() * 60, 1);
      this.root.add(sp);
      this.glows.push({ sprite: sp, phase: Math.random() * 6.28, baseY: sp.position.y });
    }
  }

  Sparkle3D.prototype.update = function (t) {
    this.material.uniforms.uTime.value = t;
    for (var i = 0; i < this.glows.length; i++) {
      var g = this.glows[i];
      g.sprite.position.y = ((g.baseY + t * 18) % 360) - 180;
      g.sprite.material.opacity = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + g.phase));
    }
  };

  Sparkle3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this.glowTex) this.glowTex.dispose();
    this.root = null;
  };

  // ============================================================
  // G. Nebula3D
  // ============================================================
  function Nebula3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    this.tex = createSoftDiskTexture();
    var palette = [0x4a3a6a, 0x6a3a4a, 0x3a5a6a, 0x3a4a6a, 0x6a4a5a];
    this.clouds = [];
    var n = this.boost ? 60 : 40;
    for (var i = 0; i < n; i++) {
      var col = palette[(Math.random() * palette.length) | 0];
      var mat = new THREE.SpriteMaterial({
        map: this.tex, color: col, transparent: true,
        opacity: 0.18 + Math.random() * 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var sp = new THREE.Sprite(mat);
      sp.position.set(
        (Math.random() - 0.5) * 700,
        (Math.random() - 0.5) * 400,
        (Math.random() - 0.5) * 400 - 60
      );
      var sc = 180 + Math.random() * 320;
      sp.scale.set(sc, sc, 1);
      this.root.add(sp);
      this.clouds.push({
        sprite: sp, mat: mat,
        rot: (Math.random() - 0.5) * 0.3,
        drift: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 0)
      });
    }

    // embedded star clusters
    var sCount = this.boost ? 700 : 450;
    var sPos = new Float32Array(sCount * 3);
    var sSize = new Float32Array(sCount);
    var sOff = new Float32Array(sCount);
    var sCol = new Float32Array(sCount * 3);
    for (var s = 0; s < sCount; s++) {
      var cluster = (Math.random() * 4) | 0;
      var cx = (cluster - 1.5) * 160;
      var cy = (Math.random() - 0.5) * 120;
      sPos[s * 3] = cx + (Math.random() - 0.5) * 120;
      sPos[s * 3 + 1] = cy + (Math.random() - 0.5) * 120;
      sPos[s * 3 + 2] = (Math.random() - 0.5) * 200 - 60;
      sSize[s] = 0.8 + Math.random() * 2.2;
      sOff[s] = Math.random() * 100;
      var cc = new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.3, 0.6);
      sCol[s * 3] = cc.r; sCol[s * 3 + 1] = cc.g; sCol[s * 3 + 2] = cc.b;
    }
    var sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sgeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
    sgeo.setAttribute('aOffset', new THREE.BufferAttribute(sOff, 1));
    sgeo.setAttribute('aColor', new THREE.BufferAttribute(sCol, 3));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SHADERS.star.vertex,
      fragmentShader: SHADERS.star.fragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.stars = new THREE.Points(sgeo, this.starMat);
    this.root.add(this.stars);
  }

  Nebula3D.prototype.update = function (t, dt) {
    this.starMat.uniforms.uTime.value = t;
    for (var i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      c.sprite.position.addScaledVector(c.drift, dt);
      c.sprite.material.rotation += c.rot * dt * 0.2;
      if (c.sprite.position.x > 400) c.sprite.position.x = -400;
      if (c.sprite.position.x < -400) c.sprite.position.x = 400;
    }
    this.root.rotation.z = Math.sin(t * 0.02) * 0.05;
  };

  Nebula3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this.tex) this.tex.dispose();
    this.root = null;
  };

  // ============================================================
  // H. CrystalShards3D
  // ============================================================
  function CrystalShards3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.dirLight.position.set(50, 80, 60);
    this.root.add(this.dirLight);
    this.ambLight = new THREE.AmbientLight(0x6688aa, 0.7);
    this.root.add(this.ambLight);
    this.pointLight = new THREE.PointLight(0x6677aa, 0.6, 400);
    this.pointLight.position.set(0, 0, 80);
    this.root.add(this.pointLight);

    this.geo = new THREE.OctahedronGeometry(1, 0);
    this.shards = [];
    var n = this.boost ? 80 : 50;
    var palette = [0x8a6a7a, 0x6a7a8a, 0x7a6a8a, 0x6a8a7a, 0x8a8a6a];
    for (var i = 0; i < n; i++) {
      var col = palette[(Math.random() * palette.length) | 0];
      var mat;
      try {
        mat = new THREE.MeshPhysicalMaterial({
          color: col,
          metalness: 0.1,
          roughness: 0.08,
          transmission: 0.85,
          thickness: 1.2,
          ior: 1.6,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          transparent: true,
          opacity: 0.55,
          emissive: col,
          emissiveIntensity: 0.06,
          side: THREE.DoubleSide
        });
      } catch (e) {
        mat = new THREE.MeshStandardMaterial({
          color: col, metalness: 0.3, roughness: 0.2,
          transparent: true, opacity: 0.5, emissive: col, emissiveIntensity: 0.1
        });
      }
      var m = new THREE.Mesh(this.geo, mat);
      var sc = 3 + Math.random() * 6;
      m.scale.set(sc, sc * (0.8 + Math.random() * 0.6), sc);
      m.position.set(
        (Math.random() - 0.5) * 460,
        (Math.random() - 0.5) * 260,
        (Math.random() - 0.5) * 220 - 40
      );
      this.root.add(m);
      this.shards.push({
        mesh: m,
        rot: new THREE.Vector3(Math.random() * 0.6, Math.random() * 0.6, Math.random() * 0.6),
        floatPhase: Math.random() * 6.28,
        basePos: m.position.clone()
      });
    }
  }

  CrystalShards3D.prototype.update = function (t, dt) {
    for (var i = 0; i < this.shards.length; i++) {
      var s = this.shards[i];
      s.mesh.rotation.x += s.rot.x * dt;
      s.mesh.rotation.y += s.rot.y * dt;
      s.mesh.rotation.z += s.rot.z * dt;
      s.mesh.position.y = s.basePos.y + Math.sin(t * 0.6 + s.floatPhase) * 14;
      s.mesh.position.x = s.basePos.x + Math.cos(t * 0.4 + s.floatPhase) * 8;
    }
    this.pointLight.intensity = 0.5 + 0.2 * Math.sin(t * 0.8);
  };

  CrystalShards3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root = null;
  };

  // ============================================================
  // I. Bioluminescence3D
  // ============================================================
  function Bioluminescence3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    var count = this.boost ? 650 : 420;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var offsets = new Float32Array(count);
    var speeds = new Float32Array(count);
    var colors = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 640;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 360;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 320 - 40;
      sizes[i] = 1.2 + Math.random() * 2.6;
      offsets[i] = Math.random() * 100;
      speeds[i] = 0.6 + Math.random() * 2.2;
      var h = 0.45 + Math.random() * 0.15; // cyan -> green-cyan
      var c = new THREE.Color().setHSL(h, 0.3, 0.4);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SHADERS.biolum.vertex,
      fragmentShader: SHADERS.biolum.fragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(geo, this.material);
    this.root.add(this.points);
  }

  Bioluminescence3D.prototype.update = function (t) {
    this.material.uniforms.uTime.value = t;
  };

  Bioluminescence3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root = null;
  };

  // ============================================================
  // Weather3D — realistic self-contained weather scene (sky dome + lighting +
  // precipitation). NormalBlending only; no additive neon glow.
  // ============================================================
  var WEATHER_PALETTES = {
    sunny: {
      zenith: 0x1f5fa8, mid: 0x4f93d8, horizon: 0xc4dcf0, ground: 0x6a7a8a,
      sunDir: [0.45, 0.5, -1], sunColor: 0xfff2d0, domeOp: 0.92,
      lightCol: 0xfff1d8, lightInt: 1.15, ambCol: 0x9ec0e2, ambInt: 0.7,
      hemiSky: 0x6aa0d8, hemiGround: 0x6a7a8a, hemiInt: 0.5, sun: true, fogCol: 0xbcd6ee
    },
    cloudy: {
      zenith: 0x4a6680, mid: 0x7090a8, horizon: 0xc0d0dc, ground: 0x6a7480,
      sunDir: [0.4, 0.5, -1], sunColor: 0xdfe6f0, domeOp: 0.9,
      lightCol: 0xc8d4e0, lightInt: 0.8, ambCol: 0x8a9eb0, ambInt: 0.7,
      hemiSky: 0x8aa0b4, hemiGround: 0x6a7480, hemiInt: 0.45, sun: true, fogCol: 0xa8bcc8
    },
    overcast: {
      zenith: 0x3a4452, mid: 0x566270, horizon: 0x8a96a4, ground: 0x3a3e44,
      sunDir: [0.3, 0.6, -1], sunColor: 0x000000, domeOp: 0.95,
      lightCol: 0x9aa6b4, lightInt: 0.55, ambCol: 0x6a7684, ambInt: 0.65,
      hemiSky: 0x6a7684, hemiGround: 0x3a3e44, hemiInt: 0.4, sun: false, fogCol: 0x707c88
    },
    rainy: {
      zenith: 0x2a323c, mid: 0x3e4a58, horizon: 0x6a7684, ground: 0x2a2e34,
      sunDir: [0.3, 0.6, -1], sunColor: 0x000000, domeOp: 0.96,
      lightCol: 0x8c9cb0, lightInt: 0.5, ambCol: 0x566272, ambInt: 0.6,
      hemiSky: 0x566272, hemiGround: 0x2a2e34, hemiInt: 0.4, sun: false, fogCol: 0x5a6674
    },
    storm: {
      zenith: 0x161a22, mid: 0x242a34, horizon: 0x383e48, ground: 0x141618,
      sunDir: [0.3, 0.6, -1], sunColor: 0x000000, domeOp: 0.97,
      lightCol: 0x5a6474, lightInt: 0.35, ambCol: 0x38424e, ambInt: 0.5,
      hemiSky: 0x38424e, hemiGround: 0x141618, hemiInt: 0.35, sun: false, fogCol: 0x2c323c
    },
    snow: {
      zenith: 0x5e6a7a, mid: 0x8a96a6, horizon: 0xc4ced8, ground: 0x929ca6,
      sunDir: [0.35, 0.55, -1], sunColor: 0x000000, domeOp: 0.95,
      lightCol: 0xd8e2ec, lightInt: 0.6, ambCol: 0xb4c0cc, ambInt: 0.7,
      hemiSky: 0xb4c0cc, hemiGround: 0x929ca6, hemiInt: 0.45, sun: false, fogCol: 0xb0bcc8
    },
    lightsnow: {
      zenith: 0x6a7686, mid: 0x94a0b0, horizon: 0xccd6e0, ground: 0x9aa4ae,
      sunDir: [0.35, 0.55, -1], sunColor: 0x000000, domeOp: 0.93,
      lightCol: 0xdce6f0, lightInt: 0.65, ambCol: 0xbcc8d4, ambInt: 0.72,
      hemiSky: 0xbcc8d4, hemiGround: 0x9aa4ae, hemiInt: 0.45, sun: false, fogCol: 0xb8c4d0
    },
    midsnow: {
      zenith: 0x5e6a7a, mid: 0x8a96a6, horizon: 0xc4ced8, ground: 0x929ca6,
      sunDir: [0.35, 0.55, -1], sunColor: 0x000000, domeOp: 0.95,
      lightCol: 0xd8e2ec, lightInt: 0.6, ambCol: 0xb4c0cc, ambInt: 0.7,
      hemiSky: 0xb4c0cc, hemiGround: 0x929ca6, hemiInt: 0.45, sun: false, fogCol: 0xb0bcc8
    },
    heavysnow: {
      zenith: 0x4e5a68, mid: 0x74808e, horizon: 0xb4bec8, ground: 0x868c94,
      sunDir: [0.35, 0.55, -1], sunColor: 0x000000, domeOp: 0.97,
      lightCol: 0xd0dae4, lightInt: 0.55, ambCol: 0xa8b4c0, ambInt: 0.68,
      hemiSky: 0xa8b4c0, hemiGround: 0x868c94, hemiInt: 0.42, sun: false, fogCol: 0xa0acb8
    },
    thunder: {
      zenith: 0x0e1118, mid: 0x1a1e28, horizon: 0x2a3040, ground: 0x0a0c10,
      sunDir: [0.3, 0.6, -1], sunColor: 0x000000, domeOp: 0.98,
      lightCol: 0x4a5464, lightInt: 0.3, ambCol: 0x2a3040, ambInt: 0.45,
      hemiSky: 0x2a3040, hemiGround: 0x0a0c10, hemiInt: 0.3, sun: false, fogCol: 0x1c2030
    }
  };

  function Weather3D(opts) {
    this.scene = opts.scene;
    this.type = opts.type; // sunny|cloudy|overcast|rainy|storm|snow|lightsnow|midsnow|heavysnow
    this.boost = !!opts.boost;
    this.skyless = !!opts.skyless; // 无天空穹顶模式（自定义背景时使用）
    this.root = makeRoot();
    this.scene.add(this.root);

    var P = WEATHER_PALETTES[this.type] || WEATHER_PALETTES.overcast;
    this.pal = P;
    this._sunTex = null;

    // skyless 模式：跳过天空穹顶（不遮挡自定义背景），但保留太阳/光照/降水
    if (!this.skyless) {
      this._initSky(P);
    }
    // 太阳在晴天/多云时始终显示（skyless 模式下作为可见光效）
    if (P.sun) this._initSun(P);
    // 光照始终保留（降水需要光照）
    this._initLights(P);
    if (this.type === 'rainy' || this.type === 'storm' || this.type === 'thunder') {
      this._initRain(P, this.type === 'storm' || this.type === 'thunder');
      if (this.type === 'thunder') {
        this._initLightning(P);
        this._initLightningBolt(P);
      } else if (this.type === 'storm' && !this.skyless) {
        this._initLightning(P);
      }
    } else if (this.type.indexOf('snow') >= 0) {
      this._initSnow(P, this.type);
    }
  }

  Weather3D.prototype._initSky = function (P) {
    var domeGeo = new THREE.SphereGeometry(900, 48, 32);
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(P.zenith) },
        uMid: { value: new THREE.Color(P.mid) },
        uHorizon: { value: new THREE.Color(P.horizon) },
        uGround: { value: new THREE.Color(P.ground) },
        uSunDir: { value: new THREE.Vector3(P.sunDir[0], P.sunDir[1], P.sunDir[2]).normalize() },
        uSunColor: { value: new THREE.Color(P.sunColor) },
        uTime: { value: 0 },
        uOpacity: { value: P.domeOp }
      },
      vertexShader: SHADERS.sky.vertex,
      fragmentShader: SHADERS.sky.fragment,
      side: THREE.BackSide, depthWrite: false, transparent: true
    });
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.renderOrder = 1;
    this.root.add(this.dome);
  };

  Weather3D.prototype._initLights = function (P) {
    this.dirLight = new THREE.DirectionalLight(P.lightCol, P.lightInt);
    this.dirLight.position.set(P.sunDir[0] * 60, P.sunDir[1] * 60 + 40, P.sunDir[2] * 60);
    this.root.add(this.dirLight);
    this.ambLight = new THREE.AmbientLight(P.ambCol, P.ambInt);
    this.root.add(this.ambLight);
    this.hemiLight = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiInt);
    this.root.add(this.hemiLight);
  };

  Weather3D.prototype._initSun = function (P) {
    var sunDir = new THREE.Vector3(P.sunDir[0], P.sunDir[1], P.sunDir[2]).normalize();
    this._sunTex = createGlowTexture('#fff0d0');
    // bright sun disc — NormalBlending, clearly visible
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._sunTex, color: P.sunColor, transparent: true,
      opacity: 0.75, blending: THREE.NormalBlending, depthWrite: false
    }));
    this.sunSprite.position.copy(sunDir.clone().multiplyScalar(820));
    this.sunSprite.scale.set(160, 160, 1);
    this.sunSprite.renderOrder = 5;
    this.root.add(this.sunSprite);
    // large warm halo
    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._sunTex, color: P.sunColor, transparent: true,
      opacity: 0.28, blending: THREE.NormalBlending, depthWrite: false
    }));
    this.sunHalo.position.copy(this.sunSprite.position);
    this.sunHalo.scale.set(600, 600, 1);
    this.sunHalo.renderOrder = 4;
    this.root.add(this.sunHalo);
    // outer atmospheric glow
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._sunTex, color: 0xffe8b0, transparent: true,
      opacity: 0.12, blending: THREE.NormalBlending, depthWrite: false
    }));
    this.sunGlow.position.copy(this.sunSprite.position);
    this.sunGlow.scale.set(1000, 1000, 1);
    this.sunGlow.renderOrder = 3;
    this.root.add(this.sunGlow);
  };

  Weather3D.prototype._initRain = function (P, heavy) {
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
    var count = heavy ? (this.boost ? 2400 : 1500) : (this.boost ? 1500 : 950);
    if (mobile) count = Math.floor(count * 0.5);
    var w = 600, h = 480;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var seeds = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * w;
      positions[i * 3 + 1] = (Math.random() - 0.5) * h;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 260 - 30;
      sizes[i] = 0.6 + Math.random() * 1.4;
      seeds[i] = Math.random() * 100;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uHeight: { value: h },
        uColor: { value: new THREE.Color(P.fogCol) }
      },
      vertexShader: SHADERS.rainStreak.vertex,
      fragmentShader: SHADERS.rainStreak.fragment,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending
    });
    this.rain = new THREE.Points(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 10;
    this.rain.rotation.z = 0.14; // wind angle
    this.root.add(this.rain);
  };

  Weather3D.prototype._initSnow = function (P, type) {
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
    var base = this.boost ? 1100 : 750;
    var mult = { lightsnow: 0.45, midsnow: 0.8, snow: 1.0, heavysnow: 1.6 }[type] || 1.0;
    var count = Math.floor(base * mult);
    if (mobile) count = Math.floor(count * 0.5);
    var w = 600, h = 480;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var seeds = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * w;
      positions[i * 3 + 1] = (Math.random() - 0.5) * h;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 260 - 30;
      sizes[i] = 0.5 + Math.random() * 1.6;
      seeds[i] = Math.random() * 100;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uHeight: { value: h },
        uColor: { value: new THREE.Color(P.fogCol) }
      },
      vertexShader: SHADERS.snowFlake.vertex,
      fragmentShader: SHADERS.snowFlake.fragment,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending
    });
    this.snow = new THREE.Points(geo, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 10;
    this.root.add(this.snow);
  };

  Weather3D.prototype._initLightning = function (P) {
    this.light = new THREE.PointLight(0xdfe8ff, 0, 900);
    this.light.position.set((Math.random() - 0.5) * 300, 250, 80);
    this.root.add(this.light);
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xdfe8ff, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.BackSide
    });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.flashMat);
    this.flash.renderOrder = 15;
    this.root.add(this.flash);
    this.nextFlash = 3 + Math.random() * 4;
    this.flashTimer = 0;
  };

  // Lightning bolt: thick TubeGeometry mesh with branches for dramatic effect.
  // LineBasicMaterial linewidth is clamped to 1px in WebGL, so we use
  // TubeGeometry + CatmullRomCurve3 to create real 3D bolt geometry.
  Weather3D.prototype._initLightningBolt = function (P) {
    // Core bolt: bright white, thin tube
    this._boltMaterial = new THREE.MeshBasicMaterial({
      color: 0xf0f5ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    // Glow bolt: wider, blue-tinted, lower opacity
    this._boltGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x88bbff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._boltMeshes = [];     // array of {core, glow} mesh pairs
    this._boltTimer = 0;
    this._thunderAudioCtx = null;
  };

  // Generate a jagged bolt path from sky to ground
  Weather3D.prototype._generateBoltPath = function () {
    var points = [];
    var x = (Math.random() - 0.5) * 380;
    var y = 340;
    var z = 30 + (Math.random() - 0.5) * 50;
    points.push(new THREE.Vector3(x, y, z));
    var segments = 10 + Math.floor(Math.random() * 5);
    for (var i = 0; i < segments; i++) {
      y -= 28 + Math.random() * 18;
      x += (Math.random() - 0.5) * 45;
      z += (Math.random() - 0.5) * 12;
      points.push(new THREE.Vector3(x, y, z));
    }
    return points;
  };

  // Generate a branch path splitting off from a point on the main bolt
  Weather3D.prototype._generateBranchPath = function (origin) {
    var points = [origin.clone()];
    var x = origin.x, y = origin.y, z = origin.z;
    var segs = 3 + Math.floor(Math.random() * 3);
    var dir = (Math.random() - 0.5) * 1.6;
    for (var i = 0; i < segs; i++) {
      y -= 18 + Math.random() * 15;
      x += dir * (22 + Math.random() * 18) + (Math.random() - 0.5) * 10;
      z += (Math.random() - 0.5) * 8;
      points.push(new THREE.Vector3(x, y, z));
    }
    return points;
  };

  // Create a tube mesh from an array of points
  Weather3D.prototype._createBoltMesh = function (points, radius, material) {
    var curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    var tubularSegments = Math.max(8, points.length * 3);
    var geo = new THREE.TubeGeometry(curve, tubularSegments, radius, 5, false);
    var mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return mesh;
  };

  // Trigger a full lightning strike: main bolt + branches
  Weather3D.prototype._triggerLightning = function () {
    // Clean up previous bolts
    for (var i = 0; i < this._boltMeshes.length; i++) {
      var pair = this._boltMeshes[i];
      if (pair.core) { this.root.remove(pair.core); pair.core.geometry.dispose(); }
      if (pair.glow) { this.root.remove(pair.glow); pair.glow.geometry.dispose(); }
    }
    this._boltMeshes = [];

    // Main bolt
    var mainPath = this._generateBoltPath();
    var mainCore = this._createBoltMesh(mainPath, 2.0, this._boltMaterial);
    mainCore.renderOrder = 21;
    this.root.add(mainCore);
    var mainGlow = this._createBoltMesh(mainPath, 5.5, this._boltGlowMaterial);
    mainGlow.renderOrder = 20;
    this.root.add(mainGlow);
    this._boltMeshes.push({ core: mainCore, glow: mainGlow });

    // Branches (2-4 off the main bolt)
    var branchCount = 2 + Math.floor(Math.random() * 3);
    for (var b = 0; b < branchCount; b++) {
      var idx = 1 + Math.floor(Math.random() * (mainPath.length - 3));
      var branchPath = this._generateBranchPath(mainPath[idx]);
      var bCore = this._createBoltMesh(branchPath, 1.2, this._boltMaterial);
      bCore.renderOrder = 21;
      this.root.add(bCore);
      var bGlow = this._createBoltMesh(branchPath, 3.5, this._boltGlowMaterial);
      bGlow.renderOrder = 20;
      this.root.add(bGlow);
      this._boltMeshes.push({ core: bCore, glow: bGlow });
    }
  };

  Weather3D.prototype._triggerThunderSound = function () {
    // Web Audio API: synthesized thunder with sharp crack + deep rumble
    try {
      if (!this._thunderAudioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this._thunderAudioCtx = new AC();
      }
      var ctx = this._thunderAudioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      var now = ctx.currentTime;

      // --- Part 1: Sharp crack (initial lightning strike) ---
      var crackDur = 0.15;
      var crackSize = Math.floor(ctx.sampleRate * crackDur);
      var crackBuf = ctx.createBuffer(1, crackSize, ctx.sampleRate);
      var crackData = crackBuf.getChannelData(0);
      for (var i = 0; i < crackSize; i++) {
        var crackDecay = Math.exp(-i / (ctx.sampleRate * 0.04));
        crackData[i] = (Math.random() * 2 - 1) * crackDecay * 0.6;
      }
      var crackSrc = ctx.createBufferSource();
      crackSrc.buffer = crackBuf;
      var crackFilter = ctx.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.value = 800;
      var crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(0, now);
      crackGain.gain.linearRampToValueAtTime(0.4, now + 0.005);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + crackDur);
      crackSrc.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(ctx.destination);
      crackSrc.start(now);

      // --- Part 2: Deep rumble (rolling thunder) ---
      var rumbleDur = 1.8 + Math.random() * 1.2;
      var rumbleSize = Math.floor(ctx.sampleRate * rumbleDur);
      var rumbleBuf = ctx.createBuffer(1, rumbleSize, ctx.sampleRate);
      var rumbleData = rumbleBuf.getChannelData(0);
      for (var j = 0; j < rumbleSize; j++) {
        var decay = Math.exp(-j / (ctx.sampleRate * 0.8));
        var rumble = Math.sin(2 * Math.PI * (50 + Math.random() * 30) * j / ctx.sampleRate);
        var noise = (Math.random() * 2 - 1);
        rumbleData[j] = (noise * 0.4 + rumble * 0.5) * decay;
      }
      var rumbleSrc = ctx.createBufferSource();
      rumbleSrc.buffer = rumbleBuf;
      var rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 180 + Math.random() * 80;
      var rumbleGain = ctx.createGain();
      rumbleGain.gain.setValueAtTime(0, now + 0.05);
      rumbleGain.gain.linearRampToValueAtTime(0.45, now + 0.15);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDur);
      rumbleSrc.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(ctx.destination);
      rumbleSrc.start(now + 0.05);
    } catch (e) {
      // silently fail if audio not available
    }
  };

  Weather3D.prototype.update = function (t, dt) {
    if (this.domeMat) this.domeMat.uniforms.uTime.value = t;
    if (this.rainMat) this.rainMat.uniforms.uTime.value = t;
    if (this.snowMat) this.snowMat.uniforms.uTime.value = t;
    if (this.sunSprite) {
      var p = 0.5 + 0.5 * Math.sin(t * 0.4);
      this.sunSprite.material.opacity = 0.68 + p * 0.14;
      this.sunHalo.material.opacity = 0.22 + p * 0.08;
      if (this.sunGlow) this.sunGlow.material.opacity = 0.09 + p * 0.05;
    }
    if (this.light && this.flashMat) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        // Thunder flash lasts longer, more dramatic
        this.flashTimer = 0.30 + Math.random() * 0.15;
        this.nextFlash = 2.5 + Math.random() * 5;
        this.light.position.set((Math.random() - 0.5) * 400, 200 + Math.random() * 120, 80);
        // Thunder: generate lightning bolt + play sound
        if (this._boltMeshes) {
          this._triggerLightning();
          this._boltTimer = 0.18 + Math.random() * 0.12;
          // Play thunder sound (delayed to simulate sound travel)
          var self = this;
          var delay = 200 + Math.random() * 800;
          setTimeout(function() { self._triggerThunderSound(); }, delay);
        }
      }
      if (this.flashTimer > 0) {
        this.flashTimer -= dt;
        var intensity = Math.max(0, this.flashTimer / 0.4);
        // Double-flash pattern: rapid flicker for realistic lightning
        var flicker = 0.6 + 0.4 * Math.sin(intensity * 45.0);
        this.light.intensity = intensity * 8.0 * flicker;
        // Dramatic sky flash — brighter for thunder weather
        var flashMult = (this.type === 'thunder') ? 0.45 : 0.25;
        this.flashMat.opacity = intensity * flashMult * flicker;
        // Lightning bolt visibility — bright fade-out
        if (this._boltMeshes && this._boltMeshes.length > 0 && this._boltTimer > 0) {
          this._boltTimer -= dt;
          var boltAlpha = Math.max(0, this._boltTimer / 0.25);
          // Flicker the bolt too
          var boltFlicker = 0.8 + 0.2 * Math.sin(boltAlpha * 60.0);
          this._boltMaterial.opacity = boltAlpha * 0.95 * boltFlicker;
          this._boltGlowMaterial.opacity = boltAlpha * 0.5 * boltFlicker;
        } else if (this._boltMaterial) {
          this._boltMaterial.opacity = 0;
          this._boltGlowMaterial.opacity = 0;
        }
      } else {
        this.light.intensity = 0;
        this.flashMat.opacity = 0;
        if (this._boltMaterial) this._boltMaterial.opacity = 0;
        if (this._boltGlowMaterial) this._boltGlowMaterial.opacity = 0;
      }
    }
  };

  Weather3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this._sunTex) this._sunTex.dispose();
    // Clean up lightning bolt resources (TubeGeometry meshes)
    if (this._boltMeshes) {
      for (var i = 0; i < this._boltMeshes.length; i++) {
        var pair = this._boltMeshes[i];
        if (pair.core) { pair.core.geometry.dispose(); }
        if (pair.glow) { pair.glow.geometry.dispose(); }
      }
      this._boltMeshes = null;
    }
    if (this._boltMaterial) { this._boltMaterial.dispose(); this._boltMaterial = null; }
    if (this._boltGlowMaterial) { this._boltGlowMaterial.dispose(); this._boltGlowMaterial = null; }
    // Close audio context
    if (this._thunderAudioCtx) {
      try { this._thunderAudioCtx.close(); } catch (e) {}
      this._thunderAudioCtx = null;
    }
    this.root = null;
  };

  // ============================================================
  // I. DeepSea3D — immersive deep-sea scene (jellyfish + fish +
  // volumetric light shafts, caustics, marine snow). Default effect.
  // ============================================================
  var DEEPSEA_JELLY_PALETTE = [
    0xa8d4e8, 0xc0b8e8, 0xa8e0d8, 0xe0b0d8, 0xb0d0f0,
    0xc8e0f0, 0xb0e8d8, 0xe8c0d0, 0xb8c0e8, 0xd8e8d0
  ];
  var DEEPSEA_FISH_SPECIES = [
    { body: 0x4a6a7a, irid: 0x6a9aaa, sz: 1.0 },
    { body: 0x5a5a7a, irid: 0x8a8aaa, sz: 0.85 },
    { body: 0x8a8a9a, irid: 0xaabacc, sz: 1.1 },
    { body: 0x6a4a7a, irid: 0x9a7aaa, sz: 0.9 }
  ];

  function DeepSea3D(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.boost = !!opts.boost;
    this.skyless = !!opts.skyless;
    this.root = makeRoot();
    this.scene.add(this.root);

    this._initBackground();
    this._initLightShafts();
    this._initMarineSnow();

    // jellyfish + fish (reused engines, deep-sea tuned palettes)
    this.jellies = new Jellyfish3D({ scene: this.scene, camera: this.camera, boost: this.boost, palette: DEEPSEA_JELLY_PALETTE });
    this.fish = new FishSchool3D({ scene: this.scene, camera: this.camera, boost: this.boost, species: DEEPSEA_FISH_SPECIES });
  }

  DeepSea3D.prototype._initBackground = function () {
    if (!this.skyless) {
      var domeGeo = new THREE.SphereGeometry(900, 48, 32);
      this.bgMat = new THREE.ShaderMaterial({
        uniforms: {
          uDeep: { value: new THREE.Color(0x04101a) },
          uMid: { value: new THREE.Color(0x0a2a3a) },
          uSurface: { value: new THREE.Color(0x1a5a6a) },
          uTime: { value: 0 },
          uOpacity: { value: 0.92 }
        },
        vertexShader: SHADERS.deepSeaBg.vertex,
        fragmentShader: SHADERS.deepSeaBg.fragment,
        side: THREE.BackSide, depthWrite: false, transparent: true
      });
      this.bgDome = new THREE.Mesh(domeGeo, this.bgMat);
      this.root.add(this.bgDome);
    } else {
      // skyless 叠加模式：去掉深海背景穹顶，透明叠加在页面背景上
      this.bgMat = null;
      this.bgDome = null;
    }

    // skyless 模式降低光照强度，避免在水母/鱼身上过曝背景
    var ambI = this.skyless ? 0.25 : 0.5;
    var hemiI = this.skyless ? 0.25 : 0.5;
    this.ambLight = new THREE.AmbientLight(0x2a4a5a, ambI);
    this.root.add(this.ambLight);
    this.hemiLight = new THREE.HemisphereLight(0x2a6a7a, 0x02101a, hemiI);
    this.root.add(this.hemiLight);
  };

  DeepSea3D.prototype._initLightShafts = function () {
    // vertical gradient texture (bright top -> transparent bottom)
    var c = document.createElement('canvas');
    c.width = 16; c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(180,220,235,0.9)');
    g.addColorStop(0.5, 'rgba(120,180,210,0.35)');
    g.addColorStop(1, 'rgba(80,140,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 128);
    this.shaftTex = new THREE.CanvasTexture(c);
    this.shaftTex.needsUpdate = true;

    this.shafts = new THREE.Group();
    var rn = this.boost ? 12 : 8;
    for (var r = 0; r < rn; r++) {
      var w = 50 + Math.random() * 60;
      var rg = new THREE.PlaneGeometry(w, 760);
      var rm = new THREE.MeshBasicMaterial({
        map: this.shaftTex, color: 0x6ab0c8, transparent: true,
        opacity: 0.08 + Math.random() * 0.05, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
      var ray = new THREE.Mesh(rg, rm);
      ray.position.set((Math.random() - 0.5) * 560, 220, (Math.random() - 0.5) * 320 - 40);
      ray.rotation.y = Math.random() * Math.PI;
      ray.rotation.z = (Math.random() - 0.5) * 0.25;
      ray.userData.baseOp = rm.opacity;
      this.shafts.add(ray);
    }
    this.root.add(this.shafts);
  };

  DeepSea3D.prototype._initMarineSnow = function () {
    var count = this.boost ? 1200 : 800;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var seeds = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 700;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 480;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 360 - 40;
      sizes[i] = 0.4 + Math.random() * 1.3;
      seeds[i] = Math.random() * 100;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aSeed;',
        'uniform float uTime;',
        'varying float vDepth;',
        'void main(){',
        '  vec3 pos = position;',
        '  pos.y += sin(uTime*0.2 + aSeed)*6.0 - uTime*4.0;',
        '  pos.y = mod(pos.y + 240.0, 480.0) - 240.0;',
        '  pos.x += sin(uTime*0.3 + aSeed*1.3)*4.0;',
        '  pos.z += cos(uTime*0.25 + aSeed)*3.0;',
        '  vec4 mv = modelViewMatrix*vec4(pos,1.0);',
        '  vDepth = -mv.z;',
        '  gl_PointSize = clamp(aSize*(260.0/vDepth), 1.0, 9.0);',
        '  gl_Position = projectionMatrix*mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying float vDepth;',
        'void main(){',
        '  float d = length(gl_PointCoord-0.5);',
        '  float core = smoothstep(0.5, 0.0, d);',
        '  float fog = 1.0 - smoothstep(120.0, 520.0, vDepth);',
        '  float a = core * fog * 0.5;',
        '  vec3 col = mix(vec3(0.7,0.82,0.9), vec3(0.85,0.8,0.95), 0.5);',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.marineSnow = new THREE.Points(geo, this.snowMat);
    this.root.add(this.marineSnow);
  };

  DeepSea3D.prototype.update = function (t, dt, mouse) {
    if (this.bgMat) this.bgMat.uniforms.uTime.value = t;
    if (this.snowMat) this.snowMat.uniforms.uTime.value = t;
    for (var k = 0; k < this.shafts.children.length; k++) {
      var base = parseFloat(this.shafts.children[k].userData.baseOp || 0.08);
      this.shafts.children[k].material.opacity = base + 0.025 * Math.sin(t * 0.6 + k * 1.3);
    }
    this.jellies.update(t, dt, mouse);
    this.fish.update(t, dt, mouse);
  };

  DeepSea3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this.shaftTex) this.shaftTex.dispose();
    if (this.jellies) this.jellies.dispose();
    if (this.fish) this.fish.dispose();
    this.root = null;
  };

  // ============================================================
  // J. Fireworks3D — brilliant translucent fireworks blooming in the sky.
  // Semi-transparent, additive glow, gravity-affected sparks.
  // ============================================================
  var FW_COLORS = [
    [1.0, 0.4, 0.4],   // red
    [1.0, 0.7, 0.3],   // orange
    [1.0, 0.9, 0.4],   // gold
    [0.4, 1.0, 0.5],   // green
    [0.4, 0.7, 1.0],   // blue
    [0.7, 0.4, 1.0],   // purple
    [1.0, 0.5, 0.8],   // pink
    [0.7, 0.9, 1.0]    // cyan
  ];

  function Fireworks3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    this._rockets = [];     // active rockets
    this._bursts = [];      // active burst particle systems
    this._nextLaunch = 0.3;
    this._tex = createGlowTexture('#ffffff');
  }

  Fireworks3D.prototype.update = function (t, dt) {
    // Launch new rockets
    this._nextLaunch -= dt;
    if (this._nextLaunch <= 0) {
      this._nextLaunch = 0.5 + Math.random() * 1.5;
      this._launchRocket();
    }

    // Update rockets
    for (var i = this._rockets.length - 1; i >= 0; i--) {
      var r = this._rockets[i];
      r.life -= dt;
      r.vy -= 120 * dt; // gravity
      r.mesh.position.x += r.vx * dt;
      r.mesh.position.y += r.vy * dt;
      r.mesh.material.opacity = Math.max(0, r.life / r.maxLife) * 0.85;
      // Trail
      r.trail.material.opacity = Math.max(0, r.life / r.maxLife) * 0.5;
      r.trail.scale.set(1 + (1 - r.life / r.maxLife) * 2, 1 + (1 - r.life / r.maxLife) * 2, 1);
      if (r.life <= 0) {
        this._explode(r.mesh.position.x, r.mesh.position.y, r.mesh.position.z, r.color);
        this.root.remove(r.mesh);
        this.root.remove(r.trail);
        r.mesh.material.dispose();
        r.trail.material.dispose();
        this._rockets.splice(i, 1);
      }
    }

    // Update bursts
    for (var j = this._bursts.length - 1; j >= 0; j--) {
      var b = this._bursts[j];
      b.life -= dt;
      if (b.life <= 0) {
        this.root.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        if (b.flash) {
          this.root.remove(b.flash);
          b.flash.material.dispose();
        }
        this._bursts.splice(j, 1);
        continue;
      }
      // Update particle positions on CPU
      var pos = b.points.geometry.attributes.position.array;
      var vel = b.velocities;
      for (var k = 0; k < b.count; k++) {
        pos[k * 3]     += vel[k * 3]     * dt;
        pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        vel[k * 3 + 1] -= 60 * dt; // gravity
        // air resistance
        vel[k * 3]     *= 0.985;
        vel[k * 3 + 1] *= 0.985;
        vel[k * 3 + 2] *= 0.985;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      var alpha = Math.max(0, b.life / b.maxLife);
      b.points.material.opacity = alpha * 0.85;
      b.points.material.size = b.baseSize * (0.4 + alpha * 0.6);
      // Update flash (expanding, fading ring)
      if (b.flash) {
        var flashAlpha = Math.max(0, b.life / b.maxLife);
        var flashScale = 10 + (1 - flashAlpha) * 80;
        b.flash.scale.set(flashScale, flashScale, 1);
        b.flash.material.opacity = flashAlpha * flashAlpha * 0.4;
      }
    }
  };

  Fireworks3D.prototype._launchRocket = function () {
    var x = (Math.random() - 0.5) * 140;
    var z = (Math.random() - 0.5) * 40 - 25;
    var colorIdx = Math.floor(Math.random() * FW_COLORS.length);
    var col = FW_COLORS[colorIdx];
    var colorHex = (Math.floor(col[0] * 255) << 16) | (Math.floor(col[1] * 255) << 8) | Math.floor(col[2] * 255);

    // Rocket head
    var mat = new THREE.SpriteMaterial({
      map: this._tex, color: colorHex, transparent: true,
      opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var mesh = new THREE.Sprite(mat);
    mesh.position.set(x, -90, z);
    mesh.scale.set(8, 8, 1);
    mesh.renderOrder = 10;
    this.root.add(mesh);

    // Trail
    var trailMat = new THREE.SpriteMaterial({
      map: this._tex, color: colorHex, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var trail = new THREE.Sprite(trailMat);
    trail.position.copy(mesh.position);
    trail.scale.set(16, 16, 1);
    trail.renderOrder = 9;
    this.root.add(trail);

    this._rockets.push({
      mesh: mesh, trail: trail,
      vx: (Math.random() - 0.5) * 15,
      vy: 160 + Math.random() * 60,
      life: 0.9 + Math.random() * 0.4,
      maxLife: 1.3,
      color: col
    });
  };

  Fireworks3D.prototype._explode = function (x, y, z, color) {
    var count = this.boost ? 150 : 100;
    var positions = new Float32Array(count * 3);
    var velocities = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var colorHex = (Math.floor(color[0] * 255) << 16) | (Math.floor(color[1] * 255) << 8) | Math.floor(color[2] * 255);

    for (var i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      // Spherical distribution
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.acos(2 * Math.random() - 1);
      var speed = 60 + Math.random() * 80;
      velocities[i * 3]     = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      velocities[i * 3 + 2] = Math.cos(phi) * speed * 0.3;
      sizes[i] = 4 + Math.random() * 5;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    var mat = new THREE.PointsMaterial({
      map: this._tex, color: colorHex, transparent: true,
      opacity: 0.85, blending: THREE.AdditiveBlending,
      depthWrite: false, size: 14, sizeAttenuation: true
    });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    this.root.add(points);

    // Flash sprite: bright expanding ring at burst center
    var flashMat = new THREE.SpriteMaterial({
      map: this._tex, color: colorHex, transparent: true,
      opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var flash = new THREE.Sprite(flashMat);
    flash.position.set(x, y, z);
    flash.scale.set(10, 10, 1);
    flash.renderOrder = 11;
    this.root.add(flash);

    var maxLife = 1.8 + Math.random() * 0.8;
    this._bursts.push({
      points: points, velocities: velocities, count: count,
      life: maxLife, maxLife: maxLife, baseSize: 14,
      flash: flash
    });
  };

  Fireworks3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    // Clean up rockets
    for (var i = 0; i < this._rockets.length; i++) {
      this._rockets[i].mesh.material.dispose();
      this._rockets[i].trail.material.dispose();
    }
    // Clean up bursts
    for (var j = 0; j < this._bursts.length; j++) {
      this._bursts[j].points.geometry.dispose();
      this._bursts[j].points.material.dispose();
      if (this._bursts[j].flash) this._bursts[j].flash.material.dispose();
    }
    if (this._tex) this._tex.dispose();
    this._rockets = null;
    this._bursts = null;
    this.root = null;
  };

  // ============================================================
  // K. Dandelion3D — light fluffy seeds drifting on breeze.
  // Soft semi-transparent sprites, sinusoidal drift, slow rotation.
  // ============================================================
  function Dandelion3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    this._tex = this._createDandelionTexture();
    var count = this.boost ? 40 : 25;
    var w = 260, h = 320;
    this._seeds = [];

    // Shared geometry (plane) for all seeds
    this._seedGeo = new THREE.PlaneGeometry(1, 1);

    for (var i = 0; i < count; i++) {
      var mat = new THREE.MeshBasicMaterial({
        map: this._tex, transparent: true,
        opacity: 0.45 + Math.random() * 0.3,
        depthWrite: false, blending: THREE.NormalBlending,
        side: THREE.DoubleSide
      });
      var mesh = new THREE.Mesh(this._seedGeo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * w,
        (Math.random() - 0.5) * h,
        (Math.random() - 0.5) * 50 - 20
      );
      var sz = 14 + Math.random() * 12;
      mesh.scale.set(sz, sz, 1);
      mesh.renderOrder = 8;
      this.root.add(mesh);

      this._seeds.push({
        mesh: mesh,
        baseX: mesh.position.x,
        baseY: mesh.position.y,
        baseZ: mesh.position.z,
        speedY: -8 - Math.random() * 12,
        driftX: 6 + Math.random() * 10,
        driftZ: 3 + Math.random() * 6,
        phase: Math.random() * Math.PI * 2,
        phase2: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.4,
        sway: 0.3 + Math.random() * 0.4
      });
    }
  }

  Dandelion3D.prototype._createDandelionTexture = function () {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    var cx = 64, cy = 64;

    // Central seed — warm golden-brown core
    var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
    grad.addColorStop(0, 'rgba(210,190,150,0.85)');
    grad.addColorStop(0.5, 'rgba(190,170,130,0.5)');
    grad.addColorStop(1, 'rgba(180,160,120,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    // Fluffy filaments radiating outward — soft white strands
    ctx.lineCap = 'round';
    var filaments = 20;
    for (var i = 0; i < filaments; i++) {
      var angle = (i / filaments) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      var len = 42 + Math.random() * 14;
      var endX = cx + Math.cos(angle) * len;
      var endY = cy + Math.sin(angle) * len;
      // Strand with gradient opacity
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      var midX = cx + Math.cos(angle) * len * 0.5 + (Math.random() - 0.5) * 5;
      var midY = cy + Math.sin(angle) * len * 0.5 + (Math.random() - 0.5) * 5;
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
      // Soft tuft at the tip — fluffy seed head
      var tuftGrad = ctx.createRadialGradient(endX, endY, 0, endX, endY, 6);
      tuftGrad.addColorStop(0, 'rgba(255,255,255,0.5)');
      tuftGrad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
      tuftGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = tuftGrad;
      ctx.beginPath();
      ctx.arc(endX, endY, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  };

  Dandelion3D.prototype.update = function (t, dt) {
    for (var i = 0; i < this._seeds.length; i++) {
      var s = this._seeds[i];
      // Drift downward with sinusoidal horizontal sway
      s.baseY += s.speedY * dt;
      // Wrap around when too low
      if (s.baseY < -180) {
        s.baseY = 180 + Math.random() * 40;
        s.baseX = (Math.random() - 0.5) * 260;
      }
      var swayX = Math.sin(t * 0.5 + s.phase) * s.driftX * s.sway;
      var swayZ = Math.cos(t * 0.3 + s.phase2) * s.driftZ * s.sway;
      s.mesh.position.x = s.baseX + swayX;
      s.mesh.position.y = s.baseY;
      s.mesh.position.z = s.baseZ + swayZ;
      // Face the camera approximately, with slow rotation
      s.mesh.rotation.z = Math.sin(t * 0.3 + s.phase) * 0.3;
      s.mesh.rotation.x = Math.cos(t * 0.2 + s.phase2) * 0.2;
    }
  };

  Dandelion3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    // Dispose each seed material (they're unique)
    for (var i = 0; i < this._seeds.length; i++) {
      this._seeds[i].mesh.material.dispose();
    }
    this._seedGeo.dispose();
    if (this._tex) this._tex.dispose();
    this._seeds = null;
    this.root = null;
  };

  // ============================================================
  // L. GlassRaindrop3D — rain on glass (3 layers).
  //   1) attached static water droplets (fixed beads, soft glow)
  //   2) vertical sliding water traces (elongated streaks running down)
  //   3) glass mist veil (slow-evolving noise haze over the pane)
  // Ring/hollow particles removed; layers are soft additive overlays.
  // Star-field stays on the engine scene below; foreground UI untouched.
  // ============================================================
  var GLASS_DROP_VERT = [
    'attribute float aSize;',
    'attribute float aOffset;',
    'attribute float aSpeed;',
    'uniform float uTime;',
    'varying float vAlpha;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 pos = position;',
    '  // Sliding down with occasional pause',
    '  float slide = mod(uTime * aSpeed + aOffset, 1.0);',
    '  // Ease: slow at top, fast in middle, slow at bottom',
    '  float eased = smoothstep(0.0, 0.15, slide) * smoothstep(1.0, 0.85, slide);',
    '  pos.y = mix(130.0, -130.0, slide);',
    '  pos.x += sin(uTime * 0.5 + aOffset * 10.0) * 3.0;',
    '  vAlpha = eased;',
    '  vUv = vec2(aOffset, slide);',
    '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
    '  gl_PointSize = aSize * (300.0 / -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var GLASS_DROP_FRAG = [
    'varying float vAlpha;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d = length(uv);',
    '  // 软实心水痕：顶部亮、向下柔和渐隐（不带空心光圈），模拟滑落水痕',
    '  float head = smoothstep(0.5, 0.05, d);',
    '  float trail = smoothstep(0.5, 0.0, uv.y + 0.5);',
    '  float a = head * (0.6 + 0.4 * trail) * vAlpha;',
    '  // 湿玻璃水蓝色调',
    '  vec3 col = mix(vec3(0.6, 0.72, 0.95), vec3(0.9, 0.98, 1.0), trail);',
    '  // 顶部环境高光',
    '  float hl = smoothstep(0.18, 0.0, length(uv - vec2(-0.1, 0.12)));',
    '  col += vec3(0.5, 0.55, 0.62) * hl * vAlpha * 0.35;',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  var GLASS_STATIC_VERT = [
    'attribute float aSize;',
    'attribute vec2 aOffset;',
    'uniform float uTime;',
    'varying float vAlpha;',
    'void main() {',
    '  vec3 pos = position;',
    '  vAlpha = 0.3 + 0.15 * sin(uTime * 0.8 + aOffset.x * 20.0);',
    '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
    '  gl_PointSize = aSize * (300.0 / -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var GLASS_STATIC_FRAG = [
    'varying float vAlpha;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d = length(uv);',
    '  // 软实心附着水珠：柔和 glow + 顶部高光（去除空心光圈）',
    '  float body = smoothstep(0.5, 0.0, d);',
    '  float a = body * vAlpha * 0.6;',
    '  vec3 col = mix(vec3(0.62, 0.76, 0.96), vec3(0.92, 0.98, 1.0), d * 0.8);',
    '  float hl = smoothstep(0.16, 0.0, length(uv - vec2(-0.1, -0.1)));',
    '  col += vec3(0.5, 0.56, 0.64) * hl * 0.5;',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  // ── Layer 3: glass mist veil (slow-evolving haze over the pane) ──
  var GLASS_MIST_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var GLASS_MIST_FRAG = [
    'uniform float uTime;',
    'uniform vec3 uColor;',
    'uniform float uOpacity;',
    'varying vec2 vUv;',
    'float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i=floor(p), f=fract(p);',
    '  float a=hash21(i), b=hash21(i+vec2(1.0,0.0)), c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));',
    '  vec2 u=f*f*(3.0-2.0*f);',
    '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v=0.0, a=0.55;',
    '  for(int i=0;i<4;i++){ v+=noise(p)*a; p*=2.0; a*=0.5; }',
    '  return v;',
    '}',
    'void main() {',
    '  vec2 p = (vUv - 0.5) * 3.4;',
    '  float n = fbm(p + vec2(uTime*0.017, uTime*0.011));',
    '  float v = smoothstep(0.42, 0.92, n);',
    '  // 边缘略浓（模拟水珠下滑聚集）、中心柔和',
    '  float vignette = 0.6 + 0.4 * (1.0 - length(vUv - 0.5));',
    '  float a = v * uOpacity * vignette;',
    '  gl_FragColor = vec4(uColor, a);',
    '}'
  ].join('\n');

  function GlassRaindrop3D(opts) {
    this.scene = opts.scene;
    this.boost = !!opts.boost;
    this.root = makeRoot();
    this.scene.add(this.root);

    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;

    // --- Layer 2: vertical sliding water traces (fewer, sparser) ---
    var slideCount = this.boost ? 22 : 14;
    if (mobile) slideCount = Math.floor(slideCount * 0.6);
    var w = 260, h = 320;
    var sPos = new Float32Array(slideCount * 3);
    var sSize = new Float32Array(slideCount);
    var sOffset = new Float32Array(slideCount);
    var sSpeed = new Float32Array(slideCount);
    for (var i = 0; i < slideCount; i++) {
      sPos[i * 3]     = (Math.random() - 0.5) * w;
      sPos[i * 3 + 1] = 0;
      sPos[i * 3 + 2] = (Math.random() - 0.5) * 80 - 10;
      sSize[i] = 18 + Math.random() * 16;  // 长条水痕
      sOffset[i] = Math.random();
      sSpeed[i] = 0.05 + Math.random() * 0.11; // 各自漂流速度
    }
    var sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
    sGeo.setAttribute('aOffset', new THREE.BufferAttribute(sOffset, 1));
    sGeo.setAttribute('aSpeed', new THREE.BufferAttribute(sSpeed, 1));

    this.slideMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: GLASS_DROP_VERT,
      fragmentShader: GLASS_DROP_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending
    });
    this.slideDrops = new THREE.Points(sGeo, this.slideMat);
    this.slideDrops.frustumCulled = false;
    this.slideDrops.renderOrder = 8;
    this.root.add(this.slideDrops);

    // --- Static micro-droplets (smaller, more numerous) ---
    var staticCount = this.boost ? 180 : 120;
    if (mobile) staticCount = Math.floor(staticCount * 0.5);
    var stPos = new Float32Array(staticCount * 3);
    var stSize = new Float32Array(staticCount);
    var stOffset = new Float32Array(staticCount * 2);
    for (var j = 0; j < staticCount; j++) {
      stPos[j * 3]     = (Math.random() - 0.5) * w;
      stPos[j * 3 + 1] = (Math.random() - 0.5) * h;
      stPos[j * 3 + 2] = (Math.random() - 0.5) * 80 - 10;
      stSize[j] = 3 + Math.random() * 6;
      stOffset[j * 2]     = Math.random();
      stOffset[j * 2 + 1] = Math.random();
    }
    var stGeo = new THREE.BufferGeometry();
    stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
    stGeo.setAttribute('aSize', new THREE.BufferAttribute(stSize, 1));
    stGeo.setAttribute('aOffset', new THREE.BufferAttribute(stOffset, 2));

    this.staticMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: GLASS_STATIC_VERT,
      fragmentShader: GLASS_STATIC_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending
    });
    this.staticDrops = new THREE.Points(stGeo, this.staticMat);
    this.staticDrops.frustumCulled = false;
    this.staticDrops.renderOrder = 7;
    this.root.add(this.staticDrops);

    // --- Layer 3: glass mist veil (slow-evolving haze over the pane) ---
    var mistAspect = (window.innerWidth / window.innerHeight) || 1.78;
    var mistDist = 160;
    var mistHalfH = Math.tan(Math.PI / 6) * mistDist;
    var mistHalfW = mistHalfH * mistAspect;
    var mGeo = new THREE.PlaneGeometry(mistHalfW * 2, mistHalfH * 2);
    this.mistMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x96b3d6) },
        uOpacity: { value: 0.16 }
      },
      vertexShader: GLASS_MIST_VERT,
      fragmentShader: GLASS_MIST_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      side: THREE.DoubleSide
    });
    this.mistQuad = new THREE.Mesh(mGeo, this.mistMat);
    this.mistQuad.position.z = -150;
    this.mistQuad.renderOrder = 5;
    this.root.add(this.mistQuad);
  }

  GlassRaindrop3D.prototype.update = function (t, dt) {
    if (this.slideMat) this.slideMat.uniforms.uTime.value = t;
    if (this.staticMat) this.staticMat.uniforms.uTime.value = t;
    if (this.mistMat) this.mistMat.uniforms.uTime.value = t;
  };

  GlassRaindrop3D.prototype.dispose = function () {
    this.scene.remove(this.root);
    disposeObject(this.root);
    if (this.slideDrops) { this.slideDrops.geometry.dispose(); this.slideMat.dispose(); }
    if (this.staticDrops) { this.staticDrops.geometry.dispose(); this.staticMat.dispose(); }
    if (this.mistQuad) {
      this.mistQuad.geometry.dispose();
      this.mistMat.dispose();
    }
    this.root = null;
  };

  // ============================================================
  // Effect registry
  // ============================================================
  var EFFECTS = {
    fireworks: Fireworks3D,
    dandelion: Dandelion3D,
    raindrop: GlassRaindrop3D,
    aurora: Aurora3D,
    jellyfish: Jellyfish3D,
    fish: FishSchool3D,
    sky: Sky3D,
    sparkle: Sparkle3D,
    nebula: Nebula3D,
    crystals: CrystalShards3D,
    bioluminescence: Bioluminescence3D,
    deepsea: DeepSea3D
  };

  // ============================================================
  // Engine
  // ============================================================
  var engine = {
    _ready: false,
    _canvas: null,
    _renderer: null,
    _scene: null,
    _camera: null,
    _starfield: null,
    _effect: null,
    _effectType: null,
    _weather: null,
    _raf: null,
    _lastTime: 0,
    _running: false,
    _particleBoost: false,
    _mouse: { x: 0, y: 0, world: new THREE.Vector3() },
    _tmpVec: new THREE.Vector3(),
    _starDim: 1.0,
    _targetStarDim: 1.0,
    _skyless: false,
    _weatherType: null,

    setStarDim: function (f) {
      this._starDim = f;
      if (this._starfield && this._starfield.material && this._starfield.material.uniforms.uDim) {
        this._starfield.material.uniforms.uDim.value = f;
      }
    },

    // 设置星空亮度目标值（由背景模式统一控制），无天气时立即生效
    setStarTarget: function (f) {
      this._targetStarDim = f;
      if (!this._weather) this.setStarDim(f);
    },

    init: function (canvasId) {
      if (this._ready) return true;
      if (!THREE || !webglAvailable()) {
        // graceful degradation: do nothing, no crash
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ThreeEffectsEngine] WebGL unavailable; effects disabled.');
        }
        return false;
      }
      try {
        var canvas = typeof canvasId === 'string'
          ? document.getElementById(canvasId)
          : canvasId;
        if (!canvas) return false;
        this._canvas = canvas;

        var renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        this._renderer = renderer;

        this._scene = new THREE.Scene();
        this._camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
        this._camera.position.set(0, 0, 160);

        this._applySize();
        this._ready = true;

        // starfield always on
        this._starfield = new Starfield3D({
          scene: this._scene, camera: this._camera, boost: this._particleBoost
        });
        return true;
      } catch (e) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[ThreeEffectsEngine] init failed:', e);
        }
        this._ready = false;
        return false;
      }
    },

    _applySize: function () {
      if (!this._canvas || !this._renderer || !this._camera) return;
      // Use viewport dimensions directly — the canvas is position:fixed;inset:0
      // so its CSS size always matches the viewport. Using clientWidth can return 0
      // during early init before layout, causing a tiny drawing buffer.
      var w = window.innerWidth || this._canvas.clientWidth || 300;
      var h = window.innerHeight || this._canvas.clientHeight || 150;
      this._renderer.setSize(w, h, false);
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    },

    setEffect: function (type) {
      if (!this._ready) return;
      // dispose current ambient effect
      if (this._effect) {
        this._effect.dispose();
        this._effect = null;
      }
      this._effectType = type;
      if (type === 'starfield' || !type) {
        this._effect = null;
        return;
      }
      var Ctor = EFFECTS[type];
      if (!Ctor) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ThreeEffectsEngine] Unknown effect type:', type);
        }
        return;
      }
      try {
        this._effect = new Ctor({
          scene: this._scene, camera: this._camera,
          boost: this._particleBoost,
          skyless: this._skyless
        });
      } catch (e) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[ThreeEffectsEngine] effect init failed:', e);
        }
        this._effect = null;
      }
      // 星空亮度由背景模式统一控制（setStarTarget），此处不再按特效类型覆盖
      if (!this._weather) this.setStarDim(this._targetStarDim);
    },

    setWeather: function (type) {
      if (!this._ready) return;
      this._weatherType = type;
      if (this._weather) {
        this._weather.dispose();
        this._weather = null;
      }
      if (!type) {
        this.setStarDim(this._targetStarDim);
        return;
      }
      try {
        this._weather = new Weather3D({
          scene: this._scene, type: type, boost: this._particleBoost,
          skyless: this._skyless || false
        });
      } catch (e) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[ThreeEffectsEngine] weather init failed:', e);
        }
        this._weather = null;
      }
      // dim stars during daytime / overcast weather scenes
      var dim = 1.0;
      if (type === 'sunny') dim = 0.04;
      else if (type === 'cloudy') dim = 0.12;
      else if (type === 'overcast' || type === 'rainy' || type === 'storm') dim = 0.15;
      else if (type === 'thunder') dim = 0.08;
      else if (type.indexOf('snow') >= 0) dim = 0.18;
      // skyless 模式下适度调暗星空（避免遮挡自定义背景，但保留少量星星）
      if (this._skyless) dim = Math.min(dim, 0.3);
      this.setStarDim(dim);
    },

    setSkyless: function (bool) {
      var changed = this._skyless !== !!bool;
      this._skyless = !!bool;
      if (!changed) return;
      // skyless 状态变化时，若天气已在运行则重建（确保 skyless 参数生效）
      if (this._weather && this._weatherType) {
        var type = this._weatherType;
        this._weather.dispose();
        this._weather = null;
        this.setWeather(type);
      }
      // 环境特效同样重建，让自带天空穹顶的特效（sky/deepsea）立即适配背景
      if (this._effect && this._effectType) {
        var eType = this._effectType;
        this._effect.dispose();
        this._effect = null;
        this._effectType = null;
        this.setEffect(eType);
      }
      if (!this._weather) this.setStarDim(this._targetStarDim);
    },

    setMouse: function (x, y) {
      this._mouse.x = x;
      this._mouse.y = y;
      // project to world point on z=0 plane
      if (this._camera && this._ready) {
        var v = this._tmpVec.set(x, y, 0.5);
        v.unproject(this._camera);
        var dir = v.sub(this._camera.position).normalize();
        var distance = -this._camera.position.z / (dir.z || 0.0001);
        this._mouse.world.copy(this._camera.position).addScaledVector(dir, distance);
      }
    },

    setParticleBoost: function (on) {
      this._particleBoost = !!on;
      if (!this._ready) return;
      // Only rebuild the starfield here — the caller is responsible for
      // calling setEffect()/setWeather() afterwards. Rebuilding those here
      // caused duplicate effect objects and double-rendering.
      if (this._starfield) this._starfield.dispose();
      this._starfield = new Starfield3D({
        scene: this._scene, camera: this._camera, boost: this._particleBoost
      });
      this.setStarDim(this._starDim);
    },

    resize: function () {
      if (!this._ready) return;
      this._applySize();
    },

    start: function () {
      if (!this._ready || this._running) return;
      this._applySize(); // re-apply size in case layout changed since init
      this._running = true;
      this._lastTime = performance.now();
      this._frameCount = 0;
      var self = this;
      function loop() {
        if (!self._running) return;
        self._raf = requestAnimationFrame(loop);
        var now = performance.now();
        var dt = (now - self._lastTime) / 1000;
        self._lastTime = now;
        var t = now / 1000;
        self._frameCount++;
        try {
          if (self._starfield) self._starfield.update(t, dt, self._mouse);
          if (self._effect) self._effect.update(t, dt, self._mouse);
          if (self._weather) self._weather.update(t, dt, self._mouse);

          // subtle camera parallax from mouse
          self._camera.position.x += (self._mouse.x * 14 - self._camera.position.x) * 0.04;
          self._camera.position.y += (self._mouse.y * 8 - self._camera.position.y) * 0.04;
          self._camera.lookAt(0, 0, 0);

          self._renderer.render(self._scene, self._camera);
        } catch (e) {
          // never let a frame error kill the page
          if (typeof console !== 'undefined' && console.error) {
            console.error('[ThreeEffectsEngine] render error:', e);
          }
          self.stop();
        }
      }
      this._raf = requestAnimationFrame(loop);
    },

    stop: function () {
      this._running = false;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
    },

    dispose: function () {
      this.stop();
      if (!this._ready) return;
      if (this._starfield) { this._starfield.dispose(); this._starfield = null; }
      if (this._effect) { this._effect.dispose(); this._effect = null; }
      if (this._weather) { this._weather.dispose(); this._weather = null; }
      if (this._renderer) {
        this._renderer.dispose();
        this._renderer.forceContextLoss && this._renderer.forceContextLoss();
        this._renderer = null;
      }
      this._scene = null;
      this._camera = null;
      this._canvas = null;
      this._ready = false;
    }
  };

  window.ThreeEffectsEngine = engine;
})();
