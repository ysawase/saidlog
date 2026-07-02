import { Capacitor } from '@capacitor/core';

/**
 * Plus アップグレードの状態を6段階で判定する（優先順位厳守）。
 *
 * 1. plus_active   – 取得成功 + Plus 利用中（最優先）
 * 2. web           – Web 環境
 * 3. not_logged_in – Native かつ未ログイン → AuthModal を開く
 * 4. account_error – Native + ログイン済み + accountStatus 取得失敗
 * 5. loading       – Native + ログイン済み + accountStatus 取得中
 * 6. purchase      – 取得成功 + ログイン済み + 無料プラン → 購入可能
 */
export function getUpgradeMode({ user, accountStatus, accountStatusLoadState }) {
  if (accountStatusLoadState === 'success' && accountStatus?.planId === 'take') return 'plus_active';
  if (!Capacitor.isNativePlatform()) return 'web';
  if (!user) return 'not_logged_in';
  if (accountStatusLoadState === 'error') return 'account_error';
  if (accountStatusLoadState !== 'success') return 'loading';
  return 'purchase';
}
