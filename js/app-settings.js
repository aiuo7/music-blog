/* ============================================================
   app-settings.js — 设置面板模块
   ----------------------------------------------------------------
   设置面板构建/事件绑定 + 配置应用（apply* 系列）。
   依赖 app-core.js 的全局状态与工具函数。
   ============================================================ */
'use strict';
/* ================================================================
   轻量自定义 select 组件（带过渡动画，替代原生 select）
   ----------------------------------------------------------------
   原生 <select> 的下拉菜单是浏览器行为，无法加 CSS 过渡。
   本组件隐藏原生 select，叠加自定义触发器+下拉面板，
   选择后通过 dispatchEvent 触发原生 change 事件，
   因此所有现有 onchange 逻辑无需修改。
================================================================ */
function initCustomSelects(container) {
  container.querySelectorAll('select').forEach(function(sel) {
    // 已初始化过则跳过
    if (sel.dataset.cselectInit) return;
    sel.dataset.cselectInit = '1';
    sel.style.display = 'none';

    // 构建自定义结构
    const wrap = document.createElement('div');
    wrap.className = 'cselect';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel); // 把原生 select 移进 wrap

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cselect-trigger';
    wrap.appendChild(trigger);

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'cselect-options';
    // 挂到 body 下，脱离 settings-panel 的 transform 包含块，让 fixed 真正相对视口定位
    document.body.appendChild(optionsWrap);

    // 渲染选项 + 同步触发器文案
    function render() {
      optionsWrap.innerHTML = '';
      Array.from(sel.options).forEach(function(opt) {
        const item = document.createElement('div');
        item.className = 'cselect-option' + (opt.selected ? ' selected' : '');
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        item.onclick = function(e) {
          e.stopPropagation();
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          trigger.textContent = opt.textContent;
          wrap.classList.remove('open');
          optionsWrap.classList.remove('open');
          render();
        };
        optionsWrap.appendChild(item);
      });
      // 触发器显示当前选中项
      const cur = sel.options[sel.selectedIndex];
      trigger.textContent = cur ? cur.textContent : '';
    }
    render();

    // 点击触发器切换
    trigger.onclick = function(e) {
      e.stopPropagation();
      // 关闭其它已打开的下拉（wrap 在 container 内，optionsWrap 在 body 下，需分别清理）
      container.querySelectorAll('.cselect.open').forEach(function(o) {
        if (o !== wrap) o.classList.remove('open');
      });
      document.querySelectorAll('.cselect-options.open').forEach(function(o) {
        if (o !== optionsWrap) o.classList.remove('open');
      });
      const willOpen = !wrap.classList.contains('open');
      wrap.classList.toggle('open', willOpen);
      optionsWrap.classList.toggle('open', willOpen);
      // optionsWrap 在 body 下，fixed 相对视口定位，不会被任何父容器裁剪
      if (willOpen) {
        const rect = trigger.getBoundingClientRect();
        const optH = optionsWrap.offsetHeight || 160;
        const spaceBelow = window.innerHeight - rect.bottom;
        let top;
        if (spaceBelow >= optH + 12) {
          top = rect.bottom + 4;
        } else {
          top = Math.max(8, rect.top - optH - 4);
        }
        optionsWrap.style.left = rect.left + 'px';
        optionsWrap.style.top = top + 'px';
        optionsWrap.style.width = rect.width + 'px';
      }
    };

    // 外部点击关闭
    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target) && !optionsWrap.contains(e.target)) {
        wrap.classList.remove('open');
        optionsWrap.classList.remove('open');
      }
    });
  });
}

/* ================================================================
   轻量自定义颜色选择器（带过渡动画，替代原生 input[type=color]）
   ----------------------------------------------------------------
   原生 <input type="color"> 弹出的是操作系统级颜色窗口，无法加 CSS 过渡。
   本组件隐藏原生 input，叠加自定义触发器 + 色板面板（预设色 + 原生 input 兜底），
   选择后通过 dispatchEvent 触发原生 input 事件，
   因此所有现有 oninput 逻辑无需修改。
================================================================ */
// 预设色板（覆盖常用颜色）
const CCOLOR_PRESETS = [
  '#ffffff','#000000','#ff4d4f','#ff7a45','#fa8c16','#faad14','#fadb14','#a0d911','#52c41a','#13c2c2',
  '#1890ff','#2f54eb','#722ed1','#eb2f96','#f5222d','#fa541c','#d4380d','#d48806','#c41d7f','#531dab',
  '#3949ab','#43a047','#8d6e63','#616161','#262630','#0d0d1a','#e91e63','#9c27b0','#3f51b5','#009688'
];

function initCustomColors(container) {
  container.querySelectorAll('input[type="color"]').forEach(function(inp) {
    if (inp.dataset.ccolorInit) return;
    inp.dataset.ccolorInit = '1';
    inp.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'ccolor';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);

    // 触发器（显示当前颜色）
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ccolor-trigger';
    wrap.appendChild(trigger);

    // 色板面板
    const panel = document.createElement('div');
    panel.className = 'ccolor-panel';
    panel.innerHTML =
      '<div class="ccolor-presets"></div>' +
      '<div class="ccolor-custom-row">' +
        '<input type="color" class="ccolor-native">' +
        '<span class="ccolor-custom-label">自定义</span>' +
      '</div>';
    // 挂到 body 下，脱离 settings-panel 的 transform 包含块，让 fixed 真正相对视口定位
    document.body.appendChild(panel);

    const presetsEl = panel.querySelector('.ccolor-presets');
    const nativeInput = panel.querySelector('.ccolor-native');

    function syncTrigger() {
      trigger.style.background = inp.value || '#000';
    }
    function syncPresetSelect() {
      presetsEl.querySelectorAll('.ccolor-swatch').forEach(function(s) {
        s.classList.toggle('selected', s.dataset.value.toLowerCase() === String(inp.value).toLowerCase());
      });
    }

    // 构建预设色块
    CCOLOR_PRESETS.forEach(function(c) {
      const sw = document.createElement('div');
      sw.className = 'ccolor-swatch';
      sw.style.background = c;
      sw.dataset.value = c;
      sw.title = c;
      sw.onclick = function(e) {
        e.stopPropagation();
        inp.value = c;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        syncTrigger();
        syncPresetSelect();
      };
      presetsEl.appendChild(sw);
    });

    // 原生 input 兜底（选自定义颜色）
    nativeInput.value = inp.value;
    nativeInput.oninput = function(e) {
      e.stopPropagation();
      inp.value = nativeInput.value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      syncTrigger();
      syncPresetSelect();
    };

    // 触发器切换面板
    trigger.onclick = function(e) {
      e.stopPropagation();
      container.querySelectorAll('.ccolor.open').forEach(function(o) {
        if (o !== wrap) o.classList.remove('open');
      });
      document.querySelectorAll('.ccolor-panel.open').forEach(function(o) {
        if (o !== panel) o.classList.remove('open');
      });
      const willOpen = !wrap.classList.contains('open');
      wrap.classList.toggle('open', willOpen);
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        nativeInput.value = inp.value;
        syncPresetSelect();
        // panel 在 body 下，fixed 相对视口定位，不会被任何父容器裁剪
        const rect = trigger.getBoundingClientRect();
        const panelW = 220;
        const panelH = panel.offsetHeight || 200;
        // 水平：尽量右对齐触发器，不超出视口左侧
        let left = rect.right - panelW;
        if (left < 8) left = 8;
        // 垂直：优先向下，空间不足则向上
        const spaceBelow = window.innerHeight - rect.bottom;
        let top;
        if (spaceBelow >= panelH + 12) {
          top = rect.bottom + 6;
        } else {
          top = Math.max(8, rect.top - panelH - 6);
        }
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
      }
    };

    // 外部点击关闭
    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target) && !panel.contains(e.target)) {
        wrap.classList.remove('open');
        panel.classList.remove('open');
      }
    });

    syncTrigger();
  });
}

/* ================================================================
   设置面板构建
================================================================ */
function buildSettingsPanel() {
  const body = $('settingsBody');
  body.innerHTML = '';

  // --- 背景设置（含轮播） ---
  body.appendChild(group('背景设置', `
    <div class="settings-row">
      <label>背景类型</label>
      <select id="set_bgType">
        <option value="zootopia" ${settings.background.type==='zootopia'?'selected':''}>肖老师的卡通动画(默认)</option>
        <option value="gradient" ${settings.background.type==='gradient'?'selected':''}>动态渐变</option>
        <option value="color" ${settings.background.type==='color'?'selected':''}>纯色</option>
        <option value="image" ${settings.background.type==='image'?'selected':''}>静态图片</option>
        <option value="video" ${settings.background.type==='video'?'selected':''}>动态视频</option>
      </select>
    </div>
    <div class="settings-row" id="bgColorRow" style="display:${settings.background.type==='color'?'flex':'none'}">
      <label>背景颜色</label>
      <input type="color" id="set_bgColor" value="${settings.background.color}">
    </div>
    <div class="settings-row" id="bgImageRow" style="display:${settings.background.type==='image'?'flex':'none'}">
      <label>上传图片</label>
      <button class="settings-add-btn" style="flex:1" id="set_uploadBgImage">选择背景图片</button>
    </div>
    <div class="settings-row" id="bgVideoRow" style="display:${settings.background.type==='video'?'flex':'none'}">
      <label>上传视频</label>
      <button class="settings-add-btn" style="flex:1" id="set_uploadBgVideo">选择背景视频</button>
    </div>
    <input type="file" id="bgImageInput" accept="image/*" multiple style="display:none">
    <input type="file" id="bgVideoInput" accept="video/*" multiple style="display:none">
    <div class="settings-group-title" style="margin-top:14px">背景轮播</div>
    <div class="settings-row">
      <label>开启轮播</label>
      <div class="settings-toggle ${settings.carousel.enabled?'on':''}" id="set_carouselEnable"></div>
    </div>
    <div class="settings-row">
      <label>轮播速度 ${settings.carousel.speed}秒</label>
      <input type="range" id="set_carouselSpeed" min="3" max="15" value="${settings.carousel.speed}">
    </div>
    <div class="settings-row">
      <label>清空轮播</label>
      <button class="settings-add-btn" style="flex:1" id="set_clearMedia">一键清空 (${settings.carousel.items.length})</button>
    </div>
  `));

  // --- 头像设置 ---
  body.appendChild(group('头像设置', `
    <div class="settings-row">
      <label>头像边框</label>
      <select id="set_avatarFrame">
        ${FRAME_OPTIONS.map(f => `<option value="${f.v}" ${settings.avatar.frame===f.v?'selected':''}>${f.l}</option>`).join('')}
      </select>
    </div>
    <div class="settings-row" id="customFrameRow" style="display:${settings.avatar.frame==='frame-custom'?'flex':'none'}">
      <label>自定义边框</label>
      <button class="settings-add-btn" style="flex:1" id="set_uploadCustomFrame">选择边框图片(PNG透明)</button>
    </div>
    <div class="settings-row">
      <label>框透明度 ${Math.round(settings.avatar.opacity*100)}%</label>
      <input type="range" id="set_avatarOpacity" min="0.2" max="1" step="0.05" value="${settings.avatar.opacity}">
    </div>
    <div class="settings-hint">点击页面头像即可更换静态/动态图片</div>
    <input type="file" id="avatarFileInput" accept="image/*" style="display:none">
    <input type="file" id="customFrameInput" accept="image/*" style="display:none">
  `));

  // --- 昵称设置 ---
  body.appendChild(group('昵称设置', `
    <div class="settings-row">
      <label>昵称</label>
      <input type="text" id="set_nickname" value="${escapeHtml(settings.nickname.text)}" maxlength="20">
    </div>
    <div class="settings-inline-row">
      <span class="ilabel">字体</span>
      <select id="set_nickFont" class="iselect">${FONT_OPTIONS.map(f=>`<option value="${f.v}" ${settings.nickname.font===f.v?'selected':''}>${f.l}</option>`).join('')}</select>
      <span class="ilabel">字重</span>
      <select id="set_nickWeight" class="iselect">
        <option value="bold" ${settings.nickname.weight==='bold'?'selected':''}>粗体</option>
        <option value="normal" ${settings.nickname.weight==='normal'?'selected':''}>常规</option>
        <option value="lighter" ${settings.nickname.weight==='lighter'?'selected':''}>细体</option>
      </select>
      <span class="ilabel">字号</span>
      <input type="range" id="set_nickSize" class="irange" min="16" max="48" value="${settings.nickname.size}">
      <span class="ival" id="nickSizeVal">${settings.nickname.size}px</span>
      <span class="ilabel">字色</span>
      <input type="color" id="set_nickColor" class="icolor" value="${settings.nickname.color}">
    </div>
    <div class="settings-inline-row">
      <span class="ilabel">动态渐变</span>
      <div class="settings-toggle ${settings.nickname.gradient.enabled?'on':''}" id="set_nickGradient"></div>
    </div>
    <div id="nickGradientSettings" style="display:${settings.nickname.gradient.enabled?'block':'none'}">
      <div class="settings-row">
        <label>渐变色</label>
        <div class="color-pick-row">
          <input type="color" id="set_nickGrad1" value="${settings.nickname.gradient.color1}">
          <input type="color" id="set_nickGrad2" value="${settings.nickname.gradient.color2}">
          <input type="color" id="set_nickGrad3" value="${settings.nickname.gradient.color3}">
        </div>
      </div>
      <div class="settings-row">
        <label>渐变动画</label>
        <div class="settings-toggle ${settings.nickname.gradient.animated?'on':''}" id="set_nickGradAnim"></div>
      </div>
    </div>
  `));

  // --- 签名设置 ---
  body.appendChild(group('个性签名', `
    <div class="settings-row">
      <label>签名内容</label>
      <textarea id="set_sigText" maxlength="50">${escapeHtml(settings.signature.text)}</textarea>
    </div>
    <div class="settings-inline-row">
      <span class="ilabel">字体</span>
      <select id="set_sigFont" class="iselect">${FONT_OPTIONS.map(f=>`<option value="${f.v}" ${settings.signature.font===f.v?'selected':''}>${f.l}</option>`).join('')}</select>
      <span class="ilabel">字重</span>
      <select id="set_sigWeight" class="iselect">
        <option value="normal" ${settings.signature.weight==='normal'?'selected':''}>常规</option>
        <option value="bold" ${settings.signature.weight==='bold'?'selected':''}>粗体</option>
        <option value="lighter" ${settings.signature.weight==='lighter'?'selected':''}>细体</option>
      </select>
      <span class="ilabel">字号</span>
      <input type="range" id="set_sigSize" class="irange" min="10" max="30" value="${settings.signature.size}">
      <span class="ival" id="sigSizeVal">${settings.signature.size}px</span>
      <span class="ilabel">字色</span>
      <input type="color" id="set_sigColor" class="icolor" value="${settings.signature.color}">
    </div>
    <div class="settings-inline-row">
      <span class="ilabel">动态渐变</span>
      <div class="settings-toggle ${settings.signature.gradient.enabled?'on':''}" id="set_sigGradient"></div>
      <span class="ilabel" style="margin-left:16px">动效</span>
      <select id="set_sigEffect" class="iselect">${EFFECT_OPTIONS.map(e=>`<option value="${e.v}" ${settings.signature.effect===e.v?'selected':''}>${e.l}</option>`).join('')}</select>
    </div>
    <div id="sigGradientSettings" style="display:${settings.signature.gradient.enabled?'block':'none'}">
      <div class="settings-row">
        <label>渐变色</label>
        <div class="color-pick-row">
          <input type="color" id="set_sigGrad1" value="${settings.signature.gradient.color1}">
          <input type="color" id="set_sigGrad2" value="${settings.signature.gradient.color2}">
          <input type="color" id="set_sigGrad3" value="${settings.signature.gradient.color3}">
        </div>
      </div>
      <div class="settings-row">
        <label>渐变动画</label>
        <div class="settings-toggle ${settings.signature.gradient.animated?'on':''}" id="set_sigGradAnim"></div>
      </div>
    </div>
  `));

  // --- 天气设置 ---
  body.appendChild(group('天气设置', `
    <div class="settings-row">
      <label>开启天气</label>
      <div class="settings-toggle ${settings.weather.enabled?'on':''}" id="set_weatherEnable"></div>
    </div>
    <div class="settings-row">
      <label>地区</label>
      <input type="text" id="set_weatherRegion" value="${escapeHtml(settings.weather.region)}" maxlength="10">
    </div>
    <div class="settings-row">
      <label>温度 ${settings.weather.temp}°</label>
      <input type="range" id="set_weatherTemp" min="-30" max="50" value="${settings.weather.temp}">
    </div>
    <div class="settings-row weather-type-row">
      <label>天气类型</label>
      <div class="weather-type-toggles" id="set_weatherType">
        ${Object.entries(WEATHER_TYPES).map(([k,v])=>`<div class="weather-type-toggle${settings.weather.type===k?' on':''}" data-type="${k}">${v.label}</div>`).join('')}
      </div>
    </div>
    <div class="settings-row">
      <label>空气质量</label>
      <input type="text" id="set_weatherAqi" value="${escapeHtml(settings.weather.aqi || '空气优 32')}" maxlength="12">
    </div>
    <div class="settings-row">
      <label>湿度 ${settings.weather.humidity || 60}%</label>
      <input type="range" id="set_weatherHumidity" min="0" max="100" value="${settings.weather.humidity || 60}">
    </div>
    <div class="settings-row">
      <label>大小 ${settings.weather.size.toFixed(1)}x</label>
      <input type="range" id="set_weatherSize" min="0.8" max="2.5" step="0.1" value="${settings.weather.size}">
    </div>
  `));

  // --- 音乐设置 ---
  body.appendChild(group('音乐播放器', `
    <div class="settings-row">
      <label>数据来源</label>
      <span style="flex:1;text-align:right;font-size:13px;color:var(--text-tertiary)">网易云/酷我音乐（在线搜索在播放器右侧）</span>
    </div>
    <div class="settings-row">
      <label>导入音乐</label>
      <button class="settings-add-btn" style="flex:1" id="set_importMusic">选择音频文件</button>
    </div>
    <div id="musicImportProgress" class="music-import-progress" style="display:none"></div>
    <div id="musicTrackList" class="music-playlist"></div>
  `));
  renderMusicTrackList();

  bindSettingsEvents();
  // 初始化自定义 select 组件（替代原生 select，带过渡动画）
  initCustomSelects(body);
  // 初始化自定义颜色选择器（替代原生 color input，带过渡动画）
  initCustomColors(body);
}

function group(title, inner) {
  const div = document.createElement('div');
  div.className = 'settings-group';
  div.innerHTML = `<div class="settings-group-title">${title}</div>${inner}`;
  return div;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMusicTrackList() {
  const el = $('musicTrackList');
  if (!el) return;
  if (settings.music.tracks.length === 0) {
    el.innerHTML = '<div style="opacity:0.5;padding:8px 0">暂无音乐，点击上方搜索或导入</div>';
    return;
  }
  el.innerHTML = settings.music.tracks.map((t, i) => {
    const isCurrent = i === settings.music.currentIndex;
    return `<div class="playlist-item ${isCurrent ? 'current' : ''}" data-idx="${i}">
      <span class="playlist-item-idx">${isCurrent ? '▶' : (i+1)}</span>
      <span class="playlist-item-name">${escapeHtml(t.name)}</span>
      <button class="playlist-item-del" data-del="${i}" title="删除">✕</button>
    </div>`;
  }).join('');
  // 点击播放
  el.querySelectorAll('.playlist-item').forEach(item => {
    item.onclick = (e) => {
      if (e.target.classList.contains('playlist-item-del')) return;
      const idx = +item.dataset.idx;
      settings.music.currentIndex = idx;
      applyMusicState();
      playMusic();
      renderMusicTrackList();
    };
  });
  // 删除
  el.querySelectorAll('.playlist-item-del').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.del;
      settings.music.tracks.splice(idx, 1);
      if (settings.music.currentIndex >= settings.music.tracks.length) {
        settings.music.currentIndex = Math.max(0, settings.music.tracks.length - 1);
      }
      applyMusicState();
      renderMusicTrackList();
      autoSaveMusic();
    };
  });
}

/* ---------- 生成渐变CSS ---------- */
function buildGradientCSS(g) {
  const colors = [g.color1, g.color2];
  if (g.color3) colors.push(g.color3);
  return `linear-gradient(90deg, ${colors.join(', ')})`;
}

/* ---------- 设置事件绑定 ---------- */
function bindSettingsEvents() {
  // 背景
  $('set_bgType').onchange = e => {
    settings.background.type = e.target.value;
    $('bgColorRow').style.display = e.target.value === 'color' ? 'flex' : 'none';
    $('bgImageRow').style.display = e.target.value === 'image' ? 'flex' : 'none';
    $('bgVideoRow').style.display = e.target.value === 'video' ? 'flex' : 'none';
    applyBackground();
    // 背景切换后重新应用天气/环境特效（轻量级特效可与任何背景共存）
    if (threeEffectsInited) {
      applyWeather();
    }
  };
  $('set_bgColor').oninput = e => { settings.background.color = e.target.value; applyBackground(); };
  $('set_uploadBgImage').onclick = () => $('bgImageInput').click();
  $('bgImageInput').onchange = async e => {
    if (!e.target.files[0]) return;
    // 轮播开启时：所有图片添加到轮播列表
    if (settings.carousel.enabled) {
      await handleMediaImport(e.target.files);
      e.target.value = '';
      return;
    }
    // 否则：设置单张背景图片
    toast('上传中...');
    try {
      const url = await uploadAsset(e.target.files[0], 'background', getFileExt(e.target.files[0]));
      settings.background.image = url;
      applyBackground();
      toast('背景图片已更新');
    } catch (e) { toast('上传失败：' + (e.message || '')); }
    e.target.value = '';
  };
  $('set_uploadBgVideo').onclick = () => $('bgVideoInput').click();
  $('bgVideoInput').onchange = async e => {
    if (!e.target.files[0]) return;
    // 轮播开启时：所有视频添加到轮播列表
    if (settings.carousel.enabled) {
      await handleMediaImport(e.target.files);
      e.target.value = '';
      return;
    }
    // 否则：设置单个背景视频
    toast('上传中...');
    try {
      const url = await uploadAsset(e.target.files[0], 'background', getFileExt(e.target.files[0]));
      settings.background.video = url;
      applyBackground();
      toast('背景视频已更新');
    } catch (e) { toast('上传失败：' + (e.message || '')); }
    e.target.value = '';
  };

  // 头像
  $('set_avatarFrame').onchange = e => {
    settings.avatar.frame = e.target.value;
    $('customFrameRow').style.display = e.target.value === 'frame-custom' ? 'flex' : 'none';
    applyAvatar();
  };
  $('set_avatarOpacity').oninput = e => {
    settings.avatar.opacity = +e.target.value;
    e.target.previousElementSibling.textContent = `框透明度 ${Math.round((+e.target.value)*100)}%`;
    applyAvatar();
  };
  $('set_uploadCustomFrame').onclick = () => $('customFrameInput').click();
  $('customFrameInput').onchange = e => { if (e.target.files[0]) handleCustomFrameUpload(e.target.files[0]); };
  $('avatarFileInput').onchange = e => { if (e.target.files[0]) handleAvatarUpload(e.target.files[0]); };

  // 昵称
  $('set_nickname').oninput = e => { settings.nickname.text = e.target.value || '未设置昵称'; applyNickname(); };
  $('set_nickFont').onchange = e => { settings.nickname.font = e.target.value; applyNickname(); };
  $('set_nickSize').oninput = e => { settings.nickname.size = +e.target.value; $('nickSizeVal').textContent = e.target.value + 'px'; applyNickname(); };
  $('set_nickWeight').onchange = e => { settings.nickname.weight = e.target.value; applyNickname(); };
  $('set_nickColor').oninput = e => { settings.nickname.color = e.target.value; applyNickname(); };
  $('set_nickGradient').onclick = e => {
    settings.nickname.gradient.enabled = !settings.nickname.gradient.enabled;
    e.target.classList.toggle('on');
    $('nickGradientSettings').style.display = settings.nickname.gradient.enabled ? 'block' : 'none';
    applyNickname();
  };
  $('set_nickGrad1').oninput = e => { settings.nickname.gradient.color1 = e.target.value; applyNickname(); };
  $('set_nickGrad2').oninput = e => { settings.nickname.gradient.color2 = e.target.value; applyNickname(); };
  $('set_nickGrad3').oninput = e => { settings.nickname.gradient.color3 = e.target.value; applyNickname(); };
  $('set_nickGradAnim').onclick = e => { settings.nickname.gradient.animated = !settings.nickname.gradient.animated; e.target.classList.toggle('on'); applyNickname(); };

  // 签名
  $('set_sigText').oninput = e => { settings.signature.text = e.target.value; applySignature(); };
  $('set_sigFont').onchange = e => { settings.signature.font = e.target.value; applySignature(); };
  $('set_sigSize').oninput = e => { settings.signature.size = +e.target.value; $('sigSizeVal').textContent = e.target.value + 'px'; applySignature(); };
  $('set_sigWeight').onchange = e => { settings.signature.weight = e.target.value; applySignature(); };
  $('set_sigColor').oninput = e => { settings.signature.color = e.target.value; applySignature(); };
  $('set_sigGradient').onclick = e => {
    settings.signature.gradient.enabled = !settings.signature.gradient.enabled;
    e.target.classList.toggle('on');
    $('sigGradientSettings').style.display = settings.signature.gradient.enabled ? 'block' : 'none';
    applySignature();
  };
  $('set_sigGrad1').oninput = e => { settings.signature.gradient.color1 = e.target.value; applySignature(); };
  $('set_sigGrad2').oninput = e => { settings.signature.gradient.color2 = e.target.value; applySignature(); };
  $('set_sigGrad3').oninput = e => { settings.signature.gradient.color3 = e.target.value; applySignature(); };
  $('set_sigGradAnim').onclick = e => { settings.signature.gradient.animated = !settings.signature.gradient.animated; e.target.classList.toggle('on'); applySignature(); };
   $('set_sigEffect').onchange = e => { settings.signature.effect = e.target.value; applySignature(); };

   // 天气
  $('set_weatherEnable').onclick = e => { settings.weather.enabled = !settings.weather.enabled; e.target.classList.toggle('on'); applyWeather(); };
  $('set_weatherRegion').oninput = e => { settings.weather.region = e.target.value; applyWeather(); };
  $('set_weatherTemp').oninput = e => { settings.weather.temp = +e.target.value; e.target.previousElementSibling.textContent = `温度 ${e.target.value}°`; applyWeather(); };
  $('set_weatherType').addEventListener('click', e => {
    const btn = e.target.closest('.weather-type-toggle');
    if (!btn) return;
    settings.weather.type = btn.dataset.type;
    $('set_weatherType').querySelectorAll('.weather-type-toggle').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    applyWeather();
  });
  // 降雪强度循环按钮已在 initEvents() 中使用事件委托绑定
  $('set_weatherAqi').oninput = e => { settings.weather.aqi = e.target.value; applyWeather(); };
  $('set_weatherHumidity').oninput = e => { settings.weather.humidity = +e.target.value; e.target.previousElementSibling.textContent = `湿度 ${e.target.value}%`; applyWeather(); };
  $('set_weatherSize').oninput = e => {
    settings.weather.size = +e.target.value;
    e.target.previousElementSibling.textContent = `大小 ${(+e.target.value).toFixed(1)}x`;
    applyWeather();
  };

  // 音乐
  $('set_importMusic').onclick = (e) => {
    // 阻止冒泡到 document，避免触发"点击空白关闭设置面板"逻辑
    e.stopPropagation();
    $('musicFileInput').click();
  };
  // 文件选择 change 事件也阻止冒泡（文件对话框关闭时可能派发 click）
  $('musicFileInput').onchange = e => {
    e.stopPropagation();
    handleMusicImport(e.target.files);
    // 清空 input value，允许重复选择同一文件
    e.target.value = '';
  };
  // 胶片轮播
  $('set_carouselEnable').onclick = e => { settings.carousel.enabled = !settings.carousel.enabled; e.target.classList.toggle('on'); applyCarousel(); };
  $('set_carouselSpeed').oninput = e => {
    settings.carousel.speed = +e.target.value;
    e.target.previousElementSibling.textContent = `轮播速度 ${e.target.value}秒`;
    startCarouselAuto();
  };
  $('set_clearMedia').onclick = () => {
    if (settings.carousel.items.length === 0) { toast('轮播列表为空'); return; }
    if (!confirm('确定清空所有轮播图片/视频吗？')) return;
    settings.carousel.items = [];
    settings.carousel.enabled = false;
    const toggle = $('set_carouselEnable');
    if (toggle) toggle.classList.remove('on');
    applyCarousel();
    const clearBtn = $('set_clearMedia');
    if (clearBtn) clearBtn.textContent = '一键清空 (0)';
    toast('已清空轮播列表');
    saveUserSettings(true);
  };

}

/* ================================================================
   应用配置到界面
================================================================ */
function applyAllSettings() {
  // 旧版天气类型迁移
  initSnowLevelFromType(settings.weather.type);
  applyBackground();
  applyAvatar();
  applyNickname();
  applySignature();
  applyWeather();
  applyCarousel();
  applyMusicState();
  // 同步音量/静音状态到播放器（切歌和加载设置后保持）
  if (typeof applyVolumeToAudio === 'function') applyVolumeToAudio();
}

function applyBackground() {
  const layer = $('bgLayer');
  const video = $('bgVideo');
  const bg = settings.background;
  const bgSceneCanvas = $('bgSceneCanvas');

  if (bg.type === 'zootopia') {
    // 疯狂动物城3D背景：启动独立渲染，隐藏其他背景层
    layer.style.background = 'transparent';
    layer.style.animation = 'none';
    video.style.display = 'none';
    video.pause();
    if (bgSceneCanvas) bgSceneCanvas.style.display = 'block';
    if (window.ZootopiaBG) window.ZootopiaBG.show();
  } else {
    // 非疯狂动物城模式：停止3D背景，恢复常规背景系统
    if (window.ZootopiaBG) window.ZootopiaBG.hide();
    if (bgSceneCanvas) bgSceneCanvas.style.display = 'none';

    if (bg.type === 'gradient') {
      layer.style.background = 'linear-gradient(-45deg, rgba(8,8,16,0.75), rgba(10,20,35,0.75), rgba(20,20,40,0.75), rgba(16,28,52,0.78), rgba(12,40,75,0.78))';
      layer.style.backgroundSize = '400% 400%';
      layer.style.animation = 'bgGradientFlow 18s ease infinite';
      video.style.display = 'none';
      video.pause();
    } else if (bg.type === 'color') {
      layer.style.background = bg.color || '#000000';
      layer.style.animation = 'none';
      video.style.display = 'none';
      video.pause();
    } else if (bg.type === 'image' && bg.image) {
      layer.style.background = `url("${bg.image}") center/cover no-repeat, #000`;
      layer.style.animation = 'none';
      video.style.display = 'none';
      video.pause();
    } else if (bg.type === 'video' && bg.video) {
      layer.style.background = '#000';
      layer.style.animation = 'none';
      video.src = bg.video;
      video.style.display = 'block';
      video.play().catch(() => {});
    } else {
      layer.style.background = 'transparent';
      layer.style.animation = 'none';
      video.style.display = 'none';
      video.pause();
    }
  }

  // 背景变化后同步特效渲染：默认/静态/动态背景统一以叠加层渲染
  if (threeEffectsInited && window.ThreeEffectsEngine) {
    // 天气关闭时不渲染任何环境特效
    switchThreeEffect(settings.weather.enabled ? settings.weather.type : null);
  }
}

function applyAvatar() {
  const frame = $('avatarFrame');
  const img = $('avatarImg');
  const customFrame = $('avatarCustomFrame');
  const glassRing = $('avatarGlassRing');
  frame.className = 'avatar-frame ' + settings.avatar.frame;
  // 透明度
  document.documentElement.style.setProperty('--avatar-opacity', settings.avatar.opacity);
  if (settings.avatar.src) {
    img.src = settings.avatar.src;
    img.classList.add('has-img');
  } else {
    img.classList.remove('has-img');
    img.src = '';
  }
  // 自定义边框
  if (settings.avatar.frame === 'frame-custom' && settings.avatar.customFrame) {
    customFrame.style.backgroundImage = `url("${settings.avatar.customFrame}")`;
    customFrame.classList.add('has-frame');
  } else {
    customFrame.classList.remove('has-frame');
    customFrame.style.backgroundImage = '';
  }
}

function applyNickname() {
  const el = $('nickname');
  el.textContent = settings.nickname.text;
  el.style.fontFamily = settings.nickname.font;
  el.style.fontSize = settings.nickname.size + 'px';
  el.style.fontWeight = settings.nickname.weight || 'bold';

  const g = settings.nickname.gradient;
  el.classList.remove('gradient-animated');
  if (g.enabled) {
    el.style.background = buildGradientCSS(g);
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
    el.style.webkitTextFillColor = 'transparent';
    el.style.color = 'transparent';
    el.style.backgroundSize = '200% auto';
    if (g.animated) el.classList.add('gradient-animated');
    el.style.textShadow = 'none';
  } else {
    el.style.color = settings.nickname.color;
    el.style.background = 'none';
    el.style.webkitTextFillColor = '';
    el.style.backgroundSize = '';
    el.style.textShadow = '0 2px 12px rgba(0,0,0,0.6),0 0 30px rgba(255,255,255,0.05)';
  }
}

function applySignature() {
  const el = $('signature');
  const s = settings.signature;
  el.className = 'signature';
  el.textContent = s.text;
  el.style.fontFamily = s.font;
  el.style.fontSize = s.size + 'px';
  el.style.fontWeight = s.weight || 'normal';

  const g = s.gradient;
  el.classList.remove('gradient-animated');
  if (g.enabled) {
    el.style.background = buildGradientCSS(g);
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
    el.style.webkitTextFillColor = 'transparent';
    el.style.color = 'transparent';
    el.style.backgroundSize = '200% auto';
    if (g.animated) el.classList.add('gradient-animated');
    el.style.textShadow = 'none';
  } else {
    el.style.color = s.color;
    el.style.background = 'none';
    el.style.webkitTextFillColor = '';
    el.style.backgroundSize = '';
    el.style.textShadow = '0 1px 8px rgba(0,0,0,0.6)';
  }

  if (s.effect === 'typewriter') {
    el.classList.add('effect-typewriter');
    typewriterEffect(el, s.text);
  } else if (s.effect !== 'none') {
    el.classList.add('effect-' + s.effect);
  }
}

let typewriterTimer = null;
function typewriterEffect(el, text) {
  clearTimeout(typewriterTimer);
  let i = 0;
  el.textContent = '';
  function type() {
    if (i <= text.length) {
      el.textContent = text.substring(0, i);
      i++;
      typewriterTimer = setTimeout(type, 150);
    } else {
      typewriterTimer = setTimeout(() => { i = 0; type(); }, 2000);
    }
  }
  type();
}

const WEATHER_EMOJI = {
  fireworks:'🎆', dandelion:'🌼', raindrop:'💧',
  aurora:'🌌', jellyfish:'🪼', fish:'🐟', sky:'🌅', sparkle:'✨', deepsea:'🐠'
};

/* 获取天气显示标签 */
function getWeatherLabel(type) {
  return WEATHER_TYPES[type] ? WEATHER_TYPES[type].label : '深海沉浸';
}

/* 根据保存的天气类型初始化（旧版降雪类型迁移） */
function initSnowLevelFromType(type) {
  // 旧版降雪/天气类型迁移到新版轻量级特效
  if (['lightsnow', 'midsnow', 'heavysnow', 'sunny', 'rainy', 'cloudy', 'overcast', 'storm', 'thunder', 'snow'].indexOf(type) >= 0) {
    settings.weather.type = 'fireworks';
  }
}

function applyWeather() {
  const widget = $('weatherWidget');
  const eye = $('weatherEye');
  if (settings.weather.enabled) {
    widget.classList.remove('off');
    eye.classList.remove('off');
    $('weatherTemp').textContent = settings.weather.temp + '°';
    $('weatherCondition').textContent = getWeatherLabel(settings.weather.type);
    $('weatherRegion').textContent = settings.weather.region;
    $('weatherAqi').textContent = settings.weather.aqi || '空气优';
    $('weatherHumidity').textContent = '湿度 ' + (settings.weather.humidity || 60) + '%';
    // 更新天气图标emoji
    const iconEl = $('weatherIcon');
    if (iconEl) iconEl.textContent = WEATHER_EMOJI[settings.weather.type] || '☀️';
    const card = $('weatherCard');
    if (card) card.style.transform = `scale(${settings.weather.size})`;
    // 所有特效统一由 Three.js 引擎渲染（环境场景 + 天气覆盖）
    switchThreeEffect(settings.weather.type);
  } else {
    widget.classList.add('off');
    eye.classList.add('off');
    const card = $('weatherCard');
    if (card) card.style.transform = `scale(${settings.weather.size})`;
    // 天气关闭：完全停止环境特效
    switchThreeEffect(null);
  }
}

function applyCarousel() {
  const carousel = $('bgCarousel');
  const strip = $('bgCarouselStrip');
  if (!settings.carousel.enabled || settings.carousel.items.length === 0) {
    carousel.classList.remove('show');
    stopCarouselAuto();
    if (settings.background.type === 'video' && settings.background.video) {
      $('bgVideo').play().catch(() => {});
    }
    return;
  }
  carousel.classList.add('show');
  $('bgVideo').pause();
  strip.innerHTML = '';
  settings.carousel.items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'bg-carousel-item';
    if (i === 0) el.classList.add('active');
    if (item.type === 'video') {
      el.innerHTML = `<video src="${item.src}" muted loop playsinline></video>`;
    } else {
      el.innerHTML = `<img src="${item.src}">`;
    }
    strip.appendChild(el);
  });
  carouselIndex = 0;
  updateCarousel();
  startCarouselAuto();
}

function applyMusicState() {
  if (settings.music.tracks.length > 0) {
    const track = settings.music.tracks[settings.music.currentIndex];
    $('musicTitle').textContent = track.name;
    // 专辑封面：优先歌曲封面，无封面则使用头像
    const cover = $('vinylCover');
    const vinylLabel = $('vinylLabel');
    const fallbackSrc = settings.avatar.src || '';
    const coverSrc = track.cover || fallbackSrc;
    // 封面加载辅助函数：统一处理专辑封面+黑胶唱片中心
    function applyCoverImage(imgEl, src, isFallback) {
      imgEl.src = src;
      imgEl.referrerPolicy = 'no-referrer';
      imgEl.classList.add('has-cover');
      imgEl.onerror = function() {
        if (!isFallback && fallbackSrc && this.src !== fallbackSrc) {
          // 封面加载失败，尝试使用头像
          applyCoverImage(this, fallbackSrc, true);
        } else {
          this.classList.remove('has-cover');
          this.src = '';
        }
      };
    }
    if (coverSrc) {
      applyCoverImage(cover, coverSrc, false);
      // 同时更新黑胶唱片中心封面
      if (vinylLabel) {
        let labelImg = vinylLabel.querySelector('.vinyl-cover');
        if (!labelImg) {
          labelImg = document.createElement('img');
          labelImg.className = 'vinyl-cover';
          vinylLabel.insertBefore(labelImg, vinylLabel.firstChild);
        }
        applyCoverImage(labelImg, coverSrc, false);
      }
    } else {
      cover.classList.remove('has-cover');
      cover.src = '';
      if (vinylLabel) {
        const labelImg = vinylLabel.querySelector('.vinyl-cover');
        if (labelImg) labelImg.classList.remove('has-cover');
      }
    }
    // 倍速
    audioPlayer.playbackRate = settings.music.speed || 1.0;
    const speedBtn = $('musicSpeed');
    if (speedBtn) speedBtn.textContent = settings.music.speed.toFixed(1) + 'x';
    // 播放模式
    const modeLabels = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' };
    const modeBtn = $('musicMode');
    if (modeBtn) {
      modeBtn.innerHTML = MODE_ICONS[settings.music.playMode || 'list'];
      modeBtn.title = modeLabels[settings.music.playMode || 'list'];
    }
  }
  // 仅在非歌词获取中时重启歌词雨，避免切换歌曲时旧歌词闪现
  if (settings.music.lyricsRain && !lyricsFetching) {
    startLyricsRain();
  }
  // 更新收藏按钮状态
  updateFavoriteBtnState();
}

