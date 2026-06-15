export const PLANS = {
  ume: {
    id: 'ume',
    name: '梅',
    monthlySeconds: 10800,
    historyLimit: 3,
    canExport: false,
    fullSummary: 'trial_only',
  },
  take: {
    id: 'take',
    name: '竹',
    monthlySeconds: 10 * 60 * 60,
    historyLimit: 30,
    canExport: true,
    fullSummary: 'unlimited',
  },
};
