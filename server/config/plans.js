export const PLANS = {
  ume: {
    id: 'ume',
    name: '梅',
    monthlySeconds: 3600,    // 梅（60分）
    historyLimit: 3,
    canExport: false,
    fullSummary: 'trial_only',
  },
  take: {
    id: 'take',
    name: 'SaidLog Plus',
    monthlySeconds: 10 * 60 * 60,
    historyLimit: 30,
    canExport: true,
    fullSummary: 'unlimited',
  },
};
