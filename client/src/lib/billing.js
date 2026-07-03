import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// cdv-purchaseプラグインはCapacitorネイティブ環境のみ有効
const isNative = () => Capacitor.isNativePlatform();

let storeInitialized = false;

/**
 * サーバーの /api/billing/verify を呼び、購入トークンを検証・保存する。
 * 成功時のみ true を返す。
 */
async function verifyPurchaseOnServer(receipt) {
  if (!receipt.purchaseToken) {
    console.error('[billing] receipt.purchaseToken is missing, skipping verification');
    return false;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    console.error('[billing] verifyPurchaseOnServer: no access_token, skipping finish()');
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/api/billing/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ purchase_token: receipt.purchaseToken }),
    });

    if (!res.ok) {
      console.error('[billing] /api/billing/verify failed:', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[billing] /api/billing/verify request error:', err);
    return false;
  }
}

/**
 * Google Play Billingの初期化
 * ネイティブ環境以外では何もしない
 */
export async function initBilling() {
  if (!isNative()) return;
  if (storeInitialized) return;

  const { CdvPurchase } = window;
  if (!CdvPurchase) {
    console.warn('[billing] CdvPurchase not available');
    return;
  }

  const { store, ProductType, Platform } = CdvPurchase;

  store.register([{
    id: 'take_monthly_680',
    type: ProductType.PAID_SUBSCRIPTION,
    platform: Platform.GOOGLE_PLAY,
  }]);

  store.when()
    .approved(transaction => transaction.verify())
    .verified(async receipt => {
      const ok = await verifyPurchaseOnServer(receipt);
      if (ok) await receipt.finish();
    });

  await store.initialize([Platform.GOOGLE_PLAY]);
  storeInitialized = true;
}

/**
 * SaidLog Plus（旧称：竹プラン）の購入開始
 */
export async function purchaseTake() {
  if (!isNative()) {
    console.warn('[billing] purchaseTake: not native');
    return;
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

/**
 * 購入の復元（アプリ再インストール時など）
 */
export async function restorePurchases() {
  if (!isNative()) return;

  const { CdvPurchase } = window;
  if (!CdvPurchase) return;

  await CdvPurchase.store.restorePurchases();
}
