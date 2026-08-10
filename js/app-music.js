/* ============================================================
   app-music.js — 音乐播放器模块
   ----------------------------------------------------------------
   播放控制、歌词同步、音波可视化、黑胶旋转、心跳律动、歌词雨、
   媒体导入、背景轮播。
   依赖 app-core.js / app-effects.js 的全局状态与工具函数。
   ============================================================ */
'use strict';
/* ================================================================
   音乐播放器
================================================================ */
async function handleMusicImport(files) {
  const fileArr = Array.from(files);
  if (fileArr.length === 0) return;
  // 进度展示容器（位于设置面板内导入按钮下方）
  const progEl = $('musicImportProgress');
  const showProgress = !!progEl;
  if (showProgress) {
    progEl.style.display = 'block';
    progEl.innerHTML = '';
  }
  function setProgress(text, pct) {
    if (!progEl) return;
    const bar = '<div class="mip-bar"><div class="mip-fill" style="width:' + (pct != null ? pct : 0) + '%"></div></div>';
    progEl.innerHTML = '<div class="mip-text">' + text + '</div>' + (pct != null ? bar : '');
  }
  toast('上传中...');
  try {
    let done = 0;
    for (const file of fileArr) {
      if (showProgress) setProgress('正在上传: ' + file.name + ' (' + (done + 1) + '/' + fileArr.length + ')', Math.round(done / fileArr.length * 100));
      const audioUrl = await uploadAsset(file, 'audi', getFileExt(file));
      let coverUrl = '';
      try {
        const coverDataUrl = await extractAlbumCover(file);
        if (coverDataUrl) {
          const coverBlob = dataUrlToBlob(coverDataUrl);
          coverUrl = await uploadAsset(coverBlob, 'audi', 'jpg');
        }
      } catch (e) { /* cover extraction failed, ignore */ }
      settings.music.tracks.push({
        name: file.name.replace(/\.[^.]+$/, ''),
        src: audioUrl,
        cover: coverUrl
      });
      done++;
    }
    if (showProgress) setProgress('已完成 ' + done + ' 首导入', 100);
    renderMusicTrackList();
    applyMusicState();
    toast('已导入 ' + fileArr.length + ' 首音乐');
    autoSaveMusic();
    // 3 秒后隐藏进度
    if (showProgress) setTimeout(() => { if (progEl) { progEl.style.display = 'none'; progEl.innerHTML = ''; } }, 3000);
  } catch (e) {
    if (showProgress) setProgress('上传失败: ' + (e.message || ''), null);
    toast('上传失败：' + (e.message || ''));
  }
}

/* 从音频文件ID3标签中提取专辑封面 */
function extractAlbumCover(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const buf = e.target.result;
        const dv = new DataView(buf);
        // 检查ID3v2头部
        if (dv.byteLength < 10 || dv.getUint8(0) !== 0x49 || dv.getUint8(1) !== 0x44 || dv.getUint8(2) !== 0x33) {
          resolve(null);
          return;
        }
        const version = dv.getUint8(3);
        // 计算ID3标签大小（同步安全整数）
        let tagSize = (dv.getUint8(6) << 21) | (dv.getUint8(7) << 14) | (dv.getUint8(8) << 7) | dv.getUint8(9);
        let offset = 10;
        const endOffset = Math.min(10 + tagSize, dv.byteLength);

        while (offset < endOffset - 10) {
          let frameId, frameSize, frameFlags;
          if (version === 4 || version === 3) {
            frameId = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
            if (version === 4) {
              frameSize = (dv.getUint8(offset+4) << 21) | (dv.getUint8(offset+5) << 14) | (dv.getUint8(offset+6) << 7) | dv.getUint8(offset+7);
            } else {
              frameSize = dv.getUint32(offset+4);
            }
            frameFlags = dv.getUint16(offset+8);
            offset += 10;
          } else {
            frameId = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2));
            frameSize = (dv.getUint8(offset+3) << 16) | (dv.getUint8(offset+4) << 8) | dv.getUint8(offset+5);
            offset += 6;
          }

          if (frameSize <= 0 || offset + frameSize > dv.byteLength) break;

          // APIC (ID3v2.3/2.4) 或 PIC (ID3v2.2) = 专辑封面
          if (frameId === 'APIC' || frameId === 'PIC') {
            const frameData = new Uint8Array(buf, offset, frameSize);
            // 找到JPEG或PNG的起始位置
            let imgStart = -1;
            let mime = 'image/jpeg';
            for (let i = 0; i < frameData.length - 3; i++) {
              if (frameData[i] === 0xFF && frameData[i+1] === 0xD8 && frameData[i+2] === 0xFF) {
                imgStart = i; mime = 'image/jpeg'; break;
              }
              if (frameData[i] === 0x89 && frameData[i+1] === 0x50 && frameData[i+2] === 0x4E && frameData[i+3] === 0x47) {
                imgStart = i; mime = 'image/png'; break;
              }
            }
            if (imgStart >= 0) {
              const imgData = frameData.slice(imgStart);
              const blob = new Blob([imgData], { type: mime });
              const url = URL.createObjectURL(blob);
              resolve(url);
              return;
            }
          }
          offset += frameSize;
        }
        resolve(null);
      } catch (err) {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file.slice(0, 256 * 1024)); // 只读前256KB查找标签
  });
}

function setupAudioContext() {
  if (audioContext) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // 不创建 MediaElementSource，避免跨域音频（iTunes 等）被静音
    // 音波可视化使用模拟动画（startVisualizer 中已实现 fallback）
  } catch (e) {
    console.warn('Audio context not available');
  }
}

function playMusic() {
  if (settings.music.tracks.length === 0) {
    toast('请先在设置中导入音乐');
    return;
  }
  const track = settings.music.tracks[settings.music.currentIndex];
  if (!track) return;
  // 先获取歌词（避免音频下载阻塞歌词请求，因为服务器是单线程）
  currentLrcLines = [];
  stopLyricSync();
  settings.music.lyricsRain = true;
  const _lrToggle = $('set_lyricsRain');
  if (_lrToggle) _lrToggle.classList.add('on');
  const _lrBtn = $('musicLyricsToggle');
  if (_lrBtn) _lrBtn.classList.add('active');
  stopLyricsRain();
  lyricsFetching = true;
  // 生成唯一曲目标识，防止快速切换歌曲时旧歌词覆盖新歌词
  const trackId = Date.now() + '_' + settings.music.currentIndex;
  currentLyricsTrackId = trackId;
  // 异步获取歌词（先于音频加载发起请求）
  var lyricsPromise = fetchLyricsForTrack(track).then(function(lines) {
    // 检查是否还是当前歌曲（防止快速切换时旧歌词覆盖）
    if (currentLyricsTrackId !== trackId) return;
    lyricsFetching = false;
    if (lines.length > 0) {
      currentLrcLines = lines;
      startLyricSync();
      settings.music.lyrics = lines.map(function(l) { return l.text; }).join('\n');
      const lrcInput = $('set_lyrics');
      if (lrcInput) lrcInput.value = settings.music.lyrics;
      startLyricsRain();
    } else {
      settings.music.lyrics = '';
      const lrcInput2 = $('set_lyrics');
      if (lrcInput2) lrcInput2.value = '';
      const lineEl = $('musicLyricsLine');
      if (lineEl) lineEl.textContent = '';
      stopLyricsRain();
      settings.music.lyricsRain = false;
      const lrToggle2 = $('set_lyricsRain');
      if (lrToggle2) lrToggle2.classList.remove('on');
      const lrBtn2 = $('musicLyricsToggle');
      if (lrBtn2) lrBtn2.classList.remove('active');
    }
  }).catch(function() {
    if (currentLyricsTrackId !== trackId) return;
    lyricsFetching = false;
  });
  // 延迟100ms再加载音频，确保歌词请求先到达服务器
  setTimeout(function() {
    audioPlayer.src = track.src;
    // 仅 iTunes 30s 试听开启无缝循环（聚合源完整播放/本地文件不循环，播完自然进入下一首）
    audioPlayer.loop = !!(track && track.isOnline && !track.source && !track.isNetEase);
    audioPlayer.playbackRate = settings.music.speed || 1.0;
    // 同步音量/静音状态到 audioPlayer（切歌时保持用户设置）
    applyVolumeToAudio();
    if (!audioContext) { setupAudioContext(); }
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    audioPlayer.play().catch(function(err) {
      const errName = err && err.name || '';
      const errDetail = errName + (err.message ? (': ' + err.message) : '');
      // 分类记录错误日志
      if (errName === 'NotAllowedError') {
        logPlayerError('permission', '自动播放被浏览器拦截: ' + errDetail);
      } else if (errName === 'NotSupportedError') {
        logPlayerError('decode', '音频格式不支持或源不可用: ' + errDetail + ' src=' + track.src);
      } else if (errName === 'AbortError') {
        logPlayerError('load', '加载被中断（可能是快速切歌）: ' + errDetail);
      } else {
        logPlayerError('other', '播放失败: ' + errDetail + ' src=' + track.src);
      }
      console.warn('Audio play failed:', err.message || err);
      // 区分自动播放限制和加载失败，给出对应提示
      if (errName === 'NotAllowedError') {
        toast('请点击播放按钮开始播放');
      } else if (errName === 'NotSupportedError') {
        toast('音频格式不支持或源不可用');
      } else {
        toast('歌曲加载中，请稍候...');
      }
    });
  }, 100);
  $('vinylRecord').classList.add('playing');
  const leftAlbum = $('musicAlbum');
  if (leftAlbum) leftAlbum.classList.add('playing');
  setPlayIcon(true);
  startVisualizer();
  startVinylRotation();
  startSmoothProgress();
  startHeartbeat();
}

function pauseMusic() {
  audioPlayer.pause();
  $('vinylRecord').classList.remove('playing');
  const leftAlbum = $('musicAlbum');
  if (leftAlbum) leftAlbum.classList.remove('playing');
  setPlayIcon(false);
  stopVisualizer();
  stopVinylRotation();
  stopSmoothProgress();
  stopHeartbeat();
  stopLyricSync();
}

function togglePlay() {
  if (audioPlayer.paused) {
    // 暂停后恢复：直接 play()，保持当前进度；仅当无 src 时才走 playMusic
    if (audioPlayer.src) {
      audioPlayer.play().catch(function(e) {
        logPlayerError('other', 'togglePlay 恢复播放失败: ' + (e.message || e));
      });
      $('vinylRecord').classList.add('playing');
      const leftAlbum = $('musicAlbum');
      if (leftAlbum) leftAlbum.classList.add('playing');
      setPlayIcon(true);
      startVisualizer();
      startVinylRotation();
      startSmoothProgress();
      startHeartbeat();
    } else {
      playMusic();
    }
  } else {
    pauseMusic();
  }
}

function musicNext() {
  if (settings.music.tracks.length === 0) return;
  const mode = settings.music.playMode || 'list';
  if (mode === 'single') {
    // 单曲循环：不切换曲目，重新播放
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
    return;
  }
  // 标记正在切换，防止 applyMusicState 用旧歌词重启歌词雨
  lyricsFetching = true;
  stopLyricsRain();
  if (mode === 'shuffle') {
    let idx;
    do { idx = Math.floor(Math.random() * settings.music.tracks.length); }
    while (settings.music.tracks.length > 1 && idx === settings.music.currentIndex);
    settings.music.currentIndex = idx;
  } else {
    // 列表循环
    settings.music.currentIndex = (settings.music.currentIndex + 1) % settings.music.tracks.length;
  }
  applyMusicState();
  renderMusicTrackList();
  playMusic();
}

function musicPrev() {
  if (settings.music.tracks.length === 0) return;
  const mode = settings.music.playMode || 'list';
  if (mode === 'single') {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
    return;
  }
  // 标记正在切换，防止 applyMusicState 用旧歌词重启歌词雨
  lyricsFetching = true;
  stopLyricsRain();
  if (mode === 'shuffle') {
    let idx;
    do { idx = Math.floor(Math.random() * settings.music.tracks.length); }
    while (settings.music.tracks.length > 1 && idx === settings.music.currentIndex);
    settings.music.currentIndex = idx;
  } else {
    settings.music.currentIndex = (settings.music.currentIndex - 1 + settings.music.tracks.length) % settings.music.tracks.length;
  }
  applyMusicState();
  renderMusicTrackList();
  playMusic();
}

function togglePlayMode() {
  const modes = ['list', 'single', 'shuffle'];
  const labels = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' };
  const cur = modes.indexOf(settings.music.playMode || 'list');
  const next = (cur + 1) % modes.length;
  settings.music.playMode = modes[next];
  const btn = $('musicMode');
  if (btn) {
    btn.innerHTML = MODE_ICONS[settings.music.playMode];
    btn.title = labels[settings.music.playMode];
  }
  toast(labels[settings.music.playMode]);
  autoSaveMusic();
}

function toggleSpeed() {
  const currentIdx = SPEED_OPTIONS.indexOf(settings.music.speed);
  const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
  settings.music.speed = SPEED_OPTIONS[nextIdx];
  audioPlayer.playbackRate = settings.music.speed;
  $('musicSpeed').textContent = settings.music.speed.toFixed(1) + 'x';
  toast('播放速度: ' + settings.music.speed.toFixed(1) + 'x');
  autoSaveMusic();
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function updateMusicProgress() {
  if (isDraggingProgress) return;
  if (audioPlayer.duration) {
    const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    $('musicProgressBar').style.width = pct + '%';
    $('musicProgressThumb').style.left = pct + '%';
    const curTime = $('musicCurrentTime');
    const durTime = $('musicDuration');
    if (curTime) curTime.textContent = formatTime(audioPlayer.currentTime);
    if (durTime) durTime.textContent = formatTime(audioPlayer.duration);
  }
}

/* 高帧率进度更新（流畅，替代timeupdate的4fps） */
function startSmoothProgress() {
  stopSmoothProgress();
  function tick() {
    if (!isDraggingProgress && audioPlayer.duration) {
      const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
      $('musicProgressBar').style.width = pct + '%';
      $('musicProgressThumb').style.left = pct + '%';
      const curTime = $('musicCurrentTime');
      if (curTime) curTime.textContent = formatTime(audioPlayer.currentTime);
    }
    progressRAF = requestAnimationFrame(tick);
  }
  tick();
}
function stopSmoothProgress() {
  if (progressRAF) cancelAnimationFrame(progressRAF);
  progressRAF = null;
}

/* ---------- 进度条拖拽 ---------- */
function initProgressDrag() {
  const container = $('musicProgressContainer');
  if (!container) return;
  const seek = function(clientX) {
    const rect = container.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    $('musicProgressBar').style.width = (pct * 100) + '%';
    $('musicProgressThumb').style.left = (pct * 100) + '%';
    // 即使 duration 未就绪也尝试 seek（部分浏览器支持）
    if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
      audioPlayer.currentTime = pct * audioPlayer.duration;
    } else {
      // duration 未就绪时记录待 seek 的百分比，等 loadedmetadata 后执行
      audioPlayer._pendingSeek = pct;
    }
    const curTime = $('musicCurrentTime');
    if (curTime && audioPlayer.duration && !isNaN(audioPlayer.duration)) {
      curTime.textContent = formatTime(audioPlayer.currentTime);
    } else if (curTime) {
      curTime.textContent = formatTime(pct * (audioPlayer.duration || 0));
    }
  };
  // 阻止默认行为防止文本选中等干扰
  container.addEventListener('mousedown', function(e) {
    e.preventDefault();
    isDraggingProgress = true;
    container.classList.add('dragging');
    seek(e.clientX);
  });
  document.addEventListener('mousemove', function(e) {
    if (isDraggingProgress) seek(e.clientX);
  });
  document.addEventListener('mouseup', function() {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      container.classList.remove('dragging');
    }
  });
  // 触摸支持
  container.addEventListener('touchstart', function(e) {
    isDraggingProgress = true;
    container.classList.add('dragging');
    if (e.touches[0]) seek(e.touches[0].clientX);
  }, {passive:true});
  document.addEventListener('touchmove', function(e) {
    if (isDraggingProgress && e.touches[0]) seek(e.touches[0].clientX);
  }, {passive:true});
  document.addEventListener('touchend', function() {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      container.classList.remove('dragging');
    }
  });
  // duration 就绪后执行待 seek
  audioPlayer.addEventListener('loadedmetadata', function() {
    if (typeof audioPlayer._pendingSeek === 'number') {
      audioPlayer.currentTime = audioPlayer._pendingSeek * audioPlayer.duration;
      delete audioPlayer._pendingSeek;
    }
  });
}

/* ---------- 歌词智能识别与同步 ---------- */
function parseLRC(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  lines.forEach(function(line) {
    const matches = [];
    let m;
    while ((m = timeReg.exec(line)) !== null) {
      matches.push(parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100));
    }
    const text = line.replace(timeReg, '').trim();
    if (matches.length > 0 && text) {
      matches.forEach(function(t) { result.push({time: t, text: text}); });
    }
  });
  result.sort(function(a, b) { return a.time - b.time; });
  return result;
}

// 在线曲目：通过统一 /api/lyrics 端点获取歌词（按 source 路由，本地/iTunes 无接口返回空）
// 向后兼容：旧收藏曲可能只有 isNetEase 而无 source，回退按 netease 处理
async function fetchLyricsForTrack(track) {
  if (!track || !track.isOnline) return [];
  var src = track.source || (track.isNetEase ? 'netease' : '');
  if (!src || !track.id) return [];
  try {
    const url = resolveNeteaseUrl('/api/lyrics?source=' + encodeURIComponent(src) + '&id=' + encodeURIComponent(track.id));
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    // 网易云：{lrc:{lyric:"[00:01.00]..."}}
    if (src === 'netease') {
      let lrcText = '';
      if (data && typeof data === 'object') {
        if (data.lrc && typeof data.lrc.lyric === 'string') lrcText = data.lrc.lyric;
        else if (data.tlyric && typeof data.tlyric.lyric === 'string') lrcText = data.tlyric.lyric;
        else if (typeof data.lyric === 'string') lrcText = data.lyric;
      } else if (typeof data === 'string') {
        lrcText = data;
      }
      if (!lrcText) return [];
      return parseLRC(lrcText);
    }
    // 酷我：{data:{lrclist:[{time:"12.34", lineLyric:"..."}]}}（time 为秒）
    if (src === 'kuwo') {
      if (data && data.data && Array.isArray(data.data.lrclist)) {
        return data.data.lrclist.map(function (item) {
          return { time: parseFloat(item.time) || 0, text: (item.lineLyric || '').trim() };
        }).filter(function (item) { return item.text; });
      }
      return [];
    }
    // 酷狗：暂不支持歌词
    return [];
  } catch (e) {
    console.warn('fetch lyrics failed:', e.message || e);
    return [];
  }
}

function startLyricSync() {
  stopLyricSync();
  if (currentLrcLines.length === 0) return;
  const lineEl = $('musicLyricsLine');
  function tick() {
    const t = audioPlayer.currentTime;
    let idx = -1;
    for (let i = currentLrcLines.length - 1; i >= 0; i--) {
      if (t >= currentLrcLines[i].time) { idx = i; break; }
    }
    if (idx !== currentLrcIndex) {
      currentLrcIndex = idx;
      if (idx >= 0 && lineEl) {
        lineEl.textContent = currentLrcLines[idx].text;
        lineEl.classList.add('singing');
      } else if (lineEl) {
        lineEl.textContent = '';
        lineEl.classList.remove('singing');
      }
    }
    lrcSyncRAF = requestAnimationFrame(tick);
  }
  tick();
}
function stopLyricSync() {
  if (lrcSyncRAF) cancelAnimationFrame(lrcSyncRAF);
  lrcSyncRAF = null;
  currentLrcIndex = -1;
  const lineEl = $('musicLyricsLine');
  if (lineEl) { lineEl.textContent = ''; lineEl.classList.remove('singing'); }
}

/* ---------- 底部微光粒子律动特效 ---------- */
function initHeartbeat() {
  heartbeatCanvas = $('musicHeartbeat');
  if (!heartbeatCanvas) return;
  heartbeatCtx = heartbeatCanvas.getContext('2d');
  const resize = function() {
    heartbeatCanvas.width = heartbeatCanvas.offsetWidth || 300;
    heartbeatCanvas.height = heartbeatCanvas.offsetHeight || 48;
  };
  resize();
  window.addEventListener('resize', resize);
}

function startHeartbeat() {
  if (!heartbeatCanvas) initHeartbeat();
  if (!heartbeatCtx) return;
  stopHeartbeat();
  // 确保canvas有有效尺寸
  if (heartbeatCanvas.width < 2) heartbeatCanvas.width = heartbeatCanvas.offsetWidth || 300;
  if (heartbeatCanvas.height < 2) heartbeatCanvas.height = heartbeatCanvas.offsetHeight || 48;
  const ctx = heartbeatCtx;
  let W = heartbeatCanvas.width, H = heartbeatCanvas.height;
  // 跟随音频频率的频谱条律动系统
  const barCount = 56;
  const bars = new Array(barCount).fill(0);

  function draw() {
    W = heartbeatCanvas.width; H = heartbeatCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const now = Date.now() * 0.001;

    // 获取音频频率数据
    let dataArray = null;
    if (analyser) {
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
    }

    const barSpace = W / barCount;
    const gap = Math.max(1, barSpace * 0.28);
    const bw = barSpace - gap;

    for (let i = 0; i < barCount; i++) {
      let v = 0;
      if (dataArray && dataArray.length > 0) {
        // 对数分布取样，低频密高频疏，聚焦前55%频段
        const ratio = i / barCount;
        const idx = Math.floor(Math.pow(ratio, 1.6) * (dataArray.length * 0.55));
        v = dataArray[Math.min(idx, dataArray.length - 1)] / 255;
      } else {
        // 无音频时柔和呼吸波，保持律动感
        v = (Math.sin(now * 1.1 + i * 0.45) * 0.5 + 0.5) * 0.22 + 0.04;
      }
      // 平滑衰减，让跳动更自然
      bars[i] = Math.max(v, bars[i] * 0.88);

      const h = Math.max(1.5, bars[i] * H * 0.92);
      const x = i * barSpace + gap / 2;
      const y = H - h;

      // 颜色：蓝→紫→粉渐变
      const hue = 205 + (i / barCount) * 75;
      const grad = ctx.createLinearGradient(0, H, 0, H - H * 0.92);
      grad.addColorStop(0, 'hsla(' + hue + ',82%,55%,0.12)');
      grad.addColorStop(0.55, 'hsla(' + hue + ',86%,60%,0.45)');
      grad.addColorStop(1, 'hsla(' + hue + ',92%,72%,0.82)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, bw, h);

      // 顶部圆点高光
      if (bars[i] > 0.08) {
        ctx.fillStyle = 'hsla(' + hue + ',95%,82%,' + (bars[i] * 0.7).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x + bw / 2, y, Math.min(bw * 0.45, 2.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    heartbeatAnimId = requestAnimationFrame(draw);
  }
  draw();
}
function stopHeartbeat() {
  if (heartbeatAnimId) cancelAnimationFrame(heartbeatAnimId);
  heartbeatAnimId = null;
  if (heartbeatCtx) heartbeatCtx.clearRect(0, 0, heartbeatCanvas.width, heartbeatCanvas.height);
}

/* ---------- 音乐可视化（微光粒子流） ---------- */
function initVisualizer() {
  const canvas = $('visualizerCanvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || (canvas.parentElement ? canvas.parentElement.offsetWidth : 300) || 300;
  canvas.height = canvas.offsetHeight || (canvas.parentElement ? canvas.parentElement.offsetHeight : 60) || 60;
}

function startVisualizer() {
  stopVisualizer();
  const canvas = $('visualizerCanvas');
  if (!canvas) return;
  // 确保canvas有有效尺寸，使用父元素尺寸作为回退
  const parent = canvas.parentElement;
  canvas.width = canvas.offsetWidth || (parent ? parent.offsetWidth : 300) || 300;
  canvas.height = canvas.offsetHeight || (parent ? parent.offsetHeight : 60) || 60;
  if (canvas.width < 2) canvas.width = 300;
  if (canvas.height < 2) canvas.height = 60;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  // 微光粒子流系统
  const particles = [];
  const maxParticles = 80;

  function spawnParticle(intensity) {
    const x = Math.random() * W;
    const baseY = H * (0.5 + Math.random() * 0.3);
    particles.push({
      x: x,
      y: baseY,
      ox: x,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.2 - Math.random() * 1.2 - intensity * 0.8,
      size: 0.4 + Math.random() * 1.8,
      life: 1.0,
      decay: 0.006 + Math.random() * 0.012,
      brightness: 0.3 + intensity * 0.5,
      drift: Math.random() * Math.PI * 2
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const now = Date.now() * 0.001;
    let dataArray;
    if (analyser) {
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
    }
    // 计算整体能量
    let energy = 0;
    if (dataArray && dataArray.length > 0) {
      for (let i = 0; i < Math.min(dataArray.length, 32); i++) energy += dataArray[i];
      energy = energy / (32 * 255);
    } else {
      energy = Math.sin(now * 1.5) * 0.2 + 0.3 + Math.sin(now * 3.7) * 0.1;
    }
    // 生成粒子
    const spawnCount = Math.floor(1 + energy * 4);
    for (let i = 0; i < spawnCount && particles.length < maxParticles; i++) {
      spawnParticle(energy);
    }
    // 更新和绘制粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.drift += 0.02;
      p.x += p.vx + Math.sin(p.drift) * 0.15;
      p.y += p.vy;
      p.vy *= 0.998;
      p.life -= p.decay;
      if (p.life <= 0 || p.y < -10) {
        particles.splice(i, 1);
        continue;
      }
      const alpha = p.life * p.brightness;
      const r = Math.max(0.3, p.size * p.life);
      // 微光光晕
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
      grad.addColorStop(0, 'rgba(200,230,255,' + (alpha * 0.7).toFixed(3) + ')');
      grad.addColorStop(0.3, 'rgba(150,210,255,' + (alpha * 0.25).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(100,180,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2);
      ctx.fill();
      // 核心亮点
      ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.9).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    visualizerAnimId = requestAnimationFrame(draw);
  }
  draw();
}

function stopVisualizer() {
  if (visualizerAnimId) { cancelAnimationFrame(visualizerAnimId); visualizerAnimId = null; }
  const canvas = $('visualizerCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ---------- 黑胶唱片旋转（JS控制，跟随音乐流畅转动） ---------- */
function startVinylRotation() {
  stopVinylRotation();
  const record = $('vinylRecord');
  const leftAlbum = $('musicAlbum');
  if (!record && !leftAlbum) return;
  lastVinylTime = performance.now();

  function rotate(now) {
    const dt = (now - lastVinylTime) / 1000; // 秒
    lastVinylTime = now;

    // 基础转速：33.3 RPM（真实黑胶唱片速度），随播放倍速调整
    const baseRPM = 33.3;
    const speed = settings.music.speed || 1.0;
    const degPerSec = (baseRPM * 360) / 60 * speed; // 度/秒

    vinylAngle = (vinylAngle + degPerSec * dt) % 360;

    // 音频反应：根据音频频率数据微调旋转（流动感）
    let audioBoost = 0;
    if (analyser) {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      // 取低频平均值作为节拍感
      let sum = 0;
      const bassRange = Math.min(8, dataArray.length);
      for (let i = 0; i < bassRange; i++) sum += dataArray[i];
      const bassAvg = sum / bassRange / 255; // 0~1
      audioBoost = bassAvg * 8; // 最多额外加8度/秒
    }

    vinylAngle = (vinylAngle + audioBoost * dt) % 360;
    if (record) record.style.setProperty('--vinyl-angle', vinylAngle + 'deg');
    // 左侧专辑封面（圆形黑胶）同步旋转
    if (leftAlbum) leftAlbum.style.setProperty('--vinyl-angle', vinylAngle + 'deg');

    vinylAnimId = requestAnimationFrame(rotate);
  }
  vinylAnimId = requestAnimationFrame(rotate);
}

function stopVinylRotation() {
  if (vinylAnimId) { cancelAnimationFrame(vinylAnimId); vinylAnimId = null; }
}

/* ---------- 歌词雨 ---------- */
function toggleLyricsRain() {
  if (settings.music.lyricsRain) {
    startLyricsRain();
  } else {
    stopLyricsRain();
  }
  $('musicLyricsToggle').classList.toggle('active', settings.music.lyricsRain);
}

function startLyricsRain() {
  stopLyricsRain();
  // 优先使用已识别的LRC歌词文本，其次使用手动输入
  let lyricsText = settings.music.lyrics || '';
  if (!lyricsText && currentLrcLines.length > 0) {
    lyricsText = currentLrcLines.map(function(l) { return l.text; }).join('\n');
  }
  const lines = lyricsText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) {
    // 歌词未就绪时不弹toast，静默返回（自动播放时歌词可能还在识别中）
    return;
  }

  const container = $('lyricsRain');
  container.classList.add('show');

  // 歌词雨与播放进度同步：当前播放行高亮下落，附近行随机点缀
  let lastSyncIdx = -1;
  let lastDropTime = 0;

  function rainTick() {
    const now = performance.now();
    // 根据播放进度获取当前歌词行索引
    let currentIdx = -1;
    if (currentLrcLines.length > 0 && !audioPlayer.paused) {
      const t = audioPlayer.currentTime;
      for (let i = currentLrcLines.length - 1; i >= 0; i--) {
        if (t >= currentLrcLines[i].time) { currentIdx = i; break; }
      }
    }

    // 当歌词行变化时，立即生成当前行的歌词雨
    if (currentIdx !== lastSyncIdx && currentIdx >= 0 && currentLrcLines[currentIdx]) {
      lastSyncIdx = currentIdx;
      const line = currentLrcLines[currentIdx].text;
      if (line && line.trim()) {
        spawnLyricDrop(container, line, true);
      }
    }

    // 每隔一段时间随机生成一条歌词雨（保持视觉效果连续）
    if (now - lastDropTime > 800) {
      lastDropTime = now;
      const line = lines[Math.floor(Math.random() * lines.length)];
      spawnLyricDrop(container, line, false);
    }

    lyricsRainTimer = requestAnimationFrame(rainTick);
  }
  rainTick();
}

function spawnLyricDrop(container, text, isCurrent) {
  const drop = document.createElement('div');
  drop.className = 'lyric-drop' + (isCurrent ? ' lyric-drop-current' : '');
  drop.textContent = text;
  drop.style.left = Math.random() * 85 + 5 + '%';
  const duration = isCurrent ? (7 + Math.random() * 3) : (6 + Math.random() * 6);
  drop.style.animationDuration = duration + 's';
  if (isCurrent) {
    drop.style.fontSize = (16 + Math.random() * 6) + 'px';
    drop.style.color = `rgba(255,255,255,${0.6 + Math.random() * 0.3})`;
    drop.style.textShadow = '0 0 8px rgba(255,255,255,0.3)';
  } else {
    drop.style.fontSize = (12 + Math.random() * 8) + 'px';
    drop.style.color = `rgba(255,255,255,${0.2 + Math.random() * 0.25})`;
  }
  container.appendChild(drop);
  setTimeout(() => { if (drop.parentNode) drop.remove(); }, (duration + 1) * 1000);
}

function stopLyricsRain() {
  if (lyricsRainTimer) { cancelAnimationFrame(lyricsRainTimer); lyricsRainTimer = null; }
  const el = $('lyricsRain');
  if (el) {
    el.classList.remove('show');
    el.innerHTML = '';
  }
}

/* ================================================================
   全页背景轮播（电影放映带）
================================================================ */
async function handleMediaImport(files) {
  const fileArr = Array.from(files);
  toast('上传中...');
  try {
    for (const file of fileArr) {
      const url = await uploadAsset(file, 'background', getFileExt(file));
      settings.carousel.items.push({
        type: file.type.startsWith('video') ? 'video' : 'image',
        src: url,
        name: file.name
      });
    }
    applyCarousel();
    const clearBtn = $('set_clearMedia');
    if (clearBtn) clearBtn.textContent = '一键清空 (' + settings.carousel.items.length + ')';
    toast('已导入 ' + fileArr.length + ' 个文件');
    autoSaveMusic();
  } catch (e) {
    toast('上传失败：' + (e.message || ''));
  }
}

function updateCarousel() {
  const strip = $('bgCarouselStrip');
  strip.style.transform = `translateX(-${carouselIndex * 100}vw)`;
  const items = strip.querySelectorAll('.bg-carousel-item');
  items.forEach((item, i) => {
    if (i === carouselIndex) item.classList.add('active');
    else item.classList.remove('active');
    const video = item.querySelector('video');
    if (video) {
      if (i === carouselIndex) video.play().catch(() => {});
      else video.pause();
    }
  });
}

function startCarouselAuto() {
  stopCarouselAuto();
  if (settings.carousel.enabled && settings.carousel.items.length > 0) {
    carouselTimer = setInterval(() => {
      carouselIndex = (carouselIndex + 1) % settings.carousel.items.length;
      updateCarousel();
    }, settings.carousel.speed * 1000);
  }
}
function stopCarouselAuto() { if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; } }

/* ================================================================
   音量控制
================================================================ */
// 将 settings 中的音量/静音状态应用到 audioPlayer
function applyVolumeToAudio() {
  if (!audioPlayer) return;
  const vol = settings.music.volume != null ? settings.music.volume : 0.8;
  audioPlayer.volume = Math.max(0, Math.min(1, vol));
  audioPlayer.muted = !!settings.music.muted;
  // 同步 UI
  const volBtn = $('musicVolumeBtn');
  if (volBtn) {
    volBtn.classList.toggle('muted', audioPlayer.muted || vol === 0);
  }
  const volSlider = $('musicVolumeSlider');
  if (volSlider) volSlider.value = audioPlayer.muted ? 0 : Math.round(audioPlayer.volume * 100);
}

// 设置音量（0~1），同时取消静音
function setVolume(vol) {
  vol = Math.max(0, Math.min(1, vol));
  settings.music.volume = vol;
  if (vol > 0) settings.music.muted = false;
  applyVolumeToAudio();
  autoSaveMusic();
  toast('音量: ' + Math.round(vol * 100) + '%');
}

// 切换静音
function toggleMute() {
  settings.music.muted = !settings.music.muted;
  applyVolumeToAudio();
  autoSaveMusic();
  toast(settings.music.muted ? '已静音' : '已取消静音');
}

/* ================================================================
   3D ambient effects migrated to Three.js (three-effects.js).
   Legacy Canvas 2D implementation (jellyfish/fish/aurora/sky/sparkle) removed.
================================================================ */

