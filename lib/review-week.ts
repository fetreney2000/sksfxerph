/** A school week ends on Sunday in Malaysia, regardless of the viewer's zone. */
export function isPastReviewWeek(planDate: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) return false;
  const today = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const monday = day - ((today.getUTCDay() + 6) % 7) * 86_400_000;
  return planDate < new Date(monday).toISOString().slice(0, 10);
}
