// Protects the admin dashboard PAGE. Verifies the Cloudflare Access assertion server-side so a
// direct request without a valid Access identity is rejected even if the edge policy is missing.
import { requireAccess } from '../_lib/http.js';

export async function onRequest(context) {
  const admin = await requireAccess(context);
  if (!admin) {
    return new Response('Forbidden — this page requires Ingenious Hunter admin access (Cloudflare Access).',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  context.data = context.data || {};
  context.data.admin = admin;
  return context.next();
}
