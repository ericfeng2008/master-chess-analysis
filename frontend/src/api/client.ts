import type { PositionEvalResult } from '../types'

const API_BASE = 'http://localhost:8099'

type ApiErrorPayload = {
  detail?: string
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: res.statusText }))) as ApiErrorPayload
    throw new Error(err.detail ?? 'Request failed')
  }

  return (await res.json()) as T
}

export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: res.statusText }))) as ApiErrorPayload
    throw new Error(err.detail ?? 'Request failed')
  }

  return (await res.json()) as T
}

export function ssePost(
  path: string,
  body: unknown,
  onMessage: (data: unknown) => void,
  onError: (err: Error) => void,
  onDone?: () => void,
): AbortController {
  const controller = new AbortController()

  fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ detail: res.statusText }))) as ApiErrorPayload
        throw new Error(err.detail ?? 'Request failed')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          const dataLine = chunk
            .split('\n')
            .find((line) => line.startsWith('data: '))

          if (!dataLine) continue
          const json = JSON.parse(dataLine.slice(6)) as unknown
          onMessage(json)
        }
      }

      if (buffer.trim()) {
        const dataLine = buffer
          .split('\n')
          .find((line) => line.startsWith('data: '))
        if (dataLine) {
          const json = JSON.parse(dataLine.slice(6)) as unknown
          onMessage(json)
        }
      }

      onDone?.()
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return
      onError(err instanceof Error ? err : new Error(String(err)))
    })

  return controller
}

export async function evaluatePosition(
  fen: string,
  depth: number = 12,
  acceptableDrop: number = 0.5,
): Promise<PositionEvalResult> {
  return apiPost<PositionEvalResult>('/api/evaluate-position', {
    fen,
    depth,
    acceptable_drop: acceptableDrop,
  })
}
