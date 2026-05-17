import { Chess } from 'chess.js';

const cache = new WeakMap<readonly string[], Map<string, string[]>>();

export function bestLineFens(startFen: string, line: readonly string[]): string[] {
  let byFen = cache.get(line);
  if (byFen) {
    const cached = byFen.get(startFen);
    if (cached) {
      return cached;
    }
  }

  const fens: string[] = [];
  const chess = new Chess(startFen);

  for (const san of line) {
    const result = chess.move(san);
    if (!result) {
      break;
    }
    fens.push(chess.fen());
  }

  if (!byFen) {
    byFen = new Map();
    cache.set(line, byFen);
  }

  byFen.set(startFen, fens);
  return fens;
}
