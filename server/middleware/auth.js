import { getSupabase } from '../services/storage.js';

/**
 * Authorization: Bearer <token> ヘッダーからユーザーを検証し req.userId にセットする。
 * トークンがない・無効な場合は req.userId = null のまま通過する（プランゲートが任意適用になる）。
 */
export async function optionalAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      const { data: { user } } = await getSupabase().auth.getUser(token);
      req.userId = user?.id ?? null;
    } else {
      req.userId = null;
    }
  } catch {
    req.userId = null;
  }
  next();
}
