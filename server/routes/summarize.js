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
};

router.post('/summarize', optionalAuth, async (req, res, next) => {
  try {
    const {
      utterances,
      template = 'bullets',
      names = {},
      userChoseFullTrial = false,
      audioDurationSec = 0,
    } = req.body;
    const userId = req.userId;

    if (!utterances || utterances.length === 0) {
      return res.status(400).json({ error: '文字起こしデータがありません' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' });
    }

    const summaryMode = userId
      ? await getSummaryMode(userId, null, audioDurationSec, userChoseFullTrial)
      : 'preview';

    const prompt = PROMPTS[template] ?? PROMPTS.bullets;

    const transcript = utterances
      .map((u) => `${names[u.speaker] ?? `話者${u.speaker}`}：${u.text}`)
      .join('\n');

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

    if (userId && summaryMode === 'full' && userChoseFullTrial === true) {
      await getSupabase()
        .from('profiles')
        .update({ full_summary_used: true })
        .eq('id', userId)
        .catch(console.error);
    }

    res.json({ summary, summaryType: summaryMode });
  } catch (err) {
    next(err);
  }
});

export default router;