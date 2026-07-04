import { Router } from 'express';
import { transcribe } from '../stt/index.js';
import {
  createSignedAudioUrl, deleteAudio, supabaseConfigured, getSupabase,
  getStorageUsageRatio, deleteOldAudioFiles, scheduleAudioDeletion, THRESHOLD_HIGH,
} from '../services/storage.js';
import { cleanupOldFiles } from '../services/cleanup.js';
import {
  canStartTranscription, recordTranscriptionSuccess, recordTranscriptionFailure,
} from '../services/plan.js';
import { optionalAuth } from '../middleware/auth.js';
import { buildTranscriptionErrorCode } from '../utils/classifyTranscriptionError.js';

const router = Router();

// {uuid}/{ASCII安全なファイル名} 形式のみ受け付ける（パス潜り対策）
const FILE_PATH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]+$/i;

router.post('/transcribe', optionalAuth, async (req, res, next) => {
  try {
    const { filePath, durationSeconds } = req.body ?? {};
    const guestId = req.body.guestId ?? null;
    const userId = req.userId; // optionalAuth で検証済み（未認証時は null）

    if (typeof filePath !== 'string' || !FILE_PATH_PATTERN.test(filePath)) {
      return res.status(400).json({ error: 'ファイルパスが不正です。アップロードからやり直してください' });
    }
    if (!supabaseConfigured()) {
      return res.status(500).json({ error: 'サーバーにSupabaseの接続情報が設定されていません' });
    }
    // プロバイダーに対応するAPIキーを起動前に検証する（不正リクエストでSTT処理に入る前に弾く）
    const provider = process.env.STT_PROVIDER || 'assemblyai';
    const requiredKey = provider === 'amivoice' ? 'AMIVOICE_APPKEY'
      : provider === 'groq' ? 'GROQ_API_KEY'
      : 'ASSEMBLYAI_API_KEY';
    if (!process.env[requiredKey]) {
      return res.status(500).json({ error: `サーバーに ${requiredKey} が設定されていません` });
    }

    const GUEST_TRIAL_MAX_MINUTES = parseInt(process.env.GUEST_TRIAL_MAX_MINUTES ?? '15', 10);
    const GUEST_TRIAL_MAX_SECONDS = GUEST_TRIAL_MAX_MINUTES * 60;

    if (!userId && guestId) {
      const { data: guestData } = await getSupabase()
        .from('guest_usage')
        .select('transcribe_count, used_seconds')
        .eq('guest_id', guestId)
        .maybeSingle();

      if (guestData && guestData.transcribe_count >= 1) {
        return res.status(403).json({ error: 'GUEST_TRIAL_USED' });
      }

      if ((durationSeconds ?? 0) > GUEST_TRIAL_MAX_SECONDS) {
        return res.status(403).json({ error: 'GUEST_TRIAL_TOO_LONG' });
      }
    }

    // プランゲート（認証済みの場合のみ）
    // クライアントから送られた durationSeconds で上限チェック。
    // 正確な課金は STT 完了後の実測値で行う（recordTranscriptionSuccess）。
    const hasPlanContext = userId !== null;
    if (hasPlanContext) {
      const gate = await canStartTranscription(userId, null, durationSeconds ?? 0);
      if (!gate.ok) {
        return res.status(403).json({ error: gate.reason, remainingSeconds: gate.remainingSeconds });
      }
    }

    // 文字起こし前に使用量を確認し、80%超なら古いファイルを削除してから処理を続行
    const uploadedAt = new Date();
    const ratio = await getStorageUsageRatio();
    if (ratio >= THRESHOLD_HIGH) {
      await deleteOldAudioFiles();
    }

    const audioUrl = await createSignedAudioUrl(filePath);
    const filename = filePath.split('/').pop();
    const sttModel = provider === 'groq' ? 'whisper-large-v3-turbo'
      : provider === 'amivoice' ? 'a-general'
      : 'universal-3-pro';

    // STT開始前にtranscripts行を先に作っておく（transcribing）。
    // 失敗時もこのIDでrecordTranscriptionFailureが更新できるようにするため。
    // 事前insertに失敗しても文字起こし自体は継続する（ベストエフォート、フォールバックは成功時に行う）。
    let transcriptId = null;
    if (hasPlanContext) {
      const { data: preInserted, error: preInsertError } = await getSupabase()
        .from('transcripts')
        .insert({
          user_id: userId,
          filename,
          result: { utterances: [] },
          transcription_status: 'transcribing',
          stt_provider: provider,
          stt_model: sttModel,
          audio_duration_seconds: durationSeconds ?? 0,
        })
        .select('id')
        .single();
      if (preInsertError) {
        console.error('[transcribe] 事前insert失敗:', preInsertError.message);
      } else {
        transcriptId = preInserted?.id ?? null;
      }
    }

    console.log(`文字起こし開始: ${filePath}`);
    let result;
    let sttError = null;
    try {
      // filePath は {uuid}/{ファイル名} 形式。拡張子による変換判定用にファイル名部分を渡す
      result = await transcribe({ audio: audioUrl, language: 'ja', filename });
    } catch (err) {
      sttError = err;
    } finally {
      // 会議データを残さない方針：成功・失敗を問わず即削除。
      // Vercelはレスポンス後に実行が凍結されるため、必ずawaitしてから応答する
      try {
        await deleteAudio(filePath);
      } catch (err) {
        console.error(`削除失敗 (${filePath}):`, err.message);
      }
      await scheduleAudioDeletion(filePath, uploadedAt);
    }

    if (sttError) {
      if (userId) {
        await recordTranscriptionFailure(transcriptId, buildTranscriptionErrorCode(sttError)).catch(console.error);
      }
      throw sttError;
    }

    console.log(`文字起こし完了: ${filePath} (発言数: ${result.utterances.length}, 音声長: ${result.audioDurationSec}s)`);

    let insertedId = transcriptId;
    if (hasPlanContext) {
      const actualSeconds = Math.ceil(result.audioDurationSec);
      const costEstimate = provider === 'groq' ? Math.round(actualSeconds / 60 * 0.004 * 150) / 100
        : provider === 'amivoice' ? Math.round(actualSeconds / 60 * 0.044 * 100) / 100
        : Math.round(actualSeconds / 60 * 0.007 * 100) / 100;

      if (insertedId) {
        const { error: updateError } = await getSupabase()
          .from('transcripts')
          .update({
            result,
            audio_duration_seconds: actualSeconds,
            stt_cost_estimate: costEstimate,
          })
          .eq('id', insertedId);
        if (updateError) {
          console.error('[transcribe] 結果update失敗:', updateError.message);
        }
      } else {
        // 事前insertが失敗していた場合のフォールバック（従来どおりinsert）
        const { data: inserted } = await getSupabase()
          .from('transcripts')
          .insert({
            user_id: userId,
            filename,
            result,
            transcription_status: 'transcribing',
            stt_provider: provider,
            stt_model: sttModel,
            audio_duration_seconds: actualSeconds,
            stt_cost_estimate: costEstimate,
          })
          .select('id')
          .single();
        insertedId = inserted?.id ?? null;
      }

      await recordTranscriptionSuccess(userId, insertedId, actualSeconds).catch(console.error);
    }

    if (!userId && guestId) {
      const usedSec = result.audioDurationSec ?? durationSeconds ?? 0;
      await getSupabase()
        .from('guest_usage')
        .upsert({
          guest_id: guestId,
          transcribe_count: 1,
          used_seconds: usedSec,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'guest_id' });
    }

    // piggyback掃除：削除に失敗した過去ファイルの残骸を回収（同上の理由でawait）
    try {
      await cleanupOldFiles();
    } catch (err) {
      console.error('クリーンアップ失敗:', err.message);
    }

    res.json({ ...result, transcriptId: insertedId });
  } catch (err) {
    next(err);
  }
});

export default router;
