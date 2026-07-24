/** accountStatusのplanId('ume'|'take')をイベント用plan_stateに変換する。 */
export function planStateFromPlanId(planId) {
  if (planId === 'take') return 'plus';
  if (planId === 'ume') return 'free';
  return 'unknown';
}
