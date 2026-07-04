import { getSupabase, supabaseConfigured } from './storage.js';

// S01効果検証イベント（Phase 1）。
// eventsテーブルへの書き込みは必ずこのモジュールを通す。
// 個人情報・本文・raw値が保存されないよう、ここで一元的に検証・破棄する。

export const ALLOWED_EVENT_NAMES = new Set([
  's01_view',
  's01_record_click',
  's01_upload_click',
  'transcription_request',
  'transcription_success',
  'transcription_error',
  'auth_modal_open',
  'signup_submit',
]);

// enum列の許可値。ここに無い値は default に丸めるか null に落とす
const ENUM_COLUMNS = {
  actor_type: { values: ['guest', 'user', 'unknown'], fallback: 'unknown' },
  auth_state: { values: ['guest', 'logged_in'], fallback: 'guest' },
  plan_state: { values: ['unknown', 'free', 'plus'], fallback: 'unknown' },
  source: { values: ['s01', 'auth_modal', 'history', 'plus_cta', 'header', 'guest_gate'], fallback: null },
  device_category: { values: ['mobile', 'desktop', 'unknown'], fallback: 'unknown' },
  result: { values: ['success', 'error'], fallback: null },
  error_category: { values: ['auth', 'rate_limit', 'timeout', 'provider_response', 'audio_processing', 'unknown'], fallback: null },
  audio_duration_bucket: { values: ['0-3m', '3-15m', '15m+'], fallback: null },
  stt_provider: { values: ['groq', 'amivoice', 'assemblyai', 'unknown'], fallback: null },
};

// metadata_jsonの許可キー。Phase 1は空（常に'{}'を保存）
const ALLOWED_METADATA_KEYS = new Set();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// page_pathはSPAのパスのみ（クエリ・フラグメント・自由文字列は拒否）
const PAGE_PATH_PATTERN = /^\/[a-zA-Z0-9/_-]{0,99}$/;

/**
 * sessionIdを検証し、UUID形式のみ通す。
 * 不正・欠落時はnull（analytics側で破棄。文字起こし本体には影響させない）。
 */
export function sanitizeSessionId(value) {
  if (typeof value !== 'string') return null;
  if (value.length > 36) return null;
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** 音声長（秒）を丸めた区分に変換する。生の秒数は保存しない。 */
export function bucketAudioDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds <= 180) return '0-3m';
  if (seconds <= 900) return '3-15m';
  return '15m+';
}

/**
 * classifyTranscriptionErrorの分類コードをeventsのerror_categoryに変換する。
 * 分類コード以外（rawメッセージ等）が来ても固定値'unknown'に落とす。
 */
export function mapErrorCategory(code) {
  const map = {
    AUTH_ERROR: 'auth',
    RATE_LIMIT: 'rate_limit',
    TIMEOUT: 'timeout',
    PROVIDER_ERROR: 'provider_response',
    AUDIO_ERROR: 'audio_processing',
  };
  return map[code] ?? 'unknown';
}

function sanitizeEnum(column, value) {
  const def = ENUM_COLUMNS[column];
  return def.values.includes(value) ? value : def.fallback;
}

function sanitizeMetadata(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value)) {
    if (ALLOWED_METADATA_KEYS.has(key)) out[key] = value[key];
  }
  return out;
}

/**
 * 入力をeventsテーブルのinsert行に変換する。
 * 許可外のevent_nameは拒否。それ以外のフィールドは許可値に丸め、
 * 未知のキー・自由文字列は一切保持しない（出力は固定キーのみ）。
 * @returns {{ ok: true, row: object } | { ok: false, reason: string }}
 */
export function sanitizeEvent(input) {
  if (input === null || typeof input !== 'object') {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!ALLOWED_EVENT_NAMES.has(input.event_name)) {
    return { ok: false, reason: 'event_name_not_allowed' };
  }
  const row = {
    event_name: input.event_name,
    anonymous_session_id: sanitizeSessionId(input.anonymous_session_id),
    actor_type: sanitizeEnum('actor_type', input.actor_type),
    auth_state: sanitizeEnum('auth_state', input.auth_state),
    plan_state: sanitizeEnum('plan_state', input.plan_state),
    source: sanitizeEnum('source', input.source),
    page_path: typeof input.page_path === 'string' && PAGE_PATH_PATTERN.test(input.page_path)
      ? input.page_path
      : null,
    device_category: sanitizeEnum('device_category', input.device_category),
    result: sanitizeEnum('result', input.result),
    error_category: sanitizeEnum('error_category', input.error_category),
    audio_duration_bucket: sanitizeEnum('audio_duration_bucket', input.audio_duration_bucket),
    stt_provider: sanitizeEnum('stt_provider', input.stt_provider),
    metadata_json: sanitizeMetadata(input.metadata_json),
  };
  return { ok: true, row };
}

/**
 * イベントを1件保存する（fire-and-forget）。
 * analyticsは補助機能のため、検証NG・insert失敗を含め一切throwしない。
 * @returns {Promise<boolean>} 保存できたか
 */
export async function insertEvent(input) {
  try {
    const sanitized = sanitizeEvent(input);
    if (!sanitized.ok) return false;
    if (!supabaseConfigured()) return false;
    const { error } = await getSupabase().from('events').insert(sanitized.row);
    if (error) {
      console.error('[events] insert失敗:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[events] insertEventで例外:', err.message);
    return false;
  }
}
