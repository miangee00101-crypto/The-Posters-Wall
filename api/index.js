const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');

const app = express();
app.use(cors());

// White network SVGs with no backgrounds
const WHITE_BRAND_SVGS = {
  'netflix': `<path fill="#FFFFFF" d="M3.5 0h2.9v27H3.5V0zm5.1 0h2.9v27H8.6V0zm5.2 0h2.9v27h-2.9V0zm-10.3 0 10.3 27h2.8L4.3 0H3.5z"/>`,
  'hbo': `<g fill="#FFFFFF"><path d="M4 4h4v6H4V4zm0 10h4v6H4v-6zm9.2-10h4.3c2.4 0 4.3 1.9 4.3 4.3v1.4c0 2.4-1.9 4.3-4.3 4.3h-4.3V4zm4.3 12c1.3 0 2.3-1 2.3-2.3v-1.4c0-1.3-1-2.3-2.3-2.3h-4.3v6h4.3zm9.5-12c2.8 0 5 2.2 5 5v10c0 2.8-2.2 5-5 5s-5-2.2-5-5V9c0-2.8 2.2-5 5-5zm0 4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1 1 1 0 0 0 1-1V9a1 1 0 0 0-1-1z"/></g>`,
  'prime': `<g fill="#FFFFFF"><path d="M1.3 15.3c0-3 3-5 7.7-5 2.1 0 4 .3 5.4.8v-.6c0-2.3-1.5-3.6-4.2-3.6-2.1 0-4.3.7-5.8 1.8L3.2 6.5C5.4 4.8 8.6 3.7 12 3.7c5.4 0 8.7 3 8.7 8.5v9.3h-3.4v-2.3c-1.3 1.5-3.5 2.7-6.2 2.7-5.3-.1-9.8-3.1-9.8-6.6zm13.1-1.3c-1.1-.3-2.5-.5-3.8-.5-3.1 0-4.8 1.1-4.8 2.8s1.4 2.8 3.8 2.8c2.8 0 4.8-1.5 4.8-3.9v-1.2zm6.7 10s3 4.6 9 4.6c4.6 0 7-1.8 7-1.8l-1.3-3s-2.1 1.6-5.5 1.6c-4.4 0-7.3-3.6-7.3-3.6l-1.9 2.2z"/></g>`,
  'disney': `<path fill="#FFFFFF" d="M11 2c-4 0-7.2 3.2-7.2 7.2h2c0-2.9 2.3-5.2 5.2-5.2s5.2 2.3 5.2 5.2h2c0-4-3.2-7.2-7.2-7.2zm3.3 6h1.5v1.2h1.2v1.5h-1.2v1.2h-1.5v-1.2h-1.2v-1.5h1.2V8zm-6 2.3c.7 0 1.2.6 1.2 1.2s-.6 1.2-1.2 1.2-1.2-.6-1.2-1.2.5-1.2 1.2-1.2zm2.7 4.7H13c0 2.2-1.8 4-4 4s-4-1.8-4-4h2c0 1.1.9 2 2 2s2-.9 2-2z"/>`,
  'default': `<circle cx="12" cy="12" r="9" fill="none" stroke="#FFFFFF" stroke-width="2"/>`
};

// --- CONFIGURATION WEB PAGE ROUTE ---
app.get('/', (req, res) => res.redirect('/configure'));
app.get('/configure', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>The Posters Wall Configuration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f0f11; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
      .card { background: #18181c; border: 1px solid #282830; border-radius: 12px; padding: 2rem; width: 100%; max-width: 420px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
      h2 { margin-top: 0; color: #e50914; font-size: 1.5rem; text-align: center; }
      p { color: #aaa; font-size: 0.9rem; margin-bottom: 1.5rem; text-align: center; }
      label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: #ddd; }
      input { width: 100%; padding: 0.75rem; border-radius: 6px; border: 1px solid #333; background: #09090b; color: #fff; box-sizing: border-box; margin-bottom: 1.2rem; font-size: 0.9rem; }
      input:focus { border-color: #e50914; outline: none; }
      button { width: 100%; padding: 0.85rem; border-radius: 6px; border: none; background: #e50914; color: #fff; font-weight: bold; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
      button:hover { background: #b80710; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>The Posters Wall</h2>
      <p>Configure your API keys to generate your Stremio Addon manifest link.</p>
      <label>TMDB API Key (Required)</label>
      <input type="text" id="tmdb" placeholder="e.g. 1234567890abcdef..." />
      
      <label>MDBList API Key (Optional for RT/IMDb scores)</label>
      <input type="text" id="mdblist" placeholder="e.g. mdblist_key..." />
      
      <button onclick="install()">Install to Stremio</button>
    </div>

    <script>
      function install() {
        const tmdb = document.getElementById('tmdb').value.trim();
        const mdblist = document.getElementById('mdblist').value.trim();
        if (!tmdb) return alert('Please enter your TMDB API key.');
        
        const config = btoa(JSON.stringify({ tmdb, mdblist }));
        const manifestUrl = window.location.origin + '/' + config + '/manifest.json';
        window.location.href = 'stremio://' + manifestUrl.replace(/^https?:\\/\\//, '');
      }
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

// Helper to decode user config from base64 URL params
function parseConfig(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (e) {
    return { tmdb: '', mdblist: '' };
  }
}

// --- DYNAMIC MANIFEST WITH EMBEDDED CONFIG ---
app.get('/:config/manifest.json', (req, res) => {
  res.json({
    id: 'org.theposterswall.landscape',
    version: '1.0.0',
    name: 'The Posters Wall',
    description: 'Landscape Top 10 Movies and Series catalogs featuring Poster+ style rank numbers, official title logos, plain white network icons, and 6.1-70-Action meta text.',
    resources: ['catalog'],
    types: ['movie', 'series'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    },
    catalogs: [
      {
        type: 'movie',
        id: 'posterswall_top_movies',
        name: 'The Posters Wall - Top 10 Movies',
        extra: [{ name: 'skip' }],
        behaviorHints: { landscape: true }
      },
      {
        type: 'series',
        id: 'posterswall_top_series',
        name: 'The Posters Wall - Top 10 Series',
        extra: [{ name: 'skip' }],
        behaviorHints: { landscape: true }
      }
    ]
  });
});

async function getOfficialTitleLogo(id, tmdbType, tmdbKey) {
  try {
    const res = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${id}/images?api_key=${tmdbKey}`);
    const logos = res.data.logos || [];
    const enLogo = logos.find(l => l.iso_639_1 === 'en') || logos[0];
    return enLogo ? enLogo.file_path : null;
  } catch (err) {
    return null;
  }
}

async function getRichRankings(type, tmdbKey, mdbKey) {
  try {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const res = await axios.get(
      `https://api.themoviedb.org/3/trending/${tmdbType}/day?api_key=${tmdbKey}`
    );

    const items = res.data.results.slice(0, 10);
    return await Promise.all(items.map(async (item) => {
      let imdb = '—';
      let rt = '—';
      let network = 'default';
      let genre = 'Action';

      const logoPath = await getOfficialTitleLogo(item.id, tmdbType, tmdbKey);

      try {
        if (mdbKey) {
          const mdb = await axios.get(`https://api.mdblist.com/?apikey=${mdbKey}&tmdb=${item.id}&type=${tmdbType}`);
          if (mdb.data) {
            imdb = mdb.data.ratings?.find(r => r.source === 'imdb')?.value || imdb;
            const rtObj = mdb.data.ratings?.find(r => r.source === 'rotten_tomatoes');
            rt = rtObj ? rtObj.value : rt;

            const list = mdb.data.streams?.map(s => s.network.toLowerCase()) || [];
            if (list.includes('netflix')) network = 'netflix';
            else if (list.includes('hbo') || list.includes('max')) network = 'hbo';
            else if (list.includes('prime video')) network = 'prime';
            else if (list.includes('disney+')) network = 'disney';
          }
        }
      } catch (e) {}

      const genreMap = { 28:'Action', 12:'Adv', 16:'Anim', 35:'Comedy', 80:'Crime', 18:'Drama', 27:'Horror', 878:'Sci-Fi', 53:'Thriller', 10759:'Action', 10765:'Sci-Fi' };
      if (item.genre_ids?.length) genre = genreMap[item.genre_ids[0]] || 'Drama';

      return {
        id: `tmdb:${item.id}`,
        title: item.title || item.name,
        backdropPath: item.backdrop_path,
        logoPath,
        overview: item.overview,
        imdb,
        rt,
        network,
        genre
      };
    }));
  } catch (err) {
    return [];
  }
}

// --- DYNAMIC CATALOG ROUTER ---
app.get('/:config/catalog/:type/:id.json', async (req, res) => {
  const { config, type, id } = req.params;
  const { tmdb, mdblist } = parseConfig(config);

  if (!tmdb) return res.json({ metas: [] });
  if (type === 'movie' && id !== 'posterswall_top_movies') return res.json({ metas: [] });
  if (type === 'series' && id !== 'posterswall_top_series') return res.json({ metas: [] });

  try {
    const items = await getRichRankings(type, tmdb, mdblist);
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;

    const metas = items.map((item, index) => {
      const rank = index + 1;
      const q = `path=${encodeURIComponent(item.backdropPath)}&logo=${encodeURIComponent(item.logoPath || '')}&title=${encodeURIComponent(item.title)}&imdb=${item.imdb}&rt=${item.rt}&genre=${encodeURIComponent(item.genre)}&network=${item.network}`;

      return {
        id: item.id,
        type,
        name: `#${rank} ${item.title}`,
        poster: `${protocol}://${host}/landscape-card/${rank}?${q}`,
        description: item.overview,
        behaviorHints: { defaultVideoId: item.id }
      };
    });

    res.json({ metas });
  } catch (err) {
    res.status(500).json({ metas: [] });
  }
});

// --- IMAGE GENERATOR ---
app.get('/landscape-card/:rank', async (req, res) => {
  try {
    const { rank } = req.params;
    const { path, logo, imdb = '—', rt = '—', genre = '', network = 'default' } = req.query;

    if (!path) return res.status(400).send('Backdrop missing');

    const baseRes = await axios.get(`https://image.tmdb.org/t/p/w780${path}`, { responseType: 'arraybuffer' });
    const baseBuffer = Buffer.from(baseRes.data);
    const { width = 780, height = 439 } = await sharp(baseBuffer).metadata();

    const fontLarge = Math.floor(height * 0.73);
    const composites = [];

    if (logo && logo !== 'null') {
      try {
        const logoRes = await axios.get(`https://image.tmdb.org/t/p/w500${logo}`, { responseType: 'arraybuffer' });
        const logoBuffer = Buffer.from(logoRes.data);

        const resizedLogo = await sharp(logoBuffer)
          .resize({
            width: Math.floor(width * 0.42),
            height: Math.floor(height * 0.30),
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .toBuffer();

        composites.push({
          input: resizedLogo,
          top: Math.floor(height * 0.55),
          left: Math.floor(width * 0.28)
        });
      } catch (e) {}
    }

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}">
        <style>
          .num-bg { font-family: 'Helvetica Neue', 'Arial Black', sans-serif; font-size: ${fontLarge}px; font-weight: 900; fill: none; stroke: #000; stroke-width: 18px; }
          .num-fg { font-family: 'Helvetica Neue', 'Arial Black', sans-serif; font-size: ${fontLarge}px; font-weight: 900; fill: none; stroke: #FFF; stroke-width: 8px; }
          
          .metadata-text { 
            font-family: 'Arial', sans-serif; 
            font-size: 14.5px; 
            font-weight: 800; 
            fill: #FFFFFF; 
            letter-spacing: 0.5px;
            text-anchor: end;
            filter: drop-shadow(0px 1.5px 1.5px rgba(0, 0, 0, 0.9));
          }
        </style>

        <g transform="translate(${width - 45}, 16)" opacity="0.9">
          ${WHITE_BRAND_SVGS[network.toLowerCase()] || WHITE_BRAND_SVGS['default']}
        </g>

        <text x="12" y="${height - 20}" class="num-bg">${rank}</text>
        <text x="12" y="${height - 20}" class="num-fg">${rank}</text>

        <text x="${width - 15}" y="${height - 21}" class="metadata-text">${imdb}-${rt}-${genre}</text>
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
    res.status(500).send('Overlay rendering failed');
  }
});

module.exports = app;
