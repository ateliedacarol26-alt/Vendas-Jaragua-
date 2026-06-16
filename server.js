const http = require('http');
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = 5000;
const HOST = '0.0.0.0';

const ALLOWED_CITIES = ['Jaraguá do Sul', 'Guaramirim', 'Schroeder'];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── helpers ────────────────────────────────────────────────────────────────
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
  const pp = pattern.split('/');
  const up = url.split('/');
  if (pp.length !== up.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = up[i];
    else if (pp[i] !== up[i]) return null;
  }
  return params;
}

// ── server ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = req.url.split('?')[0];
  const method = req.method;

  // ── static HTML ──
  if (url === '/' || url === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading page'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ── POST /api/ads  (submit new ad) ──
  if (url === '/api/ads' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { title, category, city, description, price, whatsapp } = body;

      if (!title || !category || !city || !whatsapp)
        return jsonRes(res, 400, { ok: false, error: 'Preencha todos os campos obrigatórios.' });

      if (!ALLOWED_CITIES.includes(city))
        return jsonRes(res, 422, {
          ok: false,
          error: 'Desculpe, no momento aceitamos anúncios apenas para Jaraguá do Sul, Guaramirim e Schroeder.'
        });

      await pool.query(
        `INSERT INTO ads (title, category, city, description, price, whatsapp)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [title, category, city, description || '', Number(price) || 0, whatsapp]
      );

      return jsonRes(res, 200, { ok: true, message: 'Anúncio enviado para aprovação!' });
    } catch (e) {
      console.error('POST /api/ads:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro interno ao salvar anúncio.' });
    }
  }

  // ── GET /api/admin/ads  (list ads, optional ?status=) ──
  if (url === '/api/admin/ads' && method === 'GET') {
    try {
      const qs     = req.url.includes('?') ? req.url.split('?')[1] : '';
      const params = Object.fromEntries(new URLSearchParams(qs));
      const VALID_STATUS = ['pending', 'active', 'rejected'];

      let query  = 'SELECT * FROM ads';
      let values = [];
      if (params.status && VALID_STATUS.includes(params.status)) {
        query  += ' WHERE status = $1';
        values  = [params.status];
      }
      query += ' ORDER BY created_at DESC';

      const { rows } = await pool.query(query, values);
      return jsonRes(res, 200, { ok: true, ads: rows });
    } catch (e) {
      console.error('GET /api/admin/ads:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao buscar anúncios.' });
    }
  }

  // ── GET /api/admin/stats ──
  if (url === '/api/admin/stats' && method === 'GET') {
    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*)                                  AS total,
           COUNT(*) FILTER (WHERE status='pending')  AS pending,
           COUNT(*) FILTER (WHERE status='active')   AS active,
           COUNT(*) FILTER (WHERE status='rejected') AS rejected
         FROM ads`
      );
      const s = rows[0];
      return jsonRes(res, 200, {
        ok: true,
        total:    Number(s.total),
        pending:  Number(s.pending),
        active:   Number(s.active),
        rejected: Number(s.rejected)
      });
    } catch (e) {
      console.error('GET /api/admin/stats:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao buscar estatísticas.' });
    }
  }

  // ── POST /api/admin/ads/:id/approve ──
  const approveP = matchRoute(url, '/api/admin/ads/:id/approve');
  if (approveP && method === 'POST') {
    try {
      const { rows } = await pool.query(
        `UPDATE ads SET status='active' WHERE id=$1 RETURNING *`,
        [Number(approveP.id)]
      );
      if (!rows.length) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
      return jsonRes(res, 200, { ok: true, ad: rows[0] });
    } catch (e) {
      console.error('approve:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao aprovar anúncio.' });
    }
  }

  // ── POST /api/admin/ads/:id/reject ──
  const rejectP = matchRoute(url, '/api/admin/ads/:id/reject');
  if (rejectP && method === 'POST') {
    try {
      const { rows } = await pool.query(
        `UPDATE ads SET status='rejected' WHERE id=$1 RETURNING *`,
        [Number(rejectP.id)]
      );
      if (!rows.length) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
      return jsonRes(res, 200, { ok: true, ad: rows[0] });
    } catch (e) {
      console.error('reject:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao rejeitar anúncio.' });
    }
  }

  // ── DELETE /api/admin/ads/:id ──
  const deleteP = matchRoute(url, '/api/admin/ads/:id');
  if (deleteP && method === 'DELETE') {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM ads WHERE id=$1',
        [Number(deleteP.id)]
      );
      if (!rowCount) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
      return jsonRes(res, 200, { ok: true });
    } catch (e) {
      console.error('delete:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao excluir anúncio.' });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Classificados Jaraguá server running at http://${HOST}:${PORT}`);
});
