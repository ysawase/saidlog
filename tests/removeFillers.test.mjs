import test from 'node:test';
import assert from 'node:assert/strict';
import { removeFillers } from '../server/utils/removeFillers.js';

const cases = [
  // フィラー除去
  ['えーと、本日の議題ですが', '本日の議題ですが'],
  ['えーっと、次に進みます', '次に進みます'],
  ['あのー、その件は私が担当します', 'その件は私が担当します'],
  ['うーん、それは難しいですね', 'それは難しいですね'],
  ['うーんと、そうですね', 'そうですね'],
  ['んーと、確認します', '確認します'],
  ['あー、なるほど、そのー、つまりこうですね', 'なるほど、つまりこうですね'],
  ['Um, I think uh we should proceed', 'I think we should proceed'],
  // 誤除去しないこと（指示語・一般語）
  ['あの資料とその案件は問題ありません', 'あの資料とその案件は問題ありません'],
  ['考えとくのは私です', '考えとくのは私です'],
  ['summer is coming', 'summer is coming'],
  // 日本語文字間スペース除去（英単語間は保持）
  ['本日 の 議題 について 説明します', '本日の議題について説明します'],
  ['この機能は React と Express で実装します', 'この機能は React と Express で実装します'],
  ['ミーティング ノート を Slack に送ります', 'ミーティングノートを Slack に送ります'],
  // STTがフィラー内部にスペースを挟んで返すケース（実例：AssemblyAI日本語出力）
  ['ええ と、 本日の議題です', '本日の議題です'],
  ['うーん と、 テスト工程は九月末です', 'テスト工程は九月末です'],
  // 境界
  ['', ''],
  [null, ''],
];

for (const [input, expected] of cases) {
  test(`removeFillers(${JSON.stringify(input)})`, () => {
    assert.equal(removeFillers(input), expected);
  });
}
