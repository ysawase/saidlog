import { Capacitor } from '@capacitor/core';

/**
 * Plus アップグレードの状態を5段階で判定する（優先順位厳守）。
 *
 * 1. plus_active   – Plus 利用中（最優先。環境・ログイン問わず購入CTA非表示）
 * 2. web           – Web 環境（isNative() = false）
 * 3. not_logged_in – Native かつ未ログイン → AuthModal を開く
 * 4. loading       – Native かつログイン済み、accountStatus 未取得 / 取得エラー
 * 5. purchase      – Native + ログイン済み + 無料プラン + accountStatus 取得済み
 */
export function getUpgradeMode({ user, accountStatus }) {
  if (accountStatus?.planId === 'take') return 'plus_active';
  if (!Capacitor.isNativePlatform()) return 'web';
  if (!user) return 'not_logged_in';
  if (accountStatus === null) return 'loading';
  return 'purchase';
}
