/* ============================================================
   server.js — 个人主页本地服务器（Node.js 版）
   ----------------------------------------------------------------
   由 server.ps1 完整移植而来，仅依赖 Node.js 内置模块（零安装）。
   同时承担两个职责：
     1. 静态文件服务（index.html / js / css / 资源）
     2. 多平台音乐聚合 API（网易云/酷我，统一 schema，source 字段区分歌源）
   统一聚合端点（推荐，多平台）：
     /api/search                 聚合搜索 source=all|netease|kuwo
     /api/audio                  统一音频代理（服务器侧下载+本地缓存+Range）
     /api/lyrics                 统一词牌
     /api/cover                  封面图代理（http→https，平台无关）
   旧端点（网易云单平台，保留向后兼容）：
     /api/netease-music/search   归一化搜索（VIP/无版权自动过滤）
     /api/netease-music/song-url 单曲地址归一化
     /api/netease-detail         歌曲详情透传
     /api/netease-cover          封面图代理（http→https）
     /api/netease-lyrics         歌词透传
     /api/netease-audio          全曲音频代理（→ 统一 serveAudioUnified）
     /api/netease-search         原始搜索透传
   启动：node server.js   （默认监听 127.0.0.1:9123）
   ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 9123;
let ROOT = __dirname;
if (!require('fs').existsSync(require('path').join(ROOT, 'index.html'))) {
  ROOT = process.cwd();
  if (!require('fs').existsSync(require('path').join(ROOT, 'index.html'))) {
    ROOT = '/var/task';
  }
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// 伪装大陆 IP，绕过网易云对境外服务器的加密响应（老接口会读取此头判断地域）
const CN_REAL_IP = '116.25.146.181';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'application/sql; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/* ---------- 工具：查询参数解析 ---------- */
function getQuery(urlStr, key) {
  const q = urlStr.split('?')[1];
  if (!q) return null;
  const pairs = q.split('&');
  for (const pair of pairs) {
    const kv = pair.split('=', 2);
    if (kv.length === 2 && kv[0] === key) {
      return decodeURIComponent(kv[1].replace(/\+/g, ' '));
    }
  }
  return null;
}

/* ---------- 工具：发送 JSON ---------- */
function sendJson(res, body, status) {
  if (status) res.statusCode = status;
  const buf = Buffer.from(body, 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

/* ---------- 工具：CORS 跨域响应头 ----------
   前端可能从其它端口（如 8080）加载页面后访问本端口 API，需放开跨域。
   - 允许任意来源（本地开发服务器，无敏感数据）
   - 允许 Range 头：音频代理支持拖动进度条
   - 暴露 Content-Range / Content-Length / Accept-Ranges：供前端读取
----------------------------------------------------------------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/* ---------- 工具：HTTPS 请求（GET / POST），返回字符串 ---------- */
function httpsRequest(url, options) {
  return new Promise((resolve, reject) => {
    const opts = options || {};
    const req = https.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({
        status: resp.statusCode,
        headers: resp.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ---------- 工具：HTTP/HTTPS 通用文本请求（返回字符串，跟随跳转） ----------
   酷我等接口为 http 且可能 302，需同时支持两种协议并跟跳。
----------------------------------------------------------------- */
function fetchText(url, options, maxRedirect) {
  maxRedirect = maxRedirect == null ? 3 : maxRedirect;
  return new Promise((resolve, reject) => {
    const opts = options || {};
    const mod = pickModule(url);
    const req = mod.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && maxRedirect > 0) {
        resp.resume();
        return resolve(fetchText(resolveUrl(resp.headers.location, url), opts, maxRedirect - 1));
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({
        status: resp.statusCode,
        headers: resp.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ---------- 工具：按协议选择 http/https 模块 ---------- */
// 网易云 outer/url 会 302 到 http:// CDN，需同时支持两种协议
function pickModule(url) { return url.indexOf('https:') === 0 ? https : http; }
function resolveUrl(loc, base) {
  return loc.indexOf('http') === 0 ? loc : new URL(loc, base).href;
}

/* ---------- 工具：下载到 Buffer（带跟随跳转，http/https 均可） ---------- */
function downloadBuffer(url, headers, maxRedirect) {
  maxRedirect = maxRedirect == null ? 5 : maxRedirect;
  return new Promise((resolve, reject) => {
    const mod = pickModule(url);
    const req = mod.request(url, { method: 'GET', headers: headers || {} }, (resp) => {
      // 处理 3xx 跳转（网易云 outer/url 会 302 到真实 CDN）
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && maxRedirect > 0) {
        resp.resume();
        return resolve(downloadBuffer(resolveUrl(resp.headers.location, url), headers, maxRedirect - 1));
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({
        status: resp.statusCode,
        headers: resp.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('download timeout')));
    req.end();
  });
}

/* ---------- 工具：下载文件到磁盘（带跟随跳转，http/https 均可） ---------- */
function downloadFile(url, dest, headers) {
  return new Promise((resolve, reject) => {
    let redirects = 5;
    const attempt = (u) => {
      const mod = pickModule(u);
      const req = mod.request(u, { method: 'GET', headers: headers || {} }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && redirects > 0) {
          redirects--;
          resp.resume();
          return attempt(resolveUrl(resp.headers.location, u));
        }
        if (resp.statusCode !== 200) {
          resp.resume();
          return reject(new Error('HTTP ' + resp.statusCode));
        }
        const stream = fs.createWriteStream(dest);
        resp.pipe(stream);
        stream.on('finish', () => stream.close(() => resolve()));
        stream.on('error', (e) => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error('download timeout')));
      req.end();
    };
    attempt(url);
  });
}

/* ============================================================
   网易云搜索核心：分页拉取 + VIP/无版权过滤，返回过滤后的原始歌曲
   -------------------------------------------------------------
   供旧端点 /api/netease-music/search（旧 schema）和
   neteaseAdapter.search（统一 schema）共享，避免逻辑重复。
   ============================================================ */
async function neteaseSearchCore(keyword, limit) {
  limit = limit || 20;
  if (limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  console.log('[netease-search] start keyword="' + keyword + '" limit=' + limit);
  const rawSongs = [];
  let offset = 0;
  const pageSize = Math.max(limit, 30);
  const maxRaw = Math.max(limit * 3, 60);

  // 分页拉取：最多收集 maxRaw 首原始歌曲（热门歌手 VIP 多，需多拉保证过滤后数量充足）
  let pageCount = 0;
  while (rawSongs.length < maxRaw && offset < 600) {
    const neteaseUrl = 'https://music.163.com/api/search/get/web';
    const postData = 's=' + encodeURIComponent(keyword) + '&type=1&offset=' + offset + '&total=true&limit=' + pageSize;
    const r = await httpsRequest(neteaseUrl, {
      method: 'POST',
      headers: {
        'Referer': 'https://music.163.com',
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Real-IP': CN_REAL_IP
      },
      body: postData
    });
    pageCount++;
    let pageSongs = [];
    let apiCode = null;
    let parseErr = null;
    try {
      const data = JSON.parse(r.body);
      apiCode = data && data.code;
      if (data && data.code === 200 && data.result && Array.isArray(data.result.songs)) {
        pageSongs = data.result.songs;
      }
    } catch (e) { parseErr = e.message || String(e); /* 结构异常，当作空页 */ }
    console.log('[netease-search] page=' + pageCount + ' offset=' + offset
      + ' http=' + r.status + ' apiCode=' + apiCode
      + ' pageSongs=' + pageSongs.length + ' total=' + rawSongs.length
      + (parseErr ? (' parseErr=' + parseErr) : '')
      + (r.body && (r.body.length < 200 || pageSongs.length === 0) ? (' body=' + r.body.slice(0, 500)) : ''));
    for (const s of pageSongs) rawSongs.push(s);
    if (pageSongs.length < pageSize) break;
    offset += pageSize;
  }
  console.log('[netease-search] raw collected=' + rawSongs.length + ' (cap=' + maxRaw + ')');

  // 批量校验播放地址，过滤 VIP / 无版权（分块请求，避免一次过多 id 被限流）
  const availableIds = {};
  let playableCount = 0;
  let blockedCount = 0;
  if (rawSongs.length > 0) {
    try {
      const chunk = 20;
      let chunkIdx = 0;
      for (let i = 0; i < rawSongs.length; i += chunk) {
        const chunkIds = [];
        for (let j = i; j < Math.min(i + chunk, rawSongs.length); j++) {
          chunkIds.push(rawSongs[j].id);
        }
        const idsJson = chunkIds.join(',');
        const urlApi = 'https://music.163.com/api/song/enhance/player/url?ids=%5B' + idsJson + '%5D&br=999000';
        const vr = await httpsRequest(urlApi, {
          headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }
        });
        let urlCode = null;
        let dataArrLen = 0;
        try {
          const urlData = JSON.parse(vr.body);
          urlCode = urlData && urlData.code;
          if (urlData.code === 200 && Array.isArray(urlData.data)) {
            dataArrLen = urlData.data.length;
            for (const d of urlData.data) {
              // url 非空即为可播放（非 VIP / 有版权）
              const ok = !!(d.url && d.url.length > 0);
              availableIds[String(d.id)] = ok;
              if (ok) playableCount++; else blockedCount++;
            }
          }
        } catch (e) { /* 校验失败，忽略本块 */ }
        chunkIdx++;
        console.log('[netease-search] url-check chunk=' + chunkIdx
          + ' http=' + vr.status + ' apiCode=' + urlCode
          + ' checked=' + dataArrLen + '/' + chunkIds.length
          + ' playable=' + playableCount + ' blocked=' + blockedCount
          + (vr.body && vr.body.length < 200 ? (' body=' + vr.body) : ''));
      }
    } catch (e) {
      console.error('[netease-search] url-check fatal:', e.message || e);
    }
  }
  console.log('[netease-search] url-check summary: playable=' + playableCount
    + ' blocked=' + blockedCount + ' unchecked=' + (rawSongs.length - playableCount - blockedCount));

  // 校验成功且不可播放 → 过滤；校验未覆盖 → 保留（不误过滤）
  const filtered = [];
  for (const s of rawSongs) {
    const key = String(s.id);
    if (Object.prototype.hasOwnProperty.call(availableIds, key) && !availableIds[key]) continue;
    filtered.push(s);
  }
  console.log('[netease-search] done keyword="' + keyword + '" raw=' + rawSongs.length
    + ' returned=' + filtered.length
    + (filtered.length === 0 ? ' (EMPTY — 无搜索结果 / 全部VIP无版权 / 网络请求失败)' : ''));

  // 批量获取封面 URL（搜索 API 不返回 album.picUrl，需额外请求 detail 接口）
  const picMap = await neteaseFetchPics(filtered.map(s => s.id));
  return { filtered: filtered, availableIds: availableIds, picMap: picMap };
}

/* 网易云批量封面获取：/api/song/detail 返回 album.picUrl，分块请求避免 URL 过长 */
async function neteaseFetchPics(ids) {
  const picMap = {};
  if (!ids || ids.length === 0) return picMap;
  const chunk = 50;
  for (let i = 0; i < ids.length; i += chunk) {
    const chunkIds = ids.slice(i, Math.min(i + chunk, ids.length));
    const idsJson = chunkIds.join(',');
    const url = 'https://music.163.com/api/song/detail/?ids=%5B' + idsJson + '%5D';
    try {
      const r = await httpsRequest(url, {
        headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }
      });
      const d = JSON.parse(r.body);
      if (d && Array.isArray(d.songs)) {
        for (const s of d.songs) {
          if (s.album && s.album.picUrl) picMap[String(s.id)] = s.album.picUrl;
        }
      }
    } catch (e) { /* 忽略本块，封面留空 */ }
  }
  console.log('[netease-search] pics fetched=' + Object.keys(picMap).length + '/' + ids.length);
  return picMap;
}

/* 旧端点 /api/netease-music/search 专用：输出旧 schema（含 vip、/api/netease-audio url）
   外部行为与原 neteaseSearch 完全一致，前端无需改动。 */
async function neteaseSearch(keyword, limit) {
  const { filtered, availableIds, picMap } = await neteaseSearchCore(keyword, limit);
  const out = [];
  for (const s of filtered) {
    const key = String(s.id);
    const artistNames = [];
    if (s.artists) {
      for (const a of s.artists) { if (a.name) artistNames.push(a.name); }
    }
    out.push({
      id: s.id,
      name: s.name,
      artist: artistNames.join(' / '),
      album: s.album ? s.album.name : '',
      pic: picMap[key] || '',
      duration: s.duration || 0,
      url: '/api/netease-audio?id=' + s.id,
      vip: Object.prototype.hasOwnProperty.call(availableIds, key) ? false : true
    });
  }
  return { success: true, source: 'netease', count: out.length, songs: out };
}

/* ============================================================
   本地音频缓存目录（所有平台共用）
   ============================================================ */
const cacheDir = path.join(os.tmpdir(), 'music-audio-cache');
try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* ignore */ }

/* ============================================================
   多平台适配器：每个平台实现统一接口，输出统一 schema
   -------------------------------------------------------------
     search(keyword, limit)   → [ { source, id, name, artist, album, pic, duration, url } ]
     resolveAudioUrl(id)      → { url, headers } | null   （可下载的临时直链）
     getLyrics(id)            → 原始歌词 JSON 字符串
   统一 schema 中仅用 source 字段区分歌源（netease|kuwo）。
   ============================================================ */

const neteaseAdapter = {
  source: 'netease',
  async search(keyword, limit) {
    const { filtered, picMap } = await neteaseSearchCore(keyword, limit);
    return filtered.map(s => {
      const artistNames = [];
      if (s.artists) for (const a of s.artists) if (a.name) artistNames.push(a.name);
      return {
        source: 'netease', id: String(s.id), name: s.name,
        artist: artistNames.join(' / '), album: s.album ? s.album.name : '',
        pic: picMap[String(s.id)] || '', duration: s.duration || 0,
        url: '/api/audio?source=netease&id=' + s.id
      };
    });
  },
  async resolveAudioUrl(id) {
    return {
      url: 'https://music.163.com/song/media/outer/url?id=' + id,
      headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }
    };
  },
  async getLyrics(id) {
    const lyricUrl = 'https://music.163.com/api/song/lyric?id=' + id + '&lv=1&kv=1&tv=-1';
    const r = await httpsRequest(lyricUrl, {
      headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }
    });
    return r.body;
  }
};

const kuwoAdapter = {
  source: 'kuwo',
  async search(keyword, limit) {
    limit = Math.min(Math.max(limit || 20, 1), 50);
    const url = 'http://search.kuwo.cn/r.s?all=' + encodeURIComponent(keyword)
      + '&ft=music&itemset=web_2013&client=kt&pn=0&rn=' + limit + '&rformat=json&encoding=utf8';
    const r = await fetchText(url, { headers: { 'Referer': 'http://www.kuwo.cn/', 'User-Agent': UA } });
    let list = [];
    // 酷我 r.s 返回单引号伪 JSON，需把 ' 替换为 " 再解析
    try { const d = JSON.parse(r.body.replace(/'/g, '"')); if (d && Array.isArray(d.abslist)) list = d.abslist; } catch (e) {}
    const out = [];
    for (const s of list) {
      const rid = String(s.MUSICRID || '').replace('MUSIC_', '');
      if (!rid) continue;
      out.push({
        source: 'kuwo', id: rid, name: unescapeHtml(tryDecode(s.SONGNAME)) || '',
        artist: unescapeHtml(tryDecode(s.ARTIST)) || '', album: unescapeHtml(tryDecode(s.ALBUM)) || '',
        pic: kuwoPicUrl(s.albumpic, s.web_albumpic_short),
        duration: (parseInt(s.DURATION, 10) || 0) * 1000,
        url: '/api/audio?source=kuwo&id=' + rid
      });
    }
    return out;
  },
  async resolveAudioUrl(id) {
    const url = 'http://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=' + id + '&format=mp3&response=url';
    const r = await fetchText(url, { headers: { 'Referer': 'http://www.kuwo.cn/', 'User-Agent': UA } });
    const body = (r.body || '').trim();
    if (!body) return null;
    // 响应可能是纯文本 url，也可能是 {"code":200,"url":"..."}
    if (body.indexOf('http') === 0) return { url: body, headers: { 'User-Agent': UA } };
    try {
      const d = JSON.parse(body.replace(/'/g, '"'));
      if (d && d.url && String(d.url).indexOf('http') === 0) return { url: d.url, headers: { 'User-Agent': UA } };
    } catch (e) {}
    return null;
  },
  async getLyrics(id) {
    // www.kuwo.cn openapi：{code:200, data:{lrclist:[{lineLyric, time}]}}，无歌词时 data 为空
    // 需带 csrf header + kw_token cookie（值随意，接口校验宽松）
    const url = 'http://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=' + id + '&httpsStatus=1';
    const r = await fetchText(url, {
      headers: { 'Referer': 'http://www.kuwo.cn/play_detail/' + id, 'User-Agent': UA, 'csrf': 'TOKEN', 'Cookie': 'kw_token=TOKEN' }
    });
    try {
      const d = JSON.parse(r.body);
      if (d && d.data && Array.isArray(d.data.lrclist)) {
        return JSON.stringify({ data: { lrclist: d.data.lrclist } });
      }
      // 无歌词 → 空列表，前端静默处理
      return JSON.stringify({ data: { lrclist: [] } });
    } catch (e) {}
    return JSON.stringify({ data: { lrclist: [] } });
  }
};

const adapters = {
  netease: neteaseAdapter,
  kuwo: kuwoAdapter
};

/* 工具：酷我字段可能是 URL 编码也可能是明文，安全解码 */
function tryDecode(v) {
  if (!v) return v;
  try { return decodeURIComponent(v); } catch (e) { return v; }
}

/* 工具：酷我封面 URL 补全 —— web_albumpic_short 是相对路径（如 /120/47/9/xxx.jpg），需拼接图片域名 */
function kuwoPicUrl(albumpic, short) {
  if (albumpic && String(albumpic).indexOf('http') === 0) return albumpic;
  if (short) {
    const s = String(short);
    if (s.indexOf('http') === 0) return s;
    // 相对路径形如 /120/47/9/xxx.jpg → 拼接酷我图片 CDN
    return 'https://img1.kuwo.cn/star/albumcover' + (s.charAt(0) === '/' ? s : '/' + s);
  }
  return '';
}

/* 工具：解码常见 HTML 实体（酷我 SONGNAME 含 &nbsp; 等） */
function unescapeHtml(v) {
  if (!v) return v;
  return String(v)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/* 归一化 key：用于跨平台去重（歌名+歌手，忽略大小写/空白/括号后缀） */
function dedupeKey(name, artist) {
  return (String(name || '') + '|' + String(artist || ''))
    .toLowerCase().replace(/\s+/g, '')
    .replace(/\(.*?\)/g, '').replace(/（.*?）/g, '');
}

/* ============================================================
   聚合搜索：source=all 时并发拉取所有平台，合并去重
   ============================================================ */
async function aggregateSearch(keyword, limit, source) {
  limit = Math.min(Math.max(limit || 20, 1), 50);
  const targets = (!source || source === 'all') ? Object.keys(adapters) : [source];
  const tasks = targets.map(src =>
    adapters[src] ? adapters[src].search(keyword, limit) : Promise.reject(new Error('unknown source ' + src))
  );
  const settled = await Promise.allSettled(tasks);
  let merged = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      merged = merged.concat(r.value);
      console.log('[aggregate-search] ' + targets[i] + ' returned ' + r.value.length);
    } else {
      console.warn('[aggregate-search] ' + targets[i] + ' failed:', r.reason && (r.reason.message || r.reason));
    }
  }
  const seen = new Set();
  const out = [];
  for (const s of merged) {
    const k = dedupeKey(s.name, s.artist);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return { success: true, count: out.length, songs: out };
}

/* ============================================================
   统一音频代理：服务器侧下载完整 mp3 + 本地缓存 + Range 支持
   -------------------------------------------------------------
   按 source 路由到对应 adapter.resolveAudioUrl(id) 获取直链，再复用
   下载+缓存逻辑。各平台 CDN 直链多绑定生成时 IP，故始终由服务器
   下载完整文件并本地缓存，浏览器只与本地端口通信。
   ============================================================ */
async function serveAudioUnified(req, res, source, songId) {
  const adapter = adapters[source];
  if (!adapter) return sendJson(res, '{"error":"unknown source"}', 400);
  const cachePath = path.join(cacheDir, 'song-' + source + '-' + songId + '.mp3');

  let needDownload = true;
  try {
    const st = fs.statSync(cachePath);
    if ((Date.now() - st.mtimeMs) / 60000 < 120) needDownload = false;
  } catch (e) { /* 不存在，需下载 */ }

  if (needDownload) {
    try {
      const resolved = await adapter.resolveAudioUrl(songId);
      if (!resolved || !resolved.url) throw new Error('no audio url for ' + source + '/' + songId);
      await downloadFile(resolved.url, cachePath, resolved.headers || {});
    } catch (e) {
      console.error('[audio] ' + source + ' ' + songId + ' download error:', e.message || e);
      try { if (fs.statSync(cachePath).size < 1024) fs.unlinkSync(cachePath); } catch (_) {}
    }
  }

  let data;
  try { data = fs.readFileSync(cachePath); } catch (e) {
    return sendJson(res, '{"error":"song not available"}', 404);
  }
  if (data.length < 1024) {
    try { fs.unlinkSync(cachePath); } catch (_) {}
    return sendJson(res, '{"error":"song not available"}', 404);
  }

  const total = data.length;
  const rangeHeader = req.headers['range'];
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'audio/mpeg');

  if (rangeHeader && /bytes=(\d*)-(\d*)/.test(rangeHeader)) {
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    const start = m[1] !== '' ? parseInt(m[1], 10) : 0;
    const end = m[2] !== '' ? parseInt(m[2], 10) : total - 1;
    const clampedEnd = Math.min(end, total - 1);
    if (start >= total || start > clampedEnd) {
      res.statusCode = 416;
      res.setHeader('Content-Range', 'bytes */' + total);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', 'bytes ' + start + '-' + clampedEnd + '/' + total);
    res.setHeader('Content-Length', clampedEnd - start + 1);
    return res.end(data.slice(start, clampedEnd + 1));
  }

  res.setHeader('Content-Length', total);
  res.end(data);
}

/* ============================================================
   静态文件服务
   ============================================================ */
function serveStatic(req, res, urlPath) {
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath.replace(/^\//, ''));
  // 防止路径穿越
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      return res.end('Not found: ' + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', data.length);
    res.end(data);
  });
}

/* ============================================================
   主请求路由
   ============================================================ */
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    // 预检请求（OPTIONS）直接返回 204，不进入业务路由
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rawQuery = req.url.split('?')[1] ? ('?' + req.url.split('?')[1]) : '';

    if (urlPath === '/api/netease-music/search') {
      const term = getQuery(rawQuery, 'keyword');
      const limitStr = getQuery(rawQuery, 'limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      if (!term) return sendJson(res, '{"success":false,"message":"missing keyword"}', 400);
      try {
        const result = await neteaseSearch(term, limit);
        sendJson(res, JSON.stringify(result), 200);
      } catch (e) {
        console.error('search error:', e.message || e);
        sendJson(res, '{"success":false,"message":"netease request failed"}', 502);
      }
      return;
    }

    if (urlPath === '/api/netease-music/song/url') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"success":false,"message":"missing id"}', 400);
      const result = { success: true, id: parseInt(songId, 10) || songId, url: '/api/netease-audio?id=' + songId, vip: false };
      return sendJson(res, JSON.stringify(result), 200);
    }

    if (urlPath === '/api/netease-detail') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"error":"missing id"}', 400);
      try {
        const detailUrl = 'https://music.163.com/api/song/detail/?ids=%5B' + songId + '%5D';
        const r = await httpsRequest(detailUrl, {
          headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }
        });
        return sendJson(res, r.body, 200);
      } catch (e) {
        return sendJson(res, '{"error":"detail request failed"}', 502);
      }
    }

    if (urlPath === '/api/netease-cover') {
      let coverUrl = getQuery(rawQuery, 'url');
      if (!coverUrl) return sendJson(res, '{"error":"missing url"}', 400);
      try {
        if (coverUrl.indexOf('http://') === 0) coverUrl = 'https://' + coverUrl.substring(7);
        const r = await downloadBuffer(coverUrl, {
          'Referer': 'https://music.163.com',
          'User-Agent': UA,
          'X-Real-IP': CN_REAL_IP
        });
        const ct = (r.headers['content-type'] && r.headers['content-type'].indexOf('image') === 0) ? r.headers['content-type'] : 'image/jpeg';
        res.setHeader('Content-Type', ct);
        res.setHeader('Content-Length', r.body.length);
        return res.end(r.body);
      } catch (e) {
        return sendJson(res, '{"error":"cover request failed"}', 502);
      }
    }

    if (urlPath === '/api/netease-lyrics') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"error":"missing id"}', 400);
      try {
        const lyricUrl = 'https://music.163.com/api/song/lyric?id=' + songId + '&lv=1&kv=1&tv=-1';
        const r = await httpsRequest(lyricUrl, {
          headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }
        });
        return sendJson(res, r.body, 200);
      } catch (e) {
        return sendJson(res, '{"error":"lyrics request failed"}', 502);
      }
    }

    if (urlPath === '/api/netease-audio') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"error":"missing id"}', 400);
      try {
        return await serveAudioUnified(req, res, 'netease', songId);
      } catch (e) {
        console.error('Audio proxy fatal for ' + songId + ':', e.message || e);
        return sendJson(res, '{"error":"song not available"}', 404);
      }
    }

    if (urlPath === '/api/netease-search') {
      const term = getQuery(rawQuery, 'term');
      if (!term) return sendJson(res, '{"error":"missing term"}', 400);
      try {
        // POST 方式请求网易云搜索 API（GET 方式容易被限流）
        const neteaseUrl = 'https://music.163.com/api/search/get/web';
        const postData = 's=' + encodeURIComponent(term) + '&type=1&offset=0&total=true&limit=30';
        const r = await httpsRequest(neteaseUrl, {
          method: 'POST',
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Real-IP': CN_REAL_IP
          },
          body: postData
        });
        return sendJson(res, r.body, 200);
      } catch (e) {
        console.error('Search proxy error for ' + term + ':', e.message || e);
        return sendJson(res, '{"error":"netease request failed"}', 502);
      }
    }

    /* ---- 统一聚合端点（多平台，source 字段区分歌源） ---- */

    // 聚合搜索：source=all|netease|kuwo
    if (urlPath === '/api/search') {
      const term = getQuery(rawQuery, 'keyword');
      const source = getQuery(rawQuery, 'source') || 'all';
      const limitStr = getQuery(rawQuery, 'limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      if (!term) return sendJson(res, '{"success":false,"message":"missing keyword"}', 400);
      try {
        const result = await aggregateSearch(term, limit, source);
        return sendJson(res, JSON.stringify(result), 200);
      } catch (e) {
        console.error('aggregate search error:', e.message || e);
        return sendJson(res, '{"success":false,"message":"search failed"}', 502);
      }
    }

    // 统一音频代理：source + id 路由到对应平台
    if (urlPath === '/api/audio') {
      const source = getQuery(rawQuery, 'source');
      const songId = getQuery(rawQuery, 'id');
      if (!source || !songId) return sendJson(res, '{"error":"missing source or id"}', 400);
      try {
        return await serveAudioUnified(req, res, source, songId);
      } catch (e) {
        console.error('Audio proxy fatal for ' + source + '/' + songId + ':', e.message || e);
        return sendJson(res, '{"error":"song not available"}', 404);
      }
    }

    // 统一词牌：source + id 路由到对应平台歌词接口
    if (urlPath === '/api/lyrics') {
      const source = getQuery(rawQuery, 'source');
      const songId = getQuery(rawQuery, 'id');
      if (!source || !songId) return sendJson(res, '{"error":"missing source or id"}', 400);
      const adapter = adapters[source];
      if (!adapter) return sendJson(res, '{"error":"unknown source"}', 400);
      try {
        const body = await adapter.getLyrics(songId);
        return sendJson(res, body, 200);
      } catch (e) {
        return sendJson(res, '{"error":"lyrics request failed"}', 502);
      }
    }

    // 统一封面代理（平台无关，http→https）
    if (urlPath === '/api/cover') {
      let coverUrl = getQuery(rawQuery, 'url');
      if (!coverUrl) return sendJson(res, '{"error":"missing url"}', 400);
      try {
        if (coverUrl.indexOf('http://') === 0) coverUrl = 'https://' + coverUrl.substring(7);
        const r = await downloadBuffer(coverUrl, { 'User-Agent': UA });
        const ct = (r.headers['content-type'] && r.headers['content-type'].indexOf('image') === 0) ? r.headers['content-type'] : 'image/jpeg';
        res.setHeader('Content-Type', ct);
        res.setHeader('Content-Length', r.body.length);
        return res.end(r.body);
      } catch (e) {
        return sendJson(res, '{"error":"cover request failed"}', 502);
      }
    }

    // 其它路径 → 静态文件
    return serveStatic(req, res, urlPath);
  } catch (e) {
    console.error('Request error:', e.message || e);
    try { res.statusCode = 500; res.end('Internal error'); } catch (_) {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running at http://localhost:' + PORT + ' (ROOT=' + ROOT + ') - Node.js ' + process.version);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
