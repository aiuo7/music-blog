/* ============================================================
   app-search.js — 搜索/歌单/事件模块
   ----------------------------------------------------------------
   在线音乐搜索（网易云音乐）、内联编辑、
   播放列表/收藏歌单、全局事件初始化、启动入口。
   必须最后加载（initEvents / DOMContentLoaded 在此）。
   ============================================================ */
'use strict';
/* ================================================================
   音乐搜索系统（多平台聚合 API，VIP/无版权自动过滤）
=============================================================== */

// 平台中文名映射（source 字段值 → 显示标签）
const MUSIC_SOURCE_LABELS = {
  netease: '网易云',
  kuwo: '酷我'
};

function getNeteaseApiBase() {
  const cfg = (window.PUBLIC_CONFIG && PUBLIC_CONFIG.music && PUBLIC_CONFIG.music.apiBase) || '';
  return String(cfg).replace(/\/+$/, '');
}

// 提取 API 服务的 origin（如 'http://127.0.0.1:8094'），用于把相对路径补全为绝对路径
// 跨域场景下（页面在 8080、API 在 8094）必须用绝对路径，否则相对路径会走页面所在端口
function getNeteaseOrigin() {
  const base = getNeteaseApiBase();
  if (!base) return '';
  try { return new URL(base).origin; } catch (e) { return ''; }
}

// 把相对路径补全为绝对路径（指向 API 服务器）
function resolveNeteaseUrl(url) {
  if (!url) return '';
  if (url.indexOf('http') === 0) return url;
  return getNeteaseOrigin() + url;
}

async function searchMusicOnline(keyword) {
  const resultsEl = $('musicSearchResults');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="music-search-loading">正在搜索网易云/酷我...</div>';
  const term = encodeURIComponent(keyword);
  const origin = getNeteaseOrigin();
  let results = [];

  // ---- 聚合搜索（多平台 source=all 并发拉取 + 跨平台去重，VIP/无版权已在服务端过滤） ----
  if (origin) {
    try {
      const res = await fetch(origin + '/api/search?keyword=' + term + '&source=all&limit=20', { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.songs)) {
          results = data.songs.map(function (s) {
            return {
              trackName: s.name || '未知歌曲',
              artistName: s.artist || '未知',
              previewUrl: resolveNeteaseUrl(s.url),          // /api/audio?source=&id= 补全为绝对路径（跨域可用）
              artworkUrl60: s.pic || '',
              artworkUrl100: s.pic || '',
              trackViewUrl: '',
              trackId: s.id || 0,
              duration: s.duration || 0,        // 毫秒
              source: s.source || '',           // 歌源：netease|kuwo|kugou
              isOnline: true,
              isNetEase: s.source === 'netease',
              isVip: false                      // 聚合端点已过滤，均为免费可播放
            };
          });
        }
      }
    } catch (e) {
      console.warn('aggregate search failed:', e.message || e);
    }
  }

  // ---- 未配置或无结果 ----
  if (!results || results.length === 0) {
    resultsEl.innerHTML = '<div class="music-search-loading">未找到可播放歌曲（各平台免费曲源已过滤 VIP/无版权）</div>';
    return;
  }
  renderMusicSearchResults(results);
}

function renderMusicSearchResults(results) {
  const resultsEl = $('musicSearchResults');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  // 数据来源标签：统计各平台命中数量
  const sourceCount = {};
  results.forEach(function (s) { sourceCount[s.source] = (sourceCount[s.source] || 0) + 1; });
  const sourceLabel = Object.keys(sourceCount)
    .map(function (k) { return (MUSIC_SOURCE_LABELS[k] || k) + ' ' + sourceCount[k]; })
    .join(' · ') || '未知来源';
  const label = document.createElement('div');
  label.className = 'music-search-source';
  label.textContent = '数据来源：' + sourceLabel + ' · 完整播放 · 已自动过滤 VIP';
  resultsEl.appendChild(label);
  results.forEach((song, idx) => {
    const item = document.createElement('div');
    item.className = 'music-search-item';
    const coverUrl = song.artworkUrl60 || '';
    const trackName = song.trackName || '未知歌曲';
    const artist = song.artistName || '未知';
    const durationStr = song.duration ? ' (' + formatTime(song.duration / 1000) + ')' : '';
    const srcTag = song.source ? '<span class="music-search-item-source">' + escapeHtml(MUSIC_SOURCE_LABELS[song.source] || song.source) + '</span>' : '';
    item.innerHTML = `
      <img class="music-search-item-cover" src="${coverUrl}" alt="" onerror="this.style.opacity=0">
      <div class="music-search-item-info">
        <div class="music-search-item-name">${escapeHtml(trackName)}${durationStr}${srcTag}</div>
        <div class="music-search-item-artist">${escapeHtml(artist)}</div>
      </div>
      <button class="music-search-item-add" data-idx="${idx}" title="加入列表"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="music-search-item-play" data-idx="${idx}" title="立即播放"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    `;
    item.querySelector('.music-search-item-add').onclick = () => addOnlineSongToPlaylist(song);
    item.querySelector('.music-search-item-play').onclick = () => playOnlineSongNow(song);
    resultsEl.appendChild(item);
  });
}

function playOnlineSongNow(song) {
  const trackName = song.trackName || '未知歌曲';
  const artist = song.artistName || '';
  const name = trackName + (artist ? ' - ' + artist : '');
  if (!song.previewUrl) {
    toast('该歌曲暂无试听链接');
    logPlayerError('load', 'playOnlineSongNow 无试听链接: ' + name);
    return;
  }
  var coverUrl = song.artworkUrl100 || '';
  const track = {
    name: name,
    artist: artist,
    id: song.trackId || song.id || 0,
    src: song.previewUrl,
    cover: coverUrl,
    isOnline: true,          // 在线曲目：不写入本地/云存储
    source: song.source || '',          // 歌源：netease|kuwo|kugou（区分聚合来源）
    isNetEase: !!song.isNetEase
  };
  // 去重：已存在则切换到该曲并播放，不再重复添加
  const existIdx = settings.music.tracks.findIndex(function(t) {
    return String(t.src || '') === String(track.src || '');
  });
  if (existIdx >= 0) {
    settings.music.currentIndex = existIdx;
    renderMusicTrackList();
    lyricsFetching = true;
    stopLyricsRain();
    applyMusicState();
    playMusic();
    toast('已在列表中，切换播放: ' + name);
    return;
  }
  settings.music.tracks.push(track);
  settings.music.currentIndex = settings.music.tracks.length - 1;
  renderMusicTrackList();
  // 标记正在切换，防止 applyMusicState 用旧歌词重启歌词雨
  lyricsFetching = true;
  stopLyricsRain();
  applyMusicState();
  playMusic();
  toast('正在播放: ' + name);
  // 在线试听不写入本地/云存储，仅当次播放
}

function addOnlineSongToPlaylist(song) {
  const trackName = song.trackName || '未知歌曲';
  const artist = song.artistName || '';
  const name = trackName + (artist ? ' - ' + artist : '');
  if (!song.previewUrl) {
    toast('该歌曲暂无试听链接');
    return;
  }
  var coverUrl = song.artworkUrl100 || '';
  const track = {
    name: name,
    artist: artist,
    id: song.trackId || song.id || 0,
    src: song.previewUrl,
    cover: coverUrl,
    isOnline: true,
    source: song.source || '',
    isNetEase: !!song.isNetEase
  };
  // 去重：已存在则提示，不重复添加
  if (isTrackInPlaylist(track, settings.music.tracks)) {
    toast('列表中已存在: ' + name);
    return;
  }
  settings.music.tracks.push(track);
  renderMusicTrackList();
  applyMusicState();
  toast('已添加: ' + name);
  // 在线试听不写入本地/云存储，仅当次会话可用
}

function openMusicSearch() {
  // 播放器右侧搜索浮层：点击搜索按钮在播放器上方弹出/收起搜索框
  const panel = $('musicSearchPanel');
  if (!panel) return;
  const willOpen = !panel.classList.contains('show');
  panel.classList.toggle('show', willOpen);
  if (willOpen) {
    setTimeout(() => {
      const input = $('musicSearchInput');
      if (input) input.focus();
    }, 120);
  }
}

/* ================================================================
   事件初始化
================================================================ */
/* ---------- 内联编辑（点击即编辑文本内容） ---------- */
function makeInlineEditable(el, settingsPath, applyFn, opts) {
  if (!el) return;
  opts = opts || {};
  el.classList.add('inline-editable');
  el.addEventListener('click', function(e) {
    if (el.querySelector('input, textarea')) return; // 已在编辑中
    e.stopPropagation();
    e.preventDefault();
    const currentText = (function() {
      var parts = settingsPath.split('.');
      var obj = settings;
      for (var i = 0; i < parts.length; i++) { obj = obj[parts[i]]; }
      return obj || '';
    })();
    const input = document.createElement(opts.multiline ? 'textarea' : 'input');
    input.value = currentText;
    input.className = 'inline-edit-input';
    input.maxLength = opts.maxLen || 50;
    // 继承元素字体样式
    var cs = window.getComputedStyle(el);
    input.style.fontFamily = cs.fontFamily;
    input.style.fontSize = cs.fontSize;
    input.style.fontWeight = cs.fontWeight;
    input.style.color = '#fff';
    input.style.background = 'rgba(255,255,255,0.08)';
    input.style.border = 'none';
    input.style.borderRadius = '8px';
    input.style.padding = '4px 12px';
    input.style.textAlign = 'center';
    input.style.outline = 'none';
    input.style.width = '100%';
    input.style.backdropFilter = 'blur(10px)';
    input.style.webkitBackdropFilter = 'blur(10px)';
    input.style.boxShadow = 'none';
    if (opts.multiline) { input.rows = 2; input.style.resize = 'none'; }
    el.textContent = '';
    el.appendChild(input);
    // 延迟focus确保DOM已渲染
    requestAnimationFrame(function() {
      input.focus();
      input.select();
    });
    const save = function() {
      var val = input.value.trim();
      // 写入 settings
      var parts = settingsPath.split('.');
      var obj = settings;
      for (var i = 0; i < parts.length - 1; i++) { obj = obj[parts[i]]; }
      obj[parts[parts.length - 1]] = val || (opts.placeholder || '');
      // 同步设置面板中的输入框
      var setInput = $(opts.syncId);
      if (setInput) setInput.value = val;
      applyFn();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter' && !opts.multiline) { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Enter' && opts.multiline && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { applyFn(); }
    });
  });
}

function initInlineEditing() {
  // 昵称：点击即编辑
  makeInlineEditable($('nickname'), 'nickname.text', applyNickname, { maxLen: 20, syncId: 'set_nickname' });
  // 个性签名：点击即编辑
  makeInlineEditable($('signature'), 'signature.text', applySignature, { maxLen: 50, multiline: true, syncId: 'set_sigText' });
}

/* ================================================================
   播放列表面板 + 收藏歌单
================================================================ */
function togglePlaylistPanel() {
  var panel = $('musicPlaylistPanel');
  var favPanel = $('musicFavoritesPanel');
  if (!panel) return;
  var isOpen = panel.classList.contains('show');
  if (isOpen) {
    panel.classList.remove('show');
    $('musicPlaylistToggle').classList.remove('active');
  } else {
    favPanel && favPanel.classList.remove('show');
    renderPlaylistPanel();
    panel.classList.add('show');
    $('musicPlaylistToggle').classList.add('active');
  }
}

function renderPlaylistPanel() {
  var body = $('playlistPanelBody');
  if (!body) return;
  if (settings.music.tracks.length === 0) {
    body.innerHTML = '<div class="pp-empty">播放列表为空，点击搜索按钮添加歌曲</div>';
    return;
  }
  body.innerHTML = settings.music.tracks.map(function(t, i) {
    var isCurrent = i === settings.music.currentIndex;
    var cover = t.cover || '';
    var artist = t.artist || (t.isOnline ? '' : '');
    var coverHtml = cover ? '<img class="pp-item-cover" src="' + escapeHtml(cover) + '" onerror="this.style.opacity=0">' : '<div class="pp-item-cover" style="display:flex;align-items:center;justify-content:center;font-size:14px;opacity:0.3">♪</div>';
    return '<div class="pp-item ' + (isCurrent ? 'current' : '') + '" data-idx="' + i + '">'
      + coverHtml
      + '<div class="pp-item-info"><div class="pp-item-name">' + escapeHtml(t.name) + '</div>'
      + (artist ? '<div class="pp-item-artist">' + escapeHtml(artist) + '</div>' : '')
      + '</div>'
      + '<button class="pp-item-del" data-del="' + i + '" title="删除">✕</button>'
      + '</div>';
  }).join('');
  // 点击播放
  body.querySelectorAll('.pp-item').forEach(function(item) {
    item.onclick = function(e) {
      if (e.target.classList.contains('pp-item-del')) return;
      var idx = +item.dataset.idx;
      settings.music.currentIndex = idx;
      applyMusicState();
      playMusic();
      renderPlaylistPanel();
    };
  });
  // 删除
  body.querySelectorAll('.pp-item-del').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      var idx = +btn.dataset.del;
      settings.music.tracks.splice(idx, 1);
      if (settings.music.currentIndex >= settings.music.tracks.length) {
        settings.music.currentIndex = Math.max(0, settings.music.tracks.length - 1);
      }
      applyMusicState();
      renderPlaylistPanel();
      renderMusicTrackList();
      autoSaveMusic();
    };
  });
}

function clearPlaylist() {
  if (settings.music.tracks.length === 0) {
    toast('播放列表已为空');
    return;
  }
  // 停止播放
  audioPlayer.pause();
  audioPlayer.src = '';
  $('vinylRecord').classList.remove('playing');
  setPlayIcon(false);
  stopVisualizer();
  stopVinylRotation();
  stopSmoothProgress();
  stopHeartbeat();
  stopLyricSync();
  stopLyricsRain();
  // 清空列表
  settings.music.tracks = [];
  settings.music.currentIndex = 0;
  settings.music.lyrics = '';
  applyMusicState();
  renderPlaylistPanel();
  renderMusicTrackList();
  toast('已清空播放列表');
  autoSaveMusic();
}

/* ---------- 收藏歌单 ---------- */
function toggleFavoritesPanel() {
  var panel = $('musicFavoritesPanel');
  var plPanel = $('musicPlaylistPanel');
  if (!panel) return;
  var isOpen = panel.classList.contains('show');
  if (isOpen) {
    panel.classList.remove('show');
  } else {
    plPanel && plPanel.classList.remove('show');
    $('musicPlaylistToggle').classList.remove('active');
    renderFavoritesPanel();
    panel.classList.add('show');
  }
}

function renderFavoritesPanel() {
  var body = $('favoritesPanelBody');
  if (!body) return;
  var favs = settings.music.favorites || [];
  var html = '';
  // 新建歌单夹
  html += '<div class="fav-folder-input-row" style="margin-bottom:10px">'
    + '<input type="text" class="fav-folder-input" id="newFavName" placeholder="输入歌单名称..." maxlength="20">'
    + '<button class="playlist-panel-btn" id="createFavBtn" style="width:100%;justify-content:center;margin-top:4px"><span>+ 新建歌单</span></button>'
    + '</div>';
  if (favs.length === 0) {
    html += '<div class="pp-empty">暂无收藏歌单，新建一个吧</div>';
  } else {
    favs.forEach(function(fav, fi) {
      html += '<div class="fav-folder" data-fi="' + fi + '">'
        + '<div class="fav-folder-header">'
        + '<span class="fav-folder-icon">📁</span>'
        + '<span class="fav-folder-name">' + escapeHtml(fav.name) + '</span>'
        + '<span class="fav-folder-count">' + fav.songs.length + '首</span>'
        + '<button class="fav-folder-del" data-del-fav="' + fi + '" title="删除歌单">✕</button>'
        + '</div>'
        + '<div class="fav-folder-body">';
      if (fav.songs.length === 0) {
        html += '<div class="pp-empty" style="padding:12px">歌单为空，在播放列表中收藏歌曲到此歌单</div>';
      } else {
        fav.songs.forEach(function(song, si) {
          html += '<div class="pp-item" data-fav="' + fi + '" data-si="' + si + '">'
            + (song.cover ? '<img class="pp-item-cover" src="' + escapeHtml(song.cover) + '" onerror="this.style.opacity=0">' : '<div class="pp-item-cover" style="display:flex;align-items:center;justify-content:center;font-size:14px;opacity:0.3">♪</div>')
            + '<div class="pp-item-info"><div class="pp-item-name">' + escapeHtml(song.name) + '</div></div>'
            + '<button class="pp-item-del" data-del-fav-song="' + fi + ':' + si + '" title="移除">✕</button>'
            + '</div>';
        });
      }
      html += '<div class="fav-folder-add" data-load-fav="' + fi + '">加载到播放列表 ▶</div>';
      html += '</div></div>';
    });
  }
  body.innerHTML = html;

  // 新建歌单
  var createBtn = $('createFavBtn');
  if (createBtn) {
    createBtn.onclick = function() {
      var nameInput = $('newFavName');
      var name = nameInput ? nameInput.value.trim() : '';
      if (!name) { toast('请输入歌单名称'); return; }
      settings.music.favorites.push({ name: name, songs: [] });
      renderFavoritesPanel();
      toast('已创建歌单：' + name);
      autoSaveMusic();
    };
  }
  // 展开/折叠歌单夹
  body.querySelectorAll('.fav-folder-header').forEach(function(h) {
    h.onclick = function(e) {
      if (e.target.classList.contains('fav-folder-del')) return;
      h.parentElement.classList.toggle('expanded');
    };
  });
  // 删除歌单夹
  body.querySelectorAll('[data-del-fav]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      var fi = +btn.dataset.delFav;
      settings.music.favorites.splice(fi, 1);
      renderFavoritesPanel();
      toast('已删除歌单');
      autoSaveMusic();
    };
  });
  // 删除歌单内歌曲
  body.querySelectorAll('[data-del-fav-song]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      var parts = btn.dataset.delFavSong.split(':');
      var fi = +parts[0], si = +parts[1];
      settings.music.favorites[fi].songs.splice(si, 1);
      renderFavoritesPanel();
      autoSaveMusic();
    };
  });
  // 加载歌单到播放列表
  body.querySelectorAll('[data-load-fav]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      var fi = +btn.dataset.loadFav;
      var fav = settings.music.favorites[fi];
      if (!fav || fav.songs.length === 0) { toast('歌单为空'); return; }
      // 深拷贝歌曲到播放列表
      fav.songs.forEach(function(s) {
        settings.music.tracks.push(JSON.parse(JSON.stringify(s)));
      });
      renderMusicTrackList();
      renderPlaylistPanel();
      applyMusicState();
      toast('已加载 ' + fav.songs.length + ' 首歌曲到播放列表');
      autoSaveMusic();
    };
  });
  // 点击歌单内歌曲播放
  body.querySelectorAll('.pp-item[data-fav]').forEach(function(item) {
    item.onclick = function(e) {
      if (e.target.classList.contains('pp-item-del')) return;
      var fi = +item.dataset.fav;
      var si = +item.dataset.si;
      var song = settings.music.favorites[fi].songs[si];
      if (!song) return;
      // 添加到播放列表并播放
      var newTrack = JSON.parse(JSON.stringify(song));
      settings.music.tracks.push(newTrack);
      settings.music.currentIndex = settings.music.tracks.length - 1;
      renderMusicTrackList();
      renderPlaylistPanel();
      applyMusicState();
      playMusic();
      autoSaveMusic();
    };
  });
}

// 收藏当前歌曲到歌单
function favoriteCurrentSong() {
  var track = settings.music.tracks[settings.music.currentIndex];
  if (!track) { toast('没有正在播放的歌曲'); return; }
  var favs = settings.music.favorites;
  if (favs.length === 0) {
    // 没有歌单，自动创建一个默认歌单
    favs.push({ name: '我的收藏', songs: [] });
  }
  // 检查是否已在某个歌单中
  var existingFav = null;
  var existingIdx = -1;
  for (var i = 0; i < favs.length; i++) {
    for (var j = 0; j < favs[i].songs.length; j++) {
      if (favs[i].songs[j].src === track.src) {
        existingFav = i; existingIdx = j; break;
      }
    }
    if (existingFav !== null) break;
  }
  if (existingFav !== null) {
    // 已收藏，取消收藏
    favs[existingFav].songs.splice(existingIdx, 1);
    $('musicFavoriteBtn').classList.remove('favorited');
    toast('已取消收藏');
    renderFavoritesPanel();
    return;
  }
  // 收藏到第一个歌单（或让用户选择）
  var songCopy = {
    name: track.name,
    src: track.src,
    cover: track.cover || '',
    artist: track.artist || '',
    isOnline: !!track.isOnline
  };
  if (favs.length === 1) {
    favs[0].songs.push(songCopy);
    $('musicFavoriteBtn').classList.add('favorited');
    toast('已收藏到「' + favs[0].name + '」');
  } else {
    // 多个歌单：收藏到第一个
    favs[0].songs.push(songCopy);
    $('musicFavoriteBtn').classList.add('favorited');
    toast('已收藏到「' + favs[0].name + '」');
  }
  renderFavoritesPanel();
  autoSaveMusic();
}

// 将整个播放列表存为收藏歌单
function savePlaylistAsFavorite() {
  if (settings.music.tracks.length === 0) { toast('播放列表为空'); return; }
  var name = '歌单 ' + (settings.music.favorites.length + 1);
  var songs = settings.music.tracks.map(function(t) {
    return {
      name: t.name, src: t.src, cover: t.cover || '',
      artist: t.artist || '', isOnline: !!t.isOnline
    };
  });
  settings.music.favorites.push({ name: name, songs: songs });
  toast('已收藏 ' + songs.length + ' 首歌曲到「' + name + '」');
  // 打开收藏面板展示结果
  $('musicPlaylistPanel').classList.remove('show');
  $('musicPlaylistToggle').classList.remove('active');
  renderFavoritesPanel();
  $('musicFavoritesPanel').classList.add('show');
  autoSaveMusic();
}

// 更新收藏按钮状态
function updateFavoriteBtnState() {
  var track = settings.music.tracks[settings.music.currentIndex];
  var btn = $('musicFavoriteBtn');
  if (!btn || !track) { if (btn) btn.classList.remove('favorited'); return; }
  var isFav = false;
  for (var i = 0; i < settings.music.favorites.length; i++) {
    for (var j = 0; j < settings.music.favorites[i].songs.length; j++) {
      if (settings.music.favorites[i].songs[j].src === track.src) { isFav = true; break; }
    }
    if (isFav) break;
  }
  btn.classList.toggle('favorited', isFav);
}

function initEvents() {
  // 设置面板
  $('settingsTrigger').onclick = (e) => { e.stopPropagation(); $('settingsPanel').classList.add('open'); };
  $('settingsClose').onclick = () => $('settingsPanel').classList.remove('open');
  // 点击空白区域收起设置面板（使用 capture 阶段，在 stopPropagation 之前拦截）
  document.addEventListener('click', (e) => {
    const panel = $('settingsPanel');
    if (!panel.classList.contains('open')) return;
    if (panel.contains(e.target) || (e.target.closest && e.target.closest('#settingsTrigger'))) return;
    // 点击音乐搜索按钮时不关闭面板（避免搜索中断）
    if (e.target.closest && e.target.closest('#musicSearchTrigger')) return;
    // 点击文件选择相关元素时不关闭面板（避免导入音乐时面板被关闭）
    if (e.target.id === 'musicFileInput' || e.target.closest && e.target.closest('#set_importMusic')) return;
    // 点击自定义下拉/颜色面板的浮动层时不关闭面板（这些层挂在 body 下，不在 settingsPanel 内）
    if (e.target.closest && (e.target.closest('.cselect-options') || e.target.closest('.ccolor-panel'))) return;
    panel.classList.remove('open');
  }, true);
  // 降雪强度循环按钮已移除（天气类型简化）
  $('settingsSave').onclick = () => { saveUserSettings(); };
  $('settingsReset').onclick = resetToDefault;

  // 天气眼睛
  $('weatherEye').onclick = () => {
    settings.weather.enabled = !settings.weather.enabled;
    const toggle = $('set_weatherEnable');
    if (toggle) toggle.classList.toggle('on', settings.weather.enabled);
    applyWeather();
  };

  // 头像点击上传
  $('avatarPlus').onclick = (e) => { e.stopPropagation(); $('avatarFileInput').click(); };
  $('avatarFrame').onclick = () => $('avatarFileInput').click();

  // 裁剪
  $('cropCancel').onclick = () => $('cropModal').classList.remove('show');
  $('cropConfirm').onclick = confirmCrop;
  initCropDrag();

  // 音乐
  $('musicPlay').onclick = togglePlay;
  $('musicNext').onclick = musicNext;
  $('musicPrev').onclick = musicPrev;
  $('musicSpeed').onclick = toggleSpeed;
  $('musicMode') && ($('musicMode').onclick = togglePlayMode);
  $('musicSearchTrigger').onclick = openMusicSearch;
  // 音乐搜索浮层（播放器右侧上方）
  $('musicSearchPanelClose').onclick = () => $('musicSearchPanel').classList.remove('show');
  $('musicSearchGo').onclick = () => {
    const kw = $('musicSearchInput').value.trim();
    if (kw) searchMusicOnline(kw);
  };
  $('musicSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const kw = e.target.value.trim();
      if (kw) searchMusicOnline(kw);
    }
  });
  // 点击浮层外部 / ESC 关闭搜索浮层
  document.addEventListener('click', (e) => {
    const panel = $('musicSearchPanel');
    if (panel && panel.classList.contains('show') &&
        !panel.contains(e.target) && !(e.target.closest && e.target.closest('#musicSearchTrigger'))) {
      panel.classList.remove('show');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const panel = $('musicSearchPanel');
      if (panel && panel.classList.contains('show')) panel.classList.remove('show');
    }
  });
  $('musicLyricsToggle').onclick = () => {
    settings.music.lyricsRain = !settings.music.lyricsRain;
    $('musicLyricsToggle').classList.toggle('active', settings.music.lyricsRain);
    const toggle = $('set_lyricsRain');
    if (toggle) toggle.classList.toggle('on', settings.music.lyricsRain);
    toggleLyricsRain();
    autoSaveMusic();
  };
  // 播放列表面板
  $('musicPlaylistToggle').onclick = togglePlaylistPanel;
  $('musicFavoriteBtn').onclick = favoriteCurrentSong;
  $('playlistClearBtn').onclick = clearPlaylist;
  $('playlistAddFavBtn').onclick = savePlaylistAsFavorite;
  $('playlistViewFavBtn') && ($('playlistViewFavBtn').onclick = toggleFavoritesPanel);
  $('playlistPanelClose').onclick = function() {
    $('musicPlaylistPanel').classList.remove('show');
    $('musicPlaylistToggle').classList.remove('active');
  };
  $('favoritesPanelClose').onclick = function() {
    $('musicFavoritesPanel').classList.remove('show');
  };
  audioPlayer.addEventListener('timeupdate', updateMusicProgress);
  audioPlayer.addEventListener('ended', musicNext);
  // 音频加载失败处理：聚合源走服务器代理（URL 稳定），失败多为 VIP/无版权/下载失败，移除该曲并切下一首
  audioPlayer.addEventListener('error', function() {
    var track = settings.music.tracks[settings.music.currentIndex];
    if (track && track.isOnline) {
      var errorDetail = '';
      if (audioPlayer.error) {
        switch (audioPlayer.error.code) {
          case 1: errorDetail = '加载被中断'; break;
          case 2: errorDetail = '网络错误'; break;
          case 3: errorDetail = '解码失败'; break;
          case 4: errorDetail = '源不可用（可能为VIP歌曲）'; break;
        }
      }
      console.warn('Audio error:', errorDetail, 'src:', track.src);
      // 记录到错误日志缓冲区，便于排查
      var errType = 'other';
      if (audioPlayer.error) {
        if (audioPlayer.error.code === 2) errType = 'network';
        else if (audioPlayer.error.code === 3) errType = 'decode';
        else if (audioPlayer.error.code === 4) errType = 'permission';
        else if (audioPlayer.error.code === 1) errType = 'load';
      }
      logPlayerError(errType, errorDetail + ' | src=' + track.src + ' | name=' + (track.name || ''));
      // 聚合源（source 字段，或旧网易云 isNetEase）：URL 由服务器代理稳定不变，重试无意义，直接移除
      if (track.source || track.isNetEase) {
        consecutiveAudioErrors = 0;
        var failIdx = settings.music.tracks.indexOf(track);
        if (failIdx >= 0) {
          settings.music.tracks.splice(failIdx, 1);
          if (settings.music.currentIndex >= settings.music.tracks.length) {
            settings.music.currentIndex = Math.max(0, settings.music.tracks.length - 1);
          }
          renderMusicTrackList();
        }
        toast('该歌曲无法播放（VIP或无版权），已移除');
        if (settings.music.tracks.length === 0) {
          pauseMusic();
        } else {
          applyMusicState();
          playMusic();
        }
        return;
      }
      // 其它在线源（iTunes 试听等）：累计错误，达到阈值提示
      consecutiveAudioErrors++;
      if (consecutiveAudioErrors < settings.music.tracks.length) {
        toast('歌曲加载失败' + (errorDetail ? '（' + errorDetail + '）' : '') + '，自动切换下一首');
        setTimeout(function() { musicNext(); }, 800);
      } else {
        toast('多首歌曲加载失败，请尝试重新搜索或更换歌曲');
        consecutiveAudioErrors = 0;
      }
    }
  });
  audioPlayer.addEventListener('playing', function() { consecutiveAudioErrors = 0; });

  // 音量控制
  $('musicVolumeBtn').onclick = toggleMute;
  const volSlider = $('musicVolumeSlider');
  if (volSlider) {
    volSlider.addEventListener('input', function(e) {
      setVolume(parseInt(e.target.value, 10) / 100);
    });
  }

  // 键盘快捷键系统
  initKeyboardShortcuts();

  // 初始化内联编辑
  initInlineEditing();

  // 页面隐藏/关闭时立即保存音乐列表（防止防抖未触发就丢失）
  window.addEventListener('pagehide', () => {
    if (musicSaveTimer) { clearTimeout(musicSaveTimer); musicSaveTimer = null; saveUserSettings(true); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && musicSaveTimer) {
      clearTimeout(musicSaveTimer); musicSaveTimer = null; saveUserSettings(true);
    }
  });
}

/* ================================================================
   快捷键系统
   ----------------------------------------------------------------
   参考 Spotify / Apple Music / QQ音乐 通用键位：
     Space        播放/暂停
     Ctrl+←/→     上一曲 / 下一曲
     ← / →        进度后退/前进 5 秒
     Ctrl+↑/↓     音量 +5% / -5%
     M            静音切换
     R            切换播放模式（列表/单曲/随机）
     S            切换倍速
     L            打开/关闭播放列表
     F            打开/关闭搜索
     K            切换歌词雨
   在 input/textarea/contenteditable 中输入时不响应。
   快捷键说明通过各按钮的 title 属性悬浮显示，不再单独建弹窗。
================================================================ */
function isTypingInInput(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (e.target && e.target.isContentEditable) return true;
  return false;
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {
    // 在输入框中不响应快捷键
    if (isTypingInInput(e)) return;

    const tracks = settings.music.tracks;
    if (tracks.length === 0 && !['f', 'F', 'l', 'L', 'k', 'K'].includes(e.key)) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+← 上一曲
          musicPrev();
        } else {
          // ← 进度后退 5 秒
          if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
            toast('后退 5 秒');
          }
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+→ 下一曲
          musicNext();
        } else {
          // → 进度前进 5 秒
          if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
            audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
            toast('前进 5 秒');
          }
        }
        break;
      case 'ArrowUp':
        // 仅 Ctrl+↑ 调节音量，避免页面滚动冲突
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setVolume((settings.music.volume != null ? settings.music.volume : 0.8) + 0.05);
        }
        break;
      case 'ArrowDown':
        // 仅 Ctrl+↓ 调节音量，避免页面滚动冲突
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setVolume((settings.music.volume != null ? settings.music.volume : 0.8) - 0.05);
        }
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        if ($('musicMode')) togglePlayMode();
        break;
      case 's':
      case 'S':
        e.preventDefault();
        if ($('musicSpeed')) toggleSpeed();
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        togglePlaylistPanel();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        openMusicSearch();
        break;
      case 'k':
      case 'K':
        e.preventDefault();
        if ($('musicLyricsToggle')) $('musicLyricsToggle').click();
        break;
    }
  });
}

/* ---------- 启动 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  enterMainPage();
});
