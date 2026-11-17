// Protects every /api/admin/* mutation endpoint. Server-side Access verification — admin mutation
// endpoints are NEVER reachable without a valid Cloudflare Access identity.
import { requireAccess, accessForbidden } from '../../tournaments/_lib/http.js';

export async function onRequest(context) {
  const admin = await requireAccess(context);
  if (!admin) return accessForbidden(context, true);
  context.data = context.data || {};
  context.data.admin = admin;
  return context.next();
}
