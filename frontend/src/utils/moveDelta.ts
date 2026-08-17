export function formatMoveDelta(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (rounded === 0 || Object.is(rounded, -0)) {
    return "0.00";
  }
  return rounded.toFixed(2);
}
