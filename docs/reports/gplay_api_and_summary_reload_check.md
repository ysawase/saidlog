# Google Play Developer API本番設定の有無・詳細要約再表示挙動の実測確認

調査はコード読み取りとローカルdevサーバーでの実地検証のみで実施。ソースコード変更・git操作・本番Vercel/Supabaseへのアクセスは一切行っていない。Anthropic APIへの実課金呼び出しは、事前にユーザーへ確認・承認を得た上で2回実行した。

---

## ■ Google Play Developer API本番設定：**確認不能（リポジトリからは断定できない。Vercelダッシュボードでの直接確認が必要）**

### コード上の参照・フォールバック挙動

`server/services/googlePlay.js`：
```js
export function isGooglePlayConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);   // 18-20行目
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);  // 22-24行目
}
```
```js
  if (!isGooglePlayConfigured()) {
    // 本番では検証をスキップせずエラーにする（fail-close）。
    if (isProduction()) {
      console.error('[googlePlay] GOOGLE_SERVICE_ACCOUNT_JSON が未設定のため検証できません');
      return { ...base, reason: 'NOT_CONFIGURED' };            // 79-84行目
    }
    console.warn('[googlePlay] GOOGLE_SERVICE_ACCOUNT_JSON 未設定（開発環境）。検証をスキップします');
    return { ...base, valid: true, reason: 'VERIFICATION_SKIPPED_DEV' };  // 86-87行目
  }
```
本番（`NODE_ENV=production`または`VERCEL`環境変数あり）で`GOOGLE_SERVICE_ACCOUNT_JSON`が未設定の場合は**fail-close**（検証失敗として扱う）。開発環境では警告付きでスキップし素通しする設計。

### ローカル`.env`

`server/.env`に`GOOGLE_SERVICE_ACCOUNT_JSON`は存在しない（既知・再確認済み、キー名のみのgrepで0件）。

### リポジトリ内の関連記述

- `README.md:95`：Vercel設定手順として`ASSEMBLYAI_API_KEY`の追加のみ記載。`GOOGLE_SERVICE_ACCOUNT_JSON`への言及なし（このREADME自体、他の環境変数（`SUPABASE_URL`, `ANTHROPIC_API_KEY`, `STT_PROVIDER`等）も記載されておらず、更新が追いついていない古い文書と判断できる）。
- `vercel.json`：環境変数の記載なし（Vercelの環境変数はダッシュボード側で管理する仕様のため、そもそも`vercel.json`には現れない）。
- **`saidlog_handover.md:445`**：「✅ Vercel環境変数にGOOGLE_SERVICE_ACCOUNT_JSON追加済み」という記述が存在する。

### この記述の信頼性に関する重要な留保

`saidlog_handover.md:445`の記述は`git blame`で**commit `e4cb74b`（2026-07-01）**時点のものと確認した。しかし：
- `server/services/googlePlay.js`自体が実装されたのは**2026-07-03**（commit `a22c25f`「P1-2 Google Play Developer APIによるpurchase_token検証を実装」）であり、**この記述はそのコードが存在する前に書かれている**。
- `saidlog_handover.md`はそれ以降**一度も更新されていない**（`git log -- saidlog_handover.md`の最新コミットは`e4cb74b`のまま、現HEAD`aaebf77`は2026-07-14）。同じ文書内の「次にやること」セクション（305-310行目）には、07-01時点でまだ「Google Play Developer APIによるレシート検証実装...GOOGLE_SERVICE_ACCOUNT_JSONを使用」がTODOとして残っており、コード実装前の状態を反映した記述である。
- したがって「✅ 追加済み」は**インフラ側の設定を事前に済ませたという申告に過ぎず、その後13日間、値が現在も有効なまま存在するか・実際に機能する値か・一度でも実際に使われて成功したかを裏付ける記述はどこにも見つからなかった**（既存の`docs/db_push_verification_2026_07_04.txt:77-78`および`docs/reports/billing_native_verification.md`は、いずれもGoogle Play検証の疎通自体を「未確認」としている）。

**結論**：リポジトリ内の記述だけでは「本番に設定されている」とも「されていない」とも断定できない。Vercelダッシュボード（Settings → Environment Variables）での直接確認が必要。

---

## ■ 詳細要約再表示時の挙動：コード上の事実

**現在クライアントが使用する経路（`/api/summarize`）には、キャッシュ・重複防止ロジックが一切存在しない。呼ぶたびに必ずAnthropic APIを新規に呼び出す設計。**

- `client/src/components/TranscriptView.jsx:60-86`の`generateSummary()`が唯一の呼び出し元。`client/src/api.js:52-66`の`requestSummary()`経由で`POST /api/summarize`を叩く。
- `server/routes/summarize.js:75-178`（`/summarize`）の処理順を確認：
  - 87-108行目：入力検証（文字数不足チェックのみ）
  - 110-116行目：`summaryMode`判定（`getSummaryMode()`または`'preview'`固定）
  - **118-128行目：既存データの有無を一切確認せず、無条件で`client.messages.create()`を呼ぶ**
  - 132-151行目：保存処理。`full`モードは`transcripts.summary_type='full'`という**フラグのみ**保存し、要約本文はどこにも保存されない（`preview`モードのみ`summary_preview`本文を保存）
- 別途存在する`POST /api/summarize/full`（180-280行目）は`transcript_full_summaries`テーブルを使った本物のキャッシュ機構を持つが、**`client/src`のどこからも呼ばれていない**（前回調査で確認済み、`grep`で0件）。

つまり、現在ユーザーが実際に触っている「詳細要約」機能は、キャッシュ層を経由しない設計であり、同じ会議メモを2回開けば2回ともAnthropic APIが新規に呼ばれる。

---

## ■ 実際にAPIを2回叩いて確認できた結果

事前にユーザーの承認を得た上で、ローカルdevサーバー（`npm run dev`、`localhost:3000`）に対し、`POST /api/summarize`へ**完全に同一の入力**（ダミーの5発話会議文、`template: "bullets"`、未ログイン＝previewモード）を2回連続送信した。

（`full`モードの検証には認証済みユーザーのアクセストークンが必要で、テスト用アカウントを持たないため未実施。ただしキャッシュ有無を左右するコード分岐は`preview`/`full`で共通〈118-128行目は`summaryMode`に関わらず同一の無条件呼び出し〉であり、`preview`での検証結果はそのまま`full`にも当てはまる。）

**1回目**（所要時間 2002ms）：
```json
{"summary":"## AI要約プレビュー\n\nこの会議では、デザイン修正の完了と実装フェーズへの移行について話されています。\n\n決まったこと：実装担当は鈴木が行い、金曜日までに一次実装を完了する。\n\n次にやること：鈴木が金曜日までに実装の一次完了を行う。", ...}
```

**2回目**（所要時間 2836ms、同一入力）：
```json
{"summary":"## AI要約プレビュー\n\nこの会議では、先週のタスク進捗確認と実装フェーズへの移行について話されています。\n\n決まったこと：鈴木が実装を担当し、金曜日までに一次実装を完了させる。\n\n次にやること：鈴木が金曜日までに一次実装を終わらせる。", ...}
```

**確認できたこと：**
1. **2回ともAnthropic APIが実際に呼ばれている**：所要時間がいずれも2秒台（キャッシュヒットなら数十ms程度で返るはずだが、そうなっていない）。かつコード上118-128行目に条件分岐なくAPI呼び出しが存在することと整合。
2. **要約本文は完全に同一ではない**：文言・言い回しが毎回異なる（「デザイン修正の完了と実装フェーズへの移行」→「先週のタスク進捗確認と実装フェーズへの移行」等）。意味内容は同趣旨だが一字一句同じではない。`server/routes/summarize.js:119-128`の`client.messages.create()`呼び出しに`temperature`指定がなく、Anthropic APIのデフォルト値（非ゼロ）が適用されるため、同一入力でも出力が変動しうる設計と一致する。
3. **サーバー側にキャッシュ・重複防止ロジックは存在しない**：コード再確認（118-128行目）でも、実測（2回とも同程度のレイテンシと異なる本文）でも、キャッシュや重複防止の形跡は見られなかった。

---

## ■ 失敗時に過去の要約を表示できるか

**できない。エラーメッセージに置き換わり、過去の要約へのフォールバックは存在しない。**

`client/src/components/TranscriptView.jsx:82-85`：
```js
} catch (err) {
  setSummary(t('transcript.summaryError', { message: err.message }));
  setSummaryStatus('error');
}
```
`catch`節は`summary`ステートをエラーメッセージ文言で**上書き**するのみで、直前に表示していた要約や過去に取得した要約へのフォールバックは実装されていない。また前述の通り、full要約の本文自体がそもそもどこにも保存されていない（`transcripts`には`summary_type`フラグのみ）ため、そもそも「フォールバックできる過去の本文」がサーバー側にも存在しない。
