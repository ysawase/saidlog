import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEvent, sanitizeSessionId, bucketAudioDuration, mapErrorCategory,
} from '../server/services/events.js';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

// ---- event_name ホワイトリスト ----

test('許可された8イベントのみ受け付ける', () => {
  const allowed = [
    's01_view', 's01_record_click', 's01_upload_click',
    'transcription_request', 'transcription_success', 'transcription_error',
    'auth_modal_open', 'signup_submit',
  ];
  for (const name of allowed) {
    assert.equal(sanitizeEvent({ event_name: name }).ok, true, name);
  }
});

test('許可外のevent_nameは拒否される', () => {
  const rejected = [
    'plus_cta_view', 'history_open', 'summary_preview_shown',
    'DROP TABLE events', '', null, undefined, 123,
  ];
  for (const name of rejected) {
    assert.equal(sanitizeEvent({ event_name: name }).ok, false, String(name));
  }
});

test('オブジェクト以外のペイロードは拒否される', () => {
  assert.equal(sanitizeEvent(null).ok, false);
  assert.equal(sanitizeEvent('s01_view').ok, false);
  assert.equal(sanitizeEvent(undefined).ok, false);
});

// ---- sessionId 検証 ----

test('sessionIdはUUID形式のみ通る', () => {
  assert.equal(sanitizeSessionId(VALID_UUID), VALID_UUID);
  assert.equal(sanitizeSessionId(VALID_UUID.toUpperCase()), VALID_UUID);
});

test('sessionIdの不正値はnullに落ちる', () => {
  const invalid = [
    'user@example.com',
    'https://example.com/audio.mp3',
    '会議録音_2026-07-04.m4a',
    'guest_' + VALID_UUID, // 既存guest_id形式は不可
    'x'.repeat(1000),      // 長すぎる文字列
    VALID_UUID + 'a',
    '', null, undefined, 123, {},
  ];
  for (const v of invalid) {
    assert.equal(sanitizeSessionId(v), null, String(v).slice(0, 40));
  }
});

test('sessionId不正でもイベント自体は保存対象になる（anonymous_session_id=null）', () => {
  const res = sanitizeEvent({ event_name: 's01_view', anonymous_session_id: 'user@example.com' });
  assert.equal(res.ok, true);
  assert.equal(res.row.anonymous_session_id, null);
});

// ---- enum列の丸め ----

test('enum外の値はfallbackに丸められる', () => {
  const res = sanitizeEvent({
    event_name: 's01_view',
    actor_type: 'admin',
    auth_state: 'super_user',
    plan_state: 'enterprise',
    source: 'javascript:alert(1)',
    device_category: 'Mozilla/5.0 (Windows NT 10.0)',
    result: 'partial',
    error_category: 'ECONNREFUSED at provider.example.com',
    audio_duration_bucket: '4712 seconds',
    stt_provider: 'openai',
  });
  assert.equal(res.ok, true);
  assert.equal(res.row.actor_type, 'unknown');
  assert.equal(res.row.auth_state, 'guest');
  assert.equal(res.row.plan_state, 'unknown');
  assert.equal(res.row.source, null);
  assert.equal(res.row.device_category, 'unknown');
  assert.equal(res.row.result, null);
  assert.equal(res.row.error_category, null);
  assert.equal(res.row.audio_duration_bucket, null);
  assert.equal(res.row.stt_provider, null);
});

test('正しいenum値はそのまま通る', () => {
  const res = sanitizeEvent({
    event_name: 'transcription_error',
    actor_type: 'user',
    auth_state: 'logged_in',
    plan_state: 'plus',
    source: 's01',
    device_category: 'mobile',
    result: 'error',
    error_category: 'timeout',
    audio_duration_bucket: '3-15m',
    stt_provider: 'amivoice',
  });
  assert.equal(res.ok, true);
  assert.equal(res.row.actor_type, 'user');
  assert.equal(res.row.result, 'error');
  assert.equal(res.row.error_category, 'timeout');
});

// ---- metadata_json 許可キー制 ----

test('metadataの禁止キーはすべて破棄され空オブジェクトになる', () => {
  const res = sanitizeEvent({
    event_name: 's01_view',
    metadata_json: {
      email: 'user@example.com',
      fileName: '会議録音.m4a',
      audioUrl: 'https://storage.example.com/signed?token=abc',
      transcript: '本日の議題は…',
      summary: '・決定事項…',
      rawError: 'Error: 401 Unauthorized at https://api...',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ip: '203.0.113.7',
      userId: VALID_UUID,
      guestId: 'guest_' + VALID_UUID,
    },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.row.metadata_json, {});
});

test('metadataが配列・文字列・nullでも空オブジェクトになる', () => {
  for (const v of [['a'], 'text', null, undefined, 42]) {
    const res = sanitizeEvent({ event_name: 's01_view', metadata_json: v });
    assert.deepEqual(res.row.metadata_json, {});
  }
});

// ---- page_path ----

test('page_pathはパス形式のみ通り、URL・クエリ付きは落ちる', () => {
  assert.equal(sanitizeEvent({ event_name: 's01_view', page_path: '/' }).row.page_path, '/');
  const invalid = [
    'https://example.com/',
    '/?email=user@example.com',
    '/#token=abc',
    '/' + 'a'.repeat(200),
    'not-a-path',
  ];
  for (const p of invalid) {
    assert.equal(sanitizeEvent({ event_name: 's01_view', page_path: p }).row.page_path, null, p);
  }
});

// ---- 禁止情報がどのフィールドにも残らないこと（総合） ----

test('禁止情報を全フィールドに混入させても保存行に出現しない', () => {
  const poison = {
    event_name: 'transcription_error',
    anonymous_session_id: 'user@example.com',
    actor_type: 'user@example.com',
    auth_state: 'https://example.com/audio.mp3',
    plan_state: '会議録音.m4a',
    source: 'Error: 500 Internal Server Error',
    page_path: '/?q=user@example.com',
    device_category: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit',
    result: '203.0.113.7',
    error_category: 'AssemblyAI responded 401: invalid api key sk-abc123',
    audio_duration_bucket: '本日の議題は予算です',
    stt_provider: 'sk-secret-key',
    metadata_json: { anything: 'user@example.com' },
    // 未知フィールドも保存されないこと
    email: 'user@example.com',
    filename: '会議録音.m4a',
    raw_message: 'Error: fetch failed at https://api.example.com',
  };
  const res = sanitizeEvent(poison);
  assert.equal(res.ok, true);
  const serialized = JSON.stringify(res.row);
  const forbidden = [
    'user@example.com', 'example.com', '会議録音', 'Mozilla',
    '203.0.113.7', 'sk-', '本日の議題', 'Error:', 'email', 'filename', 'raw_message',
  ];
  for (const word of forbidden) {
    assert.equal(serialized.includes(word), false, `混入: ${word}`);
  }
});

// ---- audio_duration_bucket 変換 ----

test('音声長は3区分に丸められ、生の秒数は残らない', () => {
  assert.equal(bucketAudioDuration(0), '0-3m');
  assert.equal(bucketAudioDuration(180), '0-3m');
  assert.equal(bucketAudioDuration(181), '3-15m');
  assert.equal(bucketAudioDuration(900), '3-15m');
  assert.equal(bucketAudioDuration(901), '15m+');
  assert.equal(bucketAudioDuration(7200), '15m+');
  assert.equal(bucketAudioDuration(-1), null);
  assert.equal(bucketAudioDuration(NaN), null);
  assert.equal(bucketAudioDuration('600'), null);
  assert.equal(bucketAudioDuration(undefined), null);
});

// ---- error_category マッピング ----

test('classifyTranscriptionErrorの分類コードが正しく変換される', () => {
  assert.equal(mapErrorCategory('AUTH_ERROR'), 'auth');
  assert.equal(mapErrorCategory('RATE_LIMIT'), 'rate_limit');
  assert.equal(mapErrorCategory('TIMEOUT'), 'timeout');
  assert.equal(mapErrorCategory('PROVIDER_ERROR'), 'provider_response');
  assert.equal(mapErrorCategory('AUDIO_ERROR'), 'audio_processing');
  assert.equal(mapErrorCategory('UNKNOWN'), 'unknown');
});

test('分類コード以外（rawメッセージ等）はunknownに落ちる', () => {
  assert.equal(mapErrorCategory('Error: 401 at https://api.assemblyai.com'), 'unknown');
  assert.equal(mapErrorCategory(''), 'unknown');
  assert.equal(mapErrorCategory(null), 'unknown');
  assert.equal(mapErrorCategory(undefined), 'unknown');
});
