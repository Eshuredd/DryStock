// Public endpoint configuration only. No AWS credentials or capability tokens in URLs.
export const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
export const cloudDemo = Boolean(apiBase);
const sessionKey = 'drystock-demo-session-v1';
let sessionPromise: Promise<string> | null = null;

function cachedToken() {
  const raw = sessionStorage.getItem(sessionKey);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as {token: string; expires_at: number};
    if (session.expires_at * 1000 > Date.now()) return session.token;
  } catch { /* Discard malformed/expired browser state. Backend remains authoritative. */ }
  sessionStorage.removeItem(sessionKey);
  return null;
}

async function sessionToken(): Promise<string> {
  const existing = cachedToken();
  if (existing) return existing;
  if (!sessionPromise) sessionPromise = (async () => {
    const response = await fetch(`${apiBase}/api/sessions`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}', cache: 'no-store'
    });
    if (!response.ok) throw new Error('Could not start a temporary demo session. Please retry later.');
    const session = await response.json() as {token: string; expires_at: number};
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    return session.token;
  })().finally(() => {sessionPromise = null;});
  return sessionPromise;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/api/')) throw new Error('Invalid API path');
  if (!cloudDemo) return fetch(path, options);
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${await sessionToken()}`);
  let response = await fetch(apiBase + path, {...options, headers, cache: 'no-store'});
  if (response.status === 401) {
    sessionStorage.removeItem(sessionKey);
    if (!options.method || options.method === 'GET') {
      headers.set('Authorization', `Bearer ${await sessionToken()}`);
      response = await fetch(apiBase + path, {...options, headers, cache: 'no-store'});
    }
  }
  return response;
}
