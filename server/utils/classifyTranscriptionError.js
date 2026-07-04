const MAX_MESSAGE_LENGTH = 200;

/**
 * STT失敗時のerrorから、既存の transcripts.error_code（text列）に
 * 保存するための分類コード付き文字列を組み立てる。
 * 新規カラムを追加せず、既存の1列に「種別: 短縮メッセージ」の形で収める。
 * @param {Error & { code?: string, name?: string }} err
 * @returns {string}
 */
export function buildTranscriptionErrorCode(err) {
  const category = classifyTranscriptionError(err);
  const rawMessage = String(err?.message ?? '').replace(/\s+/g, ' ').trim();
  const truncated = rawMessage.length > MAX_MESSAGE_LENGTH
    ? `${rawMessage.slice(0, MAX_MESSAGE_LENGTH)}…`
    : rawMessage;
  return truncated ? `${category}: ${truncated}` : category;
}

/**
 * errから種別コードのみを判定する。
 * 優先順位: err.code → タイムアウト → 音声/ファイル関連 →
 * メッセージ中のHTTPステータス → 不明。
 * @param {Error & { code?: string, name?: string }} err
 * @returns {'AUTH_ERROR'|'RATE_LIMIT'|'TIMEOUT'|'AUDIO_ERROR'|'PROVIDER_ERROR'|'UNKNOWN'|string}
 */
export function classifyTranscriptionError(err) {
  if (err?.code) return String(err.code);

  const message = String(err?.message ?? '');

  if (err?.name === 'AbortError' || /タイムアウト|timeout/i.test(message)) {
    return 'TIMEOUT';
  }
  if (/ダウンロードに失敗/.test(message)) {
    return 'AUDIO_ERROR';
  }

  const statusMatch = message.match(/(?:^|\s)([1-5]\d{2})(?:\s|$)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 429) return 'RATE_LIMIT';
  if (status !== null && status >= 400) return 'PROVIDER_ERROR';

  return 'UNKNOWN';
}
