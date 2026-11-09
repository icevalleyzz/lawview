// Streaming alias: POST /api/ask-stream behaves like POST /api/ask?stream=1.
const ask = require('./ask.js');

module.exports = function handler(req, res) {
  try {
    const url = new URL(req.url || '/api/ask-stream', 'http://localhost');
    url.searchParams.set('stream', '1');
    req.url = `${url.pathname}${url.search}`;
    if (req.query && typeof req.query === 'object') req.query.stream = '1';
  } catch {
    // Fall through; ask.js also honours the /ask-stream path via the shim in server.js.
  }
  return ask(req, res);
};
