import { supabase } from './supabase.js';

// S01効果検証イベント（Phase 1）送信ヘルパー。
// analyticsは補助機能：送信失敗・例外はすべて握りつぶし、UXに影響させない。

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const SESSION_ID_KEY = 'saidlog_session_id';

/**
 * 訪問単位の匿名セッションID（純ランダムUUID）を返す。
 * user_id / guest_id / email から導出しない。sessionStorage保持のため
 * タブを閉じると消える（永続的な端末識別子にしない）。
 */
export function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function getDeviceCategory() {
  try {
    return window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
  } catch {
    return 'unknown';
  }
}

/**
 * イベントを送信する（fire-and-forget、await不要）。
 * auth_stateはサーバーがAuthorizationヘッダーから判定するため、ここでは送らない。
 */
export async function trackEvent(eventName, { source = null, planState = 'unknown' } = {}) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    fetch(`${API_BASE}/api/events`, {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({
        eventName,
        sessionId: getOrCreateSessionId(),
        planState,
        source,
        pagePath: window.location.pathname,
        deviceCategory: getDeviceCategory(),
      }),
    }).catch(() => {});
  } catch { /* analyticsは失敗を無視 */ }
}
