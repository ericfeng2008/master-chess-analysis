export function pawnScoreToWhiteShare(evaluation: number): number {
  if (!Number.isFinite(evaluation)) {
    return 50;
  }

  return Math.min(100, Math.max(0, 50 + 50 * Math.tanh(evaluation / 4)));
}
