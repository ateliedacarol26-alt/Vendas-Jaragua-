const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HOST = '0.0.0.0';

const ALLOWED_CITIES = ['Jaraguá do Sul', 'Guaramirim', 'Schroeder'];

let nextId = 1;
const ads = [];

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function jsonRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function matchRoute(url, pattern) {
  const patternParts = pattern.split('/');
  const urlParts = url.split('/');
  if (patternParts.length !== urlParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  if (url === '/' || url === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading page'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (url === '/api/ads' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { title, category, city, description, price, whatsapp } = body;

      if (!title || !category || !city || !whatsapp) {
        return jsonRes(res, 400, { ok: false, error: 'Preencha todos os campos obrigatórios.' });
      }

      if (!ALLOWED_CITIES.includes(city)) {
        return jsonRes(res, 422, {
          ok: false,
          error: 'Desculpe, no momento aceitamos anúncios apenas para Jaraguá do Sul, Guaramirim e Schroeder.'
        });
      }

      const ad = {
        id: nextId++,
        title,
        category,
        city,
        description: description || '',
        price: price ? Number(price) : 0,
        whatsapp,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      ads.push(ad);

      return jsonRes(res, 200, { ok: true, message: 'Anúncio enviado para aprovação!' });
    } catch (e) {
      return jsonRes(res, 400, { ok: false, error: 'Requisição inválida.' });
    }
  }

  if (url === '/api/admin/ads' && method === 'GET') {
    const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
    const params = Object.fromEntries(new URLSearchParams(qs));
    const filtered = params.status && params.status !== 'all'
      ? ads.filter(a => a.status === params.status)
      : [...ads];
    filtered.sort((a, b) => b.id - a.id);
    return jsonRes(res, 200, { ok: true, ads: filtered });
  }

  if (url === '/api/admin/stats' && method === 'GET') {
    const pending = ads.filter(a => a.status === 'pending').length;
    const active = ads.filter(a => a.status === 'active').length;
    const rejected = ads.filter(a => a.status === 'rejected').length;
    return jsonRes(res, 200, { ok: true, pending, active, rejected, total: ads.length });
  }

  const approveParams = matchRoute(url, '/api/admin/ads/:id/approve');
  if (approveParams && method === 'POST') {
    const ad = ads.find(a => a.id === Number(approveParams.id));
    if (!ad) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
    ad.status = 'active';
    return jsonRes(res, 200, { ok: true, ad });
  }

  const rejectParams = matchRoute(url, '/api/admin/ads/:id/reject');
  if (rejectParams && method === 'POST') {
    const ad = ads.find(a => a.id === Number(rejectParams.id));
    if (!ad) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
    ad.status = 'rejected';
    return jsonRes(res, 200, { ok: true, ad });
  }

  const deleteParams = matchRoute(url, '/api/admin/ads/:id');
  if (deleteParams && method === 'DELETE') {
    const idx = ads.findIndex(a => a.id === Number(deleteParams.id));
    if (idx === -1) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
    ads.splice(idx, 1);
    return jsonRes(res, 200, { ok: true });
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Classificados Jaraguá server running at http://${HOST}:${PORT}`);
});
