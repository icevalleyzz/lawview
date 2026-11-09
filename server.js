// Local / long-running server (Render, Railway, VPS, or your own machine).
// No dependencies — plain Node.js http, Node >= 18.
// Serves public/ and proxies /api/ask and /api/ask-stream to ./api/ask.js.
// The API key is read ONLY from process.env.CROWTIT_API_KEY.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ask = require('./api/ask.js');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: { type: 'invalid_request_error', message: '허용되지 않은 경로입니다.' } });
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: { type: 'invalid_request_error', message: '페이지를 찾을 수 없습니다.' } });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'legal-consult-proxy',
        keyConfigured: Boolean(process.env.CROWTIT_API_KEY),
        upstream: 'api.crow-tit.com/v1/agent',
      });
    }

    if (url.pathname === '/api/ask' || url.pathname === '/api/ask-stream') {
      // Parse a JSON body for the proxy handler (Vercel parses it for us).
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('utf8');
        try { req.body = text ? JSON.parse(text) : {}; } catch {
          return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'JSON 본문을 읽을 수 없습니다.' } });
        }
        req.query = Object.fromEntries(url.searchParams.entries());
        if (url.pathname === '/api/ask-stream') req.query.stream = '1';
        // Hand the already-read request to the handler; it must not re-read the body.
        // It reads req.body first, so this is safe.
        return ask(req, res);
      }
      req.query = Object.fromEntries(url.searchParams.entries());
      return ask(req, res);
    }

    if (req.method === 'GET') return serveStatic(req, res);
    return sendJson(res, 405, { error: { type: 'invalid_request_error', message: '지원하지 않는 요청입니다.' } });
  } catch {
    if (!res.headersSent) return sendJson(res, 500, { error: { type: 'api_error', message: '서버 오류가 발생했습니다.' } });
    return res.end();
  }
});

server.listen(PORT, () => {
  // Deliberately do not print the key — only whether one is configured.
  console.log(`Legal consult app listening on http://localhost:${PORT}`);
  console.log(`CROWTIT_API_KEY configured: ${Boolean(process.env.CROWTIT_API_KEY)}`);
});
