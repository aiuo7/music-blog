/* ================================================================
   公开配置文件 — 所有访客都会加载这份配置
   ----------------------------------------------------------------
   把你的头像、背景、音乐文件放到 assets/ 对应文件夹里，
   然后修改下面的配置即可。所有人打开网页都会看到同样的内容。
   ================================================================ */

/* ================================================================
   Supabase 云端配置（复用 music-homepage 项目）
   - 图片/音乐上传到云端 Storage（avatar/background/audi 桶）
   - 设置持久化到 profiles 表的 music_playlist 字段
     （固定 id='my_blog_settings' 的单条共享记录，无需登录）
   ================================================================ */
const SUPABASE_URL = 'https://nolkjvpcnqkduqpbqiay.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QehMPorzx57bvnLSgaI74A_QH3Af4oJ';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

window.PUBLIC_CONFIG = {

  /* ===== 背景 ===== */
  background: {
    // type 可选: 'zootopia'(肖老师的卡通动画3D动态背景-默认) | 'gradient'(动态渐变) | 'color'(纯色) | 'image'(图片) | 'video'(视频)
    type: 'zootopia',
    color: '#000000',
    // 如果用图片，把图片放到 assets/background/ 里，然后写路径：
    image: '',
    // 如果用视频，把视频放到 assets/background/ 里：
    video: ''
  },

  /* ===== 头像 ===== */
  avatar: {
    // 把你的头像图片放到 assets/avatar/ 里，然后写路径：
    src: 'assets/avatar/me.jpg',
    frame: 'frame-glow',       // 边框样式: frame-default/frame-glow/frame-gold/frame-rainbow/frame-rotate/frame-neon/frame-petal
    customFrame: '',
    opacity: 0.85
  },

  /* ===== 昵称 ===== */
  nickname: {
    text: '肖老师做的卡通动画',           // ← 改成你的名字
    font: "'STHeiti','SimHei',sans-serif",
    size: 28, color: '#ffffff', weight: 'bold',
    gradient: { enabled: true, color1: '#64c8ff', color2: '#a55eea', color3: '#ff6b6b', animated: true }
  },

  /* ===== 个性签名 ===== */
  signature: {
    text: '欢迎来到我的个人空间',  // ← 改成你的签名
    font: "'STHeiti','SimHei',sans-serif", size: 15, color: '#ffffff', weight: 'normal',
    gradient: { enabled: false, color1: '#64c8ff', color2: '#a55eea', color3: '#ff6b6b', animated: true },
    effect: 'fade'
  },

  /* ===== 天气 ===== */
  weather: {
    enabled: true, temp: 22, region: '北京', type: 'fireworks', size: 1.2,
    aqi: '空气优 32', humidity: 60
  },

  /* ===== 音乐 ===== */
  music: {
    // 在线搜索 API 基地址（server.js 多平台聚合接口，仅取 origin 部分）：
    // 前端调用 /api/search /api/audio /api/lyrics，需对应服务器已部署聚合端点
    // 例：'http://127.0.0.1:9123' （路径前缀如 /api/netease-music 会被忽略，仅用 origin）
    // 留空 '' 则关闭在线搜索
    apiBase: '',
    tracks: [
      // 你的音乐文件已放到 assets/music/ 里
      { name: 'Back to You', artist: 'VØRTEX', src: 'assets/music/back-to-you.mp3', cover: '' },
      // 备用在线音乐（网络不稳定时自动切换）
      { name: 'SoundHelix Song 1', artist: 'SoundHelix', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', cover: '' }
    ],
    currentIndex: 0, playing: false, lyricsRain: false, lyrics: '', speed: 1.0, autoplay: false
  },

  /* ===== 背景轮播 ===== */
  carousel: {
    // 把多张图片放到 assets/background/ 里即可开启轮播：
    // items: ['assets/background/1.jpg','assets/background/2.jpg'],
    items: [], enabled: false, speed: 5
  }
};
