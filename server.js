const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HOST = '0.0.0.0';

const ALLOWED_CITIES = ['Jaraguá do Sul', 'Guaramirim', 'Schroeder'];

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

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });

  } else if (req.url === '/api/ads' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const body = await parseBody(req);
      const { title, category, city, description, price, whatsapp } = body;

      if (!title || !category || !city || !whatsapp) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Preencha todos os campos obrigatórios.' }));
        return;
      }

      if (!ALLOWED_CITIES.includes(city)) {
        res.writeHead(422);
        res.end(JSON.stringify({
          ok: false,
          error: 'Desculpe, no momento aceitamos anúncios apenas para Jaraguá do Sul, Guaramirim e Schroeder.'
        }));
        return;
      }

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, message: 'Anúncio enviado para aprovação!' }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: 'Requisição inválida.' }));
    }

  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Classificados Jaraguá server running at http://${HOST}:${PORT}`);
});
