const MESSAGES = {
  'auth-missing': 'not signed in on this account',
  'auth-expired': 'sign-in expired · use Claude Code on this account to renew it',
  'auth-rejected': 'sign-in rejected by the provider',
  'rate-limited': 'rate-limited by the provider',
  timeout: 'timed out',
  network: 'network unreachable',
  malformed: 'unexpected response',
  unavailable: 'unavailable',
}

export class SourceError extends Error {
  constructor(kind, detail = null, retryAt = null) {
    const base = MESSAGES[kind] ?? MESSAGES.unavailable
    super(detail ? `${base} · ${detail}` : base)
    this.kind = MESSAGES[kind] ? kind : 'unavailable'
    this.retryAt = retryAt
  }

  toJSON() {
    return this.retryAt ? { kind: this.kind, message: this.message, retryAt: this.retryAt } : { kind: this.kind, message: this.message }
  }
}

export function toSourceError(err) {
  if (err instanceof SourceError) return err
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new SourceError('timeout')
  if (err?.code === 'ENOENT') return new SourceError('unavailable', 'command or file missing')
  if (err instanceof TypeError && /fetch/i.test(err.message)) return new SourceError('network')
  return new SourceError('unavailable')
}
