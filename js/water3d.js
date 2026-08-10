/* ============================================================
   water3d.js — Three.js 高级 3D 水面渲染模块
   ----------------------------------------------------------------
   基于WebGL着色器的真实物理水面反射系统，包含：
   - Gerstner 波浪模型（4层叠加）+ Simplex 噪声细节
   - 实时法线计算（解析导数法）
   - Fresnel 菲涅尔反射（Schlick 近似）
   - Blinn-Phong 镜面高光（双光源）
   - 水下焦散光斑（法线聚焦 + 噪声纹理）
   - 深度色彩吸收（Beer-Lambert 衰减）
   - 次表面散射近似（波峰柔光）
   - 水面线 Fresnel 辉光
   - 上帝之光（水面光柱）
   - 水面泡沫（水线白沫）
   ============================================================ */
(function () {
  'use strict';

  var Water3D = {
    _canvas: null,
    _renderer: null,
    _scene: null,
    _camera: null,
    _mesh: null,
    _material: null,
    _raf: null,
    _running: false,
    _startTime: 0,
    _disposed: false,
    _onResize: null,

    /* ===== 初始化 ===== */
    init: function (canvasId) {
      if (this._renderer) return true;
      if (!window.THREE) { console.warn('[Water3D] THREE not loaded'); return false; }
      var canvas = typeof canvasId === 'string'
        ? document.getElementById(canvasId)
        : canvasId;
      if (!canvas) { console.warn('[Water3D] canvas not found'); return false; }
      this._canvas = canvas;

      try {
        this._renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          antialias: false,
          alpha: true,
          premultipliedAlpha: false
        });
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this._renderer.setClearColor(0x000000, 0);
      } catch (e) {
        console.warn('[Water3D] WebGL unavailable:', e.message);
        return false;
      }

      this._scene = new THREE.Scene();
      this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      this._buildMesh();
      this._onResize = this._resize.bind(this);
      window.addEventListener('resize', this._onResize);
      this._resize();
      this._disposed = false;
      return true;
    },

    /* ===== 构建全屏 Quad + 着色器 ===== */
    _buildMesh: function () {
      var geometry = new THREE.PlaneGeometry(2, 2);

      this._material = new THREE.ShaderMaterial({
        vertexShader: this._vertexShader(),
        fragmentShader: this._fragmentShader(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime:          { value: 0 },
          uResolution:    { value: new THREE.Vector2(1, 1) },
          uOpacity:       { value: 0.55 },
          uLightDir:      { value: new THREE.Vector3(0.5, 0.35, 0.8).normalize() },
          uLightDir2:     { value: new THREE.Vector3(-0.4, -0.2, 0.7).normalize() },
          uSkyColor:      { value: new THREE.Color(0x4a90c2) },
          uDeepColor:     { value: new THREE.Color(0x001a30) },
          uShallowColor:  { value: new THREE.Color(0x0a3550) },
          uCausticColor:  { value: new THREE.Color(0x6ab8e8) },
          uFoamColor:     { value: new THREE.Color(0xc8e0f0) }
        }
      });

      this._mesh = new THREE.Mesh(geometry, this._material);
      this._scene.add(this._mesh);
    },

    /* ===== 顶点着色器 ===== */
    _vertexShader: function () {
      return [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = vec4(position, 1.0);',
        '}'
      ].join('\n');
    },

    /* ===== 片段着色器（核心水面渲染） ===== */
    _fragmentShader: function () {
      return [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform float uTime;',
        'uniform vec2  uResolution;',
        'uniform float uOpacity;',
        'uniform vec3  uLightDir;',
        'uniform vec3  uLightDir2;',
        'uniform vec3  uSkyColor;',
        'uniform vec3  uDeepColor;',
        'uniform vec3  uShallowColor;',
        'uniform vec3  uCausticColor;',
        'uniform vec3  uFoamColor;',

        /* ---- Simplex 2D Noise (Ashima Arts) ---- */
        'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
        'vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}',
        'vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}',
        'float snoise(vec2 v){',
        '  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);',
        '  vec2 i=floor(v+dot(v,C.yy));',
        '  vec2 x0=v-i+dot(i,C.xx);',
        '  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);',
        '  vec4 x12=x0.xyxy+C.xxzz;',
        '  x12.xy-=i1;',
        '  i=mod289(i);',
        '  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));',
        '  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);',
        '  m=m*m;m=m*m;',
        '  vec3 x=2.0*fract(p*C.www)-1.0;',
        '  vec3 h=abs(x)-0.5;',
        '  vec3 ox=floor(x+0.5);',
        '  vec3 a0=x-ox;',
        '  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);',
        '  vec3 g;',
        '  g.x=a0.x*x0.x+h.x*x0.y;',
        '  g.yz=a0.yz*x12.xz+h.yz*x12.yw;',
        '  return 130.0*dot(m,g);',
        '}',

        /* ---- Gerstner 波浪法线计算 ---- */
        'vec3 getWaterNormal(vec2 uv, float t, out float height) {',
        '  height = 0.0;',
        '  vec2 d = vec2(0.0);',
        '  vec2 dir;',
        '  float phase, h, freq, amp, spd;',
        '',
        '  dir = normalize(vec2( 1.0,  0.3));  freq=2.8;  amp=0.020; spd=0.6;',
        '  phase = dot(dir, uv) * freq + t * spd;',
        '  h = sin(phase) * amp;  height += h;',
        '  d += dir * cos(phase) * amp * freq;',
        '',
        '  dir = normalize(vec2(-0.6,  0.9));  freq=4.5;  amp=0.012; spd=0.9;',
        '  phase = dot(dir, uv) * freq + t * spd;',
        '  h = sin(phase) * amp;  height += h;',
        '  d += dir * cos(phase) * amp * freq;',
        '',
        '  dir = normalize(vec2( 0.4, -0.7));  freq=7.0;  amp=0.006; spd=1.3;',
        '  phase = dot(dir, uv) * freq + t * spd;',
        '  h = sin(phase) * amp;  height += h;',
        '  d += dir * cos(phase) * amp * freq;',
        '',
        '  dir = normalize(vec2(-0.3, -0.8));  freq=11.0; amp=0.003; spd=1.6;',
        '  phase = dot(dir, uv) * freq + t * spd;',
        '  h = sin(phase) * amp;  height += h;',
        '  d += dir * cos(phase) * amp * freq;',
        '',
        '  float n = snoise(uv * 8.0 + t * 0.4) * 0.003;',
        '  height += n;',
        '',
        '  return normalize(vec3(-d.x, -d.y, 1.0));',
        '}',

        /* ---- 主函数 ---- */
        'void main() {',
        '  vec2 uv = vUv;',
        '  float t = uTime;',
        '  float depth = 1.0 - uv.y;',
        '',
        '  float aspect = uResolution.x / max(1.0, uResolution.y);',
        '  vec2 wUV = vec2(uv.x * aspect, uv.y) * 4.0;',
        '',
        '  float waveH;',
        '  vec3 N = getWaterNormal(wUV, t, waveH);',
        '  vec3 V = vec3(0.0, 0.0, 1.0);',
        '',
        '  /* Fresnel (Schlick) */',
        '  float NdotV = max(0.0, dot(N, V));',
        '  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);',
        '',
        '  /* Specular — Blinn-Phong 双光源 */',
        '  vec3 H1 = normalize(uLightDir + V);',
        '  vec3 H2 = normalize(uLightDir2 + V);',
        '  float spec1 = pow(max(0.0, dot(N, H1)), 200.0);',
        '  float spec2 = pow(max(0.0, dot(N, H2)), 80.0) * 0.4;',
        '  float specular = spec1 + spec2;',
        '',
        '  /* 焦散光斑 */',
        '  float cFocus = pow(max(0.0, 1.0 - length(N.xy) * 15.0), 4.0);',
        '  vec2 cUV = wUV * 0.6 + N.xy * 4.0;',
        '  float c1 = snoise(cUV * 3.0 + t * 0.20) * 0.5 + 0.5;',
        '  float c2 = snoise(cUV * 8.0 - t * 0.15) * 0.5 + 0.5;',
        '  float c3 = snoise(cUV * 16.0 + t * 0.35) * 0.5 + 0.5;',
        '  float caustics = cFocus * c1 * c2 * (c3 * 0.4 + 0.6) * 1.8;',
        '  caustics *= smoothstep(0.0, 0.25, depth) * (1.0 - smoothstep(0.55, 1.0, depth));',
        '',
        '  /* 深度色彩 (Beer-Lambert) */',
        '  vec3 waterColor = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.75, depth));',
        '  float depthAlpha = mix(0.10, 0.62, smoothstep(0.0, 0.9, depth));',
        '',
        '  /* 环境反射 */',
        '  vec3 reflectColor = mix(uSkyColor * 0.7, vec3(1.0), fresnel * 0.4);',
        '',
        '  /* 次表面散射 (波峰柔光) */',
        '  float sss = max(0.0, waveH) * 50.0;',
        '',
        '  /* 水面线 Fresnel 辉光 */',
        '  float waterline = smoothstep(0.0, 0.02, depth) * (1.0 - smoothstep(0.02, 0.10, depth));',
        '',
        '  /* 上帝之光 (水面光柱) */',
        '  float godRay = pow(max(0.0, 1.0 - abs(uv.x - 0.5) * 2.5), 3.0)',
        '              * smoothstep(0.0, 0.45, depth) * (1.0 - smoothstep(0.7, 1.0, depth)) * 0.05;',
        '',
        '  /* 水面泡沫 */',
        '  float foamNoise = snoise(wUV * 18.0 + t * 0.8) * 0.5 + 0.5;',
        '  float foam = smoothstep(0.0, 0.012, depth)',
        '             * (1.0 - smoothstep(0.012, 0.045, depth))',
        '             * foamNoise * 0.6;',
        '',
        '  /* 漫反射 */',
        '  float diffuse = max(0.0, dot(N, uLightDir)) * 0.06;',
        '',
        '  /* ===== 合成 ===== */',
        '  vec3 color = vec3(0.0);',
        '  color += waterColor * depthAlpha;',
        '  color += reflectColor * fresnel * 0.30;',
        '  color += vec3(1.0, 0.98, 0.95) * specular * 0.90;',
        '  color += uCausticColor * caustics * 0.45;',
        '  color += uShallowColor * sss * 0.15;',
        '  color += vec3(0.8, 0.92, 1.0) * waterline * 0.50;',
        '  color += vec3(0.9, 0.95, 1.0) * godRay;',
        '  color += uFoamColor * foam * 0.25;',
        '  color += waterColor * diffuse;',
        '',
        '  float alpha = depthAlpha',
        '             + fresnel * 0.20',
        '             + specular * 0.35',
        '             + caustics * 0.20',
        '             + waterline * 0.35',
        '             + foam * 0.10;',
        '  alpha = clamp(alpha, 0.0, 0.85) * uOpacity;',
        '',
        '  gl_FragColor = vec4(color, alpha);',
        '}'
      ].join('\n');
    },

    /* ===== 尺寸调整 ===== */
    _resize: function () {
      if (!this._renderer || !this._canvas) return;
      var w = this._canvas.offsetWidth || window.innerWidth;
      var h = this._canvas.offsetHeight || Math.floor(window.innerHeight * 0.32);
      if (w < 2 || h < 2) return;
      this._renderer.setSize(w, h, false);
      if (this._material) {
        this._material.uniforms.uResolution.value.set(w, h);
      }
    },

    /* ===== 启动渲染循环 ===== */
    start: function () {
      if (!this._renderer) {
        if (!this.init(this._canvas ? this._canvas : 'waterCanvas')) return;
      }
      if (this._running) return;
      this._resize();
      this._running = true;
      this._startTime = performance.now();
      this._loop();
    },

    _loop: function () {
      var self = this;
      this._raf = requestAnimationFrame(function () { self._loop(); });
      if (!this._running || this._disposed) return;
      var t = (performance.now() - this._startTime) / 1000;
      if (this._material) {
        this._material.uniforms.uTime.value = t;
      }
      this._renderer.render(this._scene, this._camera);
    },

    /* ===== 停止 ===== */
    stop: function () {
      this._running = false;
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    /* ===== 设置透明度 ===== */
    setOpacity: function (opacity) {
      if (this._material) {
        this._material.uniforms.uOpacity.value = opacity;
      }
    },

    /* ===== 销毁 ===== */
    dispose: function () {
      this.stop();
      if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
      if (this._mesh) {
        if (this._mesh.geometry) this._mesh.geometry.dispose();
        if (this._mesh.material) this._mesh.material.dispose();
        this._mesh = null;
      }
      if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
      this._material = null;
      this._scene = null;
      this._camera = null;
      this._disposed = true;
    }
  };

  window.Water3D = Water3D;
})();
