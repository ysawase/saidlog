// UI棚卸し用: SaidLog Web版（ローカルdevサーバー）の主要画面をPlaywrightでスクリーンショット撮影する。
// 事前に `npm run dev` でローカルdevサーバー（client:5173 / server:3000）を起動しておくこと。
// 実行: node scripts/take_ui_screenshots.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'http://localhost:5173';
const OUT_DIR = path.resolve('reports/ui_screenshots');

const results = [];

async function shot(page, name, opts = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  results.push({ name, file, note: opts.note ?? '' });
  console.log(`[shot] ${name}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 12 Pro相当
    baseURL: BASE_URL,
  });
  await context.grantPermissions(['microphone'], { origin: BASE_URL });
  const page = await context.newPage();

  // 1. オンボーディング・初回起動画面（未ログイン）
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.s01-hero');
  await shot(page, '01_onboarding_top');
  await shot(page, '01_onboarding_full', { fullPage: true, note: '価格・フロー説明含む全体' });

  // 5. Plusアップグレード誘導・ペイウォール（idle画面内の価格セクション）
  const pricing = page.locator('#s01-pricing');
  await pricing.scrollIntoViewIfNeeded();
  await pricing.screenshot({ path: path.join(OUT_DIR, '05_paywall_pricing.png') });
  results.push({ name: '05_paywall_pricing', file: path.join(OUT_DIR, '05_paywall_pricing.png'), note: '未ログイン状態: 無料登録/ログイン導線' });
  console.log('[shot] 05_paywall_pricing');

  // ログインモーダル（オンボーディングからの入口として参考取得）
  await page.locator('.header-auth button', { hasText: /ログイン/ }).click();
  await page.waitForSelector('.auth-modal, [class*="modal"]', { timeout: 5000 }).catch(() => {});
  await shot(page, '06_auth_modal', { note: 'ログイン/新規登録モーダル' });
  // モーダルを閉じてidleに戻す
  await page.keyboard.press('Escape').catch(() => {});
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.s01-hero');

  // 2. 録音・文字起こし開始画面
  const recorderStart = page.locator('.recorder button.btn.primary');
  await recorderStart.click();
  await page.waitForSelector('.recorder .notice', { timeout: 5000 });
  await shot(page, '02_recording_active', { note: '録音中の状態' });

  // 少し録音してから停止（短い音声にするため数秒待つ）
  await page.waitForTimeout(3000);
  const recorderStop = page.locator('.recorder button.btn.primary');
  await recorderStop.click();
  await page.waitForSelector('.recorder .notice', { timeout: 5000 });
  await shot(page, '02b_recording_confirm', { note: '録音停止後の確認（保存/文字起こし開始）画面' });

  // 文字起こし開始 → uploading/processing/done の遷移を追う
  const transcribeBtn = page.locator('.recorder button.btn.primary', { hasText: /文字起こし/ });
  await transcribeBtn.click();

  // 3. 文字起こし中（uploading→processing）の待機画面
  // uploadingは一瞬の可能性があるため即座にも一枚撮る
  await page.waitForTimeout(300);
  await shot(page, '03_processing_early', { note: 'uploading/processing 遷移直後（uploadingを捕捉できていない可能性あり）' });

  try {
    await page.waitForSelector('main .notice.processing', { timeout: 10000 });
    await shot(page, '03_processing', { note: '文字起こし処理中の待機画面' });
  } catch {
    console.log('[warn] processing状態のセレクタを検出できず（既にdone/errorへ遷移した可能性）');
  }

  // 4. 文字起こし結果画面（doneまたはerrorを待つ。実APIのため時間がかかる場合あり）
  try {
    await page.waitForSelector('main .notice.error, .done-elapsed', { timeout: 90000 });
    const isError = await page.locator('main .notice.error').count();
    if (isError > 0) {
      await shot(page, '04_transcribe_error', { fullPage: true, note: '文字起こしエラー画面' });
    } else {
      await shot(page, '04_transcribe_done', { fullPage: true, note: '文字起こし結果画面（要約・アップグレードCTA含む）' });
    }
  } catch (err) {
    console.log('[warn] done/error状態を90秒以内に検出できず:', err.message);
    await shot(page, '04_transcribe_timeout', { fullPage: true, note: 'done/errorへの遷移がタイムアウト時点のスクショ' });
  }

  await browser.close();

  console.log('\n=== 撮影結果一覧 ===');
  for (const r of results) {
    console.log(`- ${r.name}.png${r.note ? '  (' + r.note + ')' : ''}`);
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
