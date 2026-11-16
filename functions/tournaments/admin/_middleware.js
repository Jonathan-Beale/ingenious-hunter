// Protects the admin dashboard PAGE. Verifies the Cloudflare Access assertion server-side so a
// direct request without a valid Access identity is rejected even if the edge policy is missing.
import { requireAccess } from '../_lib/http.js';

export async function onRequest(context) {
  const admin = await requireAccess(context);
  if (!admin) {
    const dbg = context.data && context.data.accessDebug;
    const reason = (context.data && context.data.accessReason) || 'verify_failed';
    const body = 'Forbidden — this page requires Ingenious Hunter admin access (Cloudflare Access).'
      + (dbg ? `\n\n[auth-debug] ${reason}` : '');
    return new Response(body, {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...(dbg ? { 'x-access-debug': reason } : {}) },
    });
  }
  context.data = context.data || {};
  context.data.admin = admin;
  return context.next();
}
