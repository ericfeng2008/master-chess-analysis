const STANDARD_TAGS = new Set([
  'Event',
  'Site',
  'Date',
  'Round',
  'White',
  'Black',
  'Result',
  'WhiteElo',
  'BlackElo',
  'WhiteTitle',
  'BlackTitle',
  'ECO',
  'Opening',
  'Variation',
  'TimeControl',
  'Termination',
  'UTCDate',
  'UTCTime',
  'WhiteRatingDiff',
  'BlackRatingDiff',
  'WhiteTeam',
  'BlackTeam',
  'Board',
  'FEN',
  'SetUp',
])

export interface PgnHeaders {
  [key: string]: string
}

export function parsePgnHeaders(pgn: string): PgnHeaders {
  const headers: PgnHeaders = {}
  const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g

  let match: RegExpExecArray | null = null
  while ((match = headerRegex.exec(pgn)) !== null) {
    const [, tag, value] = match
    if (!STANDARD_TAGS.has(tag)) continue
    if (value === '?' || value === '??' || value === '') continue
    headers[tag] = value
  }

  return headers
}
