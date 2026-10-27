export interface AccessEnvironment {
  CROSSLAB_AUTH_REQUIRED?: string;
  CROSSLAB_ACCESS_CODE?: string;
  CROSSLAB_LOGIN_GUARD?: DurableObjectNamespace;
}

const COOKIE = '__Host-crosslab_access';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 2048;
const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sessionKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function loginAttempt(request: Request, secret: string, namespace: DurableObjectNamespace) {
  const origin = new URL(request.url).origin;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.sign('HMAC', await sessionKey(secret), encoder.encode(`CrossLab login rate\n${origin}\n${ip}`));
  const object = namespace.get(namespace.idFromName(base64url(digest)));
  const response = await object.fetch('https://login-guard.internal/attempt', { method: 'POST' });
  if (!response.ok) throw new Error('Login counter unavailable');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('success' in result) || typeof result.success !== 'boolean' || !('retryAfter' in result) || !Number.isInteger(result.retryAfter)) throw new Error('Invalid login counter response');
  const retryAfter = result.retryAfter as number;
  if ((result.success && retryAfter !== 0) || (!result.success && (retryAfter < 1 || retryAfter > 60))) throw new Error('Invalid login counter response');
  return { success: result.success, retryAfter };
}

export async function signAccessSession(secret: string, origin: string, nowMs = Date.now()): Promise<string> {
  const payload = `v1.${Math.floor(nowMs / 1000) + SESSION_SECONDS}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(secret), encoder.encode(`CrossLab access\n${origin}\n${payload}`));
  return `${payload}.${base64url(signature)}`;
}

export async function verifyAccessSession(token: string, secret: string, origin: string, nowMs = Date.now()): Promise<boolean> {
  if (token.length > 200) return false;
  const match = /^v1\.(\d{1,12})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expiry = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  if (expiry <= now || expiry > now + SESSION_SECONDS) return false;
  try {
    const signature = Uint8Array.from(atob(match[3].replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0));
    if (base64url(signature.buffer) !== match[3]) return false;
    return await crypto.subtle.verify('HMAC', await sessionKey(secret), signature, encoder.encode(`CrossLab access\n${origin}\nv1.${match[1]}.${match[2]}`));
  } catch { return false; }
}

function sessionCookie(request: Request) {
  const cookies = request.headers.get('Cookie') || '';
  if (cookies.length > 8192) return '';
  const values = cookies.split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
  return values.length === 1 ? values[0].slice(COOKIE.length + 1) : '';
}

function privateResponse(response: Response, referrerPolicy: 'no-referrer' | 'same-origin' = 'no-referrer') {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', referrerPolicy);
  return result;
}

function redirect(location: string, cookie?: string) {
  return privateResponse(new Response(null, { status: 303, headers: { Location: location, ...(cookie ? { 'Set-Cookie': cookie } : {}) } }));
}

function loginPage(message = '', status = 200, logout = false) {
  // All text is fixed server copy: no request value or configured secret is rendered.
  // HTML form POSTs need same-origin policy: no-referrer makes browsers send Origin: null.
  return privateResponse(new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>进入 CrossLab</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f3f5f2;color:#20332c;font:16px/1.6 system-ui,sans-serif}main{width:min(100%,420px);padding:36px;border:1px solid #dce4dc;border-radius:20px;background:#fff;box-shadow:0 12px 48px #20332c0b}.brand{font-size:14px;color:#48755b;letter-spacing:.06em}h1{font-size:25px;line-height:1.3;margin:16px 0 10px}p{color:#68776d;margin:0 0 24px}label{display:block;font-size:14px;margin-bottom:8px}input,button{font:inherit;width:100%;border-radius:10px;padding:12px 14px}input{border:1px solid #b8c7bc;margin-bottom:18px}input:focus{outline:2px solid #80aa8e;outline-offset:2px}button{border:0;background:#315e43;color:#fff;cursor:pointer}a{color:#315e43}.message{color:#9d342e;font-size:14px;margin:0 0 16px}:focus-visible{outline:2px solid #315e43;outline-offset:3px}
  </style></head><body><main><div class="brand">CrossLab · 跨界研究器</div><h1>${logout ? '退出工作台' : '进入研究工作台'}</h1><p>${logout ? '退出后，此浏览器需要重新输入访问口令。' : '输入网站访问口令，继续你的跨学科研究。'}</p>${message ? `<p class="message" role="alert">${message}</p>` : ''}<form method="post" action="/__crosslab/${logout ? 'logout' : 'login'}">${logout ? '' : '<label for="code">访问口令</label><input id="code" name="code" type="password" autocomplete="current-password" required minlength="16" maxlength="256" autofocus>'}<button type="submit">${logout ? '退出登录' : '进入工作台'}</button></form>${logout ? '<p style="margin:16px 0 0"><a href="/">返回工作台</a></p>' : ''}</main></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  }), 'same-origin');
}

function failure(message: string, status: number) {
  return privateResponse(Response.json({ error: message }, { status }));
}

async function boundedForm(request: Request): Promise<URLSearchParams | null> {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

async function sameCode(actual: string, expected: string) {
  const [a, b] = await Promise.all([actual, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const first = new Uint8Array(a), second = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < first.length; i++) difference |= first[i] ^ second[i];
  return difference === 0;
}

/** Enable the website access gate with CROSSLAB_AUTH_REQUIRED. */
export async function withWebsiteAccess(request: Request, env: AccessEnvironment, next: () => Promise<Response>): Promise<Response> {
  if (env.CROSSLAB_AUTH_REQUIRED !== 'true') return next();
  const secret = env.CROSSLAB_ACCESS_CODE;
  if (!secret || [...secret.trim()].length < 16 || secret.length > 256) return failure('网站访问口令尚未配置，请联系网站所有者。', 503);
  const url = new URL(request.url);
  if (url.protocol !== 'https:') {
    if (!['GET', 'HEAD'].includes(request.method)) return failure('请使用 HTTPS 访问。', 400);
    url.protocol = 'https:';
    return privateResponse(new Response(null, { status: 308, headers: { Location: url.href } }));
  }
  const login = url.pathname === '/__crosslab/login';
  const logout = url.pathname === '/__crosslab/logout';
  if ((login || logout) && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return failure('请求来源无效。', 403);
    if (logout) return redirect('/__crosslab/login', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    if (!env.CROSSLAB_LOGIN_GUARD) return failure('登录暂不可用，请稍后重试。', 503);
    try {
      const { success, retryAfter } = await loginAttempt(request, secret, env.CROSSLAB_LOGIN_GUARD);
      if (!success) {
        const response = loginPage('尝试次数较多，请一分钟后重试。', 429);
        response.headers.set('Retry-After', String(retryAfter));
        return response;
      }
    } catch { return failure('登录暂不可用，请稍后重试。', 503); }
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') return failure('登录请求格式无效。', 415);
    const form = await boundedForm(request);
    if (!form) return failure('登录请求过长或格式无效。', 413);
    const code = form.get('code') || '';
    if (form.getAll('code').length !== 1 || code.length > 256 || !(await sameCode(code, secret))) return loginPage('访问口令无效，请重新输入。', 401);
    return redirect('/', `${COOKIE}=${await signAccessSession(secret, url.origin)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  }
  if ((login || logout) && !['GET', 'HEAD'].includes(request.method)) return failure('请求方法无效。', 405);
  const authenticated = await verifyAccessSession(sessionCookie(request), secret, url.origin);
  if (logout) return authenticated ? loginPage('', 200, true) : redirect('/__crosslab/login');
  if (login) return authenticated ? redirect('/') : loginPage();
  if (!authenticated) {
    if ((request.method === 'GET' || request.method === 'HEAD') && request.headers.get('Accept')?.includes('text/html') && !url.pathname.startsWith('/api/')) return loginPage('', 401);
    return privateResponse(Response.json({ error: '登录已过期或尚未登录，请刷新页面重新输入网站访问口令。', loginPath: '/__crosslab/login' }, { status: 401 }));
  }
  return privateResponse(await next());
}
