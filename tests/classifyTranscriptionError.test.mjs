import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTranscriptionError,
  buildTranscriptionErrorCode,
} from '../server/utils/classifyTranscriptionError.js';

test('classifyTranscriptionError: err.codeがあればそれを優先する', () => {
  assert.equal(classifyTranscriptionError({ code: 'ECONNRESET', message: 'x' }), 'ECONNRESET');
});

test('classifyTranscriptionError: AbortErrorはTIMEOUT', () => {
  assert.equal(classifyTranscriptionError({ name: 'AbortError', message: 'aborted' }), 'TIMEOUT');
});

test('classifyTranscriptionError: タイムアウト文言はTIMEOUT', () => {
  assert.equal(
    classifyTranscriptionError({ message: 'AmiVoice: タイムアウトしました（10分超過）' }),
    'TIMEOUT',
  );
});

test('classifyTranscriptionError: ダウンロード失敗はAUDIO_ERROR', () => {
  assert.equal(
    classifyTranscriptionError({ message: 'Groq: 音声のダウンロードに失敗しました: 404' }),
    'AUDIO_ERROR',
  );
});

test('classifyTranscriptionError: 401/403はAUTH_ERROR', () => {
  assert.equal(classifyTranscriptionError({ message: 'Groq STTエラー: 401 unauthorized' }), 'AUTH_ERROR');
  assert.equal(classifyTranscriptionError({ message: 'Groq STTエラー: 403 forbidden' }), 'AUTH_ERROR');
});

test('classifyTranscriptionError: 429はRATE_LIMIT', () => {
  assert.equal(classifyTranscriptionError({ message: 'Groq STTエラー: 429 too many requests' }), 'RATE_LIMIT');
});

test('classifyTranscriptionError: その他の4xx/5xxはPROVIDER_ERROR', () => {
  assert.equal(classifyTranscriptionError({ message: 'Groq STTエラー: 500 internal error' }), 'PROVIDER_ERROR');
  assert.equal(classifyTranscriptionError({ message: 'AmiVoice ジョブ投入失敗: 400 bad request' }), 'PROVIDER_ERROR');
});

test('classifyTranscriptionError: 手がかりがなければUNKNOWN固定にならず判定不能を表す', () => {
  assert.equal(classifyTranscriptionError({ message: 'よくわからないエラー' }), 'UNKNOWN');
  assert.equal(classifyTranscriptionError({}), 'UNKNOWN');
  assert.equal(classifyTranscriptionError(undefined), 'UNKNOWN');
});

test('buildTranscriptionErrorCode: 種別+メッセージを結合する', () => {
  const result = buildTranscriptionErrorCode({ message: 'Groq STTエラー: 429 rate limited' });
  assert.equal(result, 'RATE_LIMIT: Groq STTエラー: 429 rate limited');
});

test('buildTranscriptionErrorCode: メッセージが長い場合は切り詰める', () => {
  const longMessage = 'あ'.repeat(300);
  const result = buildTranscriptionErrorCode({ message: longMessage });
  const [category, ...rest] = result.split(': ');
  const truncatedMessage = rest.join(': ');
  assert.equal(category, 'UNKNOWN');
  assert.ok(truncatedMessage.length <= 201); // 200文字 + 省略記号1文字
  assert.ok(truncatedMessage.endsWith('…'));
});

test('buildTranscriptionErrorCode: err.codeがあれば種別として使う', () => {
  const result = buildTranscriptionErrorCode({ code: 'ECONNRESET', message: 'connection reset' });
  assert.equal(result, 'ECONNRESET: connection reset');
});
