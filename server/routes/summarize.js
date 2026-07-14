import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { optionalAuth } from '../middleware/auth.js';
import { getSummaryMode, getEntitlement, getVisibleMeetings } from '../services/plan.js';
import { getSupabase } from '../services/storage.js';

const router = express.Router();

const PROMPTS = {
  bullets: `以下は会議の文字起こしです。
次の2点を箇条書きで出力してください。

## 決定事項
- （決まったことを箇条書き）

## アクションアイテム
- （誰が・何をするかを箇条書き。担当者が不明な場合は「要確認」とする）

担当者名は文字起こしに登場する話者名をそのまま使うこと。
余計な前置きや後書きは不要。
音声品質や文字起こし精度へのコメントは一切出力しないこと。
抽出できる情報が少ない場合も、取れた情報だけで出力すること。
補足・免責・品質評価の文言は禁止。`,

  minutes: `以下は会議の文字起こしです。
次の形式で議事録を出力してください。

## 概要
（会議全体を2〜3文で要約）

## 主な議題と議論
（話題ごとに見出しを立てて要点をまとめる）

## 決定事項
- （箇条書き）

## 次のアクション
- （担当者：タスク内容）

担当者名は文字起こしに登場する話者名をそのまま使うこと。
余計な前置きや後書きは不要。
音声品質や文字起こし精度へのコメントは一切出力しないこと。
抽出できる情報が少ない場合も、取れた情報だけで出力すること。
補足・免責・品質評価の文言は禁止。`,

  preview: `以下は会議の文字起こしです。
次の形式でAI要約プレビューを出力してください。

## AI要約プレビュー

この会議では、（会議の内容を1文で）について話されています。
決まったこと：（決定事項が1件あれば記載。なければ「明確な決定事項は確認できませんでした」）
次にやること：（アクションアイテムが1件あれば記載。なければ「明確なアクションは確認できませんでした」）

担当者名は文字起こしに登場する話者名をそのまま使うこと。
余計な前置きや後書きは不要。
音声品質や文字起こし精度へのコメントは一切出力しないこと。
補足・免責・品質評価の文言は禁止。
決定事項やアクションが見当たらない場合は、無理に作らず固定文言を使うこと。`,
};

const LOCKED_SECTIONS = {
  bullets: {
    sections: ['全文のAI要約', '決定事項の詳細', 'アクションアイテム', 'エクスポート'],
    upgradeMessage: '全文のAI要約・TODO整理はSaidLog Plusで利用できます',
  },
  minutes: {
    sections: ['詳しい議事録', '主な議題と議論', '決定事項', '次のアクション', 'エクスポート'],
    upgradeMessage: '詳しい議事録・エクスポートはSaidLog Plusで利用できます',
  },
};

const MIN_UTTERANCE_LENGTH = 100; // 文字数が少なすぎる場合はunavailable
const MIN_SUMMARY_LENGTH = 10; // 生成された要約本文の最低文字数（異常な空応答の検出用）

/**
 * Anthropic APIを呼び出し、生成テキストを返す。
 * SDKクライアント生成をこの関数に閉じ込めることで、
 * テストで `@anthropic-ai/sdk` をモックし呼び出し回数・応答内容を直接検証できるようにする
 * （tests/summarizeGeneration.test.mjs 参照）。
 */
export async function callAnthropic({ apiKey, prompt, transcript }) {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n---\n${transcript}`,
      },
    ],
  });
  return message.content[0]?.text;
}

/**
 * フルAI要約トライアルのフラグ更新。
 * 要約本文の保存が確認できた場合（新規保存 or 既存キャッシュ確認）にのみ呼ぶこと。
 */
async function markFullSummaryUsed(supabase, userId) {
  try {
    await supabase
      .from('profiles')
      .upsert({ id: userId, full_summary_used: true }, { onConflict: 'id' });
  } catch (e) {
    console.error('profiles upsert error:', e);
  }
}

router.post('/summarize', optionalAuth, async (req, res, next) => {
  try {
    const {
      utterances,
      template = 'bullets',
      names = {},
      userChoseFullTrial = false,
      audioDurationSec = 0,
      transcriptId = null,
    } = req.body;
    const userId = req.userId;

    if (!utterances || utterances.length === 0) {
      return res.status(400).json({ error: '文字起こしデータがありません' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' });
    }

    const transcript = utterances
      .map((u) => `${names[u.speaker] ?? `話者${u.speaker}`}：${u.text}`)
      .join('\n');

    // 文字数が少なすぎる場合はunavailable
    if (transcript.length < MIN_UTTERANCE_LENGTH) {
      return res.json({
        summaryType: 'unavailable',
        reason: 'too_short',
        message: 'AI要約にはもう少し内容が必要です',
        subMessage: '録音内容が短いため、決定事項やTODOを十分に整理できませんでした',
      });
    }

    const summaryMode = userId
      ? await getSummaryMode(userId, null, audioDurationSec, userChoseFullTrial)
      : 'preview';

    const supabase = getSupabase();

    // userId・transcriptIdがある場合、所有者検証・履歴範囲チェック・キャッシュ確認の対象とする
    // （所有者検証はAnthropic呼び出しより前に行い、他人のtranscriptIdは弾く）
    if (userId && transcriptId) {
      const { data: owned, error: ownerError } = await supabase
        .from('transcripts')
        .select('id')
        .eq('id', transcriptId)
        .eq('user_id', userId)
        .maybeSingle();

      if (ownerError || !owned) {
        return res.status(404).json({ error: '文字起こしデータが見つかりません' });
      }

      // プラン失効後の閲覧方針：無料プランでは「現在の履歴表示範囲」内のtranscriptのみ
      // full要約の閲覧・生成対象とする（history.jsの可視範囲ロジックをそのまま再利用し、
      // 新しい認可ルールを増やさない）。Plus在籍中は範囲制限なし。
      const { planId } = await getEntitlement(userId);
      let withinHistoryWindow = true;
      if (planId === 'ume') {
        const visibleLimit = await getVisibleMeetings(userId);
        const { data: visibleRows } = await supabase
          .from('transcripts')
          .select('id')
          .eq('user_id', userId)
          .or('transcription_status.eq.completed,transcription_status.is.null')
          .order('created_at', { ascending: false })
          .limit(visibleLimit);
        withinHistoryWindow = (visibleRows ?? []).some((r) => r.id === transcriptId);
      }

      if (!withinHistoryWindow) {
        return res.status(403).json({ error: '無料プランの履歴表示範囲外のため閲覧できません' });
      }

      // キャッシュ確認：トライアル消費状態や現在のsummaryModeに関わらず、
      // 既に生成済みのfull要約は履歴範囲内である限り再閲覧できる
      // （無料トライアルで生成した1件も、トライアル消費後にpreview扱いへ落ちて
      //   読めなくなることがないようにするため）。
      const { data: cachedRow } = await supabase
        .from('transcript_full_summaries')
        .select('summary_full')
        .eq('transcript_id', transcriptId)
        .eq('user_id', userId)
        .eq('template', template)
        .maybeSingle();

      if (cachedRow?.summary_full) {
        if (userChoseFullTrial === true) {
          await markFullSummaryUsed(supabase, userId);
        }
        return res.json({ summary: cachedRow.summary_full, summaryType: 'full', cached: true });
      }

      if (summaryMode === 'full') {
        // キャッシュなし → 生成
        const prompt = PROMPTS[template] ?? PROMPTS.bullets;
        const generated = await callAnthropic({ apiKey, prompt, transcript });
        const trimmed = typeof generated === 'string' ? generated.trim() : '';

        // 生成結果の検証：文字列型・trim後非空・最低文字数を満たさない場合は保存せず失敗として扱う
        if (typeof generated !== 'string' || trimmed.length < MIN_SUMMARY_LENGTH) {
          console.error('[summarize] full要約の生成結果が不正なため保存をスキップしました');
          return res.status(502).json({ error: 'AI要約の生成に失敗しました。時間をおいて再度お試しください' });
        }

        // 競合しない保存（INSERT ... ON CONFLICT DO NOTHING相当）。
        // 同時リクエストで既に保存済みの場合は自分の生成結果を破棄し、既存行を正本として使う。
        const { data: insertedRow, error: insertError } = await supabase
          .from('transcript_full_summaries')
          .upsert(
            {
              transcript_id: transcriptId,
              user_id: userId,
              template,
              summary_full: generated,
            },
            { onConflict: 'transcript_id,template', ignoreDuplicates: true }
          )
          .select('summary_full')
          .maybeSingle();

        let finalSummary = generated;
        let persisted = false;

        if (insertError) {
          console.error('summary保存エラー:', insertError);
        } else if (insertedRow) {
          persisted = true;
        } else {
          // 競合発生：既存行を再取得して正本とする
          const { data: existingRow, error: refetchError } = await supabase
            .from('transcript_full_summaries')
            .select('summary_full')
            .eq('transcript_id', transcriptId)
            .eq('user_id', userId)
            .eq('template', template)
            .maybeSingle();
          if (refetchError) {
            console.error('既存summary再取得エラー:', refetchError);
          } else if (existingRow?.summary_full) {
            finalSummary = existingRow.summary_full;
            persisted = true;
          }
        }

        // summary_typeフラグ更新はベストエフォート（失敗してもレスポンスはブロックしない）
        const { error: typeUpdateError } = await supabase
          .from('transcripts')
          .update({ summary_type: 'full' })
          .eq('id', transcriptId)
          .eq('user_id', userId);
        if (typeUpdateError) console.error('summary_type更新エラー:', typeUpdateError);

        // 保存成功が確認できた場合のみトライアルを消費する
        if (persisted && userChoseFullTrial === true) {
          await markFullSummaryUsed(supabase, userId);
        }

        return res.json({ summary: finalSummary, summaryType: 'full', cached: false });
      }
      // summaryMode !== 'full'（preview等）でキャッシュも無い場合は、
      // ここでreturnせず下の通常フロー（preview生成等）へフォールスルーする
    }

    // ここに到達するのは preview モード（ゲスト含む）、
    // full だが transcriptId が無く永続化できないケース、または
    // 上のブロックでキャッシュが無く summaryMode!=='full' だったフォールスルーケース
    // （いずれも従来どおりの一時生成のみ・transcript_full_summariesへの保存は行わない）
    const prompt = summaryMode === 'full'
      ? (PROMPTS[template] ?? PROMPTS.bullets)
      : PROMPTS.preview;

    const summary = (await callAnthropic({ apiKey, prompt, transcript })) ?? '';

    if (userId && transcriptId && summaryMode === 'preview') {
      try {
        await supabase
          .from('transcripts')
          .update({ summary_preview: summary, summary_type: 'preview' })
          .eq('id', transcriptId)
          .eq('user_id', userId);
      } catch (e) {
        console.error('summary保存エラー:', e);
      }
    }

    if (summaryMode === 'preview') {
      const locked = LOCKED_SECTIONS[template] ?? LOCKED_SECTIONS.bullets;
      return res.json({
        summary,
        summaryType: 'preview',
        lockedSections: locked.sections,
        upgradeMessage: locked.upgradeMessage,
      });
    }

    res.json({ summary, summaryType: summaryMode });
  } catch (err) {
    next(err);
  }
});

export default router;
