// POST /api/captain/checkin  { token } — verified captain check-in (no account).
import { json } from '../../tournaments/_lib/http.js';
import { checkIn } from '../../tournaments/_lib/service.js';

export async function onRequestPost({ env, request }) {
  if (!env.DB) return json({ error: 'not_configured' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!body || !body.token) return json({ error: 'missing_token' }, 400);
  try {
    const r = await checkIn(env, body.token);
    return json(r);
  } catch (e) {
    return json({ error: e.code || 'error' }, e.code === 'bad_token' ? 401 : 400);
  }
}
