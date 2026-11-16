// Protects the admin dashboard PAGE. Verifies the Cloudflare Access assertion server-side so a
// direct request without a valid Access identity is rejected even if the edge policy is missing.
import { requireAccess, accessForbidden } from '../_lib/http.js';

export async function onRequest(context) {
  const admin = await requireAccess(context);
  if (!admin) return accessForbidden(context, false);
  context.data = context.data || {};
  context.data.admin = admin;
  return context.next();
}
