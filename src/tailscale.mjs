import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const TIMEOUT_MS = 10000

function normalizePeer(peer) {
  return {
    hostName: peer.HostName || peer.DNSName || 'peer',
    os: peer.OS ?? null,
    online: Boolean(peer.Online),
    active: Boolean(peer.Active),
    relay: peer.Relay || null,
    curAddr: peer.CurAddr || null,
    lastSeen: peer.LastSeen && !peer.LastSeen.startsWith('0001-01-01') ? peer.LastSeen : null,
    rxBytes: peer.RxBytes ?? 0,
    txBytes: peer.TxBytes ?? 0,
  }
}

// `tailscale status --json` exits non-zero when the backend is down but still
// prints the last known state, so salvage stdout instead of failing outright.
export async function readTailscale() {
  let stdout
  try {
    ;({ stdout } = await exec('tailscale', ['status', '--json'], {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    }))
  } catch (err) {
    if (err.stdout) stdout = err.stdout
    else throw new Error(`tailscale status failed: ${err.message}`)
  }

  let json
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new Error('tailscale did not return JSON')
  }

  const self = json.Self ?? {}
  const peers = Object.values(json.Peer ?? {})
    .map(normalizePeer)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.hostName.localeCompare(b.hostName))

  return {
    backendState: json.BackendState ?? null,
    running: json.BackendState === 'Running',
    self: {
      hostName: self.HostName ?? null,
      dnsName: (self.DNSName ?? '').replace(/\.$/, '') || null,
      tailscaleIps: self.TailscaleIPs ?? [],
      os: self.OS ?? null,
    },
    peers,
  }
}
