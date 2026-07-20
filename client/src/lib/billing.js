import { Capacitor } from '@capacitor/core';
import { store, ProductType, Platform } from 'capacitor-plugin-cdv-purchase';
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
  // VerifiedReceipt には purchaseToken は直接存在しない。
  // Google Play の購入トークンは sourceReceipt (GooglePlay.Receipt) に格納されている。
  const purchaseToken = receipt.sourceReceipt?.purchaseToken;
  if (!purchaseToken) {
    console.error('[billing] purchaseToken is missing from receipt.sourceReceipt, skipping verification');
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
      body: JSON.stringify({ purchase_token: purchaseToken }),
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
export async function initBilling({ onPurchaseComplete } = {}) {
  if (!isNative()) return;
  if (storeInitialized) return;

  store.register([{
    id: 'take_monthly_680',
    type: ProductType.PAID_SUBSCRIPTION,
    platform: Platform.GOOGLE_PLAY,
  }]);

  store.when()
    .approved(transaction => transaction.verify())
    .verified(async receipt => {
      console.log('[billing][debug] verified event fired');
      const ok = await verifyPurchaseOnServer(receipt);
      console.log('[billing][debug] verifyPurchaseOnServer result:', ok);
      if (ok) {
        await receipt.finish();
        console.log('[billing][debug] calling onPurchaseComplete');
        onPurchaseComplete?.();
      }
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

  await store.restorePurchases();
}
