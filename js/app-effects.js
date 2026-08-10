/* ============================================================
   app-effects.js — 视觉特效模块
   ----------------------------------------------------------------
   Three.js 引擎集成、实时时钟、3D 鼠标视差、水面倒影、微光粒子、
   Supabase 上传、头像裁剪、自定义边框。
   （原 2D 天气画布特效已废弃并移除，天气统一由 Three.js 渲染）
   ============================================================ */
'use strict';
/* ================================================================
   Three.js 3D 特效引擎集成
================================================================ */
let threeEffectsInited = false;

function initThreeEffects() {
  if (threeEffectsInited) return;
  if (!window.ThreeEffectsEngine) { console.warn('ThreeEffectsEngine not loaded'); return; }
  const ok = window.ThreeEffectsEngine.init('ambientCanvas');
  if (!ok) return;
  threeEffectsInited = true;
  // 窗口大小变化 + 移动端横竖屏切换
  window.addEventListener('resize', () => { window.ThreeEffectsEngine.resize(); });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { window.ThreeEffectsEngine.resize(); }, 200);
  });
}

function startThreeEffects() {
  if (!threeEffectsInited || !window.ThreeEffectsEngine) return;
  // 开启粒子增强：更密集的星空 / 微光 / 水母 / 鱼群
  window.ThreeEffectsEngine.setParticleBoost(true);
  window.ThreeEffectsEngine.start();
  // 启动后统一设置初始特效（applyAllSettings 在 init 之前调用过，此时引擎才就绪）
  // 天气关闭时不渲染任何环境特效
  const weatherType = settings.weather.enabled ? settings.weather.type : null;
  switchThreeEffect(weatherType);
}

function stopThreeEffects() {
  if (!threeEffectsInited || !window.ThreeEffectsEngine) return;
  window.ThreeEffectsEngine.stop();
}

function switchThreeEffect(type) {
  if (!threeEffectsInited || !window.ThreeEffectsEngine) return;
  const engine = window.ThreeEffectsEngine;

  // 页面始终有可见背景（默认3D动物城 或 静态/动态自定义背景），
  // 特效统一以「无天空叠加层」渲染：不渲染自带天空穹顶，不遮挡/替换背景。
  engine.setSkyless(true);

  // 星空亮度按背景适配：动物城为白昼场景 → 完全关闭；
  // 静态/动态自定义背景 → 保留极轻微星光点缀，不抢背景。
  const starDim = settings.background.type === 'zootopia' ? 0.0 : 0.12;
  engine.setStarTarget(starDim);

  // 天气关闭：清除所有环境/天气特效，仅保留背景
  if (!type || type === 'off') {
    engine.setEffect(null);
    engine.setWeather(null);
    return;
  }

  // 全部特效均为透明叠加层，可与任何背景共存
  const allTypes = ['fireworks', 'dandelion', 'raindrop', 'aurora', 'jellyfish', 'fish', 'sparkle', 'nebula', 'crystals', 'bioluminescence', 'deepsea'];
  if (allTypes.indexOf(type) >= 0) {
    engine.setEffect(type);
  } else {
    engine.setEffect('deepsea');
  }
  engine.setWeather(null);
}

/* ================================================================
   深空星空 + 环境粒子特效已全部迁移至 Three.js (three-effects.js)。
   starfieldMouseX/Y 保留供视差使用。
================================================================ */
let starfieldMouseX = 0, starfieldMouseY = 0;

/* ================================================================
   实时时钟
================================================================ */
let clockIntervalId = null;

function startClock() {
  stopClock();
  const update = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const timeEl = $('clockTime');
    const secEl = $('clockSeconds');
    const dateEl = $('clockDate');
    if (timeEl) timeEl.textContent = h + ':' + m;
    if (secEl) secEl.textContent = s;
    if (dateEl) {
      const days = ['日','一','二','三','四','五','六'];
      const month = now.getMonth() + 1;
      const date = now.getDate();
      const day = days[now.getDay()];
      dateEl.textContent = month + '月' + date + '日 星期' + day;
    }
  };
  update();
  clockIntervalId = setInterval(update, 1000);
}

function stopClock() {
  if (clockIntervalId) clearInterval(clockIntervalId);
  clockIntervalId = null;
}

/* ================================================================
   3D鼠标视差
================================================================ */
let parallaxInited = false;
function initParallax() {
  if (parallaxInited) return;
  parallaxInited = true;
  const root = document.documentElement;
  window.addEventListener('mousemove', e => {
    const mx = (e.clientX / window.innerWidth - 0.5);
    const my = (e.clientY / window.innerHeight - 0.5);
    root.style.setProperty('--mx', mx.toFixed(4));
    root.style.setProperty('--my', my.toFixed(4));
    starfieldMouseX = mx;
    starfieldMouseY = my;
    // 同步鼠标到 Three.js 引擎（归一化到 -1..1，Y 轴上为正）
    if (window.ThreeEffectsEngine) window.ThreeEffectsEngine.setMouse(mx * 2, -my * 2);
  });
}

/* ================================================================
   Supabase Storage 上传助手
================================================================ */
async function uploadAsset(blob, bucket, ext) {
  if (!supabaseClient) throw new Error('未连接云端');
  const safeExts = ['jpg','jpeg','png','gif','webp','bmp','mp3','wav','ogg','flac','m4a','aac','mp4','webm','mov'];
  const safeExt = safeExts.includes(ext) ? ext : 'bin';
  const path = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + safeExt;
  const { error } = await supabaseClient.storage.from(bucket).upload(path, blob, { upsert: true });
  if (error) throw error;
  return supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

function getFileExt(file) {
  return (file.name.split('.').pop() || '').toLowerCase();
}

/* ================================================================
   头像上传与裁剪
================================================================ */
function handleAvatarUpload(file) {
  const reader = new FileReader();
  reader.onload = e => {
    cropState.originalFile = file;
    openCropModal(e.target.result, file.type === 'image/gif');
  };
  reader.readAsDataURL(file);
}

function openCropModal(src, isGif) {
  const modal = $('cropModal');
  const canvas = $('cropCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 300;
  canvas.height = 300;
  modal.classList.add('show');

  const img = new Image();
  img.onload = () => {
    cropState.img = img;
    cropState.isGif = isGif;
    const scale = Math.max(300 / img.width, 300 / img.height);
    cropState.scale = scale;
    cropState.x = (300 - img.width * scale) / 2;
    cropState.y = (300 - img.height * scale) / 2;
    drawCrop();
  };
  img.src = src;
}

function drawCrop() {
  const canvas = $('cropCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 300, 300);
  if (cropState.img) {
    ctx.drawImage(cropState.img, cropState.x, cropState.y, cropState.img.width * cropState.scale, cropState.img.height * cropState.scale);
  }
}

function initCropDrag() {
  const canvas = $('cropCanvas');
  canvas.addEventListener('mousedown', e => { cropState.dragging = true; cropState.lastX = e.clientX; cropState.lastY = e.clientY; });
  canvas.addEventListener('touchstart', e => { cropState.dragging = true; cropState.lastX = e.touches[0].clientX; cropState.lastY = e.touches[0].clientY; });
  window.addEventListener('mousemove', e => {
    if (!cropState.dragging) return;
    cropState.x += e.clientX - cropState.lastX;
    cropState.y += e.clientY - cropState.lastY;
    cropState.lastX = e.clientX;
    cropState.lastY = e.clientY;
    drawCrop();
  });
  window.addEventListener('touchmove', e => {
    if (!cropState.dragging) return;
    cropState.x += e.touches[0].clientX - cropState.lastX;
    cropState.y += e.touches[0].clientY - cropState.lastY;
    cropState.lastX = e.touches[0].clientX;
    cropState.lastY = e.touches[0].clientY;
    drawCrop();
  });
  window.addEventListener('mouseup', () => cropState.dragging = false);
  window.addEventListener('touchend', () => cropState.dragging = false);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    cropState.scale *= delta;
    drawCrop();
  });
}

async function confirmCrop() {
  const canvas = $('cropCanvas');
  const out = document.createElement('canvas');
  out.width = 256;
  out.height = 256;
  const octx = out.getContext('2d');
  octx.save();
  octx.beginPath();
  octx.arc(128, 128, 128, 0, Math.PI * 2);
  octx.clip();
  octx.drawImage(canvas, 0, 0, 300, 300, 0, 0, 256, 256);
  octx.restore();

  toast('上传中...');
  try {
    if (cropState.isGif && cropState.originalFile) {
      const url = await uploadAsset(cropState.originalFile, 'avatar', getFileExt(cropState.originalFile));
      settings.avatar.src = url;
    } else {
      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      const url = await uploadAsset(blob, 'avatar', 'png');
      settings.avatar.src = url;
    }
    applyAvatar();
    $('cropModal').classList.remove('show');
    toast('头像已更新');
  } catch (e) {
    toast('上传失败：' + (e.message || ''));
  }
}

/* ================================================================
   自定义头像边框（智能识别）
================================================================ */
async function handleCustomFrameUpload(file) {
  toast('上传中...');
  try {
    const url = await uploadAsset(file, 'avatar', getFileExt(file));
    const img = new Image();
    img.onload = () => {
      settings.avatar.customFrame = url;
      settings.avatar.frame = 'frame-custom';
      const selector = $('set_avatarFrame');
      if (selector) selector.value = 'frame-custom';
      $('customFrameRow').style.display = 'flex';
      const ratio = img.width / img.height;
      let shapeMsg;
      if (Math.abs(ratio - 1) < 0.15) {
        shapeMsg = '圆形/方形边框';
      } else if (ratio > 1.3) {
        shapeMsg = '宽幅装饰边框';
      } else if (ratio < 0.77) {
        shapeMsg = '竖幅装饰边框';
      } else {
        shapeMsg = '自定义边框';
      }
      applyAvatar();
      toast(`智能识别：${shapeMsg}，已自动应用`);
    };
    img.src = url;
  } catch (e) {
    toast('上传失败：' + (e.message || ''));
  }
}

