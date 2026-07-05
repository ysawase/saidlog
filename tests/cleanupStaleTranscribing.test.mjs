import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupStaleTranscribing } from '../server/services/cleanup.js';

// 固定時刻（2026-07-05T12:00:00Z）を基準にテスト用データを作る
const NOW = new Date('2026-07-05T12:00:00.000Z').getTime();
const THRESHOLD_ISO = new Date(NOW - 60 * 60 * 1000).toISOString(); // 11:00:00Z

// Supabase クライアントのモック。
// .from('transcripts').update({}).eq(...).lt(...).select('id') の連鎖を模擬し、
// 受け取った条件でフィルタして一致行を返す。
// from() に渡されたテーブル名をすべて記録し、usage_periods への操作がないことを検証できる。
function makeMockSupabase({ rows = [], errorOnQuery = false } = {}) {
  const fromCalls = [];
  let capturedUpdate = null;
  let eqFilters = {};
  let ltFilters = {};

  const builder = {
    update(data) {
      capturedUpdate = data;
      return builder;
    },
    eq(col, val) {
      eqFilters[col] = val;
      return builder;
    },
    lt(col, val) {
      ltFilters[col] = val;
      return builder;
    },
    async select() {
      if (errorOnQuery) return { data: null, error: { message: 'mock DB error' } };
      const matched = rows.filter((r) => {
        for (const [col, val] of Object.entries(eqFilters)) {
          if (r[col] !== val) return false;
        }
        for (const [col, val] of Object.entries(ltFilters)) {
          if (!(r[col] < val)) return false;
        }
        return true;
      });
      return { data: matched.map((r) => ({ id: r.id })), error: null };
    },
  };

  return {
    getFromCalls: () => fromCalls,
    getCapturedUpdate: () => capturedUpdate,
    getLtFilters: () => ltFilters,
    client: {
      from(table) {
        fromCalls.push(table);
        return builder;
      },
    },
  };
}

// ---- 基本動作 ----

test('1時間以上前のtranscribing行がfailedに更新される', async () => {
  const staleRow = {
    id: 1,
    transcription_status: 'transcribing',
    created_at: '2026-07-05T10:59:00.000Z', // 1時間1分前 → stale
  };
  const mock = makeMockSupabase({ rows: [staleRow] });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 1);
});

test('更新ペイロードはtranscription_status=failed, error_code=STALE_TRANSCRIBINGのみ', async () => {
  const staleRow = {
    id: 1,
    transcription_status: 'transcribing',
    created_at: '2026-07-05T10:00:00.000Z',
  };
  const mock = makeMockSupabase({ rows: [staleRow] });

  await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });

  assert.deepEqual(mock.getCapturedUpdate(), {
    transcription_status: 'failed',
    error_code: 'STALE_TRANSCRIBING',
  });
});

test('クエリのlt条件が1時間前の閾値で発行される', async () => {
  const mock = makeMockSupabase({ rows: [] });
  await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });

  const ltFilters = mock.getLtFilters();
  assert.equal(ltFilters['created_at'], THRESHOLD_ISO);
});

// ---- 対象外の行を触らないこと ----

test('1時間未満のtranscribing行は更新されない', async () => {
  const freshRow = {
    id: 2,
    transcription_status: 'transcribing',
    created_at: '2026-07-05T11:01:00.000Z', // 59分前 → fresh
  };
  const mock = makeMockSupabase({ rows: [freshRow] });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 0);
});

test('completed行は触らない', async () => {
  const row = {
    id: 3,
    transcription_status: 'completed',
    created_at: '2026-07-05T09:00:00.000Z', // 古くてもcomplete
  };
  const mock = makeMockSupabase({ rows: [row] });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 0);
});

test('failed行は触らない', async () => {
  const row = {
    id: 4,
    transcription_status: 'failed',
    created_at: '2026-07-05T09:00:00.000Z',
  };
  const mock = makeMockSupabase({ rows: [row] });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 0);
});

test('transcription_status未設定（null）の旧行は触らない', async () => {
  const row = {
    id: 5,
    transcription_status: null,
    created_at: '2026-07-05T09:00:00.000Z',
  };
  const mock = makeMockSupabase({ rows: [row] });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 0);
});

test('混在時はstale transcribingのみ更新される', async () => {
  const rows = [
    { id: 1, transcription_status: 'transcribing', created_at: '2026-07-05T10:59:00.000Z' }, // stale
    { id: 2, transcription_status: 'transcribing', created_at: '2026-07-05T11:30:00.000Z' }, // fresh
    { id: 3, transcription_status: 'completed',    created_at: '2026-07-05T09:00:00.000Z' }, // 除外
    { id: 4, transcription_status: 'failed',       created_at: '2026-07-05T09:00:00.000Z' }, // 除外
    { id: 5, transcription_status: null,           created_at: '2026-07-05T09:00:00.000Z' }, // 除外
  ];
  const mock = makeMockSupabase({ rows });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 1);
});

// ---- usage_periods非接触 ----

test('usage_periodsテーブルへのfrom()呼び出しがない', async () => {
  const mock = makeMockSupabase({ rows: [] });
  await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });

  const called = mock.getFromCalls();
  assert.ok(!called.includes('usage_periods'), `usage_periodsへのクエリが発行された: ${called}`);
});

test('transcriptsテーブルへのfrom()のみが呼ばれる', async () => {
  const mock = makeMockSupabase({ rows: [] });
  await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });

  const called = mock.getFromCalls();
  assert.deepEqual(called, ['transcripts']);
});

// ---- エラーハンドリング ----

test('DBエラー時は0を返し例外を外に投げない', async () => {
  const mock = makeMockSupabase({ errorOnQuery: true });

  const count = await cleanupStaleTranscribing({ supabase: mock.client, now: NOW });
  assert.equal(count, 0);
});

// ---- 設定なし時のno-op ----

test('supabaseが未設定かつ_deps未指定のときは0を返す（no-op）', async () => {
  // SUPABASE_URL/SERVICE_ROLE_KEYが未設定の環境では supabaseConfigured()=false になるため、
  // 本番クライアント取得を試みずに0を返す。環境変数非設定のCI/ローカルで確認できる。
  const count = await cleanupStaleTranscribing();
  assert.equal(count, 0);
});
