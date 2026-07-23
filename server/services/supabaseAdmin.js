import { createClient } from '@supabase/supabase-js';

let cachedClient = null;

export function isSupabaseAdminConfigured() {
  return Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * SUPABASE_SERVICE_ROLE_KEY を使ったAdminクライアントを初期化して返す
 * （プロセス内でキャッシュ）。RLSを経由しないため、サーバー側でのみ使用すること。
 */
function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  cachedClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return cachedClient;
}

/**
 * 指定されたメールアドレスが既にSupabase Authへ登録済みかどうかを、
 * DB側のemail_is_registered関数（security definer）経由で確認する。
 * クライアント側のidentities配列判定（Supabase内部挙動に依存する非公式な
 * 回避策）を廃止し、こちらへ置き換える。
 *
 * @param {string} email
 * @returns {Promise<boolean>}
 * @throws 未設定環境、またはSupabase側の障害時はthrowする
 *   （呼び出し元で500系として扱う想定。fail-closeにはしない＝
 *   エラー時に「未登録」と誤判定してユーザーの重複登録を許してしまう
 *   ことを避けるため、呼び出し元でエラーハンドリングを行うこと）
 */
export async function isEmailRegistered(email) {
  if (!isSupabaseAdminConfigured()) {
    console.error('[supabaseAdmin] SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です');
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const { data, error } = await getSupabaseAdmin().rpc('email_is_registered', {
    check_email: email,
  });

  if (error) {
    throw error;
  }

  return Boolean(data);
}
