const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');

const app = express();
app.use(cors());

// Global axios timeout so a hung upstream never blocks a catalog render
const http = axios.create({ timeout: 10000 });

// White network SVGs (kept simple, no backgrounds)
const WHITE_BRAND_SVGS = {
  netflix: `<path fill="#FFFFFF" d="M3.5 0h2.9v27H3.5V0zm5.1 0h2.9v27H8.6V0zm5.2 0h2.9v27h-2.9V0zm-10.3 0 10.3 27h2.8L4.3 0H3.5z"/>`,
  hbo: `<g fill="#FFFFFF"><path d="M4 4h4v6H4V4zm0 10h4v6H4v-6zm9.2-10h4.3c2.4 0 4.3 1.9 4.3 4.3v1.4c0 2.4-1.9 4.3-4.3 4.3h-4.3V4zm4.3 12c1.3 0 2.3-1 2.3-2.3v-1.4c0-1.3-1-2.3-2.3-2.3h-4.3v6h4.3zm9.5-12c2.8 0 5 2.2 5 5v10c0 2.8-2.2 5-5 5s-5-2.2-5-5V9c0-2.8 2.2-5 5-5zm0 4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1 1 1 0 0 0 1-1V9a1 1 0 0 0-1-1z"/></g>`,
  prime: `<g fill="#FFFFFF"><path d="M1.3 15.3c0-3 3-5 7.7-5 2.1 0 4 .3 5.4.8v-.6c0-2.3-1.5-3.6-4.2-3.6-2.1 0-4.3.7-5.8 1.8L3.2 6.5C5.4 4.8 8.6 3.7 12 3.7c5.4 0 8.7 3 8.7 8.5v9.3h-3.4v-2.3c-1.3 1.5-3.5 2.7-6.2 2.7-5.3-.1-9.8-3.1-9.8-6.6zm13.1-1.3c-1.1-.3-2.5-.5-3.8-.5-3.1 0-4.8 1.1-4.8 2.8s1.4 2.8 3.8 2.8c2.8 0 4.8-1.5 4.8-3.9v-1.2zm6.7 10s3 4.6 9 4.6c4.6 0 7-1.8 7-1.8l-1.3-3s-2.1 1.6-5.5 1.6c-4.4 0-7.3-3.6-7.3-3.6l-1.9 2.2z"/></g>`,
  disney: `<path fill="#FFFFFF" d="M11 2c-4 0-7.2 3.2-7.2 7.2h2c0-2.9 2.3-5.2 5.2-5.2s5.2 2.3 5.2 5.2h2c0-4-3.2-7.2-7.2-7.2zm3.3 6h1.5v1.2h1.2v1.5h-1.2v1.2h-1.5v-1.2h-1.2v-1.5h1.2V8zm-6 2.3c.7 0 1.2.6 1.2 1.2s-.6 1.2-1.2 1.2-1.2-.6-1.2-1.2.5-1.2 1.2-1.2zm2.7 4.7H13c0 2.2-1.8 4-4 4s-4-1.8-4-4h2c0 1.1.9 2 2 2s2-.9 2-2z"/>`,
  default: `<circle cx="12" cy="12" r="9" fill="none" stroke="#FFFFFF" stroke-width="2"/>`
};

// ---------- Helpers ----------

// Escape anything going into SVG text
const esc = (s) =>
  String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));

// Base64 config parse with safe fallbacks
function parseConfig(encoded) {
  try {
    const obj = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return {
      tmdb: typeof obj.tmdb === 'string' ? obj.tmdb.trim() : '',
      mdblist: typeof obj.mdblist === 'string' ? obj.mdblist.trim() : ''
    };
  } catch {
    return { tmdb: '', mdblist: '' };
  }
}

// Build absolute base URL honoring proxies
function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// ---------- API Key Verification ----------
app.get('/api/verify', async (req, res) => {
  const { type, key } = req.query;
  if (!key || typeof key !== 'string') {
    return res.json({ valid: false, message: 'Key missing' });
  }

  try {
    if (type === 'tmdb') {
      const resp = await http.get(
        `https://api.themoviedb.org/3/authentication?api_key=${encodeURIComponent(key)}`
      );
      return res.json({ valid: resp.data?.success === true });
    }
    if (type === 'mdblist') {
      const resp = await http.get(
        `https://api.mdblist.com/?apikey=${encodeURIComponent(key)}&tmdb=550`
      );
      return res.json({ valid: !resp.data?.error });
    }
    res.json({ valid: false });
  } catch (err) {
    res.json({ valid: false });
  }
});

// ---------- Modern Config Page ----------
app.get('/', (req, res) => res.redirect('/configure'));
app.get('/configure', (req, res) => {
  const previewUrl = `${baseUrl(req)}/landscape-card/1?demo=1`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>The Posters Wall · Configuration</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#08090d;
    --panel:rgba(17,19,26,.72);
    --panel-2:rgba(11,12,17,.85);
    --border:rgba(255,255,255,.08);
    --border-strong:rgba(255,255,255,.14);
    --text:#f4f4f5;
    --muted:#9aa0aa;
    --accent:#e50914;
    --accent-2:#ff2b3a;
    --ok:#10b981;
    --bad:#ef4444;
    --warn:#f59e0b;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    font-family:'Inter',system-ui,-apple-system,sans-serif;
    background:var(--bg);
    color:var(--text);
    -webkit-font-smoothing:antialiased;
    min-height:100vh;
    display:flex;align-items:center;justify-content:center;
    padding:32px 16px;
    background-image:
      radial-gradient(at 12% 8%, rgba(229,9,20,.16) 0px, transparent 55%),
      radial-gradient(at 88% 92%, rgba(59,130,246,.10) 0px, transparent 55%),
      radial-gradient(at 50% 50%, rgba(255,255,255,.02) 0px, transparent 60%);
  }
  .shell{
    width:100%;
    max-width:920px;
    display:grid;
    grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    gap:24px;
  }
  @media (max-width:820px){
    .shell{grid-template-columns:1fr;}
  }
  .panel{
    background:var(--panel);
    backdrop-filter:blur(18px);
    -webkit-backdrop-filter:blur(18px);
    border:1px solid var(--border);
    border-radius:20px;
    box-shadow:0 20px 60px rgba(0,0,0,.55);
    padding:26px;
  }
  .brand{
    display:flex;align-items:center;gap:12px;margin-bottom:6px;
  }
  .brand .dot{
    width:10px;height:10px;border-radius:999px;background:var(--accent);
    box-shadow:0 0 16px var(--accent);
  }
  .brand h1{
    font-size:1.35rem;font-weight:800;letter-spacing:-.4px;
    background:linear-gradient(135deg,#fff 30%,#a1a1aa);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  }
  .subtitle{color:var(--muted);font-size:.82rem;margin-bottom:22px}
  
  .field{margin-bottom:16px}
  .field label{
    display:flex;justify-content:space-between;align-items:center;
    font-size:.8rem;font-weight:600;color:#d1d5db;margin-bottom:.45rem;letter-spacing:.01em;
  }
  .field label .tag{
    font-size:.65rem;font-weight:600;color:var(--muted);
    background:rgba(255,255,255,.05);
    padding:2px 7px;border-radius:999px;border:1px solid var(--border);
  }
  .input-row{position:relative;display:flex;gap:8px;align-items:stretch}
  .input-row input{
    flex:1;min-width:0;
    padding:11px 14px;
    border-radius:10px;
    border:1px solid var(--border);
    background:var(--panel-2);
    color:#fff;font-size:.85rem;font-family:inherit;
    transition:border-color .15s, box-shadow .15s, background .15s;
  }
  .input-row input::placeholder{color:#525866}
  .input-row input:focus{
    outline:none;border-color:var(--accent);
    box-shadow:0 0 0 3px rgba(229,9,20,.18);
    background:rgba(10,11,16,.95);
  }
  .btn-verify{
    padding:0 14px;border-radius:10px;
    border:1px solid var(--border-strong);
    background:rgba(255,255,255,.05);
    color:#e4e4e7;font-weight:600;font-size:.78rem;font-family:inherit;
    cursor:pointer;transition:all .15s;white-space:nowrap;
  }
  .btn-verify:hover{background:rgba(255,255,255,.1)}
  .btn-verify:disabled{opacity:.6;cursor:wait}
  
  .status{
    display:none;align-items:center;gap:6px;
    font-size:.75rem;font-weight:500;margin-top:6px;
  }
  .status.show{display:flex}
  .status.ok{color:var(--ok)}
  .status.bad{color:var(--bad)}
  .status.wait{color:var(--warn)}
  .status .ico{font-size:.85rem;line-height:1}

  .actions{display:flex;flex-direction:column;gap:10px;margin-top:22px}
  .btn{
    width:100%;padding:13px 16px;border-radius:12px;border:none;
    font-weight:700;font-size:.9rem;font-family:inherit;
    cursor:pointer;display:flex;justify-content:center;align-items:center;gap:8px;
    transition:transform .12s, background .18s, box-shadow .18s;
  }
  .btn:active{transform:scale(.985)}
  .btn-primary{
    background:linear-gradient(135deg,var(--accent),var(--accent-2));
    color:#fff;
    box-shadow:0 8px 24px rgba(229,9,20,.35);
  }
  .btn-primary:hover{box-shadow:0 10px 28px rgba(229,9,20,.5)}
  .btn-secondary{
    background:rgba(255,255,255,.05);
    color:#e4e4e7;border:1px solid var(--border-strong);
  }
  .btn-secondary:hover{background:rgba(255,255,255,.1)}
  .btn svg{width:16px;height:16px;flex-shrink:0}

  .hint{
    font-size:.72rem;color:var(--muted);margin-top:14px;
    text-align:center;line-height:1.5;
  }

  /* Preview side */
  .preview-panel{padding:22px}
  .preview-head{
    display:flex;justify-content:space-between;align-items:center;
    margin-bottom:14px;
  }
  .preview-head .title{
    font-size:.7rem;font-weight:700;letter-spacing:1.4px;
    text-transform:uppercase;color:var(--muted);
  }
  .preview-head .badge{
    font-size:.65rem;font-weight:700;
    background:rgba(229,9,20,.2);color:#ff8f98;
    border:1px solid rgba(229,9,20,.35);
    padding:3px 8px;border-radius:999px;letter-spacing:.4px;
  }
  .preview-frame{
    border-radius:14px;overflow:hidden;
    border:1px solid var(--border);
    background:#0b0c11;
    position:relative;
  }
  .preview-frame img{
    display:block;width:100%;height:auto;
    aspect-ratio:780/439;object-fit:cover;
  }
  .preview-loader{
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:var(--muted);font-size:.8rem;background:#0b0c11;
  }
  .preview-caption{
    font-size:.72rem;color:var(--muted);margin-top:12px;line-height:1.5;text-align:center;
  }
  .preview-caption strong{color:#e4e4e7;font-weight:600}

  .stack{display:flex;flex-direction:column;gap:24px}
  @media (min-width:821px){
    .preview-panel{align-self:start;position:sticky;top:24px;}
  }

  .row-2{
    display:grid;grid-template-columns:1fr 1fr;gap:10px;
  }
  .row-2 .btn{margin:0}
</style>
</head>
<body>
<div class="shell">

  <!-- LEFT: Configuration -->
  <div class="panel">
    <div class="brand">
      <span class="dot"></span>
      <h1>The Posters Wall</h1>
    </div>
    <p class="subtitle">Landscape Top 10 catalogs for Stremio, with Poster+ style ranks, title logos, network badges, and rich meta.</p>

    <div class="field">
      <label>TMDB API Key <span class="tag">Required</span></label>
      <div class="input-row">
        <input id="tmdb" type="text" placeholder="Paste your TMDB v3 API key" autocomplete="off" spellcheck="false">
        <button class="btn-verify" id="verify-tmdb" onclick="verifyKey('tmdb')">Verify</button>
      </div>
      <div class="status" id="tmdb-status"><span class="ico"></span><span class="msg"></span></div>
    </div>

    <div class="field">
      <label>MDBList API Key <span class="tag">Optional</span></label>
      <div class="input-row">
        <input id="mdblist" type="text" placeholder="Paste your MDBList API key" autocomplete="off" spellcheck="false">
        <button class="btn-verify" id="verify-mdblist" onclick="verifyKey('mdblist')">Verify</button>
      </div>
      <div class="status" id="mdblist-status"><span class="ico"></span><span class="msg"></span></div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="installAddon()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5v14"/></svg>
        Install to Stremio
      </button>
      <div class="row-2">
        <button class="btn btn-secondary" onclick="copyManifestUrl(event)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          Copy URL
        </button>
        <button class="btn btn-secondary" onclick="testManifest()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
          Preview
        </button>
      </div>
    </div>

    <p class="hint">Your keys are stored only inside the manifest URL. Nothing is sent to our servers beyond the APIs you provide.</p>
  </div>

  <!-- RIGHT: Live preview -->
  <div class="stack">
    <div class="panel preview-panel">
      <div class="preview-head">
        <span class="title">In-App Poster Preview</span>
        <span class="badge">780×439 · Landscape</span>
      </div>
      <div class="preview-frame">
        <div class="preview-loader" id="preview-loader">Loading sample…</div>
        <img id="preview-img" alt="Poster preview" src="${previewUrl}"
             onload="document.getElementById('preview-loader').style.display='none'"
             onerror="document.getElementById('preview-loader').textContent='Preview failed to load'">
      </div>
      <p class="preview-caption">
        Rank number, title logo, network badge (top-right), and <strong>IMDb-RT-Genre</strong> meta strip (bottom-right) are all composited server-side.
      </p>
    </div>
  </div>

</div>

<script>
  const $ = (id) => document.getElementById(id);

  function setStatus(type, kind, msg) {
    const el = $(type + '-status');
    el.className = 'status show ' + kind;
    el.querySelector('.ico').textContent = kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : '⏳';
    el.querySelector('.msg').textContent = msg;
  }

  async function verifyKey(type) {
    const val = $(type).value.trim();
    if (!val) {
      setStatus(type, 'bad', 'Enter a key first.');
      return;
    }
    const btn = $('verify-' + type);
    btn.disabled = true;
    setStatus(type, 'wait', 'Checking…');
    try {
      const res = await fetch('/api/verify?type=' + type + '&key=' + encodeURIComponent(val));
      const data = await res.json();
      if (data.valid) setStatus(type, 'ok', 'Valid API key');
      else setStatus(type, 'bad', 'Invalid API key');
    } catch {
      setStatus(type, 'bad', 'Verification failed');
    } finally {
      btn.disabled = false;
    }
  }

  function buildManifestUrl() {
    const tmdb = $('tmdb').value.trim();
    const mdblist = $('mdblist').value.trim();
    if (!tmdb) {
      alert('TMDB API Key is required.');
      $('tmdb').focus();
      return null;
    }
    const config = btoa(JSON.stringify({ tmdb, mdblist }));
    return window.location.origin + '/' + config + '/manifest.json';
  }

  function installAddon() {
    const url = buildManifestUrl();
    if (!url) return;
    const stremioUrl = 'stremio://' + url.replace(/^https?:\\/\\//, '');
    window.location.href = stremioUrl;
  }

  async function copyManifestUrl(ev) {
    const url = buildManifestUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      const btn = ev.currentTarget;
      const original = btn.innerHTML;
      btn.innerHTML = '✓ Copied';
      btn.style.color = '#10b981';
      setTimeout(() => { btn.innerHTML = original; btn.style.color = ''; }, 1500);
    } catch {
      prompt('Copy this manifest URL:', url);
    }
  }

  function testManifest() {
    const url = buildManifestUrl();
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  ['tmdb', 'mdblist'].forEach((t) => {
    $(t).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verifyKey(t);
    });
  });
</script>
</body>
</html>`;
  res.send(html);
});
// ---------- Manifest ----------
app.get('/:config/manifest.json', (req, res) => {
  res.json({
    id: 'org.theposterswall.landscape',
    version: '1.2.0',
    name: 'The Posters Wall',
    description:
      'Landscape Top 10 Movies and Series catalogs featuring Poster+ style rank numbers, official title logos, plain white network icons, and IMDb-RT-Genre meta text.',
    resources: ['catalog'],
    types: ['movie', 'series'],
    behaviorHints: {
      configurable: true,
      configurationRequired: true
    },
    catalogs: [
      {
        type: 'movie',
        id: 'posterswall_top_movies',
        name: 'Top 10 Movies',
        extra: [{ name: 'skip' }],
        behaviorHints: { landscape: true }
      },
      {
        type: 'series',
        id: 'posterswall_top_series',
        name: 'Top 10 Series',
        extra: [{ name: 'skip' }],
        behaviorHints: { landscape: true }
      }
    ]
  });
});

// ---------- TMDB helpers ----------
async function getOfficialTitleLogo(id, tmdbType, tmdbKey) {
  try {
    const res = await http.get(
      `https://api.themoviedb.org/3/${tmdbType}/${id}/images?api_key=${encodeURIComponent(tmdbKey)}`
    );
    const logos = res.data?.logos || [];
    const enLogo = logos.find((l) => l.iso_639_1 === 'en') || logos[0];
    return enLogo?.file_path || null;
  } catch {
    return null;
  }
}

const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi', 10766: 'Soap', 10767: 'Talk', 10768: 'War'
};

async function getRichRankings(type, tmdbKey, mdbKey) {
  try {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const res = await http.get(
      `https://api.themoviedb.org/3/trending/${tmdbType}/day?api_key=${encodeURIComponent(tmdbKey)}`
    );

    const items = (res.data?.results || []).slice(0, 10);

    return await Promise.all(
      items.map(async (item) => {
        // Parallelize logo + mdblist
        const [logoPath, mdbResult] = await Promise.all([
          getOfficialTitleLogo(item.id, tmdbType, tmdbKey),
          mdbKey ? fetchMdb(item.id, tmdbType, mdbKey) : Promise.resolve(null)
        ]);

        let imdb = '—';
        let rt = '—';
        let network = 'default';

        if (mdbResult) {
          const imdbObj = mdbResult.ratings?.find((r) => r.source === 'imdb');
          if (imdbObj?.value) imdb = String(imdbObj.value).slice(0, 4);

          const rtObj = mdbResult.ratings?.find((r) => r.source === 'rotten_tomatoes');
          if (rtObj?.value) rt = String(rtObj.value).replace('%', '').slice(0, 4);

          const providers = (mdbResult.streams || [])
            .map((s) => (s?.network || '').toString().toLowerCase())
            .filter(Boolean);

          if (providers.some((p) => p.includes('netflix'))) network = 'netflix';
          else if (providers.some((p) => p.includes('hbo') || p === 'max' || p.includes('max'))) network = 'hbo';
          else if (providers.some((p) => p.includes('prime'))) network = 'prime';
          else if (providers.some((p) => p.includes('disney'))) network = 'disney';
        }

        let genre = 'Drama';
        if (item.genre_ids?.length) {
          genre = GENRE_MAP[item.genre_ids[0]] || 'Drama';
        }

        return {
          id: `tmdb:${item.id}`,
          title: item.title || item.name || 'Untitled',
          backdropPath: item.backdrop_path,
          logoPath,
          overview: item.overview || '',
          imdb,
          rt,
          network,
          genre
        };
      })
    );
  } catch (err) {
    console.error('getRichRankings failed:', err.message);
    return [];
  }
}

async function fetchMdb(id, tmdbType, mdbKey) {
  try {
    const res = await http.get(
      `https://api.mdblist.com/?apikey=${encodeURIComponent(mdbKey)}&tmdb=${id}&type=${tmdbType}`
    );
    return res.data || null;
  } catch {
    return null;
  }
}

// ---------- Catalog router ----------
app.get('/:config/catalog/:type/:id.json', async (req, res) => {
  const { config, type, id } = req.params;
  const { tmdb, mdblist } = parseConfig(config);

  if (!tmdb) return res.json({ metas: [] });
  if (type === 'movie' && id !== 'posterswall_top_movies') return res.json({ metas: [] });
  if (type === 'series' && id !== 'posterswall_top_series') return res.json({ metas: [] });

  try {
    const items = await getRichRankings(type, tmdb, mdblist);
    const base = baseUrl(req);

    const metas = items
      .filter((it) => it.backdropPath) // skip items with no backdrop
      .map((item, index) => {
        const rank = index + 1;
        const q = new URLSearchParams({
          path: item.backdropPath,
          logo: item.logoPath || '',
          title: item.title,
          imdb: item.imdb,
          rt: item.rt,
          genre: item.genre,
          network: item.network
        }).toString();

        return {
          id: item.id,
          type,
          name: `#${rank} ${item.title}`,
          poster: `${base}/landscape-card/${rank}?${q}`,
          description: item.overview,
          behaviorHints: {
            defaultVideoId: item.id,
            landscape: true
          }
        };
      });

    res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.status(500).json({ metas: [] });
  }
});

// ---------- Image generator ----------
app.get('/landscape-card/:rank', async (req, res) => {
  try {
    let { rank } = req.params;
    rank = String(Math.max(1, Math.min(99, parseInt(rank, 10) || 1)));

    const DEMO = req.query.demo === '1';

    // Demo mode: use a fixed public TMDB backdrop, no external calls needed
    const path = DEMO ? '/1X7vow16X7CnCoexXh4H4F2yDJv.jpg' : req.query.path;
    const logo = DEMO ? '' : req.query.logo;
    const rawImdb = DEMO ? '8.1' : req.query.imdb;
    const rawRt = DEMO ? '94' : req.query.rt;
    const rawGenre = DEMO ? 'Action' : req.query.genre;
    const rawNetwork = DEMO ? 'netflix' : req.query.network;

    // Validate TMDB image path (defense in depth)
    if (!path || !/^\/[A-Za-z0-9]+\.(jpg|jpeg|png)$/i.test(path)) {
      return res.status(400).send('Invalid backdrop path');
    }

    // Sanitize strings going into the SVG
    const imdb = esc(rawImdb || '—').slice(0, 8);
    const rt = esc(rawRt || '—').slice(0, 8);
    const genre = esc(rawGenre || '').slice(0, 20);
    const networkKey = String(rawNetwork || 'default').toLowerCase();
    const networkSvg = WHITE_BRAND_SVGS[networkKey] || WHITE_BRAND_SVGS.default;

    const baseRes = await http.get(`https://image.tmdb.org/t/p/w780${path}`, {
      responseType: 'arraybuffer'
    });
    const baseBuffer = Buffer.from(baseRes.data);

    const meta = await sharp(baseBuffer).metadata();
    const width = meta.width || 780;
    const height = meta.height || 439;

    const fontLarge = Math.floor(height * 0.73);
    const composites = [];

    // Logo overlay (skipped in demo mode)
    if (logo && logo !== 'null' && /^\/[A-Za-z0-9]+\.(png|svg|webp|jpg|jpeg)$/i.test(logo)) {
      try {
        const logoRes = await http.get(`https://image.tmdb.org/t/p/w500${logo}`, {
          responseType: 'arraybuffer'
        });
        const resizedLogo = await sharp(Buffer.from(logoRes.data))
          .resize({
            width: Math.floor(width * 0.42),
            height: Math.floor(height * 0.30),
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .toBuffer();

        composites.push({
          input: resizedLogo,
          top: Math.floor(height * 0.42),
          left: Math.floor(width * 0.29)
        });
      } catch {
        // logo failure is non-fatal
      }
    }

    // Safe-zone layout: keeps rank + meta inside the center strip so they
    // survive a portrait center-crop on clients that ignore landscape: true.
    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .num-bg { font-family: 'Helvetica Neue','Arial Black',sans-serif; font-size: ${fontLarge}px; font-weight: 900; fill: none; stroke: #000; stroke-width: 18px; }
          .num-fg { font-family: 'Helvetica Neue','Arial Black',sans-serif; font-size: ${fontLarge}px; font-weight: 900; fill: none; stroke: #FFF; stroke-width: 8px; }
          .meta   { font-family: 'Arial',sans-serif; font-size: 16px; font-weight: 800; fill: #FFFFFF; letter-spacing: .5px; text-anchor: middle; filter: drop-shadow(0 1.5px 2px rgba(0,0,0,.85)); }
        </style>

        <!-- Network badge (top-right, survives most crops) -->
        <g transform="translate(${width - 45}, 16)" opacity="0.92">
          ${networkSvg}
        </g>

        <!-- Rank number, moved into center-left safe zone -->
        <text x="${Math.floor(width * 0.28)}" y="${height - 20}" class="num-bg">${rank}</text>
        <text x="${Math.floor(width * 0.28)}" y="${height - 20}" class="num-fg">${rank}</text>

        <!-- Meta strip, centered under the safe zone -->
        <text x="${Math.floor(width * 0.72)}" y="${height - 21}" class="meta">${imdb}-${rt}-${genre}</text>
      </svg>
    `);

    composites.push({ input: svgOverlay, top: 0, left: 0 });

    const finalImage = await sharp(baseBuffer)
      .composite(composites)
      .jpeg({ quality: 90 })
      .toBuffer();

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
    res.send(finalImage);
  } catch (err) {
    console.error('Image render failed:', err.message);
    res.status(500).send('Overlay rendering failed');
  }
});

module.exports = app;
