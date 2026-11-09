// CrowTit Lawful Agent API proxy — Vercel serverless function.
// The API key is read ONLY from process.env.CROWTIT_API_KEY.
// It is never sent to the client, logged, or included in any response.
//
// Endpoints (same handler):
//   POST /api/ask            -> sync JSON answer {answer, sources, usage}
//   POST /api/ask?stream=1  -> SSE stream (same events as upstream)
//   GET  /api/ask            -> service info (no upstream call)

const UPSTREAM = 'https://api.crow-tit.com/v1/agent';
const MAX_QUESTION_CHARS = 45000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

// In-memory per-IP rate limit (per function instance on Vercel,
// per process on a long-running server — not a shared store).
const hits = new Map(); // ip -> { count, resetAt }

function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return 0;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }
  return 0;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

function mapUpstreamError(status, text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep raw text out of the reply */ }
  const upstreamMessage =
    (parsed && parsed.error && parsed.error.message) ||
    (parsed && parsed.message) ||
    '';
  if (status === 401) {
    return {
      status: 401,
      body: {
        error: {
          type: 'authentication_error',
          message:
            'API 키가 유효하지 않습니다. 호스팅 환경 변수 CROWTIT_API_KEY에 console.crow-tit.com에서 새로 복사한 키를 설정해 주세요.',
        },
      },
    };
  }
  if (status === 413) {
    return {
      status: 413,
      body: { error: { type: 'request_too_large', message: '질문이 너무 깁니다. 내용을 줄여서 다시 보내 주세요.' } },
    };
  }
  if (status === 400 || status === 422) {
    return {
      status,
      body: { error: { type: 'invalid_request_error', message: upstreamMessage || '요청 형식이 올바르지 않습니다.' } },
    };
  }
  return {
    status: status >= 500 ? 502 : status,
    body: { error: { type: 'api_error', message: upstreamMessage || '법률 API 서버에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.' } },
  };
}

async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return null; }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: 'legal-consult-proxy',
        upstream: 'api.crow-tit.com/v1/agent',
        endpoints: ['POST /api/ask', 'POST /api/ask?stream=1', 'POST /api/ask-stream'],
      });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: { type: 'invalid_request_error', message: 'POST 요청만 지원합니다.' } });
    }

    const ip = clientIp(req);
    const retryAfter = rateLimited(ip);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      return sendJson(res, 429, {
        error: { type: 'rate_limited', message: `요청이 너무 많습니다. ${retryAfter}초 후에 다시 시도해 주세요.` },
      });
    }

    const apiKey = process.env.CROWTIT_API_KEY;
    if (!apiKey) {
      return sendJson(res, 500, {
        error: {
          type: 'server_misconfigured',
          message: '서버에 API 키가 설정되지 않았습니다. 호스팅 환경 변수 CROWTIT_API_KEY를 설정해 주세요.',
        },
      });
    }

    const body = await readJsonBody(req);
    if (body === null || typeof body !== 'object') {
      return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'JSON 본문을 읽을 수 없습니다.' } });
    }

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return sendJson(res, 400, { error: { type: 'invalid_request_error', message: '질문을 입력해 주세요.' } });
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return sendJson(res, 413, {
        error: { type: 'request_too_large', message: `질문은 최대 ${MAX_QUESTION_CHARS.toLocaleString('ko-KR')}자까지 입력할 수 있습니다.` },
      });
    }
    const depth = body.depth === 'quick' ? 'quick' : 'deep';
    const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 2000) : undefined;

    const query = parseQuery(req);
    const wantsStream = query.stream === '1' || query.stream === 'true' ||
      (req.headers && req.headers.accept === 'text/event-stream');

    const upstreamPath = wantsStream ? `${UPSTREAM}/stream` : UPSTREAM;
    const timeoutMs = wantsStream ? 590000 : 270000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    req.on && req.on('close', () => { if (!res.writableEnded) controller.abort(); });

    let upstream;
    try {
      upstream = await fetch(upstreamPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          instructions ? { question, depth, instructions } : { question, depth }
        ),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        return sendJson(res, 504, { error: { type: 'timeout', message: '답변 생성 시간이 초과되었습니다. 빠른 답변(quick)으로 다시 시도해 주세요.' } });
      }
      return sendJson(res, 502, { error: { type: 'api_error', message: '법률 API 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' } });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      const mapped = mapUpstreamError(upstream.status, text);
      return sendJson(res, mapped.status, mapped.body);
    }

    if (!wantsStream) {
      const data = await upstream.json().catch(() => null);
      if (!data || typeof data.answer !== 'string') {
        return sendJson(res, 502, { error: { type: 'api_error', message: '법률 API 응답을 해석할 수 없습니다.' } });
      }
      return sendJson(res, 200, {
        answer: data.answer,
        sources: Array.isArray(data.sources) ? data.sources : [],
        usage: data.usage || null,
        stop_reason: data.stop_reason || null,
      });
    }

    // Streaming: forward upstream SSE events verbatim to the client.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    try {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {
      // Upstream stream ended abruptly; close the stream cleanly.
    }
    return res.end();
  } catch (err) {
    // Never include the API key or upstream internals in the error reply.
    if (!res.headersSent) {
      return sendJson(res, 500, { error: { type: 'api_error', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } });
    }
    return res.end();
  }
};
