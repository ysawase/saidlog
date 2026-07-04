import { Router } from 'express';
import { insertEvent } from '../services/events.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// クライアント発火イベントの受け口（fire-and-forget）。
// auth_state / actor_typeはAuthorizationヘッダーから判定し、クライアント申告に依存しない。
// analyticsは補助機能のため、検証NG・保存失敗でも常に202を返す。
router.post('/events', optionalAuth, async (req, res) => {
  const body = req.body ?? {};
  const isLoggedIn = req.userId !== null;
  await insertEvent({
    event_name: body.eventName,
    anonymous_session_id: body.sessionId,
    actor_type: isLoggedIn ? 'user' : 'guest',
    auth_state: isLoggedIn ? 'logged_in' : 'guest',
    plan_state: body.planState,
    source: body.source,
    page_path: body.pagePath,
    device_category: body.deviceCategory,
    metadata_json: {},
  });
  res.status(202).json({ ok: true });
});

export default router;
