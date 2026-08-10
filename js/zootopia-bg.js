/* ============================================================
   zootopia-bg.js — 疯狂动物城风格 3D 动态背景场景
   自包含模块，独立渲染于 #bgSceneCanvas
   ============================================================ */
(function () {
  'use strict';

  var ZootopiaBG = {
    _canvas: null,
    _renderer: null,
    _scene: null,
    _camera: null,
    _raf: null,
    _running: false,
    _lastTime: 0,
    _disposed: false,
    _animals: [],
    _clouds: [],
    _clock: null,
    _mouse: { x: 0, y: 0, targetX: 0, targetY: 0 },
    _raycaster: null,
    _clickNDC: null,
    _groundPlane: null,
    _clickAnimalIdx: 0,

    init: function (canvasId) {
      if (this._renderer) return true;
      if (!window.THREE) return false;
      var canvas = typeof canvasId === 'string'
        ? document.getElementById(canvasId)
        : canvasId;
      if (!canvas) return false;
      this._canvas = canvas;

      try {
        this._renderer = new THREE.WebGLRenderer({
          canvas: canvas, antialias: true, alpha: false
        });
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this._renderer.setSize(window.innerWidth, window.innerHeight, false);
      } catch (e) {
        if (console && console.warn) console.warn('[ZootopiaBG] WebGL unavailable');
        return false;
      }

      this._scene = new THREE.Scene();
      this._scene.background = this._createSkyTexture();

      this._camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
      this._camera.position.set(0, 2.5, 11);

      this._clock = new THREE.Clock();
      this._raycaster = new THREE.Raycaster();
      this._clickNDC = new THREE.Vector2();
      this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

      this._buildScene();
      this._bindEvents();
      this._disposed = false;
      return true;
    },

    // ===== 颜色方案 =====
    _COLORS: {
      sky: 0x87ceeb,
      ground: 0x7cb342,
      grassDark: 0x558b2f,
      buildings: [0xffb3ba, 0xffdfba, 0xfff3ba, 0xbaffc4, 0xbae1ff],
      rabbit: 0xfff0f5,
      rabbitInnerEar: 0xffb3c8,
      rabbitEye: 0x2c2c54,
      fox: 0xff8c42,
      foxBelly: 0xffcc99,
      foxEye: 0x4a3728,
      sloth: 0xb8a088,
      slothBelly: 0xd4c4a8,
      slothEye: 0x2c2c54,
      elephant: 0xc8d5e5,
      elephantEar: 0xa0b5d0,
      elephantEye: 0x2c2c54,
      tree: 0x66bb6a,
      treeTrunk: 0x6d4c41,
      lamppost: 0xffd700
    },

    _createSkyTexture: function () {
      var c = document.createElement('canvas');
      c.width = 4; c.height = 512;
      var ctx = c.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, '#1e5fa8');
      g.addColorStop(0.3, '#4a8fd4');
      g.addColorStop(0.6, '#7fb8ec');
      g.addColorStop(0.85, '#b8dcf5');
      g.addColorStop(1, '#e0f0ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 512);
      var tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      return tex;
    },

    _createGrassTexture: function () {
      var c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#4a8a35';
      ctx.fillRect(0, 0, 256, 256);
      for (var i = 0; i < 3000; i++) {
        var x = Math.random() * 256, y = Math.random() * 256, r = Math.random();
        if (r < 0.25) ctx.fillStyle = '#2d5e1e';
        else if (r < 0.5) ctx.fillStyle = '#3a7328';
        else if (r < 0.75) ctx.fillStyle = '#6fb04a';
        else ctx.fillStyle = '#8aca5e';
        var s = 1 + Math.random() * 2;
        ctx.fillRect(x, y, s, s);
      }
      for (var j = 0; j < 150; j++) {
        var x2 = Math.random() * 256, y2 = Math.random() * 256;
        ctx.strokeStyle = Math.random() > 0.5 ? '#2d5e1e' : '#5a9e3e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 + (Math.random() - 0.5) * 4, y2 - 3 - Math.random() * 3);
        ctx.stroke();
      }
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(24, 24);
      return tex;
    },

    _createTree: function (scaleFactor) {
      var tree = new THREE.Group();
      var COLORS = this._COLORS;
      var trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
      var trunkDarkMat = new THREE.MeshLambertMaterial({ color: 0x4a3328 });
      var leafColors = [0x4a8a35, 0x5a9e3e, 0x3a7328, 0x6fb04a, 0x4a8a35];
      var leafMats = leafColors.map(function (c) { return new THREE.MeshLambertMaterial({ color: c }); });

      var trunkBase = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.6, 10), trunkDarkMat);
      trunkBase.position.y = 0; tree.add(trunkBase);
      var trunkTop = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 10), trunkMat);
      trunkTop.position.y = 0.5; tree.add(trunkTop);

      var crownLayers = [
        { x: 0, y: 1.0, z: 0, r: 0.6, mi: 0 },
        { x: 0.25, y: 1.2, z: 0.1, r: 0.5, mi: 1 },
        { x: -0.2, y: 1.3, z: -0.15, r: 0.48, mi: 2 },
        { x: 0.1, y: 1.5, z: -0.1, r: 0.42, mi: 3 },
        { x: -0.15, y: 1.45, z: 0.2, r: 0.4, mi: 0 },
        { x: 0.2, y: 1.65, z: 0.05, r: 0.35, mi: 1 },
        { x: -0.1, y: 1.7, z: -0.05, r: 0.32, mi: 2 },
        { x: 0.05, y: 1.85, z: 0, r: 0.28, mi: 4 }
      ];
      crownLayers.forEach(function (l) {
        var crown = new THREE.Mesh(new THREE.SphereGeometry(l.r, 16, 16), leafMats[l.mi]);
        crown.position.set(l.x, l.y, l.z);
        crown.scale.set(1, 0.92 + Math.random() * 0.12, 1);
        tree.add(crown);
      });

      var s = scaleFactor || 1;
      tree.scale.set(s, s, s);
      return tree;
    },

    _createCityscape: function () {
      var self = this;
      var COLORS = this._COLORS;
      var group = new THREE.Group();

      var grassTexture = this._createGrassTexture();
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120),
        new THREE.MeshLambertMaterial({ map: grassTexture })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.5;
      group.add(ground);

      for (var i = 0; i < 8; i++) {
        var hill = new THREE.Mesh(
          new THREE.SphereGeometry(2 + Math.random() * 1.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshLambertMaterial({ color: 0x3a7328 })
        );
        hill.scale.set(1, 0.25, 1);
        hill.position.set((Math.random() - 0.5) * 35, -0.5, (Math.random() - 0.5) * 35);
        group.add(hill);
      }

      var buildingData = [
        { x: -8, z: -5, w: 2, h: 5, d: 2, c: COLORS.buildings[0] },
        { x: 8, z: -6, w: 2.5, h: 7, d: 2, c: COLORS.buildings[1] },
        { x: -10, z: -8, w: 2, h: 4, d: 2, c: COLORS.buildings[2] },
        { x: 10, z: -9, w: 2, h: 6, d: 2, c: COLORS.buildings[3] },
        { x: -6, z: -10, w: 3, h: 3, d: 2, c: COLORS.buildings[4] },
        { x: 6, z: -11, w: 2, h: 4.5, d: 2, c: COLORS.buildings[0] }
      ];
      buildingData.forEach(function (b) {
        var geo = new THREE.BoxGeometry(b.w, b.h, b.d);
        var mat = new THREE.MeshLambertMaterial({ color: b.c });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x, b.h / 2 - 0.5, b.z);
        group.add(mesh);

        var roof = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.7, 0.8, 4),
          new THREE.MeshLambertMaterial({ color: 0xef5350 })
        );
        roof.position.set(b.x, b.h - 0.1, b.z);
        roof.rotation.y = Math.PI / 4;
        group.add(roof);

        var windowMat = new THREE.MeshLambertMaterial({ color: 0xffffcc });
        var windowGeo = new THREE.PlaneGeometry(0.15, 0.2);
        for (var fi = 0; fi < Math.floor(b.h); fi++) {
          for (var fj = 0; fj < 3; fj++) {
            if (Math.random() > 0.4) {
              var win = new THREE.Mesh(windowGeo, windowMat);
              win.position.set(b.x - b.w / 2 + 0.3 + fj * (b.w / 3), 0.2 + fi * 0.6, b.z + b.d / 2 + 0.01);
              group.add(win);
            }
          }
        }
      });

      for (var li = -5; li <= 5; li += 5) {
        var pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6),
          new THREE.MeshLambertMaterial({ color: 0xcccccc })
        );
        pole.position.set(li, 0.75, 3);
        group.add(pole);

        var lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 8),
          new THREE.MeshLambertMaterial({ color: COLORS.lamppost })
        );
        lamp.position.set(li, 2, 3);
        group.add(lamp);

        var light = new THREE.PointLight(0xffddaa, 0.5, 5);
        light.position.set(li, 2, 3);
        group.add(light);
      }

      var treePositions = [
        { x: -4, z: 1, s: 1.0 }, { x: 4, z: 0, s: 1.1 }, { x: -2, z: 4, s: 0.9 },
        { x: 2, z: 5, s: 1.05 }, { x: -7, z: 2, s: 1.2 }, { x: 7, z: 1, s: 0.95 },
        { x: 0, z: 6, s: 1.1 }, { x: -9, z: 0, s: 0.85 }, { x: 9, z: 3, s: 1.0 },
        { x: -6, z: -2, s: 1.15 }, { x: 6, z: -1, s: 0.9 }, { x: -3, z: -3, s: 1.0 },
        { x: 3, z: -4, s: 1.1 }, { x: -11, z: 4, s: 0.95 }, { x: 11, z: 5, s: 1.2 }
      ];
      treePositions.forEach(function (p) {
        var t = self._createTree(p.s);
        t.position.set(p.x, -0.1, p.z);
        t.rotation.y = Math.random() * Math.PI * 2;
        group.add(t);
      });

      return group;
    },

    _createCloud: function (x, y, z) {
      var group = new THREE.Group();
      var mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.96 });
      var shadowMat = new THREE.MeshLambertMaterial({ color: 0xd8e4ee, transparent: true, opacity: 0.5 });

      var shadow = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), shadowMat);
      shadow.position.set(0, -0.25, 0);
      shadow.scale.set(1.4, 0.4, 1);
      group.add(shadow);

      var positions = [
        { x: 0, y: 0, r: 1.0 }, { x: 0.8, y: 0.15, r: 0.85 },
        { x: -0.8, y: 0.15, r: 0.85 }, { x: 0.4, y: 0.5, r: 0.7 },
        { x: -0.4, y: 0.5, r: 0.7 }, { x: 1.4, y: 0, r: 0.6 },
        { x: -1.4, y: 0, r: 0.6 }, { x: 0.15, y: 0.75, r: 0.55 },
        { x: -0.15, y: 0.8, r: 0.5 }
      ];
      positions.forEach(function (p) {
        var cloud = new THREE.Mesh(new THREE.SphereGeometry(p.r, 14, 14), mat);
        cloud.position.set(p.x, p.y, 0);
        cloud.scale.y = 0.82;
        group.add(cloud);
      });

      group.position.set(x, y, z);
      group.scale.set(1.4, 1, 1);
      return group;
    },

    _addOutline: function (mesh, thickness) {
      thickness = thickness || 1.06;
      var outline = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({ color: 0x6b5544, side: THREE.BackSide })
      );
      outline.scale.multiplyScalar(thickness);
      mesh.add(outline);
    },

    _addFaceOutlines: function (group, yThreshold) {
      var self = this;
      yThreshold = yThreshold || 1.3;
      var targets = [];
      group.traverse(function (child) {
        if (!child.isMesh || !(child.position.y > yThreshold)) return;
        var params = child.geometry.parameters || {};
        var r = params.radius || 0;
        if (r === 0 || r > 0.05) targets.push(child);
      });
      targets.forEach(function (m) { self._addOutline(m, 1.06); });
    },

    _createRabbit: function () {
      var COLORS = this._COLORS;
      var group = new THREE.Group();
      var furMat = new THREE.MeshLambertMaterial({ color: COLORS.rabbit });
      var earInnerMat = new THREE.MeshLambertMaterial({ color: COLORS.rabbitInnerEar });
      var whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      var eyeMat = new THREE.MeshLambertMaterial({ color: COLORS.rabbitEye });

      var body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 24), furMat);
      body.scale.set(1, 1.2, 1); body.position.y = 0.85; group.add(body);

      var chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), whiteMat);
      chest.scale.set(0.9, 1.05, 0.65); chest.position.set(0, 0.75, 0.42); group.add(chest);

      var head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 24), furMat);
      head.position.y = 1.75; group.add(head);

      var leftCheek = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), whiteMat);
      leftCheek.position.set(-0.22, 1.65, 0.5); group.add(leftCheek);
      var rightCheek = leftCheek.clone(); rightCheek.position.x = 0.22; group.add(rightCheek);

      var leftEar = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), furMat);
      leftEar.scale.set(0.7, 1.8, 0.7); leftEar.position.set(-0.22, 2.55, 0); leftEar.rotation.z = 0.12; group.add(leftEar);
      var leftEarInner = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), earInnerMat);
      leftEarInner.scale.set(0.6, 1.7, 0.5); leftEarInner.position.set(-0.21, 2.55, 0.06); leftEarInner.rotation.z = 0.12; group.add(leftEarInner);
      var rightEar = leftEar.clone(); rightEar.position.x = 0.22; rightEar.rotation.z = -0.12; group.add(rightEar);
      var rightEarInner = leftEarInner.clone(); rightEarInner.position.x = 0.21; rightEarInner.rotation.z = -0.12; group.add(rightEarInner);

      var leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), whiteMat);
      leftEyeWhite.position.set(-0.2, 1.82, 0.55); leftEyeWhite.scale.set(1, 1.15, 0.65); group.add(leftEyeWhite);
      var leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), eyeMat);
      leftEyePupil.position.set(-0.2, 1.82, 0.64); leftEyePupil.scale.set(0.85, 1, 0.55); group.add(leftEyePupil);
      var leftEyeShine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), whiteMat);
      leftEyeShine.position.set(-0.175, 1.86, 0.7); group.add(leftEyeShine);
      var rightEyeWhite = leftEyeWhite.clone(); rightEyeWhite.position.x = 0.2; group.add(rightEyeWhite);
      var rightEyePupil = leftEyePupil.clone(); rightEyePupil.position.x = 0.2; group.add(rightEyePupil);
      var rightEyeShine = leftEyeShine.clone(); rightEyeShine.position.x = 0.225; group.add(rightEyeShine);

      var nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), earInnerMat);
      nose.position.set(0, 1.58, 0.6); nose.scale.set(1.4, 0.9, 0.9); group.add(nose);

      var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 10, Math.PI), new THREE.MeshLambertMaterial({ color: 0x888888 }));
      mouth.position.set(0, 1.5, 0.56); mouth.rotation.x = Math.PI; group.add(mouth);

      var flArmPivot = new THREE.Group(); flArmPivot.position.set(-0.5, 1.0, 0.3);
      var leftArm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 14), furMat);
      leftArm.scale.set(0.8, 1.5, 0.8); leftArm.position.set(0, -0.15, -0.15); leftArm.rotation.z = 0.6; flArmPivot.add(leftArm);
      var leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), whiteMat);
      leftHand.position.set(-0.12, -0.4, -0.1); flArmPivot.add(leftHand); group.add(flArmPivot);

      var frArmPivot = new THREE.Group(); frArmPivot.position.set(0.5, 1.0, 0.3);
      var rightArm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 14), furMat);
      rightArm.scale.set(0.8, 1.5, 0.8); rightArm.position.set(0, -0.15, -0.15); rightArm.rotation.z = -0.6; frArmPivot.add(rightArm);
      var rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), whiteMat);
      rightHand.position.set(0.12, -0.4, -0.1); frArmPivot.add(rightHand); group.add(frArmPivot);

      var blLegPivot = new THREE.Group(); blLegPivot.position.set(-0.3, 0.55, -0.1);
      var leftLeg = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), furMat);
      leftLeg.scale.set(0.85, 1.3, 1.1); leftLeg.position.set(0, -0.2, 0.15); blLegPivot.add(leftLeg);
      var leftFoot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), whiteMat);
      leftFoot.scale.set(1, 0.55, 1.6); leftFoot.position.set(0, -0.42, 0.3); blLegPivot.add(leftFoot); group.add(blLegPivot);

      var brLegPivot = new THREE.Group(); brLegPivot.position.set(0.3, 0.55, -0.1);
      var rightLeg = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), furMat);
      rightLeg.scale.set(0.85, 1.3, 1.1); rightLeg.position.set(0, -0.2, 0.15); brLegPivot.add(rightLeg);
      var rightFoot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), whiteMat);
      rightFoot.scale.set(1, 0.55, 1.6); rightFoot.position.set(0, -0.42, 0.3); brLegPivot.add(rightFoot); group.add(brLegPivot);

      group.userData.legs = { fl: flArmPivot, fr: frArmPivot, bl: blLegPivot, br: brLegPivot };

      var tail = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), whiteMat);
      tail.position.set(0, 0.85, -0.7); group.add(tail);

      return group;
    },

    _createFox: function () {
      var COLORS = this._COLORS;
      var group = new THREE.Group();
      var furMat = new THREE.MeshLambertMaterial({ color: COLORS.fox });
      var bellyMat = new THREE.MeshLambertMaterial({ color: COLORS.foxBelly });
      var whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      var eyeMat = new THREE.MeshLambertMaterial({ color: COLORS.foxEye });
      var blackMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });

      var body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 24), furMat);
      body.scale.set(1, 1.15, 1.2); body.position.y = 0.9; group.add(body);

      var belly = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 20), bellyMat);
      belly.scale.set(0.9, 1.05, 0.65); belly.position.set(0, 0.8, 0.45); group.add(belly);

      var head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 24), furMat);
      head.scale.set(1, 1.05, 1.15); head.position.y = 1.78; group.add(head);

      var snout = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 16), bellyMat);
      snout.position.set(0, 1.62, 0.65); snout.rotation.x = Math.PI / 2; group.add(snout);
      var snoutTip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), bellyMat);
      snoutTip.scale.set(1, 0.9, 1.1); snoutTip.position.set(0, 1.62, 0.85); group.add(snoutTip);

      var leftCheek = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), bellyMat);
      leftCheek.position.set(-0.24, 1.7, 0.45); group.add(leftCheek);
      var rightCheek = leftCheek.clone(); rightCheek.position.x = 0.24; group.add(rightCheek);

      var leftEar = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), furMat);
      leftEar.position.set(-0.34, 2.25, -0.05); leftEar.rotation.z = 0.22; group.add(leftEar);
      var leftEarInner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.35, 8), blackMat);
      leftEarInner.position.set(-0.34, 2.22, 0); leftEarInner.rotation.z = 0.22; group.add(leftEarInner);
      var rightEar = leftEar.clone(); rightEar.position.x = 0.34; rightEar.rotation.z = -0.22; group.add(rightEar);
      var rightEarInner = leftEarInner.clone(); rightEarInner.position.x = 0.34; rightEarInner.rotation.z = -0.22; group.add(rightEarInner);

      var leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), whiteMat);
      leftEyeWhite.scale.set(1, 1.2, 0.65); leftEyeWhite.position.set(-0.22, 1.88, 0.62); group.add(leftEyeWhite);
      var leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), eyeMat);
      leftEyePupil.scale.set(0.9, 1, 0.6); leftEyePupil.position.set(-0.22, 1.88, 0.7); group.add(leftEyePupil);
      var leftEyeShine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), whiteMat);
      leftEyeShine.position.set(-0.2, 1.91, 0.76); group.add(leftEyeShine);
      var rightEyeWhite = leftEyeWhite.clone(); rightEyeWhite.position.x = 0.22; group.add(rightEyeWhite);
      var rightEyePupil = leftEyePupil.clone(); rightEyePupil.position.x = 0.22; group.add(rightEyePupil);
      var rightEyeShine = leftEyeShine.clone(); rightEyeShine.position.x = 0.24; group.add(rightEyeShine);

      var nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 14), blackMat);
      nose.scale.set(1.2, 0.85, 0.85); nose.position.set(0, 1.6, 0.95); group.add(nose);

      var tail1 = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), furMat);
      tail1.position.set(0, 0.95, -0.75); group.add(tail1);
      var tail2 = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), furMat);
      tail2.position.set(0, 1.12, -1.0); group.add(tail2);
      var tail3 = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), furMat);
      tail3.position.set(0, 1.3, -1.22); group.add(tail3);
      var tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), whiteMat);
      tailTip.position.set(0, 1.45, -1.4); group.add(tailTip);

      var flArmPivot = new THREE.Group(); flArmPivot.position.set(-0.55, 1.05, 0.3);
      var leftArm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), furMat);
      leftArm.scale.set(0.85, 1.6, 0.85); leftArm.position.set(0, -0.15, -0.15); leftArm.rotation.z = 0.55; flArmPivot.add(leftArm);
      var leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), blackMat);
      leftHand.position.set(-0.17, -0.38, -0.1); flArmPivot.add(leftHand); group.add(flArmPivot);

      var frArmPivot = new THREE.Group(); frArmPivot.position.set(0.55, 1.05, 0.3);
      var rightArm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), furMat);
      rightArm.scale.set(0.85, 1.6, 0.85); rightArm.position.set(0, -0.15, -0.15); rightArm.rotation.z = -0.55; frArmPivot.add(rightArm);
      var rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), blackMat);
      rightHand.position.set(0.17, -0.38, -0.1); frArmPivot.add(rightHand); group.add(frArmPivot);

      var blLegPivot = new THREE.Group(); blLegPivot.position.set(-0.25, 0.5, -0.15);
      var leftLeg = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), furMat);
      leftLeg.scale.set(0.95, 1.4, 0.95); leftLeg.position.set(0, -0.2, 0.1); blLegPivot.add(leftLeg);
      var leftFoot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), blackMat);
      leftFoot.scale.set(1, 0.55, 1.4); leftFoot.position.set(0, -0.42, 0.22); blLegPivot.add(leftFoot); group.add(blLegPivot);

      var brLegPivot = new THREE.Group(); brLegPivot.position.set(0.25, 0.5, -0.15);
      var rightLeg = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), furMat);
      rightLeg.scale.set(0.95, 1.4, 0.95); rightLeg.position.set(0, -0.2, 0.1); brLegPivot.add(rightLeg);
      var rightFoot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), blackMat);
      rightFoot.scale.set(1, 0.55, 1.4); rightFoot.position.set(0, -0.42, 0.22); brLegPivot.add(rightFoot); group.add(brLegPivot);

      group.userData.legs = { fl: flArmPivot, fr: frArmPivot, bl: blLegPivot, br: brLegPivot };
      return group;
    },

    _createSloth: function () {
      var COLORS = this._COLORS;
      var group = new THREE.Group();
      var furMat = new THREE.MeshLambertMaterial({ color: COLORS.sloth });
      var bellyMat = new THREE.MeshLambertMaterial({ color: COLORS.slothBelly });
      var whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      var eyeMat = new THREE.MeshLambertMaterial({ color: COLORS.slothEye });
      var maskMat = new THREE.MeshLambertMaterial({ color: 0x6b5544 });
      var darkMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

      var body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 24), furMat);
      body.scale.set(1.05, 1.2, 1); body.position.y = 0.95; group.add(body);

      var chest = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 20), bellyMat);
      chest.scale.set(0.9, 1.05, 0.55); chest.position.set(0, 0.9, 0.5); group.add(chest);

      var head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 24), furMat);
      head.position.y = 1.95; group.add(head);

      var face = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 20), bellyMat);
      face.scale.set(0.95, 1, 0.55); face.position.set(0, 1.9, 0.4); group.add(face);

      var leftMask = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), maskMat);
      leftMask.scale.set(1, 0.95, 0.45); leftMask.position.set(-0.27, 2.1, 0.45); group.add(leftMask);
      var rightMask = leftMask.clone(); rightMask.position.x = 0.27; group.add(rightMask);

      var leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), whiteMat);
      leftEyeWhite.scale.set(1, 0.6, 0.65); leftEyeWhite.position.set(-0.27, 2.1, 0.7); group.add(leftEyeWhite);
      var leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 14), eyeMat);
      leftEyePupil.scale.set(0.9, 0.9, 0.55); leftEyePupil.position.set(-0.27, 2.08, 0.8); group.add(leftEyePupil);
      var leftEyeShine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), whiteMat);
      leftEyeShine.position.set(-0.25, 2.12, 0.85); group.add(leftEyeShine);
      var rightEyeWhite = leftEyeWhite.clone(); rightEyeWhite.position.x = 0.27; group.add(rightEyeWhite);
      var rightEyePupil = leftEyePupil.clone(); rightEyePupil.position.x = 0.27; group.add(rightEyePupil);
      var rightEyeShine = leftEyeShine.clone(); rightEyeShine.position.x = 0.29; group.add(rightEyeShine);

      var nose = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), darkMat);
      nose.scale.set(1.2, 0.9, 0.85); nose.position.set(0, 1.86, 0.7); group.add(nose);

      var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 12, Math.PI), darkMat);
      mouth.position.set(0, 1.68, 0.62); mouth.rotation.x = Math.PI; mouth.rotation.z = Math.PI; group.add(mouth);

      var flArmPivot = new THREE.Group(); flArmPivot.position.set(-0.6, 1.0, 0.3);
      var leftArm = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), furMat);
      leftArm.scale.set(0.85, 2, 0.85); leftArm.position.set(0, -0.15, -0.15); leftArm.rotation.z = 0.75; flArmPivot.add(leftArm);
      var leftClaw = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.35, 8), darkMat);
      leftClaw.position.set(-0.3, -0.5, -0.1); leftClaw.rotation.z = 0.75; flArmPivot.add(leftClaw); group.add(flArmPivot);

      var frArmPivot = new THREE.Group(); frArmPivot.position.set(0.6, 1.0, 0.3);
      var rightArm = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), furMat);
      rightArm.scale.set(0.85, 2, 0.85); rightArm.position.set(0, -0.15, -0.15); rightArm.rotation.z = -0.75; frArmPivot.add(rightArm);
      var rightClaw = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.35, 8), darkMat);
      rightClaw.position.set(0.3, -0.5, -0.1); rightClaw.rotation.z = -0.75; frArmPivot.add(rightClaw); group.add(frArmPivot);

      var blLegPivot = new THREE.Group(); blLegPivot.position.set(-0.3, 0.5, -0.15);
      var leftLeg = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 14), furMat);
      leftLeg.scale.set(1, 1.5, 1); leftLeg.position.set(0, -0.2, 0.1); blLegPivot.add(leftLeg);
      var leftFoot = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 8), darkMat);
      leftFoot.position.set(0, -0.45, 0.25); blLegPivot.add(leftFoot); group.add(blLegPivot);

      var brLegPivot = new THREE.Group(); brLegPivot.position.set(0.3, 0.5, -0.15);
      var rightLeg = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 14), furMat);
      rightLeg.scale.set(1, 1.5, 1); rightLeg.position.set(0, -0.2, 0.1); brLegPivot.add(rightLeg);
      var rightFoot = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 8), darkMat);
      rightFoot.position.set(0, -0.45, 0.25); brLegPivot.add(rightFoot); group.add(brLegPivot);

      group.userData.legs = { fl: flArmPivot, fr: frArmPivot, bl: blLegPivot, br: brLegPivot };
      return group;
    },

    _createElephant: function () {
      var COLORS = this._COLORS;
      var group = new THREE.Group();
      var skinMat = new THREE.MeshLambertMaterial({ color: COLORS.elephant });
      var earMat = new THREE.MeshLambertMaterial({ color: COLORS.elephantEar });
      var whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      var eyeMat = new THREE.MeshLambertMaterial({ color: COLORS.elephantEye });
      var tuskMat = new THREE.MeshLambertMaterial({ color: 0xfff8dc });

      var body = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 24), skinMat);
      body.scale.set(1.2, 1.05, 1.15); body.position.y = 1.0; group.add(body);

      var head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 24), skinMat);
      head.scale.set(1.1, 1.05, 1.1); head.position.set(0, 1.75, 0.15); group.add(head);

      var leftEar = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 20), skinMat);
      leftEar.scale.set(0.28, 1.15, 1.05); leftEar.position.set(-0.7, 1.8, 0); group.add(leftEar);
      var leftEarInner = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 18), earMat);
      leftEarInner.scale.set(0.22, 0.95, 0.85); leftEarInner.position.set(-0.74, 1.8, 0.05); group.add(leftEarInner);
      var rightEar = leftEar.clone(); rightEar.position.x = 0.7; group.add(rightEar);
      var rightEarInner = leftEarInner.clone(); rightEarInner.position.x = 0.74; group.add(rightEarInner);

      var trunkSeg1 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), skinMat);
      trunkSeg1.position.set(0, 1.4, 0.7); group.add(trunkSeg1);
      var trunkSeg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.4, 14), skinMat);
      trunkSeg2.position.set(0, 1.15, 0.9); trunkSeg2.rotation.x = Math.PI / 2.5; group.add(trunkSeg2);
      var trunkSeg3 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), skinMat);
      trunkSeg3.position.set(0, 0.95, 1.1); group.add(trunkSeg3);
      var trunkSeg4 = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 14), skinMat);
      trunkSeg4.position.set(0, 0.85, 1.25); trunkSeg4.rotation.x = -Math.PI / 3; group.add(trunkSeg4);
      var trunkTip = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 14), skinMat);
      trunkTip.position.set(0, 0.7, 1.35); group.add(trunkTip);

      var leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), whiteMat);
      leftEyeWhite.scale.set(1, 1.15, 0.65); leftEyeWhite.position.set(-0.3, 1.9, 0.95); group.add(leftEyeWhite);
      var leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 14), eyeMat);
      leftEyePupil.scale.set(0.9, 1, 0.55); leftEyePupil.position.set(-0.3, 1.9, 1.05); group.add(leftEyePupil);
      var leftEyeShine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), whiteMat);
      leftEyeShine.position.set(-0.28, 1.93, 1.11); group.add(leftEyeShine);
      var rightEyeWhite = leftEyeWhite.clone(); rightEyeWhite.position.x = 0.3; group.add(rightEyeWhite);
      var rightEyePupil = leftEyePupil.clone(); rightEyePupil.position.x = 0.3; group.add(rightEyePupil);
      var rightEyeShine = leftEyeShine.clone(); rightEyeShine.position.x = 0.32; group.add(rightEyeShine);

      var leftTusk = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.28, 10), tuskMat);
      leftTusk.position.set(-0.18, 1.35, 0.7); leftTusk.rotation.x = -Math.PI / 2.5; leftTusk.rotation.z = 0.1; group.add(leftTusk);
      var rightTusk = leftTusk.clone(); rightTusk.position.x = 0.18; rightTusk.rotation.z = -0.1; group.add(rightTusk);

      var flLegPivot = new THREE.Group(); flLegPivot.position.set(-0.4, 0.55, 0.35);
      var flLeg = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), skinMat);
      flLeg.scale.set(0.95, 1.3, 0.95); flLeg.position.set(0, -0.2, -0.1); flLegPivot.add(flLeg); group.add(flLegPivot);

      var frLegPivot = new THREE.Group(); frLegPivot.position.set(0.4, 0.55, 0.35);
      var frLeg = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), skinMat);
      frLeg.scale.set(0.95, 1.3, 0.95); frLeg.position.set(0, -0.2, -0.1); frLegPivot.add(frLeg); group.add(frLegPivot);

      var blLegPivot = new THREE.Group(); blLegPivot.position.set(-0.4, 0.55, -0.35);
      var blLeg = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), skinMat);
      blLeg.scale.set(0.95, 1.3, 0.95); blLeg.position.set(0, -0.2, 0.1); blLegPivot.add(blLeg); group.add(blLegPivot);

      var brLegPivot = new THREE.Group(); brLegPivot.position.set(0.4, 0.55, -0.35);
      var brLeg = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), skinMat);
      brLeg.scale.set(0.95, 1.3, 0.95); brLeg.position.set(0, -0.2, 0.1); brLegPivot.add(brLeg); group.add(brLegPivot);

      group.userData.legs = { fl: flLegPivot, fr: frLegPivot, bl: blLegPivot, br: brLegPivot };

      var tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.45, 10), skinMat);
      tail.position.set(0, 0.95, -1.0); tail.rotation.x = Math.PI / 3; group.add(tail);
      var tailTuft = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), skinMat);
      tailTuft.position.set(0, 0.72, -1.18); group.add(tailTuft);

      return group;
    },

    _buildScene: function () {
      var self = this;
      var scene = this._scene;

      // 城市景观
      var cityscape = this._createCityscape();
      scene.add(cityscape);

      // 动物群
      var rabbit = this._createRabbit();
      this._addFaceOutlines(rabbit);
      rabbit.position.set(-3, 0.5, 2);
      scene.add(rabbit);
      this._animals.push({
        mesh: rabbit, baseY: 0.5, speed: 0.8, amplitude: 0.15,
        moveSpeed: 3.6, runCycle: 13, hopHeight: 0.42, swingAmplitude: 0.5,
        isMoving: false, startX: -3, startZ: 2, targetX: -3, targetZ: 2,
        moveTotal: 0, moveDone: 0, facing: 0
      });

      var fox = this._createFox();
      this._addFaceOutlines(fox);
      fox.position.set(3, 0.5, 2);
      scene.add(fox);
      this._animals.push({
        mesh: fox, baseY: 0.5, speed: 1.0, amplitude: 0.12,
        moveSpeed: 3.0, runCycle: 10, hopHeight: 0.22, swingAmplitude: 0.4,
        isMoving: false, startX: 3, startZ: 2, targetX: 3, targetZ: 2,
        moveTotal: 0, moveDone: 0, facing: 0
      });

      var sloth = this._createSloth();
      this._addFaceOutlines(sloth);
      sloth.position.set(-1, 0.2, 3.5);
      scene.add(sloth);
      this._animals.push({
        mesh: sloth, baseY: 0.2, speed: 0.5, amplitude: 0.08,
        moveSpeed: 0.9, runCycle: 2.4, hopHeight: 0.08, swingAmplitude: 0.25,
        isMoving: false, startX: -1, startZ: 3.5, targetX: -1, targetZ: 3.5,
        moveTotal: 0, moveDone: 0, facing: 0
      });

      var elephant = this._createElephant();
      this._addFaceOutlines(elephant);
      elephant.position.set(5, 0, 3);
      scene.add(elephant);
      this._animals.push({
        mesh: elephant, baseY: 0, speed: 0.6, amplitude: 0.1,
        moveSpeed: 1.6, runCycle: 4, hopHeight: 0.15, swingAmplitude: 0.3,
        isMoving: false, startX: 5, startZ: 3, targetX: 5, targetZ: 3,
        moveTotal: 0, moveDone: 0, facing: 0
      });

      // 云朵
      this._clouds = [];
      for (var i = 0; i < 8; i++) {
        var cloud = this._createCloud(-15 + i * 4 + Math.random() * 2, 5 + Math.random() * 2.5, -8 + Math.random() * 6);
        cloud.userData.speed = 0.2 + Math.random() * 0.3;
        scene.add(cloud);
        this._clouds.push(cloud);
      }

      // 灯光
      var ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);
      var directionalLight = new THREE.DirectionalLight(0xfff8e7, 0.9);
      directionalLight.position.set(5, 10, 5);
      scene.add(directionalLight);
      var hemiLight = new THREE.HemisphereLight(0x7fb8ec, 0x4a8a35, 0.5);
      scene.add(hemiLight);
    },

    _bindEvents: function () {
      var self = this;
      this._onMouseMove = function (e) {
        self._mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
        self._mouse.targetY = (e.clientY / window.innerHeight) * 2 - 1;
      };
      this._onClick = function (e) {
        if (e.target.closest('a, button, .proj-card, .post-item, input, .nav-inner, .section-head, .foot-inner, .hero-card, code, pre, .settings-panel, .settings-trigger, .weather-widget, .music-player, .avatar-section, .tags-container, .crop-modal, .toast, .lyrics-rain, .music-playlist-panel, .music-favorites-panel')) return;
        self._clickNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
        self._clickNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
        self._raycaster.setFromCamera(self._clickNDC, self._camera);
        var hit = new THREE.Vector3();
        if (!self._raycaster.ray.intersectPlane(self._groundPlane, hit)) return;
        hit.x = Math.max(-11, Math.min(11, hit.x));
        hit.z = Math.max(-5, Math.min(7, hit.z));
        var animal = self._animals[self._clickAnimalIdx];
        animal.isMoving = true;
        animal.startX = animal.mesh.position.x;
        animal.startZ = animal.mesh.position.z;
        animal.targetX = hit.x;
        animal.targetZ = hit.z;
        animal.moveTotal = Math.hypot(hit.x - animal.startX, hit.z - animal.startZ);
        animal.moveDone = 0;
        self._clickAnimalIdx = (self._clickAnimalIdx + 1) % self._animals.length;
      };
      this._onResize = function () {
        if (!self._camera || !self._renderer) return;
        self._camera.aspect = window.innerWidth / window.innerHeight;
        self._camera.updateProjectionMatrix();
        self._renderer.setSize(window.innerWidth, window.innerHeight, false);
      };
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('click', this._onClick);
      window.addEventListener('resize', this._onResize);
    },

    _animate: function (currentTime) {
      var self = this;
      this._raf = requestAnimationFrame(function (t) { self._animate(t); });
      if (!this._running || this._disposed) return;

      var delta = Math.min(0.05, (currentTime - this._lastTime) / 1000);
      this._lastTime = currentTime;
      var time = currentTime * 0.001;

      this._mouse.x += (this._mouse.targetX - this._mouse.x) * 0.05;
      this._mouse.y += (this._mouse.targetY - this._mouse.y) * 0.05;

      // 动物动画
      this._animals.forEach(function (animal, index) {
        var offset = index * Math.PI * 0.5;
        if (animal.isMoving && animal.moveTotal > 0.001) {
          var dx = animal.targetX - animal.startX;
          var dz = animal.targetZ - animal.startZ;
          animal.moveDone += delta * animal.moveSpeed;
          var t = Math.min(1, animal.moveDone / animal.moveTotal);
          var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          animal.mesh.position.x = animal.startX + dx * eased;
          animal.mesh.position.z = animal.startZ + dz * eased;
          var targetFacing = Math.atan2(dx, dz);
          var diff = targetFacing - animal.facing;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          animal.facing += diff * 0.12;
          animal.mesh.rotation.y = animal.facing;
          var hopPhase = time * animal.runCycle;
          animal.mesh.position.y = animal.baseY + Math.abs(Math.sin(hopPhase)) * animal.hopHeight;
          animal.mesh.rotation.x = -0.08;
          animal.mesh.rotation.z = Math.sin(hopPhase) * 0.04;
          var legs = animal.mesh.userData.legs;
          if (legs) {
            var swing = animal.swingAmplitude;
            legs.fl.rotation.x = Math.sin(hopPhase) * swing;
            legs.br.rotation.x = Math.sin(hopPhase) * swing;
            legs.fr.rotation.x = Math.sin(hopPhase + Math.PI) * swing;
            legs.bl.rotation.x = Math.sin(hopPhase + Math.PI) * swing;
          }
          animal.mesh.children.forEach(function (child) {
            if (child.isMesh && child.position.y > 1.2) {
              child.rotation.y += (0 - child.rotation.y) * 0.05;
            }
          });
          if (t >= 1) {
            animal.isMoving = false;
            animal.mesh.position.x = animal.targetX;
            animal.mesh.position.z = animal.targetZ;
          }
        } else {
          animal.mesh.position.y = animal.baseY + Math.sin(time * animal.speed + offset) * animal.amplitude;
          animal.mesh.rotation.z = Math.sin(time * animal.speed * 0.5 + offset) * 0.02;
          animal.mesh.rotation.x += (0 - animal.mesh.rotation.x) * 0.05;
          var legs2 = animal.mesh.userData.legs;
          if (legs2) {
            legs2.fl.rotation.x += (0 - legs2.fl.rotation.x) * 0.15;
            legs2.fr.rotation.x += (0 - legs2.fr.rotation.x) * 0.15;
            legs2.bl.rotation.x += (0 - legs2.bl.rotation.x) * 0.15;
            legs2.br.rotation.x += (0 - legs2.br.rotation.x) * 0.15;
          }
          animal.mesh.children.forEach(function (child) {
            if (child.isMesh && child.position.y > 1.2) {
              var targetRotationY = self._mouse.x * 0.15;
              child.rotation.y += (targetRotationY - child.rotation.y) * 0.03;
            }
          });
        }
      });

      // 云朵飘动
      this._clouds.forEach(function (cloud) {
        cloud.position.x += cloud.userData.speed * delta * 0.5;
        if (cloud.position.x > 18) cloud.position.x = -18;
      });

      // 相机轻微跟随
      this._camera.position.x += (this._mouse.x * 1.5 - this._camera.position.x) * 0.02;
      this._camera.position.y += (2 + this._mouse.y * 0.5 - this._camera.position.y) * 0.02;
      this._camera.lookAt(0, 1, 0);

      this._renderer.render(this._scene, this._camera);
    },

    start: function () {
      if (!this._renderer || this._running) return;
      this._running = true;
      this._lastTime = performance.now();
      this._animate(this._lastTime);
    },

    stop: function () {
      this._running = false;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
    },

    show: function () {
      if (this._canvas) this._canvas.style.display = 'block';
      if (!this._renderer) this.init('bgSceneCanvas');
      this.start();
    },

    hide: function () {
      this.stop();
      if (this._canvas) this._canvas.style.display = 'none';
    },

    dispose: function () {
      this.stop();
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('click', this._onClick);
      window.removeEventListener('resize', this._onResize);
      if (this._scene) {
        this._scene.traverse(function (obj) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
            else obj.material.dispose();
          }
        });
        this._scene = null;
      }
      if (this._renderer) {
        this._renderer.dispose();
        this._renderer = null;
      }
      this._animals = [];
      this._clouds = [];
      this._disposed = true;
    }
  };

  window.ZootopiaBG = ZootopiaBG;
})();
