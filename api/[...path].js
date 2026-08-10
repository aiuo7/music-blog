'use strict';
/* ============================================================
   Vercel Serverless API — 个人主页音乐聚合服务
   ============================================================ */
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CN_REAL_IP = '116.25.146.181';

/* ---------- 工具函数 ---------- */
function getQuery(urlStr, key) {
  const q = urlStr.split('?')[1];
  if (!q) return null;
  for (const pair of q.split('&')) {
    const kv = pair.split('=', 2);
    if (kv.length === 2 && kv[0] === key) return decodeURIComponent(kv[1].replace(/\+/g, ' '));
  }
  return null;
}

function sendJson(res, body, status) {
  if (status) res.statusCode = status;
  const buf = Buffer.from(body, 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function httpsRequest(url, options) {
  return new Promise((resolve, reject) => {
    const opts = options || {};
    const req = https.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function pickModule(url) { return url.indexOf('https:') === 0 ? https : http; }
function resolveUrl(loc, base) { return loc.indexOf('http') === 0 ? loc : new URL(loc, base).href; }

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
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function downloadBuffer(url, headers, maxRedirect) {
  maxRedirect = maxRedirect == null ? 5 : maxRedirect;
  return new Promise((resolve, reject) => {
    const mod = pickModule(url);
    const req = mod.request(url, { method: 'GET', headers: headers || {} }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && maxRedirect > 0) {
        resp.resume();
        return resolve(downloadBuffer(resolveUrl(resp.headers.location, url), headers, maxRedirect - 1));
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('download timeout')));
    req.end();
  });
}

/* ---------- 音频流式代理（Vercel适配：不缓存，直接管道转发） ---------- */
function streamAudio(req, res, url, headers) {
  return new Promise((resolve, reject) => {
    const mod = pickModule(url);
    const fwdHeaders = Object.assign({}, headers || {});
    if (req.headers['range']) fwdHeaders['range'] = req.headers['range'];

    const upstream = mod.request(url, { method: 'GET', headers: fwdHeaders }, (resp) => {
      // 跟随 3xx 跳转（网易云 outer/url 会 302 到 CDN）
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume();
        return resolve(streamAudio(req, res, resolveUrl(resp.headers.location, url), headers));
      }

      res.statusCode = resp.statusCode || 200;
      if (resp.headers['content-type']) res.setHeader('Content-Type', resp.headers['content-type']);
      if (resp.headers['content-length']) res.setHeader('Content-Length', resp.headers['content-length']);
      if (resp.headers['content-range']) res.setHeader('Content-Range', resp.headers['content-range']);
      if (resp.headers['accept-ranges']) res.setHeader('Accept-Ranges', resp.headers['accept-ranges']);

      resp.pipe(res);
      resp.on('end', () => resolve());
      resp.on('error', (e) => { try { res.end(); } catch(_) {} resolve(); });
    });
    upstream.on('error', (e) => {
      try { sendJson(res, '{"error":"audio stream failed: ' + e.message + '"}', 502); } catch(_) {}
      resolve();
    });
    upstream.setTimeout(25000, () => { upstream.destroy(new Error('stream timeout')); });
    upstream.end();
  });
}

/* ---------- 网易云搜索核心 ---------- */
async function neteaseSearchCore(keyword, limit) {
  limit = limit || 20;
  if (limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  const rawSongs = [];
  let offset = 0;
  const pageSize = Math.max(limit, 30);
  const maxRaw = Math.max(limit * 3, 60);

  while (rawSongs.length < maxRaw && offset < 600) {
    const neteaseUrl = 'https://music.163.com/api/search/get/web';
    const postData = 's=' + encodeURIComponent(keyword) + '&type=1&offset=' + offset + '&total=true&limit=' + pageSize;
    const r = await httpsRequest(neteaseUrl, {
      method: 'POST',
      headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Real-IP': CN_REAL_IP },
      body: postData
    });
    let pageSongs = [];
    try {
      const data = JSON.parse(r.body);
      if (data && data.code === 200 && data.result && Array.isArray(data.result.songs)) pageSongs = data.result.songs;
    } catch (e) {}
    for (const s of pageSongs) rawSongs.push(s);
    if (pageSongs.length < pageSize) break;
    offset += pageSize;
  }

  const availableIds = {};
  if (rawSongs.length > 0) {
    const chunk = 20;
    for (let i = 0; i < rawSongs.length; i += chunk) {
      const chunkIds = [];
      for (let j = i; j < Math.min(i + chunk, rawSongs.length); j++) chunkIds.push(rawSongs[j].id);
      const idsJson = chunkIds.join(',');
      const urlApi = 'https://music.163.com/api/song/enhance/player/url?ids=%5B' + idsJson + '%5D&br=999000';
      try {
        const vr = await httpsRequest(urlApi, { headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP } });
        const urlData = JSON.parse(vr.body);
        if (urlData.code === 200 && Array.isArray(urlData.data)) {
          for (const d of urlData.data) availableIds[String(d.id)] = !!(d.url && d.url.length > 0);
        }
      } catch (e) {}
    }
  }

  const filtered = [];
  for (const s of rawSongs) {
    const key = String(s.id);
    if (Object.prototype.hasOwnProperty.call(availableIds, key) && !availableIds[key]) continue;
    filtered.push(s);
  }

  const picMap = await neteaseFetchPics(filtered.map(s => s.id));
  return { filtered, availableIds, picMap };
}

async function neteaseFetchPics(ids) {
  const picMap = {};
  if (!ids || ids.length === 0) return picMap;
  const chunk = 50;
  for (let i = 0; i < ids.length; i += chunk) {
    const chunkIds = ids.slice(i, Math.min(i + chunk, ids.length));
    const idsJson = chunkIds.join(',');
    const url = 'https://music.163.com/api/song/detail/?ids=%5B' + idsJson + '%5D';
    try {
      const r = await httpsRequest(url, { headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP } });
      const d = JSON.parse(r.body);
      if (d && Array.isArray(d.songs)) {
        for (const s of d.songs) if (s.album && s.album.picUrl) picMap[String(s.id)] = s.album.picUrl;
      }
    } catch (e) {}
  }
  return picMap;
}

async function neteaseSearch(keyword, limit) {
  const { filtered, availableIds, picMap } = await neteaseSearchCore(keyword, limit);
  const out = [];
  for (const s of filtered) {
    const key = String(s.id);
    const artistNames = [];
    if (s.artists) for (const a of s.artists) if (a.name) artistNames.push(a.name);
    out.push({
      id: s.id, name: s.name, artist: artistNames.join(' / '),
      album: s.album ? s.album.name : '', pic: picMap[key] || '',
      duration: s.duration || 0, url: '/api/netease-audio?id=' + s.id,
      vip: Object.prototype.hasOwnProperty.call(availableIds, key) ? false : true
    });
  }
  return { success: true, source: 'netease', count: out.length, songs: out };
}

/* ---------- 工具：酷我 ---------- */
function tryDecode(v) { if (!v) return v; try { return decodeURIComponent(v); } catch (e) { return v; } }
function unescapeHtml(v) {
  if (!v) return v;
  return String(v).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function kuwoPicUrl(albumpic, short) {
  if (albumpic && String(albumpic).indexOf('http') === 0) return albumpic;
  if (short) { const s = String(short); if (s.indexOf('http') === 0) return s; return 'https://img1.kuwo.cn/star/albumcover' + (s.charAt(0) === '/' ? s : '/' + s); }
  return '';
}
function dedupeKey(name, artist) {
  return (String(name || '') + '|' + String(artist || '')).toLowerCase().replace(/\s+/g, '').replace(/\(.*?\)/g, '').replace(/（.*?）/g, '');
}

/* ---------- 多平台适配器 ---------- */
const neteaseAdapter = {
  source: 'netease',
  async search(keyword, limit) {
    const { filtered, picMap } = await neteaseSearchCore(keyword, limit);
    return filtered.map(s => {
      const artistNames = [];
      if (s.artists) for (const a of s.artists) if (a.name) artistNames.push(a.name);
      return { source: 'netease', id: String(s.id), name: s.name, artist: artistNames.join(' / '), album: s.album ? s.album.name : '', pic: picMap[String(s.id)] || '', duration: s.duration || 0, url: '/api/audio?source=netease&id=' + s.id };
    });
  },
  async resolveAudioUrl(id) {
    return { url: 'https://music.163.com/song/media/outer/url?id=' + id, headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP } };
  },
  async getLyrics(id) {
    const lyricUrl = 'https://music.163.com/api/song/lyric?id=' + id + '&lv=1&kv=1&tv=-1';
    const r = await httpsRequest(lyricUrl, { headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP } });
    return r.body;
  }
};

const kuwoAdapter = {
  source: 'kuwo',
  async search(keyword, limit) {
    limit = Math.min(Math.max(limit || 20, 1), 50);
    const url = 'http://search.kuwo.cn/r.s?all=' + encodeURIComponent(keyword) + '&ft=music&itemset=web_2013&client=kt&pn=0&rn=' + limit + '&rformat=json&encoding=utf8';
    const r = await fetchText(url, { headers: { 'Referer': 'http://www.kuwo.cn/', 'User-Agent': UA } });
    let list = [];
    try { const d = JSON.parse(r.body.replace(/'/g, '"')); if (d && Array.isArray(d.abslist)) list = d.abslist; } catch (e) {}
    const out = [];
    for (const s of list) {
      const rid = String(s.MUSICRID || '').replace('MUSIC_', '');
      if (!rid) continue;
      out.push({ source: 'kuwo', id: rid, name: unescapeHtml(tryDecode(s.SONGNAME)) || '', artist: unescapeHtml(tryDecode(s.ARTIST)) || '', album: unescapeHtml(tryDecode(s.ALBUM)) || '', pic: kuwoPicUrl(s.albumpic, s.web_albumpic_short), duration: (parseInt(s.DURATION, 10) || 0) * 1000, url: '/api/audio?source=kuwo&id=' + rid });
    }
    return out;
  },
  async resolveAudioUrl(id) {
    const url = 'http://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=' + id + '&format=mp3&response=url';
    const r = await fetchText(url, { headers: { 'Referer': 'http://www.kuwo.cn/', 'User-Agent': UA } });
    const body = (r.body || '').trim();
    if (!body) return null;
    if (body.indexOf('http') === 0) return { url: body, headers: { 'User-Agent': UA } };
    try { const d = JSON.parse(body.replace(/'/g, '"')); if (d && d.url && String(d.url).indexOf('http') === 0) return { url: d.url, headers: { 'User-Agent': UA } }; } catch (e) {}
    return null;
  },
  async getLyrics(id) {
    const url = 'http://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=' + id + '&httpsStatus=1';
    const r = await fetchText(url, { headers: { 'Referer': 'http://www.kuwo.cn/play_detail/' + id, 'User-Agent': UA, 'csrf': 'TOKEN', 'Cookie': 'kw_token=TOKEN' } });
    try { const d = JSON.parse(r.body); if (d && d.data && Array.isArray(d.data.lrclist)) return JSON.stringify({ data: { lrclist: d.data.lrclist } }); return JSON.stringify({ data: { lrclist: [] } }); } catch (e) {}
    return JSON.stringify({ data: { lrclist: [] } });
  }
};

const adapters = { netease: neteaseAdapter, kuwo: kuwoAdapter };

async function aggregateSearch(keyword, limit, source) {
  limit = Math.min(Math.max(limit || 20, 1), 50);
  const targets = (!source || source === 'all') ? Object.keys(adapters) : [source];
  const tasks = targets.map(src => adapters[src] ? adapters[src].search(keyword, limit) : Promise.reject(new Error('unknown source ' + src)));
  const settled = await Promise.allSettled(tasks);
  let merged = [];
  for (let i = 0; i < settled.length; i++) { if (settled[i].status === 'fulfilled' && Array.isArray(settled[i].value)) merged = merged.concat(settled[i].value); }
  const seen = new Set();
  const out = [];
  for (const s of merged) { const k = dedupeKey(s.name, s.artist); if (seen.has(k)) continue; seen.add(k); out.push(s); }
  return { success: true, count: out.length, songs: out };
}

/* ---------- 主路由 ---------- */
export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rawQuery = req.url.split('?')[1] ? ('?' + req.url.split('?')[1]) : '';

    /* ---- 网易云旧端点 ---- */
    if (urlPath === '/api/netease-music/search') {
      const term = getQuery(rawQuery, 'keyword');
      const limitStr = getQuery(rawQuery, 'limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      if (!term) return sendJson(res, '{"success":false,"message":"missing keyword"}', 400);
      try { const result = await neteaseSearch(term, limit); return sendJson(res, JSON.stringify(result), 200); }
      catch (e) { return sendJson(res, '{"success":false,"message":"netease request failed"}', 502); }
    }

    if (urlPath === '/api/netease-music/song/url') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"success":false,"message":"missing id"}', 400);
      return sendJson(res, JSON.stringify({ success: true, id: parseInt(songId, 10) || songId, url: '/api/netease-audio?id=' + songId, vip: false }), 200);
    }

    if (urlPath === '/api/netease-detail') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"error":"missing id"}', 400);
      try { const detailUrl = 'https://music.163.com/api/song/detail/?ids=%5B' + songId + '%5D'; const r = await httpsRequest(detailUrl, { headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP } }); return sendJson(res, r.body, 200); }
      catch (e) { return sendJson(res, '{"error":"detail request failed"}', 502); }
    }

    if (urlPath === '/api/netease-cover') {
      let coverUrl = getQuery(rawQuery, 'url');
      if (!coverUrl) return sendJson(res, '{"error":"missing url"}', 400);
      try { if (coverUrl.indexOf('http://') === 0) coverUrl = 'https://' + coverUrl.substring(7); const r = await downloadBuffer(coverUrl, { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP }); const ct = (r.headers['content-type'] && r.headers['content-type'].indexOf('image') === 0) ? r.headers['content-type'] : 'image/jpeg'; res.setHeader('Content-Type', ct); res.setHeader('Content-Length', r.body.length); return res.end(r.body); }
      catch (e) { return sendJson(res, '{"error":"cover request failed"}', 502); }
    }

    if (urlPath === '/api/netease-lyrics') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"error":"missing id"}', 400);
      try { const lyricUrl = 'https://music.163.com/api/song/lyric?id=' + songId + '&lv=1&kv=1&tv=-1'; const r = await httpsRequest(lyricUrl, { headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'X-Real-IP': CN_REAL_IP } }); return sendJson(res, r.body, 200); }
      catch (e) { return sendJson(res, '{"error":"lyrics request failed"}', 502); }
    }

    if (urlPath === '/api/netease-audio') {
      const songId = getQuery(rawQuery, 'id');
      if (!songId) return sendJson(res, '{"error":"missing id"}', 400);
      try {
        const resolved = await neteaseAdapter.resolveAudioUrl(songId);
        if (!resolved || !resolved.url) return sendJson(res, '{"error":"song not available"}', 404);
        return await streamAudio(req, res, resolved.url, resolved.headers || {});
      } catch (e) { return sendJson(res, '{"error":"song not available"}', 404); }
    }

    if (urlPath === '/api/netease-search') {
      const term = getQuery(rawQuery, 'term');
      if (!term) return sendJson(res, '{"error":"missing term"}', 400);
      try { const neteaseUrl = 'https://music.163.com/api/search/get/web'; const postData = 's=' + encodeURIComponent(term) + '&type=1&offset=0&total=true&limit=30'; const r = await httpsRequest(neteaseUrl, { method: 'POST', headers: { 'Referer': 'https://music.163.com', 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Real-IP': CN_REAL_IP }, body: postData }); return sendJson(res, r.body, 200); }
      catch (e) { return sendJson(res, '{"error":"netease request failed"}', 502); }
    }

    /* ---- 统一聚合端点 ---- */
    if (urlPath === '/api/search') {
      const term = getQuery(rawQuery, 'keyword');
      const source = getQuery(rawQuery, 'source') || 'all';
      const limitStr = getQuery(rawQuery, 'limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      if (!term) return sendJson(res, '{"success":false,"message":"missing keyword"}', 400);
      try { const result = await aggregateSearch(term, limit, source); return sendJson(res, JSON.stringify(result), 200); }
      catch (e) { return sendJson(res, '{"success":false,"message":"search failed"}', 502); }
    }

    if (urlPath === '/api/audio') {
      const source = getQuery(rawQuery, 'source');
      const songId = getQuery(rawQuery, 'id');
      if (!source || !songId) return sendJson(res, '{"error":"missing source or id"}', 400);
      try {
        const adapter = adapters[source];
        if (!adapter) return sendJson(res, '{"error":"unknown source"}', 400);
        const resolved = await adapter.resolveAudioUrl(songId);
        if (!resolved || !resolved.url) return sendJson(res, '{"error":"song not available"}', 404);
        return await streamAudio(req, res, resolved.url, resolved.headers || {});
      } catch (e) { return sendJson(res, '{"error":"song not available"}', 404); }
    }

    if (urlPath === '/api/lyrics') {
      const source = getQuery(rawQuery, 'source');
      const songId = getQuery(rawQuery, 'id');
      if (!source || !songId) return sendJson(res, '{"error":"missing source or id"}', 400);
      const adapter = adapters[source];
      if (!adapter) return sendJson(res, '{"error":"unknown source"}', 400);
      try { const body = await adapter.getLyrics(songId); return sendJson(res, body, 200); }
      catch (e) { return sendJson(res, '{"error":"lyrics request failed"}', 502); }
    }

    if (urlPath === '/api/cover') {
      let coverUrl = getQuery(rawQuery, 'url');
      if (!coverUrl) return sendJson(res, '{"error":"missing url"}', 400);
      try { if (coverUrl.indexOf('http://') === 0) coverUrl = 'https://' + coverUrl.substring(7); const r = await downloadBuffer(coverUrl, { 'User-Agent': UA }); const ct = (r.headers['content-type'] && r.headers['content-type'].indexOf('image') === 0) ? r.headers['content-type'] : 'image/jpeg'; res.setHeader('Content-Type', ct); res.setHeader('Content-Length', r.body.length); return res.end(r.body); }
      catch (e) { return sendJson(res, '{"error":"cover request failed"}', 502); }
    }

    return sendJson(res, '{"error":"not found: ' + urlPath + '"}', 404);
  } catch (e) {
    try { res.statusCode = 500; res.end('Internal error'); } catch (_) {}
  }
}
