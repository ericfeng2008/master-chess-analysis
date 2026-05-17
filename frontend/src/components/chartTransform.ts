const EVAL_COMPRESS_THRESHOLD = 5

export function evalTransform(x: number): number {
  const threshold = EVAL_COMPRESS_THRESHOLD
  const abs = Math.abs(x)
  if (abs <= threshold) return x
  return Math.sign(x) * (threshold + Math.log(1 + abs - threshold))
}

export function evalInverseTransform(y: number): number {
  const threshold = EVAL_COMPRESS_THRESHOLD
  const abs = Math.abs(y)
  if (abs <= threshold) return y
  return Math.sign(y) * (threshold + Math.exp(abs - threshold) - 1)
}
