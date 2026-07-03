import { google } from 'googleapis';

const PACKAGE_NAME = 'com.saidlog.app';
const SUBSCRIPTION_PRODUCT_ID = 'take_monthly_680';

// 有効とみなす購読状態。
// - ACTIVE: 通常の有効状態
// - IN_GRACE_PERIOD: 支払い失敗後の猶予期間（Googleの仕様上、expiryTimeが猶予期間分延長される）
// - CANCELED: 解約済みだが期限未到来（支払い済み期間中はアクセス権を維持する）
const VALID_SUBSCRIPTION_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

let cachedClient = null;

export function isGooglePlayConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

/**
 * GOOGLE_SERVICE_ACCOUNT_JSON からサービスアカウント認証情報を読み込み、
 * Android Publisher API クライアントを初期化して返す（プロセス内でキャッシュ）。
 */
function getAndroidPublisher() {
  if (cachedClient) return cachedClient;

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  cachedClient = google.androidpublisher({ version: 'v3', auth });
  return cachedClient;
}

/**
 * Google Play Developer API（purchases.subscriptionsv2.get）で
 * purchase_token を検証する。
 * v2 API はパッケージ名とトークンのみで購読情報を取得できる
 * （サブスクリプションIDはレスポンスの lineItems[].productId で照合する）。
 *
 * @param {string} purchaseToken 購入時にデバイスへ発行されたトークン
 * @returns {Promise<{
 *   valid: boolean,
 *   reason: string|null,
 *   subscriptionState: string|null,
 *   productId: string|null,
 *   expiryTime: string|null,
 *   startTime: string|null,
 *   acknowledgementState: string|null,
 *   testPurchase: boolean,
 * }>}
 *   reason（valid=false時）: 'NOT_CONFIGURED' | 'TOKEN_INVALID' |
 *   'PRODUCT_MISMATCH' | 'NOT_ACTIVE' | 'EXPIRED'
 *   reason（valid=true時）: 開発環境で検証をスキップした場合のみ
 *   'VERIFICATION_SKIPPED_DEV'（expiryTime等はnullのまま）
 * @throws Google API側の障害（5xx等、トークンの有効性を判定できないエラー）は
 *   そのままthrowする（呼び出し元で500系として扱う想定）
 */
export async function verifyGooglePlaySubscription(purchaseToken) {
  const base = {
    valid: false,
    reason: null,
    subscriptionState: null,
    productId: null,
    expiryTime: null,
    startTime: null,
    acknowledgementState: null,
    testPurchase: false,
  };

  if (!isGooglePlayConfigured()) {
    // 本番では検証をスキップせずエラーにする（fail-close）。
    // 開発環境ではGoogle Play検証を行えないため、警告を出した上で通す。
    if (isProduction()) {
      console.error('[googlePlay] GOOGLE_SERVICE_ACCOUNT_JSON が未設定のため検証できません');
      return { ...base, reason: 'NOT_CONFIGURED' };
    }
    console.warn('[googlePlay] GOOGLE_SERVICE_ACCOUNT_JSON 未設定（開発環境）。検証をスキップします');
    return { ...base, valid: true, reason: 'VERIFICATION_SKIPPED_DEV' };
  }

  let purchase;
  try {
    const res = await getAndroidPublisher().purchases.subscriptionsv2.get({
      packageName: PACKAGE_NAME,
      token: purchaseToken,
    });
    purchase = res.data;
  } catch (err) {
    // 400/404 はトークン自体が不正（存在しない・形式不正）を意味する
    const status = err?.code ?? err?.response?.status;
    if (status === 400 || status === 404) {
      return { ...base, reason: 'TOKEN_INVALID' };
    }
    throw err;
  }

  const lineItem = (purchase.lineItems ?? []).find(
    (item) => item.productId === SUBSCRIPTION_PRODUCT_ID
  );

  const result = {
    ...base,
    subscriptionState: purchase.subscriptionState ?? null,
    productId: lineItem?.productId ?? purchase.lineItems?.[0]?.productId ?? null,
    expiryTime: lineItem?.expiryTime ?? null,
    startTime: purchase.startTime ?? null,
    acknowledgementState: purchase.acknowledgementState ?? null,
    testPurchase: purchase.testPurchase != null,
  };

  if (!lineItem) {
    return { ...result, reason: 'PRODUCT_MISMATCH' };
  }
  if (!VALID_SUBSCRIPTION_STATES.has(purchase.subscriptionState)) {
    return { ...result, reason: 'NOT_ACTIVE' };
  }
  if (!lineItem.expiryTime || new Date(lineItem.expiryTime) <= new Date()) {
    return { ...result, reason: 'EXPIRED' };
  }

  return { ...result, valid: true };
}
