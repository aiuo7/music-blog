# 个人主页 (My Blog)

一个精致的个人主页，前端纯原生 JS/CSS 实现，无需任何构建工具；后端附带一个零依赖的 Node.js 服务器，承担静态文件服务和多平台音乐聚合 API。融合了音乐播放、天气特效、水中倒影、3D 动态背景、动态渐变等多种视觉效果。

## ✨ 特性

- 🎨 **精美视觉** - 玻璃拟态 (Glassmorphism) UI 设计，支持动态渐变文字
- 🖼️ **自定义背景** - 支持 3D 动画 / 渐变 / 纯色 / 图片 / 视频 / 胶片轮播 6 种背景模式
- 👤 **个性头像** - 8 种预设边框样式（冰蓝光晕、金色光晕、彩虹、霓虹光环、花瓣等），支持自定义边框和图片裁剪
- 🎵 **音乐播放器** - 底部黑胶风格播放器，支持本地导入、多平台聚合搜索、倍速播放、歌词雨、音波可视化
- 🔎 **多平台音乐聚合** - 服务端聚合网易云 / 酷我，统一 schema 输出，自动过滤 VIP/无版权，跨平台去重
- 🌤️ **天气特效** - 9 种天气类型（晴/雨/云/阴/暴雨/雪等），Canvas 粒子动画
- 🌊 **水中倒影** - 页面底部 3D 水面折射倒影，支持波纹动画和微光上飘效果
- 🎆 **3D 动态背景** - 基于 Three.js 的疯狂动物城卡通动画背景与深空星空粒子
- 🏷️ **泡泡标签** - 浮动个性标签，带图标和动态渐变
- ✍️ **个性签名** - 6 种动效（打字机/弹动/跳跃/渐隐/波动），支持渐变文字
- ⚙️ **可视化设置** - 侧边栏设置面板，实时预览所有配置，支持 Supabase 云端同步
- 📱 **响应式适配** - 完美适配桌面端和移动端

## 🚀 快速开始

### 方式一：Node.js 服务器（推荐，启用多平台音乐搜索）

项目根目录下的 [server.js](server.js) 同时提供静态文件服务和多平台音乐聚合 API（仅依赖 Node.js 内置模块，零安装）：

```bash
node server.js
# 默认监听 http://127.0.0.1:9123
# 可通过 PORT 环境变量改端口：PORT=8080 node server.js
```

然后在 [js/config.js](js/config.js) 中把 `music.apiBase` 指向该服务器（例如 `http://127.0.0.1:9123`），即可使用 `/api/search`、`/api/audio`、`/api/lyrics` 等聚合端点。

### 方式二：纯静态服务器（仅本地音乐可用）

若不需要在线搜索，使用任意静态文件服务器启动即可：

```bash
# Python 3
python -m http.server 8080

# Node.js (需安装 serve)
npx serve .

# VS Code
# 使用 Live Server 插件右键 index.html -> Open with Live Server
```

然后在浏览器访问 `http://localhost:8080`。

## 📁 目录结构

```
blog/
├── index.html                # 主页面入口
├── server.js                 # ⭐ Node.js 服务器（静态服务 + 多平台音乐聚合 API）
├── favicon.ico
├── supabase_setup.sql        # Supabase 云端存储建表脚本
├── css/
│   ├── styles-base.css       # 全局基础样式
│   └── styles-music.css      # 音乐播放器样式
├── js/
│   ├── config.js            # ⭐ 公开配置文件（所有访客共享）
│   ├── app-core.js          # 核心逻辑（DOM、初始化、状态）
│   ├── app-settings.js      # 设置面板（自定义 select / 颜色选择器）
│   ├── app-effects.js       # 视觉特效（天气、倒影、签名、标签）
│   ├── app-music.js         # 音乐播放器（黑胶、歌词、可视化）
│   ├── app-search.js        # 在线搜索 / 播放列表 / 收藏歌单 / 事件入口
│   ├── three-effects.js     # Three.js 3D 粒子特效
│   ├── zootopia-bg.js       # 疯狂动物城 3D 动态背景
│   └── water3d.js            # 3D 水面折射
├── assets/                   # 资源目录
│   ├── avatar/              # 头像图片 (jpg/png/gif)
│   │   └── me.jpg
│   ├── background/          # 背景图片/视频
│   │   └── beijing.png
│   ├── music/               # 音乐文件 (mp3/wav/ogg)
│   │   └── back-to-you.mp3
│   └── README.txt           # 资源放置说明
```

## ⚙️ 配置说明

所有公开配置集中在 [js/config.js](js/config.js) 文件中，修改后刷新页面即可生效。

### 1. 背景配置

```javascript
background: {
  type: 'image',               // 可选: 'zootopia'(3D 动画) | 'gradient' | 'color' | 'image' | 'video'
  color: '#0a0a12',            // 纯色模式下的背景色
  image: 'assets/background/beijing.png',  // 图片路径
  video: ''                    // 视频路径
}
```

### 2. 头像配置

```javascript
avatar: {
  src: 'assets/avatar/me.jpg',   // 头像图片路径
  frame: 'frame-glow',          // 边框样式:
                                //   frame-default  默认
                                //   frame-glow     冰蓝光晕 (推荐)
                                //   frame-gold     金色光晕
                                //   frame-rainbow  彩虹边框
                                //   frame-rotate   流光旋转
                                //   frame-neon     霓虹光环
                                //   frame-petal    花瓣边框
                                //   frame-custom   自定义边框
  customFrame: '',              // 自定义边框图片路径 (frame='frame-custom' 时生效)
  opacity: 0.85                 // 光环透明度
}
```

### 3. 昵称配置

```javascript
nickname: {
  text: '我的主页',
  font: "'STHeiti','SimHei',sans-serif",
  size: 28,
  color: '#ffffff',
  weight: 'bold',
  gradient: {
    enabled: true,              // 开启动态渐变
    color1: '#64c8ff',
    color2: '#a55eea',
    color3: '#ff6b6b',
    animated: true              // 渐变流动动画
  }
}
```

### 4. 个性签名配置

```javascript
signature: {
  text: '欢迎来到我的个人空间',
  font: "'STHeiti','SimHei',sans-serif",
  size: 15,
  color: '#ffffff',
  weight: 'normal',
  gradient: { enabled: false, color1: '#64c8ff', color2: '#a55eea', color3: '#ff6b6b', animated: true },
  effect: 'fade'                // 动效: 'none' | 'typewriter' | 'bounce' | 'jump' | 'fade' | 'wave'
}
```

### 5. 泡泡标签配置

```javascript
tags: {
  enabled: true,
  items: ['摄影', '旅行', '音乐', '代码'],   // 你的个人标签
  gradient: { enabled: true, color1: '#64c8ff', color2: '#a55eea', color3: '#ff6b6b', animated: true }
}
```

### 6. 天气配置

```javascript
weather: {
  enabled: true,
  temp: 22,                     // 温度
  region: '北京',               // 地区名称
  type: 'aurora',               // 天气类型:
                                //   sunny 晴天 | rainy 雨天 | cloudy 多云 | overcast 阴天
                                //   storm 暴雨 | snow 雪 | lightsnow 小雪 | midsnow 中雪
                                //   heavysnow 大雪
  size: 1.2,                    // 天气组件缩放
  aqi: '空气优 32',             // 空气质量
  humidity: 60                  // 湿度
}
```

### 7. 音乐播放器配置

```javascript
music: {
  // 在线搜索 API 基地址（server.js 多平台聚合接口，仅取 origin 部分）：
  //   指向运行 server.js 的服务，如 'http://127.0.0.1:9123'
  //   留空 '' 则关闭在线搜索（仅本地音乐可用）
  apiBase: 'http://127.0.0.1:9123',
  tracks: [
    { name: '歌曲名', artist: '歌手', src: 'assets/music/song.mp3', cover: '' },
    // 支持在线音乐链接
    { name: '在线示例', artist: 'SoundHelix', src: 'https://example.com/song.mp3', cover: '' }
  ],
  currentIndex: 0,
  playing: false,
  lyricsRain: false,            // 歌词雨效果
  lyrics: '',                   // 歌词文本（每行一句）
  speed: 1.0,                   // 播放倍速: 0.5 / 0.75 / 1.0 / 1.25 / 1.5 / 2.0
  autoplay: true                // 自动播放（浏览器策略可能需要首次用户交互）
}
```

### 8. 背景轮播配置

```javascript
carousel: {
  items: [
    'assets/background/1.jpg',
    'assets/background/2.jpg'
  ],
  enabled: false,
  speed: 5                      // 每张图停留秒数
}
```

### 9. 水中倒影配置

```javascript
reflection: {
  enabled: true,
  opacity: 0.6,                 // 倒影透明度
  depth: 70,                    // 倒影深度 %
  blur: 2,                      // 模糊 px
  shimmer: true                 // 水面微光上飘
}
```

## 🎨 字体选项

内置 22 种中英文字体，可在设置面板中选择：

| 分类 | 字体名称 |
|------|----------|
| 中文字体 | 黑体、苹方、楷体、宋体、ZCOOL快乐体、ZCOOL小薇体、马善政楷书、龙藏体、柳建毛草 |
| 英文字体 | Georgia、等宽(Courier New)、手写(Comic Sans MS) |
| 艺术字体 | Playfair Display、Lobster、Pacifico、Dancing Script、Cinzel、Bebas Neue、Great Vibes、Anton、Caveat、像素体(Press Start 2P) |

## 🎵 音乐搜索

设置面板中内置多平台音乐聚合搜索，由 [server.js](server.js) 提供统一接口：

- **网易云** (`source: 'netease'`)
- **酷我** (`source: 'kuwo'`)

特性：
- 统一 schema：所有平台返回 `{ source, id, name, artist, album, pic, duration, url }`，`source` 字段区分歌源
- VIP / 无版权自动过滤（基于网易云 `song/enhance/player/url` 校验）
- 跨平台去重（按歌名 + 歌手归一化）
- 统一音频代理 `/api/audio?source=&id=`，服务器侧下载缓存并支持 Range（拖动进度条）
- 统一词牌 `/api/lyrics?source=&id=` 与封面代理 `/api/cover?url=`

聚合 API 端点：

| 端点 | 说明 |
|------|------|
| `GET /api/search?keyword=&source=all&limit=` | 聚合搜索（`all`/`netease`/`kuwo`） |
| `GET /api/audio?source=&id=` | 统一音频代理（含本地缓存 + Range） |
| `GET /api/lyrics?source=&id=` | 统一词牌 |
| `GET /api/cover?url=` | 统一封面代理（http → https） |

> 旧版网易云单平台端点（`/api/netease-*`、`/api/netease-music/*`）保留向后兼容。

搜索到音乐后点击「+」即可添加到播放列表。

## 📝 资源放置指南

详见 [assets/README.txt](assets/README.txt)：

| 资源类型 | 放置目录 | 支持格式 |
|---------|---------|---------|
| 头像 | `assets/avatar/` | jpg / png / gif |
| 背景图片/视频 | `assets/background/` | jpg / png / mp4 等 |
| 音乐 | `assets/music/` | mp3 / wav / ogg |

## 🔧 设置面板使用

点击页面右上角的 **齿轮图标** ⚙️ 打开设置面板，可实时调整：

- **背景设置**：类型切换、颜色/图片/视频上传
- **头像设置**：边框样式、透明度、头像裁剪上传、自定义边框
- **昵称设置**：文字、字体、字号、字重、颜色、动态渐变
- **签名设置**：内容、字体、渐变、6 种动效
- **泡泡标签**：增删标签、渐变样式
- **天气设置**：开关、地区、温度、类型、空气质量、湿度
- **音乐播放器**：多平台聚合搜索、本地导入、专辑封面、歌词雨、播放模式、倍速
- **背景轮播**：开关、速度、多图导入
- **水中倒影**：开关、透明度、深浅、模糊、微光

调整后点击「保存设置」或「重置默认」。

## 💡 小贴士

1. **自动播放策略**：现代浏览器会阻止未交互的音频自动播放，首次点击页面任意位置会自动开始播放。
2. **公开 vs 本地**：`js/config.js` 是公开配置，所有访客共享；如果删除 `js/config.js`，设置会保存在个人浏览器的 localStorage 中。
3. **视频背景性能**：视频背景会占用较多资源，建议优先使用图片或渐变。
4. **移动端体验**：页面已做响应式适配，移动端建议关闭水中倒影以获得更流畅体验。

## 🛠️ 技术栈

- **前端** - 原生 JavaScript (ES6+)，无任何构建工具依赖
- **后端** - Node.js (`server.js`，仅依赖内置模块，静态服务 + 音乐聚合 API)
- **HTML5 Canvas** - 天气粒子特效、水面折射、音波可视化
- **Three.js** - 3D 动态背景与粒子特效
- **SVG Filters** - 水面扭曲滤镜
- **CSS3** - 动画、渐变、玻璃拟态、3D 变换
- **Web Audio API** - 音频可视化分析
- **Supabase** - 云端设置 / 资源存储
- **Google Fonts** - 在线艺术字体

## 📄 License

MIT License
