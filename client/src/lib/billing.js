import { Capacitor } from '@capacitor/core';

// cdv-purchaseプラグインはCapacitorネイティブ環境のみ有効
const isNative = () => Capacitor.isNativePlatform();

let storeInitialized = false;

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
    .verified(receipt => receipt.finish());

  await store.initialize([Platform.GOOGLE_PLAY]);
  storeInitialized = true;
}

/**
 * 竹プランの購入開始
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
