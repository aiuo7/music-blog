/* ============================================================
   app-core.js — 核心模块
   ----------------------------------------------------------------
   常量、全局状态、工具函数、设置持久化（Supabase+本地）、页面生命周期。
   必须最先加载（其它模块依赖此处声明的全局状态与常量）。
   ============================================================ */
'use strict';

/* ---------- 设置版本（用于localStorage迁移） ---------- */
const SETTINGS_VERSION = '20260807v1';

/* ---------- 默认配置 ---------- */
const DEFAULT_SETTINGS = {
  background: { type: 'zootopia', color: '#000000', image: '', video: '' },
  avatar: { src: '', frame: 'frame-glow', customFrame: '', opacity: 0.85 },
  nickname: {
    text: '肖老师做的卡通动画',
    font: "'STHeiti','SimHei',sans-serif",
    size: 28, color: '#ffffff', weight: 'bold',
    gradient: { enabled: true, color1: '#64c8ff', color2: '#a55eea', color3: '#ff6b6b', animated: true }
  },
  signature: {
    text: '欢迎来到我的个人空间',
    font: "'STHeiti','SimHei',sans-serif", size: 15, color: '#ffffff', weight: 'normal',
    gradient: { enabled: false, color1: '#64c8ff', color2: '#a55eea', color3: '#ff6b6b', animated: true },
    effect: 'fade'
  },
  weather: { enabled: true, temp: 22, region: '北京', type: 'fireworks', size: 1.2, aqi: '空气优 32', humidity: 60 },
  music: {
    tracks: [
      { name: 'SoundHelix Song 1', artist: 'SoundHelix', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', cover: '' },
      { name: 'SoundHelix Song 2', artist: 'SoundHelix', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', cover: '' }
    ],
    currentIndex: 0, playing: false, playMode: 'list', lyricsRain: false, lyrics: '', speed: 1.0, autoplay: false,
    volume: 0.8, muted: false,
    favorites: [] // 收藏歌单夹：[{name:'歌单名', songs:[track, ...]}]
  },
  carousel: { items: [], enabled: false, speed: 5 }
};

/* 天气类型（无表情包） */
const WEATHER_TYPES = {
  fireworks: { label: '璀璨烟花' },
  dandelion: { label: '蒲公英' },
  raindrop:  { label: '玻璃雨滴' },
  aurora:   { label: '极光' },
  jellyfish:{ label: '深海水母' },
  fish:     { label: '游鱼群' },
  sparkle:  { label: '微光粒子' },
  deepsea:  { label: '深海沉浸' }
};

/* 雪花强度循环：小雪 → 中雪 → 大雪 → 小雪 */
const WEATHER_SVG_ICONS = {
  fireworks:'<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none"><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4" stroke="rgba(255,180,100,0.6)" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="rgba(255,200,120,0.7)"/></svg>',
  dandelion:'<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none"><circle cx="12" cy="12" r="1.5" fill="rgba(255,255,255,0.5)"/><path d="M12 10.5V4M12 13.5V20M10.5 12H4M13.5 12H20M8 8l3 3M16 16l-3-3M8 16l3-3M16 8l-3 3" stroke="rgba(255,255,255,0.3)" stroke-width="0.8" stroke-linecap="round"/></svg>',
  raindrop: '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:rgba(150,200,255,0.4)"><path d="M12 3s-6 8-6 12a6 6 0 0012 0c0-4-6-12-6-12z"/></svg>',
  aurora:   '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none"><path d="M2 16c4-6 8-6 10-2s6 4 10-2" stroke="rgba(100,200,255,0.6)" stroke-width="2" stroke-linecap="round"/><path d="M2 20c4-4 8-4 10 0s6 2 10-4" stroke="rgba(180,130,255,0.4)" stroke-width="1.5" stroke-linecap="round"/></svg>',
  jellyfish:'<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:rgba(180,200,255,0.5)"><ellipse cx="12" cy="9" rx="7" ry="5"/><path d="M7 13c-1 3-2 5-1 7M10 13v8M14 13v8M17 13c1 3 2 5 1 7" stroke="rgba(180,200,255,0.4)" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>',
  fish:     '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:rgba(120,180,220,0.6)"><path d="M3 12c3-4 8-4 11 0c-3 4-8 4-11 0z"/><path d="M14 12l4-3v6z"/><circle cx="6" cy="11" r="0.8" fill="rgba(255,255,255,0.8)"/></svg>',
  sparkle:  '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:rgba(255,255,220,0.6)"><path d="M12 3l1.5 6L20 10l-6 1.5L12 18l-1.5-6L4 10l6-1.5z"/></svg>',
  deepsea:  '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none"><path d="M2 14c3-2 7-2 10 0s7 2 10-1" stroke="rgba(120,200,220,0.6)" stroke-width="1.5" stroke-linecap="round"/><path d="M2 18c3-2 7-2 10 0s7 2 10-1" stroke="rgba(100,180,210,0.45)" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="12" cy="7" rx="4" ry="2.6" fill="rgba(150,190,230,0.5)"/><path d="M9 9c-0.5 2-1 3-0.5 4M12 9v4M15 9c0.5 2 1 3 0.5 4" stroke="rgba(150,190,230,0.4)" stroke-width="1.2" stroke-linecap="round"/></svg>'
};

/* 丰富字体选项（含艺术字体） */
const FONT_OPTIONS = [
  { v: "'STHeiti','SimHei',sans-serif", l: '黑体(默认)' },
  { v: "'PingFang SC','Microsoft YaHei',sans-serif", l: '苹方' },
  { v: "'STKaiti','KaiTi',serif", l: '楷体' },
  { v: "'STSong','SimSun',serif", l: '宋体' },
  { v: "'Georgia',serif", l: 'Georgia' },
  { v: "'Courier New',monospace", l: '等宽' },
  { v: "'Comic Sans MS',cursive", l: '手写' },
  { v: "'Playfair Display',serif", l: 'Playfair (优雅衬线)' },
  { v: "'Lobster',cursive", l: 'Lobster (装饰)' },
  { v: "'Pacifico',cursive", l: 'Pacifico (波浪)' },
  { v: "'Dancing Script',cursive", l: 'Dancing Script (舞蹈)' },
  { v: "'Cinzel',serif", l: 'Cinzel (古典)' },
  { v: "'Bebas Neue',sans-serif", l: 'Bebas Neue (窄体)' },
  { v: "'Great Vibes',cursive", l: 'Great Vibes (花体)' },
  { v: "'Anton',sans-serif", l: 'Anton (粗黑)' },
  { v: "'Caveat',cursive", l: 'Caveat (随性)' },
  { v: "'Press Start 2P',cursive", l: '像素体' },
  { v: "'ZCOOL KuaiLe',cursive", l: 'ZCOOL快乐体' },
  { v: "'ZCOOL XiaoWei',serif", l: 'ZCOOL小薇体' },
  { v: "'Ma Shan Zheng',cursive", l: '马善政楷书' },
  { v: "'Long Cang',cursive", l: '龙藏体' },
  { v: "'Liu Jian Mao Cao',cursive", l: '柳建毛草' }
];

const EFFECT_OPTIONS = [
  { v: 'none', l: '无' },
  { v: 'typewriter', l: '打字机' },
  { v: 'bounce', l: '弹动' },
  { v: 'jump', l: '跳跃' },
  { v: 'fade', l: '渐隐渐现' },
  { v: 'wave', l: '波动' }
];

const FRAME_OPTIONS = [
  { v: 'frame-default', l: '默认' },
  { v: 'frame-glow', l: '冰蓝光晕' },
  { v: 'frame-gold', l: '金色光晕' },
  { v: 'frame-rainbow', l: '彩虹边框' },
  { v: 'frame-rotate', l: '流光旋转' },
  { v: 'frame-neon', l: '霓虹光环' },
  { v: 'frame-petal', l: '花瓣边框' },
  { v: 'frame-custom', l: '自定义边框' }
];

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

/* ---------- 状态 ---------- */
let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let audioPlayer = new Audio();
// 不设置 crossOrigin，允许播放所有来源的音频（iTunes 等非CORS源也能正常播放）
let audioContext = null;
let analyser = null;
let dataSource = null;
let weatherAnimId = null;
let weatherParticles = [];
let lyricsRainTimer = null;
let lyricsFetching = false; // 标记正在获取新歌词，防止旧歌词在切换中间被重新启用
let currentLyricsTrackId = null; // 当前正在获取歌词的曲目标识，防止快速切换时旧歌词覆盖新歌词
let carouselIndex = 0;
let carouselTimer = null;
let cropState = { img: null, x: 0, y: 0, scale: 1, dragging: false, lastX: 0, lastY: 0 };
let visualizerAnimId = null;
let vinylAngle = 0;
let vinylAnimId = null;
let lastVinylTime = 0;
let consecutiveAudioErrors = 0;

/* ---------- 播放器错误日志缓冲（便于排查） ----------
   记录最近 50 条播放器相关错误/警告，按时间倒序。
   可通过控制台 playerErrorLog 查看，或在快捷键面板里展示。 */
window.playerErrorLog = [];
function logPlayerError(type, detail) {
  const entry = {
    time: new Date().toISOString(),
    type: type, // 'load' | 'network' | 'decode' | 'permission' | 'search' | 'other'
    detail: detail || ''
  };
  window.playerErrorLog.unshift(entry);
  if (window.playerErrorLog.length > 50) window.playerErrorLog.length = 50;
  console.warn('[player-error]', entry.type, entry.detail);
}

/* ---------- 播放列表去重工具 ----------
   按 src（本地/在线音频地址）+ name 联合判定，避免同一首歌重复入列表。
   返回 true 表示已存在（已跳过添加），false 表示不存在。 */
function isTrackInPlaylist(track, list) {
  if (!track || !list || !Array.isArray(list)) return false;
  const src = String(track.src || '');
  const name = String(track.name || '').trim();
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (src && String(t.src || '') === src) return true;
    if (name && String(t.name || '').trim() === name && String(t.artist || '') === String(track.artist || '')) return true;
  }
  return false;
}

/* ---------- 歌词系统 ---------- */
let currentLrcLines = [];   // [{time:秒, text:'歌词'}]
let currentLrcIndex = -1;
let lrcSyncRAF = null;
let progressRAF = null;
let isDraggingProgress = false;

/* ---------- 心跳律动 ---------- */
let heartbeatAnimId = null;
let heartbeatCanvas = null;
let heartbeatCtx = null;

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/* 递归深度合并 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  if (!target || typeof target !== 'object') return source;
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/* ================================================================
   设置持久化（Supabase 云端 + 本地默认值）
================================================================ */

function loadUserSettings() {
  // 合并默认值 + PUBLIC_CONFIG 作为即时渲染基础（不白屏）
  settings = deepMerge(deepClone(DEFAULT_SETTINGS), window.PUBLIC_CONFIG || {});
}

async function loadCloudSettings() {
  if (!supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient
      .from('blog_settings')
      .select('music_playlist')
      .eq('id', 'my_blog_settings')
      .maybeSingle();
    if (error) throw error;
    if (data && data.music_playlist && typeof data.music_playlist === 'object') {
      settings = deepMerge(deepClone(DEFAULT_SETTINGS), deepMerge(window.PUBLIC_CONFIG || {}, data.music_playlist));
      // 版本迁移：旧设置可能携带 autoplay=true / 旧特效类型 / 非纯黑背景，强制覆盖为新默认
      if (!data.music_playlist._v || data.music_playlist._v !== SETTINGS_VERSION) {
        settings.music.autoplay = false;
        settings.background.type = 'zootopia';
        settings.background.color = '#000000';
        settings.background.image = '';
        settings.background.video = '';
        settings.weather.type = 'fireworks';
        // 迁移默认昵称：仅当用户仍使用旧默认值时更新为新默认值
        if (settings.nickname.text === '我的主页' || !settings.nickname.text) {
          settings.nickname.text = '肖老师做的卡通动画';
        }
      }
      return true;
    }
    return false;
  } catch (e) {
    console.warn('云端设置加载失败:', e.message || e);
    return false;
  }
}

async function saveUserSettings(silent) {
  if (!supabaseClient) { if (!silent) toast('未连接云端，无法保存'); return; }
  if (!silent) toast('保存中...');
  try {
    // 保存完整设置（含在线歌曲元数据：歌名、URL、封面等，不存储音频文件本身）
    const settingsToSave = deepClone(settings);
    // 清除不需要持久化的运行时状态
    if (settingsToSave.music) {
      settingsToSave.music.playing = false;
    }
    // 写入设置版本号，用于后续迁移判断
    settingsToSave._v = SETTINGS_VERSION;
    const { error } = await supabaseClient
      .from('blog_settings')
      .upsert({ id: 'my_blog_settings', music_playlist: settingsToSave });
    if (error) throw error;
    if (!silent) toast('设置已保存到云端');
  } catch (e) {
    if (!silent) toast('保存失败：' + (e.message || ''));
  }
}

/* 音乐列表自动保存（防抖，静默） */
let musicSaveTimer = null;
function autoSaveMusic() {
  if (musicSaveTimer) clearTimeout(musicSaveTimer);
  musicSaveTimer = setTimeout(() => saveUserSettings(true), 1200);
}

/* ---------- 全局加载动效（云端设置加载完成前显示） ---------- */
function showPageLoader() {
  const el = $('pageLoader');
  if (el) el.classList.remove('hide');
}
function hidePageLoader() {
  const el = $('pageLoader');
  if (el) el.classList.add('hide');
}

async function enterMainPage() {
  // 1. 显示加载动效（云端设置加载完成前，禁止展示占位字段填充）
  showPageLoader();
  // 2. 即时默认渲染（不白屏，期间被加载动效覆盖）
  loadUserSettings();
  applyAllSettings();
  buildSettingsPanel();
  initThreeEffects();
  startClock();
  initParallax();
  // 遗留 2D 天气画布已废弃，天气特效统一由 Three.js 引擎渲染（ambientCanvas）
  var legacyWeatherCanvas = $('weatherCanvas');
  if (legacyWeatherCanvas) legacyWeatherCanvas.style.display = 'none';
  initVisualizer();
  initHeartbeat();
  initProgressDrag();
  startThreeEffects();

  // 3. 异步拉取云端设置覆盖（带超时兜底，避免加载动效一直挂起）
  try {
    const hasCloud = await Promise.race([
      loadCloudSettings(),
      new Promise(resolve => setTimeout(() => resolve(false), 8000))
    ]);
    if (hasCloud) {
      applyAllSettings();
      buildSettingsPanel();
    }
  } finally {
    hidePageLoader();
  }

  // 4. 尝试自动播放音乐（浏览器可能阻止，需首次交互）
  if (settings.music.tracks.length > 0 && settings.music.autoplay) {
    tryAutoPlayMusic();
  }

  // 5. 显示首次使用引导（仅在未配置头像时）
  if (settings.avatar.src === '') {
    setTimeout(() => showFirstUseGuide(), 1200);
  }
}

// 播放/暂停 SVG 图标
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

// 播放模式 SVG 图标（简约线性风格）
const ICON_MODE_LIST = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
const ICON_MODE_SINGLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="16" font-size="8" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif" font-weight="600">1</text></svg>';
const ICON_MODE_SHUFFLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
const MODE_ICONS = { list: ICON_MODE_LIST, single: ICON_MODE_SINGLE, shuffle: ICON_MODE_SHUFFLE };

function setPlayIcon(playing) {
  $('musicPlay').innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

function tryAutoPlayMusic() {
  // 浏览器自动播放策略：直接尝试播放，失败则等待首次交互
  audioPlayer.src = settings.music.tracks[settings.music.currentIndex].src;
  audioPlayer.playbackRate = settings.music.speed || 1.0;
  // 先初始化 AudioContext，确保音频路由正确（避免跨域音频被静音）
  if (!audioContext) { setupAudioContext(); }
  if (audioContext && audioContext.state === 'suspended') audioContext.resume();
  audioPlayer.play().then(() => {
    $('vinylRecord').classList.add('playing');
    const leftAlbum = $('musicAlbum');
    if (leftAlbum) leftAlbum.classList.add('playing');
    setPlayIcon(true);
    startVisualizer();
    startVinylRotation();
  }).catch(() => {
    // 自动播放被阻止，监听首次交互后播放
    const playOnInteract = () => {
      if (settings.music.tracks.length > 0 && audioPlayer.paused) {
        playMusic();
      }
      document.removeEventListener('click', playOnInteract);
      document.removeEventListener('keydown', playOnInteract);
      document.removeEventListener('touchstart', playOnInteract);
    };
    document.addEventListener('click', playOnInteract, { once: true });
    document.addEventListener('keydown', playOnInteract, { once: true });
    document.addEventListener('touchstart', playOnInteract, { once: true });
  });
}

function showFirstUseGuide() {
  toast('点击页面任意位置即可播放音乐 · 右上角齿轮可导入你的头像、背景和音乐');
}

async function resetToDefault() {
  if (!confirm('确定要重置所有设置为默认值吗？此操作不可撤销。')) return;
  // 遗留 2D 天气动画已废弃，天气特效由 Three.js 引擎管理
  stopLyricsRain();
  stopCarouselAuto();
  stopVisualizer();
  if (audioPlayer) { audioPlayer.pause(); }
  settings = deepMerge(deepClone(DEFAULT_SETTINGS), window.PUBLIC_CONFIG || {});
  applyAllSettings();
  buildSettingsPanel();
  toast('已重置为默认设置，正在同步到云端...');
  await saveUserSettings();
}

