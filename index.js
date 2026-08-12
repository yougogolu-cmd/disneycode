const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cookieParser = require('cookie-parser');
const {
  authenticate,
  createToken,
  setAuthCookie,
  clearAuthCookie,
  getSessionUser,
  requireAuth,
} = require('./lib/auth');
const linkStorage = require('./lib/storage');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTERNAL_BASE = 'https://32t.cn';
const CODE_REGEX = /\b\d{6}\b/;
const POLL_INTERVAL_MS = 10000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

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

function getSharedStyles() {
  return `
    :root {
      --bg: #ffffff;
      --text: #111111;
      --muted: #8e8e93;
      --line: #f0f0f0;
      --accent: #007aff;
      --radius: 14px;
      --safe-b: env(safe-area-inset-bottom, 0px);
      --safe-t: env(safe-area-inset-top, 0px);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
      padding: calc(20px + var(--safe-t)) 20px calc(28px + var(--safe-b));
      display: flex;
      flex-direction: column;
    }
    .page {
      width: 100%;
      max-width: 360px;
      margin: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .site {
      text-align: center;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--muted);
      letter-spacing: 0.02em;
      margin-bottom: 32px;
    }
    .title {
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      text-align: center;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 0.8125rem;
      color: var(--muted);
      text-align: center;
      margin-bottom: 32px;
    }
    .field-label {
      display: block;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .input {
      width: 100%;
      border: none;
      border-bottom: 1.5px solid var(--line);
      border-radius: 0;
      padding: 12px 0;
      font-size: 16px;
      background: transparent;
      color: var(--text);
      transition: border-color 0.2s;
    }
    .input:focus {
      outline: none;
      border-bottom-color: var(--accent);
    }
    .input::placeholder { color: #c7c7cc; }
    .btn {
      appearance: none;
      border: none;
      border-radius: var(--radius);
      min-height: 50px;
      width: 100%;
      padding: 14px 20px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:active { opacity: 0.7; }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-text {
      background: none;
      color: var(--muted);
      min-height: 44px;
      font-size: 0.875rem;
      font-weight: 500;
      width: auto;
      margin: 0 auto;
      display: block;
    }
    .btn-row { display: flex; flex-direction: column; gap: 8px; margin-top: 28px; }
    .link-preview {
      margin-top: 28px;
      padding-top: 28px;
      border-top: 1px solid var(--line);
      display: none;
    }
    .link-preview.show { display: block; }
    .link-preview-label {
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 10px;
    }
    .link-preview-url {
      font-size: 0.8125rem;
      line-height: 1.55;
      word-break: break-all;
      color: var(--text);
      margin-bottom: 16px;
    }
    .link-actions { display: flex; flex-direction: column; gap: 8px; }
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(24px + var(--safe-b));
      transform: translateX(-50%) translateY(12px);
      background: rgba(17, 17, 17, 0.88);
      backdrop-filter: blur(8px);
      color: #fff;
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 0.8125rem;
      font-weight: 500;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
      z-index: 100;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  `;
}

function renderDigitBoxes(code) {
  if (!code) {
    return '<div class="waiting"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  }
  const digits = code.split('').map(
    (d) => `<span class="digit">${d}</span>`
  ).join('');
  return `<div class="code-digits">${digits}</div>`;
}

function renderPage({ code, token, updatedAt, errorMessage }) {
  const safeCode = code || '';
  const hasCode = Boolean(code);
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString('ko-KR', { hour12: false })
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>인증번호 확인</title>
  <style>
    ${getSharedStyles()}
    .code-area {
      text-align: center;
      padding: 40px 0 16px;
      min-height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .code-digits {
      display: flex;
      gap: clamp(8px, 3vw, 14px);
      justify-content: center;
    }
    .digit {
      font-size: clamp(2rem, 9vw, 2.75rem);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .code-digits.flash .digit {
      animation: fadeIn 0.35s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .waiting {
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: center;
      height: 48px;
    }
    .dot {
      width: 7px; height: 7px;
      background: #d1d1d6;
      border-radius: 50%;
      animation: bounce 1.2s ease-in-out infinite;
    }
    .dot:nth-child(2) { animation-delay: 0.15s; }
    .dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes bounce {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
      40% { opacity: 1; transform: scale(1); }
    }
    .status {
      text-align: center;
      font-size: 0.75rem;
      color: var(--muted);
      min-height: 1.2em;
    }
    .error {
      margin-top: 8px;
      font-size: 0.8125rem;
      color: #ff3b30;
      text-align: center;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="page">
    <p class="site">keyview.online</p>
    <h1 class="title">인증번호</h1>
    <p class="subtitle">앱에 아래 번호를 입력하세요</p>

    <div class="code-area">
      <div id="auth-code">${renderDigitBoxes(code)}</div>
    </div>

    <p class="status" id="status-text">${updatedLabel ? updatedLabel : '확인 중'}</p>
    ${errorMessage ? `<p class="error" id="error-text">${errorMessage}</p>` : '<p class="error" id="error-text" style="display:none"></p>'}

    <div class="btn-row">
      <button type="button" class="btn btn-primary" id="copy-btn" ${hasCode ? '' : 'disabled'}>복사</button>
      <button type="button" class="btn btn-text" id="refresh-btn">새로고침</button>
    </div>
  </div>

  <div class="toast" id="toast">인증번호가 복사되었습니다!</div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    const POLL_MS = ${POLL_INTERVAL_MS};
    let currentCode = ${JSON.stringify(safeCode)};
    let pollTimer = null;

    const codeEl = document.getElementById('auth-code');
    const copyBtn = document.getElementById('copy-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const statusEl = document.getElementById('status-text');
    const errorEl = document.getElementById('error-text');
    const toast = document.getElementById('toast');

    function renderDigits(code) {
      if (!code) {
        return '<div class="waiting"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
      }
      return '<div class="code-digits">' + code.split('').map(function(d) {
        return '<span class="digit">' + d + '</span>';
      }).join('') + '</div>';
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 2500);
    }

    function setWaiting() {
      codeEl.innerHTML = renderDigits(null);
      copyBtn.disabled = true;
    }

    function setCode(code, updatedAt) {
      currentCode = code;
      codeEl.innerHTML = renderDigits(code);
      var digits = codeEl.querySelector('.code-digits');
      if (digits) {
        digits.classList.remove('flash');
        void digits.offsetWidth;
        digits.classList.add('flash');
      }
      copyBtn.disabled = false;

      if (updatedAt) {
        statusEl.textContent = new Date(updatedAt).toLocaleString('ko-KR', { hour12: false });
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
          statusEl.textContent = '확인 중';
          return;
        }

        if (data.code) {
          if (data.code !== currentCode) {
            setCode(data.code, data.updatedAt);
          } else if (data.updatedAt) {
            statusEl.textContent = new Date(data.updatedAt).toLocaleString('ko-KR', { hour12: false });
          }
        } else {
          setWaiting();
          statusEl.textContent = '확인 중';
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

    refreshBtn.addEventListener('click', function() {
      refreshBtn.disabled = true;
      pollCode().finally(function() { refreshBtn.disabled = false; });
    });

    copyBtn.addEventListener('click', async function() {
      if (!currentCode) return;
      try {
        await navigator.clipboard.writeText(currentCode);
      } catch {
        var textarea = document.createElement('textarea');
        textarea.value = currentCode;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('복사되었습니다');
    });

    startPolling();
  </script>
</body>
</html>`;
}

function extractToken(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const fromPath = value.match(/\/code\/([^/?#\s]+)/i);
  if (fromPath) return decodeURIComponent(fromPath[1]);
  const from32t = value.match(/32t\.cn\/static\/code\/([^/?#\s]+)/i);
  if (from32t) return decodeURIComponent(from32t[1]);
  return value.split(/[/?#\s]+/).pop() || value;
}

function buildGuestLink(req, token) {
  const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/code/${encodeURIComponent(token)}`;
}

function renderLoginPage(errorMessage = '') {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff">
  <title>로그인</title>
  <style>${getSharedStyles()}
    .login-form { margin-top: 8px; }
    .login-error {
      margin-bottom: 16px; padding: 10px 12px; border-radius: 10px;
      background: #fff1f0; color: #ff3b30; font-size: 0.8125rem; text-align: center;
    }
  </style>
</head>
<body>
  <div class="page">
    <p class="site">keyview.online</p>
    <h1 class="title">관리자 로그인</h1>
    <p class="subtitle">링크 관리 페이지입니다</p>
    ${errorMessage ? `<p class="login-error">${errorMessage}</p>` : ''}
    <form class="login-form" method="POST" action="/login">
      <label class="field-label" for="username">아이디</label>
      <input class="input" id="username" name="username" type="text" autocomplete="username" required />
      <label class="field-label" for="password" style="margin-top:20px">비밀번호</label>
      <input class="input" id="password" name="password" type="password" autocomplete="current-password" required />
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">로그인</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

function renderDashboardPage() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff">
  <title>링크 관리</title>
  <style>${getSharedStyles()}
    .top-bar {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 28px;
    }
    .logout-btn {
      background: none; border: none; color: var(--muted);
      font-size: 0.8125rem; cursor: pointer; padding: 8px 0;
    }
    .section { margin-top: 32px; padding-top: 28px; border-top: 1px solid var(--line); }
    .section-title { font-size: 0.875rem; font-weight: 600; margin-bottom: 16px; }
    .saved-list { display: flex; flex-direction: column; gap: 12px; }
    .saved-item {
      padding: 14px 0; border-bottom: 1px solid var(--line);
    }
    .saved-item:last-child { border-bottom: none; }
    .saved-label { font-size: 0.8125rem; font-weight: 600; margin-bottom: 4px; }
    .saved-url {
      font-size: 0.75rem; color: var(--muted); word-break: break-all;
      line-height: 1.45; margin-bottom: 10px;
    }
    .saved-meta { font-size: 0.6875rem; color: #c7c7cc; margin-bottom: 10px; }
    .saved-actions { display: flex; gap: 16px; }
    .link-action {
      background: none; border: none; padding: 0;
      font-size: 0.8125rem; font-weight: 500; cursor: pointer;
    }
    .link-action.copy { color: var(--accent); }
    .link-action.open { color: var(--muted); }
    .link-action.delete { color: #ff3b30; }
    .saved-creds {
      font-size: 0.75rem; color: var(--muted); margin-bottom: 6px;
    }
    .saved-creds span { color: var(--text); font-weight: 500; }
    .type-tag {
      display: inline-block; font-size: 0.625rem; font-weight: 600;
      color: var(--muted); background: #f5f5f7; border-radius: 4px;
      padding: 2px 6px; margin-bottom: 8px;
    }
    .empty { text-align: center; color: var(--muted); font-size: 0.8125rem; padding: 24px 0; }
  </style>
</head>
<body>
  <div class="page">
    <div class="top-bar">
      <p class="site" style="margin:0">keyview.online</p>
      <form method="POST" action="/logout"><button type="submit" class="logout-btn">로그아웃</button></form>
    </div>

    <h1 class="title">링크 관리</h1>

    <p class="section-title" style="margin-top:0">① 토큰으로 만들기</p>
    <label class="field-label" for="token-input">토큰</label>
    <input class="input" id="token-input" type="text" placeholder="토큰 입력" autocomplete="off" autocapitalize="off" spellcheck="false" />

    <label class="field-label" for="label-input" style="margin-top:16px">메모 (선택)</label>
    <input class="input" id="label-input" type="text" placeholder="예: 홍길동" autocomplete="off" />

    <div class="link-preview" id="preview">
      <p class="link-preview-label">생성된 링크</p>
      <p class="link-preview-url" id="preview-link"></p>
    </div>

    <div class="btn-row">
      <button type="button" class="btn btn-primary" id="save-btn" disabled>저장</button>
      <button type="button" class="btn btn-text" id="copy-btn" disabled>복사</button>
    </div>

    <div class="section">
      <p class="section-title">② 직접 입력해서 저장</p>
      <label class="field-label" for="custom-label">메모 (선택)</label>
      <input class="input" id="custom-label" type="text" placeholder="예: A손님" autocomplete="off" />

      <label class="field-label" for="custom-url" style="margin-top:16px">링크 주소</label>
      <input class="input" id="custom-url" type="url" placeholder="https://www.keyview.online/code/..." autocomplete="off" autocapitalize="off" spellcheck="false" />

      <label class="field-label" for="custom-id" style="margin-top:16px">아이디 (선택)</label>
      <input class="input" id="custom-id" type="text" placeholder="아이디" autocomplete="off" autocapitalize="off" />

      <label class="field-label" for="custom-pass" style="margin-top:16px">비밀번호 (선택)</label>
      <input class="input" id="custom-pass" type="text" placeholder="비밀번호" autocomplete="off" />

      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="custom-save-btn">직접 저장</button>
      </div>
    </div>

    <div class="section">
      <p class="section-title">저장 목록</p>
      <div class="saved-list" id="saved-list">
        <p class="empty">불러오는 중…</p>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">복사되었습니다</div>

  <script>
    const tokenInput = document.getElementById('token-input');
    const labelInput = document.getElementById('label-input');
    const previewBox = document.getElementById('preview');
    const previewLink = document.getElementById('preview-link');
    const saveBtn = document.getElementById('save-btn');
    const copyBtn = document.getElementById('copy-btn');
    const customLabel = document.getElementById('custom-label');
    const customUrl = document.getElementById('custom-url');
    const customId = document.getElementById('custom-id');
    const customPass = document.getElementById('custom-pass');
    const customSaveBtn = document.getElementById('custom-save-btn');
    const savedList = document.getElementById('saved-list');
    const toast = document.getElementById('toast');

    let currentLink = '';

    function esc(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function extractToken(raw) {
      const value = raw.trim();
      if (!value) return '';
      const fromPath = value.match(/\\/code\\/([^/?#\\s]+)/i);
      if (fromPath) return decodeURIComponent(fromPath[1]);
      const from32t = value.match(/32t\\.cn\\/static\\/code\\/([^/?#\\s]+)/i);
      if (from32t) return decodeURIComponent(from32t[1]);
      return value.split(/[\\/?#\\s]+/).pop() || value;
    }

    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 2500);
    }

    function updatePreview() {
      const token = extractToken(tokenInput.value);
      if (!token) {
        currentLink = '';
        previewBox.classList.remove('show');
        saveBtn.disabled = true;
        copyBtn.disabled = true;
        return;
      }
      currentLink = location.origin + '/code/' + encodeURIComponent(token);
      previewLink.textContent = currentLink;
      previewBox.classList.add('show');
      saveBtn.disabled = false;
      copyBtn.disabled = false;
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        var t = document.createElement('textarea');
        t.value = text;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
      }
      showToast('복사되었습니다');
    }

    function formatDate(iso) {
      return new Date(iso).toLocaleString('ko-KR', { hour12: false });
    }

    function renderSavedLinks(links) {
      if (!links.length) {
        savedList.innerHTML = '<p class="empty">저장된 항목이 없습니다</p>';
        return;
      }
      savedList.innerHTML = links.map(function(item) {
        var tag = item.type === 'custom'
          ? '<span class="type-tag">직접입력</span>'
          : '<span class="type-tag">토큰</span>';
        var label = item.label ? '<p class="saved-label">' + esc(item.label) + '</p>' : '';
        var creds = '';
        if (item.loginId) {
          creds += '<p class="saved-creds">아이디: <span>' + esc(item.loginId) + '</span></p>';
        }
        if (item.loginPassword) {
          creds += '<p class="saved-creds">비밀번호: <span>' + esc(item.loginPassword) + '</span></p>';
        }
        var actions = '<button type="button" class="link-action copy" data-copy="' + esc(item.url) + '">링크복사</button>';
        if (item.loginId) {
          actions += '<button type="button" class="link-action copy" data-copy="' + esc(item.loginId) + '">아이디복사</button>';
        }
        if (item.loginPassword) {
          actions += '<button type="button" class="link-action copy" data-copy="' + esc(item.loginPassword) + '">비번복사</button>';
        }
        actions += '<button type="button" class="link-action open" data-url="' + esc(item.url) + '">열기</button>';
        actions += '<button type="button" class="link-action delete" data-id="' + esc(item.id) + '">삭제</button>';
        return '<div class="saved-item">' + tag + label +
          '<p class="saved-url">' + esc(item.url) + '</p>' + creds +
          '<p class="saved-meta">' + formatDate(item.createdAt) + '</p>' +
          '<div class="saved-actions">' + actions + '</div></div>';
      }).join('');
    }

    async function loadLinks() {
      const res = await fetch('/api/links');
      if (res.status === 401) { location.href = '/login'; return; }
      const data = await res.json();
      renderSavedLinks(data.links || []);
    }

    saveBtn.addEventListener('click', async function() {
      const token = extractToken(tokenInput.value);
      if (!token) return;
      saveBtn.disabled = true;
      try {
        const res = await fetch('/api/links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, label: labelInput.value.trim() }),
        });
        if (res.status === 401) { location.href = '/login'; return; }
        if (!res.ok) throw new Error('save failed');
        labelInput.value = '';
        showToast('저장되었습니다');
        loadLinks();
      } catch {
        showToast('저장 실패');
      } finally {
        saveBtn.disabled = !extractToken(tokenInput.value);
      }
    });

    customSaveBtn.addEventListener('click', async function() {
      const url = customUrl.value.trim();
      if (!url) { showToast('링크를 입력하세요'); return; }
      customSaveBtn.disabled = true;
      try {
        const res = await fetch('/api/links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            label: customLabel.value.trim(),
            loginId: customId.value.trim(),
            loginPassword: customPass.value.trim(),
            type: 'custom',
          }),
        });
        if (res.status === 401) { location.href = '/login'; return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'save failed');
        customLabel.value = '';
        customUrl.value = '';
        customId.value = '';
        customPass.value = '';
        showToast('저장되었습니다');
        loadLinks();
      } catch (e) {
        showToast(e.message === 'save failed' ? '저장 실패' : (e.message || '저장 실패'));
      } finally {
        customSaveBtn.disabled = false;
      }
    });

    copyBtn.addEventListener('click', function() {
      if (currentLink) copyText(currentLink);
    });

    savedList.addEventListener('click', async function(e) {
      const copyEl = e.target.closest('[data-copy]');
      const openEl = e.target.closest('.open');
      const deleteEl = e.target.closest('.delete');
      if (copyEl) return copyText(copyEl.getAttribute('data-copy'));
      if (openEl) return void (location.href = openEl.dataset.url);
      if (deleteEl) {
        if (!confirm('삭제할까요?')) return;
        const res = await fetch('/api/links/' + deleteEl.dataset.id, { method: 'DELETE' });
        if (res.status === 401) { location.href = '/login'; return; }
        loadLinks();
        showToast('삭제되었습니다');
      }
    });

    tokenInput.addEventListener('input', updatePreview);
    loadLinks();
  </script>
</body>
</html>`;
}

app.get('/login', (req, res) => {
  if (getSessionUser(req)) return res.redirect('/');
  res.status(200).send(renderLoginPage());
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!authenticate(username, password)) {
    return res.status(401).send(renderLoginPage('아이디 또는 비밀번호가 올바르지 않습니다.'));
  }
  setAuthCookie(res, createToken(username));
  return res.redirect('/');
});

app.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.redirect('/login');
});

app.get('/', requireAuth, (_req, res) => {
  res.status(200).send(renderDashboardPage());
});

app.get('/api/links', requireAuth, async (_req, res) => {
  try {
    const links = await linkStorage.getLinks();
    res.json({ links });
  } catch {
    res.status(500).json({ error: '링크를 불러오지 못했습니다.' });
  }
});

app.post('/api/links', requireAuth, async (req, res) => {
  const label = String(req.body?.label || '').trim();
  const loginId = String(req.body?.loginId || '').trim();
  const loginPassword = String(req.body?.loginPassword || '').trim();

  if (req.body?.type === 'custom' || req.body?.url) {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: '링크를 입력하세요.' });
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'http 또는 https 링크만 저장할 수 있습니다.' });
      }
    } catch {
      return res.status(400).json({ error: '올바른 링크 형식이 아닙니다.' });
    }

    try {
      const entry = await linkStorage.addLink({
        url,
        label,
        loginId,
        loginPassword,
        type: 'custom',
      });
      return res.status(201).json({ link: entry });
    } catch {
      return res.status(500).json({ error: '링크를 저장하지 못했습니다.' });
    }
  }

  const token = extractToken(req.body?.token);
  if (!token) return res.status(400).json({ error: '토큰 또는 링크가 필요합니다.' });

  try {
    const entry = await linkStorage.addLink({
      token,
      url: buildGuestLink(req, token),
      label,
      loginId,
      loginPassword,
      type: 'token',
    });
    res.status(201).json({ link: entry });
  } catch {
    res.status(500).json({ error: '링크를 저장하지 못했습니다.' });
  }
});

app.delete('/api/links/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await linkStorage.deleteLink(req.params.id);
    if (!deleted) return res.status(404).json({ error: '링크를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: '링크를 삭제하지 못했습니다.' });
  }
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
