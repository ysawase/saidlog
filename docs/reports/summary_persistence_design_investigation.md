# transcript_full_summaries永続化の実装方式限定確認

調査はコード・マイグレーションファイルの読み取りのみで実施。ソースコード変更・git操作・本番アクセスは一切行っていない。

---

## ■ transcript_full_summariesのスキーマ事実

根拠：`supabase/migrations/20260621000000_summary_tables.sql:33-48`
```sql
CREATE TABLE IF NOT EXISTS public.transcript_full_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES public.transcripts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template text NOT NULL DEFAULT 'bullets'
    CHECK (template IN ('bullets', 'minutes')),
  summary_full text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transcript_id, template)
);

ALTER TABLE public.transcript_full_summaries ENABLE ROW LEVEL SECURITY;
```

| 項目 | 内容 |
|---|---|
| 主キー | `id`（uuid, `gen_random_uuid()`） |
| transcript_idとの紐付け | 外部キーあり：`transcript_id REFERENCES public.transcripts(id) ON DELETE CASCADE` |
| 一意制約 | `UNIQUE (transcript_id, template)`。**1 transcriptにつき1行ではなく、`template`（'bullets'/'minutes'）ごとに1行、最大2行まで許容**される設計 |
| user_id | あり：`user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` |
| RLSポリシー | RLSは**有効化されているが、この移行ファイルにはCREATE POLICY文が一切存在しない**（コメント47行目「クライアント向けSELECTポリシーは作らない（server/service role経由のみ）」）。他の移行ファイルを`grep`しても本テーブルへのポリシー追加は見つからず（`transcript_full_summaries`を参照するのはこの1ファイルのみ）。**RLS有効＋ポリシー0件＝service role以外は原則アクセス不可**という設計。別ユーザーが取得できない設計になっているかという問いに対しては、「クライアントからは誰も取得できない」という、より厳しい形で満たされている。 |
| 削除連動 | `transcript_id`・`user_id`とも`ON DELETE CASCADE`。**transcript削除・アカウント削除のいずれでも自動的に連動削除される**。`server/routes/deleteAccount.js:19-24`（`transcripts`テーブルの明示的delete）および46-47行目（`auth.admin.deleteUser`）のいずれもこのCASCADEを経由するため、削除処理側に本テーブルを明示的に扱うコードは無いが、既存の削除フローと整合的に連動する。 |

---

## ■ 既存2経路（`/api/summarize`、`/api/summarize/full`）の比較

| 観点 | `POST /api/summarize`（現在使用中） | `POST /api/summarize/full`（未接続） |
|---|---|---|
| クライアント呼び出し | あり（`TranscriptView.jsx:64`経由） | **なし**（前回調査で確認済み、`client/src`に0件） |
| 所有者検証 | **なし**。`transcriptId`をクライアントから受け取るだけで、`transcripts`テーブルとの照合を一切行わない（`summarize.js:77-151`） | **あり**。`server/routes/summarize.js:206-215`で`transcripts`を`id`+`user_id`両方で照合し、他人のtranscriptIdを渡されても404になる |
| キャッシュ | **なし**。無条件で`client.messages.create()`を呼ぶ（118-128行目） | **あり**。`transcript_full_summaries`を`transcript_id`+`template`で検索し、あれば返す（218-227行目） |
| 永続化 | full時は`transcripts.summary_type='full'`フラグのみ。本文は保存されない（135-140行目） | `transcript_full_summaries`に本文をupsert（256-267行目） |
| 短すぎる音声の扱い | あり（`MIN_UTTERANCE_LENGTH`、100-108行目） | **なし**。短い文字起こしでもそのままAnthropicに送ってしまう |
| 無料トライアル対応 | あり（`userChoseFullTrial`をそのまま`getSummaryMode()`に渡す、110-112行目） | **なし**。`getSummaryMode(userId, null, 99999, false)`と`userChoseFullTrial`を常に`false`固定で呼んでいる（200行目）ため、**Plusプラン（`planId==='take'`）以外は常に`preview`扱いになり、無料トライアル対象者でも403で弾かれる** |
| プラン外アクセス時 | preview要約を返す（403にしない） | `403 { error: 'SaidLog Plusが必要です' }`（201-203行目） |

**判断材料**：`/api/summarize/full`は所有者検証・キャッシュ・テンプレート別保存を備えた、設計としてより完成度の高い経路である一方、①無料トライアル導線に対応していない、②短文字数ガードが無い、という2点で現在の`/api/summarize`の挙動をそのまま代替できない。**単純にクライアントの呼び先を差し替えるだけでは機能退行が起きる**ため、採用する場合は最低限この2点の補完が必要、という事実がコードから読み取れる（本調査はコード変更を行わないため、あくまで「必要な差分がある」という事実の指摘に留める）。

---

## ■ 重複生成防止の現状：**排他制御なし（DBレベルの重複行防止のみ）**

`server/routes/summarize.js:218-267`の処理順：
1. 218-223行目：`transcript_full_summaries`をSELECTしキャッシュ確認
2. （キャッシュなしの場合）229-253行目：Anthropic APIを呼ぶ（実測で2〜3秒程度かかることを前回調査で確認済み）
3. 256-267行目：`upsert(..., { onConflict: 'transcript_id,template' })`で保存

**このSELECT→生成→UPSERTの間に排他制御（トランザクション、`SELECT ... FOR UPDATE`、アプリケーションレベルのロック等）は一切存在しない。** 同一`transcript_id`+`template`への同時リクエストが2件同時に来た場合：
- 両方とも1のSELECTで「キャッシュなし」と判定する可能性がある（TOCTOU）
- 両方とも独立にAnthropic APIを呼んでしまう（**Anthropic APIコストが二重に発生しうる**）
- ただし`UNIQUE (transcript_id, template)`制約と`upsert`の`onConflict`指定により、**DBに重複行が作られることはない**（後勝ちで1行に収束する）

→ **「重複行の発生」は防げているが、「重複生成（無駄なAPI呼び出し）」は防げていない。**

---

## ■ 失敗時の保存内容：**空行・エラー内容が保存されるリスクは低いが、空文字列のキャッシュ化という軽微な穴がある**

- `/api/summarize/full`はルートハンドラ全体が`try { ... } catch (err) { next(err); }`（180, 277-279行目）で囲われている。`client.messages.create()`（242-251行目）が例外を投げた場合、処理はそこで中断し、**upsert（256-267行目）に到達しないため、失敗内容やエラーメッセージがテーブルに書き込まれることはない**。
- ただし、Anthropicが例外を投げずに**空の応答**を返した場合（`message.content[0]?.text ?? ''`、253行目）、`summaryFull`が空文字列のまま256-267行目のupsertに到達し、**空文字列がそのままキャッシュとして保存されうる**。もっとも、次回の読み出し時（225行目 `if (existing?.summary_full)`）は空文字列がfalsyと評価されるため再度生成が走り、実害としては「無駄な1行が残る」程度に留まる（自己修復的ではある）。
- `/api/summarize`（現在使用中の経路）側の保存処理（132-151行目）も同様に`try/catch`で保存失敗を`console.error`に握りつぶすのみで、失敗時に不正な内容が書き込まれるリスクは無い（148-150行目）。

---

## ■ ゲスト/無料登録/Plusそれぞれの保存範囲の整理

**ゲスト（未ログイン）**：詳細要約の永続化対象に**構造的になり得ない**。
- `client/src/lib/history.js:5-7`の`saveTranscript`は`if (!user) return null`で即終了し、ゲストの文字起こし結果はそもそも`transcripts`テーブルに保存されない（既知の事実として再確認）。
- `transcript_full_summaries.transcript_id`は`NOT NULL REFERENCES public.transcripts(id)`（外部キー制約）であり、対応する`transcripts`行が存在しない限り物理的に行を作成できない。`user_id`も同様に`NOT NULL REFERENCES auth.users(id)`で、ゲストは`auth.users`にレコードを持たない。**アプリケーションロジックの実装如何に関わらず、DBスキーマのレベルでゲストの詳細要約が永続化されることはあり得ない。**

**無料登録ユーザー（`ume`プラン、履歴3件）**：
- `server/services/plan.js:139-159`の`getSummaryMode()`により、`full`要約が生成できるのは**生涯で1回のみ**（`profiles.full_summary_used`フラグ、150-156行目の条件：`fullSummaryUsed===false && durationSeconds>=180 && userChoseFullTrial===true`）。したがって永続化の対象になり得るのも、この一度きりのトライアル分のみ。
- 履歴表示件数の上限（`server/config/plans.js`の`historyLimit: 3`）は、`server/routes/history.js:13,23`の`.limit(limit)`により**表示件数を絞るだけの制御**であり、超過分の`transcripts`行を物理削除するものではない（確認済み、DELETE文はhistory.js内に存在しない）。よって理論上、3件の表示枠に入らない古いtranscriptに紐づく`transcript_full_summaries`行が存在しても、DB上には残り続ける（表示経路からは到達できなくなるだけ）。ただし無料ユーザーはトライアルが生涯1回のみのため、実際に該当するケースはごく限定的。

**Plusユーザー（`take`プラン、履歴30件）**：
- `getSummaryMode()`は`planId==='take'`であれば無条件で`'full'`を返す（141行目）。回数制限なく何度でもfull要約を生成できるため、**永続化のメリットが最も大きい層**。
- 履歴30件も同様に表示件数の制御のみで、物理削除は伴わない。31件目以降のtranscriptに紐づく`transcript_full_summaries`があり得るとすれば、同様に表示不可だがDB上には残る。

---

## ■ 採用推奨方式と不採用にする方式、その理由

**推奨：`transcript_full_summaries`テーブル自体は再利用可能。ただし`/api/summarize/full`エンドポイントをそのまま正規経路に昇格させるのではなく、`/api/summarize`側のfullモード分岐に、`/api/summarize/full`が持つ「キャッシュ確認→なければ生成→保存」のロジックを統合する必要がある。**

理由：
1. スキーマ（`transcript_full_summaries`）自体は、外部キー・CASCADE削除・RLS封鎖・一意制約のいずれも設計として妥当であり、作り直す理由が見当たらない（ゲストの混入を防ぐ制約も既に構造的に満たされている）。
2. `/api/summarize/full`を単純に採用すると、①無料トライアル層（`userChoseFullTrial`）が締め出される、②短文字数ガードが欠落する、という2つの機能退行が発生する。これは「不採用にすべき」ではなく「そのままでは不採用にせざるを得ない」という状態であり、統合修正を要する。
3. 現行の`/api/summarize`をベースに、`summaryMode==='full'`の分岐内でキャッシュ確認・保存処理を追加する方が、既存の無料トライアル・短文字数ガードのロジックを壊さずに済む。

**不採用（少なくとも現状のままでは）**：`/api/summarize/full`をURLごとそのままクライアントに接続する方式。理由は上記2点の機能退行。

**別途対応が必要な既知の課題（今回のスキーマ再利用可否の判断自体は左右しない）**：
- 重複生成防止（排他制御）が無い点は、テーブル設計の問題ではなくアプリケーションロジックの問題であり、どちらの経路を採用しても別途対応が必要。

---

## ■ 未確定事項

1. `template`ごとに最大2行（bullets/minutes）許容する設計だが、クライアントUIが実際に両テンプレートを同一transcriptに対して切り替えて生成する動線を持つか（`TranscriptView.jsx`にテンプレート切り替えUIらしき`summaryTemplate`状態は存在するが、切り替え後に`transcript_full_summaries`を意識した挙動になるかは今回の統合方式検討の範囲外のため未検証）。
2. 無料/Plus問わず、表示件数上限を超えた古いtranscriptに紐づく`transcript_full_summaries`行が実際に本番でどの程度累積し得るかは、実データを見ないと定量化できない（本番Supabaseへのアクセスは禁止事項のため未確認）。
