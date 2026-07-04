import test from 'node:test';
import assert from 'node:assert/strict';
import { amivoiceErrorMessage } from '../server/stt/providers/amivoice.js';
import { buildTranscriptionErrorCode } from '../server/utils/classifyTranscriptionError.js';

// AmiVoiceの実際のレスポンス形状を模倣：messageは無いが、
// segments配下に認識済みっぽいテキストが含まれているケース。
const fakeResultWithRecognizedText = {
  status: 'error',
  segments: [
    {
      results: [
        {
          tokens: [
            { written: '来週の会議で決定します', label: 'speaker0' },
            { written: '田中さんの電話番号は090', label: 'speaker0' },
          ],
        },
      ],
    },
  ],
};

test('amivoiceErrorMessage: result.messageが無い場合はレスポンス全体をstringifyせず固定文言になる', () => {
  const msg = amivoiceErrorMessage(fakeResultWithRecognizedText);
  assert.equal(msg, 'AMIVOICE_RESPONSE_ERROR');
  assert.ok(!msg.includes('来週'));
  assert.ok(!msg.includes('田中'));
  assert.ok(!msg.includes('090'));
});

test('amivoiceErrorMessage: result.messageが文字列であればそれを使う（provider由来の短い説明文のみ想定）', () => {
  assert.equal(amivoiceErrorMessage({ message: 'invalid audio format' }), 'invalid audio format');
});

test('amivoiceErrorMessage: result.messageが空文字/非文字列/欠落なら固定文言にフォールバックする', () => {
  assert.equal(amivoiceErrorMessage({ message: '' }), 'AMIVOICE_RESPONSE_ERROR');
  assert.equal(amivoiceErrorMessage({ message: 123 }), 'AMIVOICE_RESPONSE_ERROR');
  assert.equal(amivoiceErrorMessage({}), 'AMIVOICE_RESPONSE_ERROR');
  assert.equal(amivoiceErrorMessage(null), 'AMIVOICE_RESPONSE_ERROR');
});

test('統合: message無しのAmiVoiceエラーがtranscripts.error_code保存値まで安全に流れること', () => {
  // amivoice.js の throw と同じ組み立て方を再現
  const err = new Error(`AmiVoice 認識エラー: ${amivoiceErrorMessage(fakeResultWithRecognizedText)}`);
  const errorCode = buildTranscriptionErrorCode(err);

  assert.equal(errorCode, 'UNKNOWN: AmiVoice 認識エラー: AMIVOICE_RESPONSE_ERROR');
  assert.ok(!errorCode.includes('来週'));
  assert.ok(!errorCode.includes('田中'));
  assert.ok(!errorCode.includes('090'));
  assert.ok(!errorCode.includes('tokens'));
  assert.ok(!errorCode.includes('segments'));
});
