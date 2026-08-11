const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTERNAL_BASE = 'https://32t.cn';
const CODE_REGEX = /\b\d{6}\b/;
const POLL_INTERVAL_MS = 10000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractSixDigitCode(raw) {
  if (raw == null || raw === '') return null;

  const text = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = text.match(CODE_REGEX);
  return match ? match[0] : null;
}

async function fetchFromApi(token) {
  const url = `${EXTERNAL_BASE}/api/v1/code/${encodeURIComponent(token)}`;

  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000,
    validateStatus: (status) => status < 500,
  });

  const body = response.data;

  if (body && (body.code === 200 || body.code === 0) && body.data) {
    const code = extractSixDigitCode(body.data.code);
    return {
      code,
      updatedAt: body.data.updated_at || null,
      source: 'api',
    };
  }

  return { code: null, updatedAt: null, source: 'api' };
}

async function fetchFromHtml(token) {
  const url = `${EXTERNAL_BASE}/static/code/${encodeURIComponent(token)}`;

  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000,
    responseType: 'text',
    validateStatus: (status) => status < 500,
  });

  const html = response.data || '';
  const $ = cheerio.load(html);
  const textContent = $.text();
  const textMatch = textContent.match(CODE_REGEX);
  const code = textMatch ? textMatch[0] : (html.match(CODE_REGEX)?.[0] ?? null);

  return { code, updatedAt: null, source: 'html' };
}

async function fetchAuthCode(token) {
  try {
    const apiResult = await fetchFromApi(token);
    if (apiResult.code) return apiResult;
  } catch {
    // API 실패 시 HTML 폴백
  }

  try {
    return await fetchFromHtml(token);
  } catch (error) {
    throw error;
  }
}

function renderPage({ code, token, updatedAt, errorMessage }) {
  const safeCode = code || '';
  const hasCode = Boolean(code);
  const displayCode = hasCode ? code : '대기 중';
  const cardClass = hasCode ? 'code-card' : 'code-card waiting';
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString('ko-KR', { hour12: false })
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>인증번호 확인</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
      min-height: 100vh;
      background: linear-gradient(160deg, #0b1633 0%, #1a2a5e 45%, #0f1f4a 100%);
      color: #f5f7ff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }

    .container {
      width: 100%;
      max-width: 420px;
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
    }

    .logo {
      display: inline-block;
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }

    .notice {
      font-size: 0.9rem;
      line-height: 1.6;
      color: rgba(245, 247, 255, 0.78);
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 14px 16px;
    }

    .card-wrap {
      margin-bottom: 24px;
    }

    .code-card {
      background: #ffffff;
      color: #0b1633;
      border-radius: 20px;
      padding: 36px 24px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      transition: background 0.3s ease, color 0.3s ease;
    }

    .code-card.waiting {
      background: rgba(255, 255, 255, 0.12);
      color: #f5f7ff;
      border: 1px dashed rgba(255, 255, 255, 0.25);
      box-shadow: none;
    }

    .code-label {
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 12px;
    }

    .code-card.waiting .code-label {
      color: rgba(245, 247, 255, 0.65);
    }

    .code-value {
      font-size: clamp(2.5rem, 12vw, 3.5rem);
      font-weight: 800;
      letter-spacing: 0.35em;
      font-variant-numeric: tabular-nums;
      padding-left: 0.35em;
      transition: opacity 0.2s ease;
    }

    .code-card.waiting .code-value {
      letter-spacing: 0.05em;
      font-size: 1.75rem;
      font-weight: 600;
    }

    .code-value.flash {
      animation: flash 0.6s ease;
    }

    @keyframes flash {
      0% { opacity: 0.4; transform: scale(0.98); }
      100% { opacity: 1; transform: scale(1); }
    }

    .status {
      margin-top: 12px;
      font-size: 0.8rem;
      color: rgba(245, 247, 255, 0.55);
      text-align: center;
      min-height: 1.2em;
    }

    .error {
      margin-top: 14px;
      font-size: 0.85rem;
      color: #fecaca;
      text-align: center;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .btn {
      appearance: none;
      border: none;
      border-radius: 14px;
      padding: 16px 12px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }

    .btn:active {
      transform: scale(0.97);
    }

    .btn-primary {
      background: #ffffff;
      color: #0b1633;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.14);
      color: #f5f7ff;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 32px;
      transform: translateX(-50%) translateY(20px);
      background: #22c55e;
      color: #fff;
      padding: 12px 20px;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s ease;
      z-index: 100;
      white-space: nowrap;
    }

    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="logo">인증번호 확인</div>
      <p class="notice">인증번호 수신까지 10~30초 소요됩니다. 10초마다 자동으로 업데이트됩니다.</p>
    </header>

    <div class="card-wrap">
      <div class="${cardClass}" id="code-card">
        <div class="code-label">인증번호</div>
        <div class="code-value" id="auth-code">${displayCode}</div>
      </div>
      <p class="status" id="status-text">${updatedLabel ? `마지막 확인: ${updatedLabel}` : '확인 중…'}</p>
      ${errorMessage ? `<p class="error" id="error-text">${errorMessage}</p>` : '<p class="error" id="error-text" style="display:none"></p>'}
    </div>

    <div class="actions">
      <button type="button" class="btn btn-secondary" id="refresh-btn">새로고침</button>
      <button type="button" class="btn btn-primary" id="copy-btn" ${hasCode ? '' : 'disabled'}>인증번호 복사</button>
    </div>
  </div>

  <div class="toast" id="toast">인증번호가 복사되었습니다!</div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    const POLL_MS = ${POLL_INTERVAL_MS};
    let currentCode = ${JSON.stringify(safeCode)};
    let pollTimer = null;

    const codeEl = document.getElementById('auth-code');
    const cardEl = document.getElementById('code-card');
    const copyBtn = document.getElementById('copy-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const statusEl = document.getElementById('status-text');
    const errorEl = document.getElementById('error-text');
    const toast = document.getElementById('toast');

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function setWaiting() {
      cardEl.className = 'code-card waiting';
      codeEl.textContent = '대기 중';
      copyBtn.disabled = true;
    }

    function setCode(code, updatedAt) {
      currentCode = code;
      cardEl.className = 'code-card';
      codeEl.textContent = code;
      codeEl.classList.remove('flash');
      void codeEl.offsetWidth;
      codeEl.classList.add('flash');
      copyBtn.disabled = false;

      if (updatedAt) {
        const date = new Date(updatedAt);
        statusEl.textContent = '마지막 확인: ' + date.toLocaleString('ko-KR', { hour12: false });
      } else {
        statusEl.textContent = '방금 확인됨';
      }

      if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }
    }

    async function pollCode() {
      try {
        const res = await fetch('/api/code/' + encodeURIComponent(TOKEN), { cache: 'no-store' });
        const data = await res.json();

        if (data.error && !data.code) {
          if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = data.error;
          }
          setWaiting();
          statusEl.textContent = '확인 중…';
          return;
        }

        if (data.code) {
          if (data.code !== currentCode) {
            setCode(data.code, data.updatedAt);
          } else if (data.updatedAt) {
            const date = new Date(data.updatedAt);
            statusEl.textContent = '마지막 확인: ' + date.toLocaleString('ko-KR', { hour12: false });
          }
        } else {
          setWaiting();
          statusEl.textContent = '확인 중…';
        }
      } catch {
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = '연결 오류입니다. 잠시 후 다시 시도합니다.';
        }
      }
    }

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollCode, POLL_MS);
    }

    refreshBtn.addEventListener('click', () => {
      refreshBtn.disabled = true;
      pollCode().finally(() => {
        refreshBtn.disabled = false;
      });
    });

    copyBtn.addEventListener('click', async () => {
      if (!currentCode) return;

      try {
        await navigator.clipboard.writeText(currentCode);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = currentCode;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      showToast('인증번호가 복사되었습니다!');
    });

    startPolling();
  </script>
</body>
</html>`;
}

app.get('/', (_req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>인증번호 확인</title>
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
          min-height: 100vh; padding: 24px 16px;
          background: linear-gradient(160deg, #0b1633 0%, #1a2a5e 45%, #0f1f4a 100%);
          color: #f5f7ff; display: flex; align-items: center; justify-content: center;
        }
        .box { width: 100%; max-width: 440px; }
        h1 { font-size: 1.5rem; margin-bottom: 8px; text-align: center; }
        .desc {
          color: rgba(245,247,255,0.78); line-height: 1.6; margin-bottom: 24px;
          text-align: center; font-size: 0.92rem;
        }
        .field { margin-bottom: 14px; text-align: left; }
        .field label {
          display: block; font-size: 0.82rem; font-weight: 600;
          color: rgba(245,247,255,0.65); margin-bottom: 8px;
        }
        input {
          width: 100%; border: 1px solid rgba(255,255,255,0.2); border-radius: 12px;
          padding: 14px; font-size: 1rem; background: rgba(255,255,255,0.1); color: #fff;
        }
        input::placeholder { color: rgba(255,255,255,0.45); }
        input:focus { outline: none; border-color: rgba(255,255,255,0.45); }
        .result {
          margin-top: 20px; padding: 16px; border-radius: 14px;
          background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
          display: none;
        }
        .result.show { display: block; }
        .result-label { font-size: 0.8rem; color: rgba(245,247,255,0.55); margin-bottom: 8px; }
        .result-link {
          word-break: break-all; font-size: 0.9rem; line-height: 1.5;
          color: #fff; margin-bottom: 14px;
        }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .btn {
          border: none; border-radius: 12px; padding: 14px 12px;
          font-size: 0.92rem; font-weight: 700; cursor: pointer; text-align: center;
        }
        .btn-primary { background: #fff; color: #0b1633; }
        .btn-secondary {
          background: rgba(255,255,255,0.14); color: #f5f7ff;
          border: 1px solid rgba(255,255,255,0.2);
        }
        .toast {
          position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(20px);
          background: #22c55e; color: #fff; padding: 12px 20px; border-radius: 999px;
          font-size: 0.9rem; font-weight: 600; opacity: 0; pointer-events: none;
          transition: opacity 0.25s ease, transform 0.25s ease; white-space: nowrap;
        }
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>인증번호 확인</h1>
        <p class="desc">토큰을 입력하면 손님에게 보낼 링크가 자동으로 만들어집니다.</p>

        <div class="field">
          <label for="token-input">토큰</label>
          <input id="token-input" type="text" placeholder="토큰 입력" autocomplete="off" />
        </div>

        <div class="result" id="result">
          <div class="result-label">손님에게 보낼 링크</div>
          <div class="result-link" id="result-link"></div>
          <div class="actions">
            <button type="button" class="btn btn-primary" id="copy-btn">링크 복사</button>
            <button type="button" class="btn btn-secondary" id="open-btn">페이지 열기</button>
          </div>
        </div>
      </div>

      <div class="toast" id="toast">링크가 복사되었습니다!</div>

      <script>
        const tokenInput = document.getElementById('token-input');
        const resultBox = document.getElementById('result');
        const resultLink = document.getElementById('result-link');
        const copyBtn = document.getElementById('copy-btn');
        const openBtn = document.getElementById('open-btn');
        const toast = document.getElementById('toast');

        function extractToken(raw) {
          const value = raw.trim();
          if (!value) return '';

          const fromPath = value.match(/\\/code\\/([^/?#\\s]+)/i);
          if (fromPath) return decodeURIComponent(fromPath[1]);

          const from32t = value.match(/32t\\.cn\\/static\\/code\\/([^/?#\\s]+)/i);
          if (from32t) return decodeURIComponent(from32t[1]);

          return value.split(/[\\/?#\\s]+/).pop() || value;
        }

        function buildLink(token) {
          return location.origin + '/code/' + encodeURIComponent(token);
        }

        function showToast(message) {
          toast.textContent = message;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2500);
        }

        function updateLink() {
          const token = extractToken(tokenInput.value);
          if (!token) {
            resultBox.classList.remove('show');
            return;
          }

          const link = buildLink(token);
          resultLink.textContent = link;
          resultBox.classList.add('show');
          openBtn.onclick = () => { location.href = link; };
        }

        async function copyLink() {
          const token = extractToken(tokenInput.value);
          if (!token) return;

          const link = buildLink(token);
          try {
            await navigator.clipboard.writeText(link);
          } catch {
            const textarea = document.createElement('textarea');
            textarea.value = link;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          }
          showToast('링크가 복사되었습니다!');
        }

        tokenInput.addEventListener('input', updateLink);
        copyBtn.addEventListener('click', copyLink);
        tokenInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') copyLink();
        });
      </script>
    </body>
    </html>
  `);
});

app.get('/api/code/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || token.trim() === '') {
    return res.status(400).json({ code: null, error: '유효한 토큰이 필요합니다.' });
  }

  try {
    const result = await fetchAuthCode(token);

    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      code: result.code,
      updatedAt: result.updatedAt,
      error: result.code
        ? null
        : '아직 인증번호가 도착하지 않았습니다. 잠시 후 자동으로 다시 확인합니다.',
    });
  } catch (error) {
    const message =
      error.code === 'ECONNABORTED'
        ? '요청 시간이 초과되었습니다.'
        : '인증번호 페이지를 불러오지 못했습니다.';

    res.status(502).json({ code: null, error: message });
  }
});

app.get('/code/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || token.trim() === '') {
    return res.status(400).send(renderPage({
      code: null,
      token: '-',
      updatedAt: null,
      errorMessage: '유효한 토큰이 필요합니다.',
    }));
  }

  try {
    const result = await fetchAuthCode(token);

    res.status(200).send(renderPage({
      code: result.code,
      token,
      updatedAt: result.updatedAt,
      errorMessage: result.code
        ? null
        : '아직 인증번호가 도착하지 않았습니다. 잠시 후 자동으로 다시 확인합니다.',
    }));
  } catch (error) {
    const message =
      error.code === 'ECONNABORTED'
        ? '요청 시간이 초과되었습니다. 새로고침해 주세요.'
        : '인증번호 페이지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

    res.status(502).send(renderPage({
      code: null,
      token,
      updatedAt: null,
      errorMessage: message,
    }));
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
