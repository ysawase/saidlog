import express from 'express';
import rateLimit from 'express-rate-limit';
import { isEmailRegistered } from '../services/supabaseAdmin.js';

const router = express.Router();

// 1分間に同一IPから10回まで。総当たりでの登録メール調査を防ぐための簡易対策。
const checkEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。しばらくしてから再試行してください' },
});

router.post('/auth/check-email', checkEmailLimiter, async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    const exists = await isEmailRegistered(email);
    res.json({ exists });
  } catch (err) {
    next(err);
  }
});

export default router;
