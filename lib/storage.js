const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KV_KEY = 'saved_links';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'links.json');

function useKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvRequest(pathSuffix, options = {}) {
  const url = `${process.env.KV_REST_API_URL}${pathSuffix}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`KV request failed: ${response.status}`);
  }
  return response.json();
}

function ensureFileStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function readFileLinks() {
  ensureFileStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileLinks(links) {
  ensureFileStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2), 'utf8');
}

async function getLinks() {
  if (useKv()) {
    const result = await kvRequest(`/get/${KV_KEY}`);
    if (!result.result) return [];
    try {
      const parsed = JSON.parse(result.result);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return readFileLinks();
}

async function saveLinks(links) {
  const payload = JSON.stringify(links);
  if (useKv()) {
    const response = await fetch(`${process.env.KV_REST_API_URL}/set/${KV_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      },
      body: payload,
    });
    if (!response.ok) throw new Error(`KV save failed: ${response.status}`);
    return;
  }
  writeFileLinks(links);
}

async function addLink({ token, url, label, loginId, loginPassword, type = 'token' }) {
  const links = await getLinks();
  const entry = {
    id: crypto.randomUUID(),
    type,
    token: token || '',
    url,
    label: label || '',
    loginId: loginId || '',
    loginPassword: loginPassword || '',
    createdAt: new Date().toISOString(),
  };
  links.unshift(entry);
  await saveLinks(links);
  return entry;
}

async function deleteLink(id) {
  const links = await getLinks();
  const next = links.filter((item) => item.id !== id);
  if (next.length === links.length) return false;
  await saveLinks(next);
  return true;
}

module.exports = {
  getLinks,
  addLink,
  deleteLink,
};
