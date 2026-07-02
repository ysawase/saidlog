import { getSupabase } from './storage.js';
import { PLANS } from '../config/plans.js';

/**
 * ユーザーの現在プランを返す。
 * status="active" かつ current_period_end が未来の take レコードがあればSaidLog Plus（旧称：竹）、それ以外は無料プラン（旧称：梅）。
 */
export async function getEntitlement(userId) {
  const { data } = await getSupabase()
    .from('user_entitlements')
    .select('plan_id')
    .eq('user_id', userId)
    .eq('plan_id', 'take')
    .eq('status', 'active')
    .gt('current_period_end', new Date().toISOString())
    .maybeSingle();

  const planId = data ? 'take' : 'ume';
  return { planId, plan: PLANS[planId] };
}

/**
 * 日本時間（UTC+9）の当月 1 日 00:00:00 を UTC Date として返す。
 * 例：2026-06-01T00:00:00+09:00 → 2026-05-31T15:00:00.000Z
 */
export function getCurrentPeriodStart() {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstNow = new Date(Date.now() + jstOffsetMs);
  const firstOfMonthUtcMs = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), 1);
  return new Date(firstOfMonthUtcMs - jstOffsetMs);
}

/**
 * STT 開始前のゲートチェック。
 * チェック 1：月間残り時間。
 * チェック 2：対象 transcript が処理中・完了済みでないか（ベストエフォート）。
 */
export async function canStartTranscription(userId, meetingId, durationSeconds) {
  const { plan } = await getEntitlement(userId);
  const supabase = getSupabase();
  const periodStart = getCurrentPeriodStart().toISOString();

  // 月間使用量チェック
  const { data: period } = await supabase
    .from('usage_periods')
    .select('used_seconds')
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .maybeSingle();

  const usedSeconds = period?.used_seconds ?? 0;
  if (usedSeconds + durationSeconds > plan.monthlySeconds) {
    return {
      ok: false,
      reason: 'MONTHLY_LIMIT_EXCEEDED',
      remainingSeconds: Math.max(0, plan.monthlySeconds - usedSeconds),
    };
  }

  // 二重処理チェック（transcript ID が既知の場合のみ有効）
  if (meetingId) {
    const { data: existing } = await supabase
      .from('transcripts')
      .select('transcription_status')
      .eq('id', meetingId)
      .maybeSingle();

    if (
      existing?.transcription_status === 'transcribing' ||
      existing?.transcription_status === 'completed'
    ) {
      return { ok: false, reason: 'MEETING_ALREADY_PROCESSING' };
    }
  }

  return { ok: true };
}

/**
 * STT 成功後に呼ぶ。transcript の状態更新 + 月間使用秒数の加算。
 */
export async function recordTranscriptionSuccess(userId, meetingId, durationSeconds) {
  const supabase = getSupabase();
  const periodStart = getCurrentPeriodStart().toISOString();

  // transcript 状態更新（meetingId が transcript UUID の場合のみ有効）
  if (meetingId) {
    await supabase
      .from('transcripts')
      .update({ charged_seconds: durationSeconds, transcription_status: 'completed' })
      .eq('id', meetingId);
  }

  // usage_periods UPSERT（原子性のため read-then-write）
  const { data: period } = await supabase
    .from('usage_periods')
    .select('used_seconds')
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .maybeSingle();

  const newUsedSeconds = (period?.used_seconds ?? 0) + durationSeconds;

  await supabase
    .from('usage_periods')
    .upsert(
      { user_id: userId, period_start: periodStart, used_seconds: newUsedSeconds },
      { onConflict: 'user_id,period_start' },
    );
}

/**
 * STT 失敗後に呼ぶ。transcript を failed に更新。usage_periods は更新しない。
 */
export async function recordTranscriptionFailure(meetingId, errorCode) {
  if (!meetingId) return;
  await getSupabase()
    .from('transcripts')
    .update({ transcription_status: 'failed', error_code: errorCode })
    .eq('id', meetingId);
}

/**
 * エクスポート可否チェック。SaidLog Plus（旧称：竹）のみ許可。
 */
export async function canExport(userId) {
  const { planId } = await getEntitlement(userId);
  if (planId === 'take') return { ok: true };
  return { ok: false, reason: 'EXPORT_REQUIRES_TAKE' };
}

/**
 * AI 要約モードを返す。"full" | "preview"。
 * フル要約生成成功後は呼び出し元で full_summary_used = true に更新すること。
 */
export async function getSummaryMode(userId, meetingId, durationSeconds, userChoseFullTrial) {
  const { planId } = await getEntitlement(userId);
  if (planId === 'take') return 'full';

  const { data: profile } = await getSupabase()
    .from('profiles')
    .select('full_summary_used')
    .eq('id', userId)
    .maybeSingle();

  const fullSummaryUsed = profile?.full_summary_used ?? false;
  if (
    fullSummaryUsed === false &&
    durationSeconds >= 180 &&
    userChoseFullTrial === true
  ) {
    return 'full';
  }

  return 'preview';
}

/**
 * プランに応じた履歴表示件数を返す。
 */
export async function getVisibleMeetings(userId) {
  const { plan } = await getEntitlement(userId);
  return plan.historyLimit;
}
