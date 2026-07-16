# /api/account/status 304 キャッシュ問題 調査・修正レポート

作成日: 2026-07-15

---

## 1. 原因（304を返し続ける具体的なロジック）

### ETagの元データは正しかった

`server/routes/account.js` の `res.json({planId, ...})` は Express の自動 ETag 機能によりレスポンスボディのハッシュをETagとして生成する。`planId` は `getEntitlement()` 経由で `user_entitlements` から直接取得されるため、**ETagの元データに user_entitlements の状態は含まれている**。このETagの仕組み自体は正しく動作している。

### 本当の問題：ブラウザが古いキャッシュを使い続けている

304が返り続ける原因は、以下の2段階の問題の組み合わせ：

**段階1 ── 古いキャッシュが作られるタイミング**

`App.jsx:247-257` の `handleUpgrade()` は `purchaseTake()` の直後に `getAccountStatus()` を呼んでいる：
```javascript
const handleUpgrade = async () => {
  if (upgradeMode === 'purchase') {
    await purchaseTake();              // offer.order() を呼ぶだけ（即return）
    getAccountStatus().then(...);      // この時点でGooglePlayの購入はまだ完了していない
  }
};
```
`purchaseTake()` は `offer.order()` を呼んで返るだけで、Google Play側の購入完了（非同期）を待たない。そのためこの `getAccountStatus()` は購入完了前に実行され、サーバーは「無料プラン」を返す。ブラウザはこのレスポンスを ETag `W/"abc"` とともにキャッシュする。

**段階2 ── その後ブラウザがサーバーに問い合わせない**

`getAccountStatus()` の fetch はデフォルトの `cache: 'default'` モード（変更前）：
```javascript
fetch(`${API_BASE}/api/account/status`, { headers })
// ↑ cache オプション未指定 = 'default'
```

`cache: 'default'` では、ブラウザが「レスポンスがまだ新鮮」と判断した場合、**サーバーへのリクエスト自体をスキップしてキャッシュを直接返す**（Vercel のログにはリクエストが届かない）。また「やや古い」と判断した場合のみ `If-None-Match` を送るが、この時点で `billing.js` の `.verified()` コールバックが Supabase を更新済みであれば サーバーは新しいETagの200を返せるはずが、そのフェッチ自体が発生しない。

さらに、`billing.js` の `.verified()` コールバック内にはReactの `accountStatus` を更新するコードが存在しない。購入完了後に `getAccountStatus()` を再呼び出しするトリガーがなく、UI が「無料プラン」表示のまま固定される。

### 結果として観察されるVercelログの304

Vercelログで見える304は、ブラウザが `If-None-Match` を送ってきたケース（ページリロード等）のもの。このとき billing.js の検証は既に完了しているにも関わらず、サーバーが304（旧キャッシュと同じ内容）を返しているように見えるのは、Express の `res.json()` がETagを照合した結果そのものが正しいことを示している（データは変わっていない、のではなく、ブラウザのキャッシュと同じデータが返っているため一致）。

---

## 2. 提案する修正の差分

### git diff --stat（今回の変更のみ）
```
 client/src/api.js        |  1 +  (billing.jsの変更は前回作業分)
 server/routes/account.js |  1 +
 2 files changed, 2 insertions(+), 1 deletion(-)
```

### git diff 本文

```diff
diff --git a/client/src/api.js b/client/src/api.js
index b71f810..c914f7e 100644
--- a/client/src/api.js
+++ b/client/src/api.js
@@ -71,7 +71,7 @@ export async function getAccountStatus() {
   if (session?.access_token) {
     headers['Authorization'] = `Bearer ${session.access_token}`;
   }
-  const res = await fetch(`${API_BASE}/api/account/status`, { headers });
+  const res = await fetch(`${API_BASE}/api/account/status`, { headers, cache: 'no-cache' });
   if (!res.ok) return null;
   return res.json();
 }

diff --git a/server/routes/account.js b/server/routes/account.js
index 4d5e48d..620a58e 100644
--- a/server/routes/account.js
+++ b/server/routes/account.js
@@ -33,6 +33,7 @@ router.get('/account/status', optionalAuth, async (req, res, next) => {
     const usedSeconds = period?.used_seconds ?? 0;
     const limitSeconds = plan.monthlySeconds;
 
+    res.set('Cache-Control', 'no-cache');
     res.json({
       planId,
       planName: plan.name,

```

### 各修正の意図

**`server/routes/account.js` — `Cache-Control: no-cache` を付与**

HTTP の `Cache-Control: no-cache` は「キャッシュを保存してよいが、使用する前に必ずサーバーで再検証すること」を意味する。ETag自体は引き続き機能する（データが変わっていない場合は304でレスポンスボディの転送を節約できる）が、「ブラウザが勝手にサーバーを飛ばす」挙動が禁止される。

**`client/src/api.js` — `cache: 'no-cache'`**

Fetch API の `cache: 'no-cache'` は、サーバー側の `Cache-Control` ヘッダーがない場合でもブラウザが必ず条件付きリクエストを送ることを保証する二重安全網。`cache: 'no-store'`（完全無効化）ではなく `no-cache`（常に再検証）を選んだのは、データが変わっていない場合の304 → 304バイパスによる帯域節約を維持するため。

---

## 3. この修正で解決する自信の度合いと根拠

**自信度: 中〜高（75%）**

### 直接解決できる部分（確実）
- `cache: 'no-cache'` + `Cache-Control: no-cache` により、ブラウザが古いキャッシュをサーバー確認なしに使う問題は解消される
- Supabaseデータが正しい状態であれば、次回 `getAccountStatus()` が呼ばれた時点でサーバーは `take` プランを返し、ブラウザが更新される

### 残る問題（この修正では解決しない）

**根本的なトリガー不在：billing.js の `.verified()` コールバックがUIを更新しない**

`billing.js` の購入検証完了後に React の `accountStatus` を再フェッチするトリガーが存在しない。この修正により「フェッチすれば正しいデータが取れる」状態になるが、「いつフェッチするか」の問題は残る。

現状のフェッチトリガー：
- ページロード時（`user` 変化）
- `accountStatusRetryCount` が変化した時（手動リトライ）
- 文字起こし完了後（`handleTranscribe`）
- アップグレードボタン押下後（`handleUpgrade` — ただしタイミングが早すぎる）

**推奨する追加対応（billing.js のスコープ外）：**
`billing.js` の `verifyPurchaseOnServer()` 成功時にカスタムイベント等でReactに通知する仕組みを追加する。例：
```javascript
// billing.js の verified コールバック内（修正後）
if (ok) {
  window.dispatchEvent(new CustomEvent('billing:verified'));
  await receipt.finish();
}
// App.jsx 側でイベントを受け取り accountStatusRetryCount をインクリメント
```
これにより「購入完了 → Supabase更新 → UI反映」のフローが確実になる。
