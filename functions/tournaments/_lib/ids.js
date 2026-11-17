// ids.js — id + time helpers. crypto is global on both Cloudflare Workers and Node 24.
export const now = () => Date.now();

export function genId(prefix = '') {
  const t = Date.now().toString(36);
  let r;
  try {
    const b = new Uint8Array(10);
    crypto.getRandomValues(b);
    r = [...b].map((x) => (x % 36).toString(36)).join('');
  } catch {
    r = Math.random().toString(36).slice(2, 12);
  }
  return (prefix ? prefix + '_' : '') + t + r;
}

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
