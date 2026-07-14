import { test } from 'node:test';
import assert from 'node:assert';

// @anthropic-ai/sdk をモックし、Anthropic呼び出し回数・応答内容を直接計測する。
// 実行には --experimental-test-module-mocks フラグが必要（package.json の test スクリプト参照）。
// t.mock.module（テストごとのスコープ）を使うことで、テスト間でのモック競合・キャッシュ汚染を避ける。

function mockAnthropicSdk(t, handler) {
  class FakeAnthropic {
    constructor() {}
    messages = { create: async (...args) => handler(...args) };
  }
  return t.mock.module('@anthropic-ai/sdk', { exports: { default: FakeAnthropic } });
}

test('callAnthropic: 正常系で生成テキストを返す', async (t) => {
  let callCount = 0;
  mockAnthropicSdk(t, async () => {
    callCount++;
    return { content: [{ text: '## 決定事項\n- テスト' }] };
  });
  // クエリ文字列でESMモジュールキャッシュを回避し、都度そのテストのモックを反映させて再importする
  const { callAnthropic } = await import(`../server/routes/summarize.js?t=${Date.now()}-${Math.random()}`);

  const result = await callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't' });
  assert.strictEqual(result, '## 決定事項\n- テスト');
  assert.strictEqual(callCount, 1);
});

test('callAnthropic: 空応答（content配列が空）の場合はundefinedを返す', async (t) => {
  mockAnthropicSdk(t, async () => ({ content: [] }));
  // クエリ文字列でESMモジュールキャッシュを回避し、都度そのテストのモックを反映させて再importする
  const { callAnthropic } = await import(`../server/routes/summarize.js?t=${Date.now()}-${Math.random()}`);

  const result = await callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't' });
  assert.strictEqual(result, undefined);
});

test('callAnthropic: 空文字列を返した場合はそのまま空文字列を返す（呼び出し元での検証対象）', async (t) => {
  mockAnthropicSdk(t, async () => ({ content: [{ text: '' }] }));
  // クエリ文字列でESMモジュールキャッシュを回避し、都度そのテストのモックを反映させて再importする
  const { callAnthropic } = await import(`../server/routes/summarize.js?t=${Date.now()}-${Math.random()}`);

  const result = await callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't' });
  assert.strictEqual(result, '');
});

test('callAnthropic: SDKが例外を投げた場合は呼び出し元に伝播する', async (t) => {
  mockAnthropicSdk(t, async () => {
    throw new Error('rate limit exceeded');
  });
  // クエリ文字列でESMモジュールキャッシュを回避し、都度そのテストのモックを反映させて再importする
  const { callAnthropic } = await import(`../server/routes/summarize.js?t=${Date.now()}-${Math.random()}`);

  await assert.rejects(
    () => callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't' }),
    /rate limit exceeded/
  );
});

test('callAnthropic: 呼び出し回数を直接計測できる（N回呼べばcallCountもN）', async (t) => {
  let callCount = 0;
  mockAnthropicSdk(t, async () => {
    callCount++;
    return { content: [{ text: `response ${callCount}` }] };
  });
  // クエリ文字列でESMモジュールキャッシュを回避し、都度そのテストのモックを反映させて再importする
  const { callAnthropic } = await import(`../server/routes/summarize.js?t=${Date.now()}-${Math.random()}`);

  await callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't1' });
  await callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't2' });
  await callAnthropic({ apiKey: 'fake', prompt: 'p', transcript: 't3' });

  assert.strictEqual(callCount, 3);
});
