const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = 5000;
const HOST = '0.0.0.0';

const ALLOWED_CITIES  = ['Jaraguá do Sul', 'Guaramirim', 'Schroeder'];
const ADMIN_EMAIL     = 'karolzinhacarvalho21@gmail.com';
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || 'Admin@2025';

const pool           = new Pool({ connectionString: process.env.DATABASE_URL });
const activeSessions = new Set();
const userSessions   = new Map(); // token → { id, name, email, picture }

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

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
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

function checkAdminAuth(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token && activeSessions.has(token);
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

  // ── POST /api/admin/login ──
  if (url === '/api/admin/login' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { email, password } = body;

      if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        return jsonRes(res, 401, { ok: false, error: 'E-mail ou senha incorretos.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      activeSessions.add(token);
      return jsonRes(res, 200, { ok: true, token });
    } catch (e) {
      return jsonRes(res, 400, { ok: false, error: 'Requisição inválida.' });
    }
  }

  // ── POST /api/admin/logout ──
  if (url === '/api/admin/logout' && method === 'POST') {
    const auth  = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    activeSessions.delete(token);
    return jsonRes(res, 200, { ok: true });
  }

  // ── GET /api/config  (public — exposes non-secret config) ──
  if (url === '/api/config' && method === 'GET') {
    return jsonRes(res, 200, {
      googleClientId: process.env.GOOGLE_CLIENT_ID || null
    });
  }

  // ── POST /api/auth/google  (Google Sign-In credential verification) ──
  if (url === '/api/auth/google' && method === 'POST') {
    try {
      const body       = await parseBody(req);
      const { credential } = body;
      if (!credential) return jsonRes(res, 400, { ok: false, error: 'Credencial ausente.' });

      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return jsonRes(res, 503, { ok: false, error: 'Login com Google não configurado.' });

      const raw     = await httpsGet(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
      const payload = JSON.parse(raw);

      if (payload.error_description || payload.error)
        return jsonRes(res, 401, { ok: false, error: 'Token Google inválido.' });

      if (payload.aud !== clientId)
        return jsonRes(res, 401, { ok: false, error: 'Token de origem incorreta.' });

      const { rows } = await pool.query(
        `INSERT INTO users (google_id, name, email, picture)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (google_id) DO UPDATE
           SET name=EXCLUDED.name, picture=EXCLUDED.picture, email=EXCLUDED.email
         RETURNING id, name, email, picture`,
        [payload.sub, payload.name, payload.email, payload.picture]
      );
      const user  = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      userSessions.set(token, { id: user.id, name: user.name, email: user.email, picture: user.picture });

      return jsonRes(res, 200, {
        ok: true, token,
        user: { name: user.name, email: user.email, picture: user.picture }
      });
    } catch (e) {
      console.error('POST /api/auth/google:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao autenticar.' });
    }
  }

  // ── POST /api/auth/user-logout ──
  if (url === '/api/auth/user-logout' && method === 'POST') {
    const auth  = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    userSessions.delete(token);
    return jsonRes(res, 200, { ok: true });
  }

  // ── GET /api/auth/me ──
  if (url === '/api/auth/me' && method === 'GET') {
    const auth  = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const user  = token ? userSessions.get(token) : null;
    if (!user) return jsonRes(res, 401, { ok: false });
    return jsonRes(res, 200, { ok: true, user });
  }

  // ── POST /api/ads  (submit new ad — public) ──
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

  // ── All routes below require admin authentication ──
  if (url.startsWith('/api/admin/') && !checkAdminAuth(req)) {
    return jsonRes(res, 401, { ok: false, error: 'Não autorizado. Faça login como administrador.' });
  }

  // ── GET /api/admin/ads  (list ads, optional ?status=) ──
  if (url === '/api/admin/ads' && method === 'GET') {
    try {
      const qs     = req.url.includes('?') ? req.url.split('?')[1] : '';
      const params = Object.fromEntries(new URLSearchParams(qs));
      const VALID  = ['pending', 'active', 'rejected'];

      let query  = 'SELECT * FROM ads';
      let values = [];
      if (params.status && VALID.includes(params.status)) {
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

  // ── GET /api/admin/ads/:id  (single ad detail) ──
  const detailP = matchRoute(url, '/api/admin/ads/:id');
  if (detailP && method === 'GET') {
    try {
      const { rows } = await pool.query('SELECT * FROM ads WHERE id=$1', [Number(detailP.id)]);
      if (!rows.length) return jsonRes(res, 404, { ok: false, error: 'Anúncio não encontrado.' });
      return jsonRes(res, 200, { ok: true, ad: rows[0] });
    } catch (e) {
      console.error('GET /api/admin/ads/:id:', e.message);
      return jsonRes(res, 500, { ok: false, error: 'Erro ao buscar anúncio.' });
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
