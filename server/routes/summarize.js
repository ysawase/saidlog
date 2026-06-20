import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { optionalAuth } from '../middleware/auth.js';
import { getSummaryMode } from '../services/plan.js';
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
    upgradeMessage: '全文のAI要約・TODO整理は竹プランで利用できます',
  },
  minutes: {
    sections: ['詳しい議事録', '主な議題と議論', '決定事項', '次のアクション', 'エクスポート'],
    upgradeMessage: '詳しい議事録・エクスポートは竹プランで利用できます',
  },
};

const MIN_UTTERANCE_LENGTH = 100; // 文字数が少なすぎる場合はunavailable

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

    const prompt = summaryMode === 'full'
      ? (PROMPTS[template] ?? PROMPTS.bullets)
      : PROMPTS.preview;

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

    const summary = message.content[0]?.text ?? '';

    // DB保存
    if (userId && transcriptId) {
      try {
        if (summaryMode === 'full') {
          await getSupabase()
            .from('transcripts')
            .update({ summary_type: 'full' })
            .eq('id', transcriptId)
            .eq('user_id', userId);
        } else if (summaryMode === 'preview') {
          await getSupabase()
            .from('transcripts')
            .update({ summary_preview: summary, summary_type: 'preview' })
            .eq('id', transcriptId)
            .eq('user_id', userId);
        }
      } catch (e) {
        console.error('summary保存エラー:', e);
      }
    }

    // フルAI要約トライアルのフラグ更新
    if (userId && summaryMode === 'full' && userChoseFullTrial === true) {
      try {
        await getSupabase()
          .from('profiles')
          .upsert({ id: userId, full_summary_used: true }, { onConflict: 'id' });
      } catch (e) {
        console.error('profiles upsert error:', e);
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

router.post('/summarize/full', optionalAuth, async (req, res, next) => {
  try {
    const { transcriptId, template = 'bullets' } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'ログインが必要です' });
    }
    if (!transcriptId) {
      return res.status(400).json({ error: 'transcriptIdが必要です' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' });
    }

    const supabase = getSupabase();

    // 竹プランか確認
    const summaryMode = await getSummaryMode(userId, null, 99999, false);
    if (summaryMode !== 'full') {
      return res.status(403).json({ error: '竹プランが必要です' });
    }

    // 本人のtranscriptか確認・utterances取得
    const { data: transcript, error: transcriptError } = await supabase
      .from('transcripts')
      .select('id, result')
      .eq('id', transcriptId)
      .eq('user_id', userId)
      .single();

    if (transcriptError || !transcript) {
      return res.status(404).json({ error: '文字起こしデータが見つかりません' });
    }

    // 既存のfull summaryがあれば返す
    const { data: existing } = await supabase
      .from('transcript_full_summaries')
      .select('summary_full')
      .eq('transcript_id', transcriptId)
      .eq('template', template)
      .single();

    if (existing?.summary_full) {
      return res.json({ summary: existing.summary_full, summaryType: 'full', cached: true });
    }

    // utterancesから全文要約を生成
    const utterances = transcript.result?.utterances ?? [];
    if (utterances.length === 0) {
      return res.status(400).json({ error: '文字起こしデータがありません' });
    }

    const transcriptText = utterances
      .map((u) => `話者${u.speaker}：${u.text}`)
      .join('\n');

    const prompt = PROMPTS[template] ?? PROMPTS.bullets;

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n${transcriptText}`,
        },
      ],
    });

    const summaryFull = message.content[0]?.text ?? '';

    // transcript_full_summariesに保存
    await supabase
      .from('transcript_full_summaries')
      .upsert(
        {
          transcript_id: transcriptId,
          user_id: userId,
          template,
          summary_full: summaryFull,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'transcript_id,template' }
      );

    // transcripts.summary_typeをfullに更新
    await supabase
      .from('transcripts')
      .update({ summary_type: 'full' })
      .eq('id', transcriptId)
      .eq('user_id', userId);

    res.json({ summary: summaryFull, summaryType: 'full', cached: false });
  } catch (err) {
    next(err);
  }
});

export default router;
