import { Router } from 'express';
import { transcribe } from '../stt/index.js';
import { createSignedAudioUrl, deleteAudio, supabaseConfigured } from '../services/storage.js';
import { cleanupOldFiles } from '../services/cleanup.js';

const router = Router();

// {uuid}/{ASCII安全なファイル名} 形式のみ受け付ける（パス潜り対策）
const FILE_PATH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]+$/i;

router.post('/transcribe', async (req, res, next) => {
  try {
    const { filePath } = req.body ?? {};
    if (typeof filePath !== 'string' || !FILE_PATH_PATTERN.test(filePath)) {
      return res.status(400).json({ error: 'ファイルパスが不正です。アップロードからやり直してください' });
    }
    if (!supabaseConfigured()) {
      return res.status(500).json({ error: 'サーバーにSupabaseの接続情報が設定されていません' });
    }
    // プロバイダーに対応するAPIキーを起動前に検証する（不正リクエストでSTT処理に入る前に弾く）
    const provider = process.env.STT_PROVIDER || 'assemblyai';
    const requiredKey = provider === 'amivoice' ? 'AMIVOICE_APPKEY' : 'ASSEMBLYAI_API_KEY';
    if (!process.env[requiredKey]) {
      return res.status(500).json({ error: `サーバーに ${requiredKey} が設定されていません` });
    }

    const audioUrl = await createSignedAudioUrl(filePath);

    console.log(`文字起こし開始: ${filePath}`);
    let result;
    try {
      // filePath は {uuid}/{ファイル名} 形式。拡張子による変換判定用にファイル名部分を渡す
      result = await transcribe({ audio: audioUrl, language: 'ja', filename: filePath.split('/').pop() });
    } finally {
      // 会議データを残さない方針：成功・失敗を問わず即削除。
      // Vercelはレスポンス後に実行が凍結されるため、必ずawaitしてから応答する
      try {
        await deleteAudio(filePath);
      } catch (err) {
        console.error(`削除失敗 (${filePath}):`, err.message);
      }
    }
    console.log(`文字起こし完了: ${filePath} (発言数: ${result.utterances.length}, 音声長: ${result.audioDurationSec}s)`);

    // piggyback掃除：削除に失敗した過去ファイルの残骸を回収（同上の理由でawait）
    try {
      await cleanupOldFiles();
    } catch (err) {
      console.error('クリーンアップ失敗:', err.message);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
