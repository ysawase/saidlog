# Plus CTA 安全化 事前調査レポート
2026-07-02

---

## 調査したファイル

- `client/src/lib/billing.js`
- `client/src/App.jsx`
- `client/src/components/HistoryList.jsx`
- `client/src/components/TranscriptView.jsx`
- `server/routes/account.js`

コード変更・commit・push は一切行っていない。

---

## 1. purchaseTake の現在仕様

**定義ファイル:** `client/src/lib/billing.js` (lines 41–58)

```js
export async function purchaseTake() {
  if (!isNative()) {
    console.warn('[billing] purchaseTake: not native');
    return;                     // Web では即 return
  }
  const { CdvPurchase } = window;
  if (!CdvPurchase) throw new Error('CdvPurchase not available');
  const { store, Platform } = CdvPurchase;
  const product = store.get('take_monthly_680', Platform.GOOGLE_PLAY);
  if (!product) throw new Error('Product not found: take_monthly_680');
  const offer = product.getOffer();
  if (!offer) throw new Error('No offer available');
  await offer.order();
}
```

| 項目 | 内容 |
|------|------|
| isNative 判定 | billing.js 先頭 `const isNative = () => Capacitor.isNativePlatform()` |
| Web 環境での挙動 | console.warn のみ出力して即 return（UI 変化なし・エラーなし） |
| Native 環境での挙動 | Google Play Billing の課金フローを起動（offer.order()） |
| Web でユーザー向け表示 | **なし**（フィードバック一切なし） |
| 未ログイン時の挙動 | user チェックなし。Native では Play 課金は走るが Supabase 未認証のためプラン反映不可 |
| エラー時のフィードバック | **なし**（throw するが呼び出し元で catch していない） |

---

## 2. purchaseTake を呼んでいる箇所（全件）

### ① HistoryList.jsx — line 99

```jsx
<button className="btn primary" onClick={purchaseTake} ...>SaidLog Plusに進む</button>
```

| 項目 | 状態 |
|------|------|
| 画面 | S04 履歴モーダル（制限バナー下部） |
| 表示条件 | `planId === 'ume'`（無料プランのみ） |
| 未ログインで表示されうるか | **いいえ**。モーダル自体が `showHistory && user` で囲まれているため到達不可 |
| Web で表示されうるか | **はい**（無料プランの Web ユーザーに表示される） |
| Plus 利用中に表示されうるか | **いいえ**（`planId === 'ume'` 条件） |
| accountStatus ロード中に表示されうるか | **いいえ**（ロード中は planId = undefined → `=== 'ume'` が false） |
| リスク評価 | **低**。Web 無反応のみ。未ログイン・Plus 表示は既にガード済み |

---

### ② TranscriptView.jsx — line 209（showCopyModal 内）

```jsx
// isLoggedIn が true の場合のみ表示される分岐内
<button className="btn primary" onClick={purchaseTake}>SaidLog Plusに進む</button>
```

| 項目 | 状態 |
|------|------|
| 画面 | S08 コピー/エクスポート不可モーダル（S08-E） |
| 表示条件 | `showCopyModal && isLoggedIn`（コピー試行 + ログイン済み） |
| 未ログインで表示されうるか | **いいえ**。`isLoggedIn` が false の場合は「無料登録/ログイン」ボタンが表示される |
| Web で表示されうるか | **はい**（canExport = false のログイン済み無料ユーザーがコピー試行した場合） |
| Plus 利用中に表示されうるか | **いいえ**（canExport = true なら showCopyModal は開かない） |
| accountStatus ロード中に表示されうるか | **△**。ロード中は `canExport ?? false` → false → showCopyModal が開く可能性あり |
| リスク評価 | **中**。Web で押しても無反応。ロード中誤表示の可能性 |

---

### ③ TranscriptView.jsx — line 293（summary-blur-wrapper 内）

```jsx
<button className="btn summary-upgrade-btn"
  onClick={async () => { await purchaseTake(); if (onPurchaseComplete) onPurchaseComplete(); }}>
  SaidLog Plusに進む
</button>
```

| 項目 | 状態 |
|------|------|
| 画面 | S08 要約プレビューのブラー CTA（S08-P） |
| 表示条件 | `summaryStatus === 'done' && summaryType === 'preview'` |
| 未ログインで表示されうるか | **★はい**。未ログインユーザーでも summary_type = 'preview' が返れば表示される |
| Web で表示されうるか | **はい** |
| Plus 利用中に表示されうるか | 理論上は 'full' が返るため表示されないはず（既存 DB が 'preview' の場合は例外） |
| accountStatus ロード中に表示されうるか | summary レスポンス次第（accountStatus とは独立） |
| リスク評価 | **高**。未ログイン + Web で押しても無反応。catch なし |

---

## 3. AuthModal を開く既存パターン

App.jsx での実装:

```jsx
const [showAuthModal, setShowAuthModal] = useState(false);
const [authModalInitialMode, setAuthModalInitialMode] = useState('login');

// 呼び出しパターン
setAuthModalInitialMode('signup');
setShowAuthModal(true);

// 子コンポーネントへの伝達（TranscriptView のみ）
onOpenAuthModal={() => { setAuthModalInitialMode('signup'); setShowAuthModal(true); }}
```

| コンポーネント | onOpenAuthModal 伝達 | 備考 |
|----------------|---------------------|------|
| TranscriptView | **あり**（line 365） | showCopyModal → 未ログイン分岐で使用済み |
| HistoryList | **なし** | user ガード済みなので現状問題なし |
| S01 idle | **なし**（インライン） | 追加実装が必要 |

→ **`onOpenAuthModal` prop を S01 / HistoryList に渡すパターンは既に確立されている**。
TranscriptView の実装がそのまま参考例として使える。

---

## 4. plan 判定の既存仕様

### accountStatus の shape（server/routes/account.js より）

```js
{
  planId: 'ume' | 'take',         // 判定に使う
  planName: '梅' | 'SaidLog Plus', // 表示用のみ
  usedSeconds: number,
  limitSeconds: number,
  remainingSeconds: number,
  fullSummaryUsed: boolean,
  historyLimit: 3 | 30,
  canExport: false | true,
}
```

| 判定 | 方法 |
|------|------|
| Plus 利用中 | `accountStatus?.planId === 'take'` |
| 無料プラン | `accountStatus?.planId === 'ume'` |
| 取得中 | `accountStatus === null` |
| 取得エラー | `catch(() => setAccountStatus(null))` → null（取得中と区別不可） |
| planName の使用 | 表示用のみ。判定に使わない（名称変更で破綻するリスクあり） |

---

## 5. Web 環境での代替表示候補

| 項目 | 状況 |
|------|------|
| Google Play Store URL | **コードベースに存在しない** |
| App Store URL | **コードベースに存在しない** |
| Android アプリ公開 URL | **存在しない**（未公開または非公開） |
| Web 版での Plus 購入案内文言 | **既存なし** |

→ Web 環境では「モバイルアプリからご利用ください」程度の静的テキスト表示が現実的。
または Plus CTA を Web では完全に非表示にする（最もシンプル）。

---

## 設計案

### 1. handleUpgradeClick 安全ハンドラを作るべきか

```
案A: billing.js に safeUpgrade({ user, onOpenAuthModal }) を追加
案B: カスタムフック useUpgrade.js を作成
案C: 各コンポーネントでインライン実装（現状踏襲）
```

**推奨: 案C（インライン）**。
呼び出し箇所は3箇所で少なく、追加抽象化のコストに見合わない。
`isNative() && user` チェックを各箇所に直書きする方がシンプルかつ今後の個別調整に強い。

### 2. S01 だけで対応する案

- メリット: 変更ファイルが1〜2本、レビュー範囲が狭い
- デメリット: TranscriptView 293行目（★最高リスク箇所）が放置される

### 3. S04/S08-E も同時に安全化する案

- メリット: 全 Plus CTA を一括でガード、後回し技術負債なし
- デメリット: 変更ファイルが増える（App.jsx + HistoryList + TranscriptView）
- **ただし TranscriptView 293行目は isLoggedIn チェック追加のみで 1〜2行変更**

### 4. Plus CTA 安全化を別タスク化する案

- メリット: S01 実装を止めない、1コミット1ファイルの原則が守りやすい
- デメリット: TranscriptView の未ログイン+Native 問題（★高リスク）が残る期間が生じる

### 5. 推奨案

**S01 v2.1 実装と同時に、TranscriptView 293行目だけ先行修正する。**

根拠:
- S01 に新規追加する CTA は最初から安全に設計できる（別タスク不要）
- TranscriptView 293行目（ブラー CTA）は唯一「未ログイン + Native」で
  purchaseTake が走る既存バグで、放置リスクが高い
- 変更は 293行目の onClick に `isLoggedIn` チェックを1〜2行追加するだけ
- HistoryList の S04 CTA は `showHistory && user` で既にガードされており後回し可

---

## 明記事項（最終判断）

| # | 質問 | 回答 |
|---|------|------|
| 1 | S01 v2.1 実装前に Plus CTA 安全化が必要か | **必須ではないが TranscriptView 293行目のみ先行推奨** |
| 2 | リスクA（Web 環境無反応）はブロッカーか | **ブロッカーではない**（何も起きないだけで画面は壊れない）。ただし UX が不完全 |
| 3 | ガード範囲 | **S01は実装時に安全に作る** / **TranscriptView 293行目は先行修正推奨** / S04は別タスク可 |
| 4 | Web 環境での表示は何が妥当か | 「モバイルアプリからご利用ください」テキスト表示、または **Plus CTA を Web で非表示** |
| 5 | 未ログイン Native では AuthModal 起動でよいか | **はい**。`onOpenAuthModal()` 既存パターンを踏襲 |
| 6 | accountStatus ロード中はどう見せるべきか | **Plus CTA・free-note を非表示**（`accountStatus === null` の間は表示しない） |
| 7 | Plus 利用中には価格比較エリアをどう見せるべきか | `accountStatus?.planId !== 'take'` 条件でラップして非表示にする |
| 8 | 変更ファイル候補 | S01実装: App.jsx + App.css / 先行修正: TranscriptView.jsx（1〜2行のみ） |

---

## コード変更・commit・push の確認

本調査では **いかなるファイルも変更しておらず、commit・push も行っていない**。
調査したファイルはすべて読み取りのみ。

---
