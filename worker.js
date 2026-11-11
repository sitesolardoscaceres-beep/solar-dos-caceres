/**
 * Solar dos Cáceres — Worker
 * - Serve o site estático (ficheiros da raiz do repositório).
 * - /api/*  → API do admin. Só funciona para quem entrou pelo Cloudflare Access
 *   (email + código). A chave do GitHub fica guardada como "secret" no Cloudflare
 *   e nunca chega ao browser.
 *
 * Variáveis (Settings → Variables and Secrets):
 *   GITHUB_TOKEN        (secret)  chave fine-grained com Contents: Read and write
 *   ADMIN_PASSWORD      (secret)  palavra-passe do admin (mín. 10 caracteres)
 *   — opcional, em vez da palavra-passe: Cloudflare Access (email + código) —
 *   ACCESS_TEAM_DOMAIN  (texto)   ex: solardoscaceres.cloudflareaccess.com
 *   ACCESS_AUD          (texto)   "Application Audience (AUD) Tag" da aplicação Access
 *   ADMIN_EMAILS        (texto)   emails autorizados, separados por vírgulas
 */

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const SESSION_DAYS = 60;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { return json({ error: e.message || 'erro' }, e.status || 500); }
    }
    return env.ASSETS.fetch(req);
  }
};

/* ------------------------------------------------------------------ API */
async function api(req, env, url) {
  const hasAccess = !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
  const hasPassword = !!(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 10);
  if (!env.GITHUB_TOKEN || (!hasAccess && !hasPassword))
    return json({ error: 'not-configured' }, 503);

  /* entrar / sair com palavra-passe */
  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!hasPassword) return json({ error: 'not-configured' }, 503);
    const { password } = await req.json().catch(() => ({}));
    if (typeof password !== 'string' || !(await safeEqual(password, env.ADMIN_PASSWORD))) {
      await new Promise(r => setTimeout(r, 1500));               // trava tentativas repetidas
      return json({ error: 'wrong-password' }, 401);
    }
    const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
    const cookie = `${exp}.${await hmac(env, String(exp))}`;
    return json({ ok: true }, 200, { 'set-cookie': `sdc_admin=${cookie}; Path=/api; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict` });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST')
    return json({ ok: true }, 200, { 'set-cookie': 'sdc_admin=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });

  const email = (hasAccess && await verifyAccess(req, env)) || (hasPassword && await verifySession(req, env));
  if (!email) return json({ error: 'not-authenticated', mode: hasPassword ? 'password' : 'access' }, 401);

  const gh = github(env);

  if (url.pathname === '/api/session' && req.method === 'GET')
    return json({ email });

  if (url.pathname === '/api/content' && req.method === 'GET') {
    const f = await gh.get('content.js');
    return json({ sha: f.sha, text: b64decode(f.content) });
  }

  if (url.pathname === '/api/save' && req.method === 'POST') {
    const body = await req.json();
    if (typeof body.text !== 'string' || !body.text.includes('window.CONTENT') || body.text.length > 500_000)
      return json({ error: 'conteúdo inválido' }, 400);

    for (const img of body.images || []) {
      if (!/^img\/[a-z0-9][a-z0-9._-]{0,120}\.(jpe?g|png|webp|gif|avif)$/i.test(img.path))
        return json({ error: 'nome de foto inválido: ' + img.path }, 400);
      if (typeof img.b64 !== 'string' || img.b64.length > 6_000_000)
        return json({ error: 'foto demasiado grande: ' + img.path }, 400);
      await gh.put(img.path, img.b64, `Admin (${email}): nova foto`);
    }
    const res = await gh.put('content.js', b64encode(body.text), `Admin (${email}): atualização de conteúdos`, body.sha);
    return json({ ok: true, sha: res.content.sha });
  }

  return json({ error: 'not-found' }, 404);
}

/* --------------------------------------------------------------- GitHub */
function github(env) {
  const repo = env.GITHUB_REPO || 'sitesolardoscaceres-beep/solar-dos-caceres';
  const branch = env.GITHUB_BRANCH || 'main';
  const base = `https://api.github.com/repos/${repo}/contents/`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'solar-dos-caceres-admin'
  };
  async function call(path, init = {}) {
    const r = await fetch(base + path + (init.method ? '' : `?ref=${branch}`), { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      const e = new Error(r.status === 409 ? 'conflict' : (t.message || 'GitHub ' + r.status));
      e.status = r.status === 409 ? 409 : 502;
      throw e;
    }
    return r.json();
  }
  return {
    get: path => call(path),
    async put(path, b64, message, sha) {
      if (sha === undefined) {                         // ficheiro pode já existir
        try { sha = (await call(path)).sha; } catch { sha = undefined; }
      }
      return call(path, { method: 'PUT', body: JSON.stringify({ message, content: b64, branch, ...(sha ? { sha } : {}) }) });
    }
  };
}

/* ---------------------------------------------------- Cloudflare Access */
let certsCache = { at: 0, keys: [] };

async function verifyAccess(req, env) {
  const token = req.headers.get('cf-access-jwt-assertion') ||
    (req.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = JSON.parse(b64urlText(parts[0]));
  const payload = JSON.parse(b64urlText(parts[1]));

  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${team}`) return null;
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp < now) return null;

  if (Date.now() - certsCache.at > 3600_000) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    certsCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = certsCache.keys.find(k => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;

  const email = (payload.email || '').toLowerCase();
  if (env.ADMIN_EMAILS) {
    const allowed = env.ADMIN_EMAILS.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(email)) return null;
  }
  return email || 'admin';
}

/* ------------------------------------------------- sessão (palavra-passe) */
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('sdc|' + env.ADMIN_PASSWORD + '|' + env.GITHUB_TOKEN),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function safeEqual(a, b) {                                   // comparação em tempo constante
  const h = async v => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function verifySession(req, env) {
  const c = (req.headers.get('cookie') || '').match(/(?:^|;\s*)sdc_admin=([^;]+)/)?.[1];
  if (!c) return null;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || +exp < Date.now() / 1000) return null;
  return (await safeEqual(sig, await hmac(env, exp))) ? 'admin' : null;
}

/* -------------------------------------------------------------- base64 */
function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
const b64urlText = s => new TextDecoder().decode(b64urlBytes(s));
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
