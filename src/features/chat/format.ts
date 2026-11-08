import type { PeerPresence } from '@/core/messaging/presence';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatLastSeen(lastSeen: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(lastSeen)) / 86_400_000);
  const time = formatTime(lastSeen);
  if (days <= 0) return `last seen today at ${time}`;
  if (days === 1) return `last seen yesterday at ${time}`;
  const d = new Date(lastSeen);
  return `last seen ${d.getDate()} ${MONTHS[d.getMonth()]} at ${time}`;
}

/** Header subtitle, WhatsApp style. */
export function presenceLabel(
  presence: PeerPresence | null,
  connectedRelays: number,
  now: number,
): string {
  if (connectedRelays === 0) return 'connecting…';
  if (!presence) return '';
  if (presence.state === 'online') return presence.typing ? 'typing…' : 'online';
  return presence.lastSeen ? formatLastSeen(presence.lastSeen, now) : '';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Day separator label, WhatsApp style: Today, Yesterday, weekday this week, then the date. */
export function formatDay(ms: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(ms);
  if (days < 7) return WEEKDAYS[d.getDay()]!;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

export function dayKey(ms: number): number {
  return startOfDay(ms);
}

export function disappearLabel(seconds: number): string {
  switch (seconds) {
    case 86_400:
      return '24 hours';
    case 604_800:
      return '7 days';
    case 7_776_000:
      return '90 days';
    default:
      return 'Off';
  }
}

/** Text for a system row (currently only disappearing-timer changes). */
export function systemNoticeText(body: string, peerName: string): string {
  try {
    const notice = JSON.parse(body) as { type: string; seconds: number; by: 'me' | 'peer' };
    if (notice.type !== 'timer') return '';
    const who = notice.by === 'me' ? 'You' : peerName;
    return notice.seconds
      ? `${who} turned on disappearing messages. New messages will disappear ${disappearLabel(notice.seconds)} after they're sent.`
      : `${who} turned off disappearing messages.`;
  } catch {
    return '';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Status line under an attachment that isn't usable yet, or null when there is nothing to say.
 * Files only move while both apps are open, so "waiting" states are spelled out.
 */
export function transferLabel(input: {
  direction: 'in' | 'out';
  state: 'pending' | 'active' | 'done' | 'failed' | null;
  size: number;
  bytes: number;
  peerOnline: boolean;
  unreachable: boolean;
  peerName: string;
}): string | null {
  const { direction, state, size, bytes, peerOnline, unreachable, peerName } = input;
  if (state === null || state === 'done') return null;
  if (state === 'failed') {
    return direction === 'in' ? "Couldn't download this file" : "Couldn't send this file";
  }
  if (!peerOnline) {
    return direction === 'in'
      ? `Downloads when ${peerName} opens the app`
      : `Sends when ${peerName} opens the app`;
  }
  if (unreachable) return "Can't connect directly on this network. Retrying…";
  const percent = size ? Math.min(99, Math.floor((bytes / size) * 100)) : 0;
  if (bytes === 0) return direction === 'in' ? 'Connecting…' : 'Waiting to send…';
  return `${direction === 'in' ? 'Downloading' : 'Sending'} ${percent}%`;
}

const ADDRESS_NAMES: Record<string, string> = {
  host: 'local network',
  srflx: 'public address',
  prflx: 'public address',
  relay: 'TURN relay',
};

function describeAddresses(types: string[]): string {
  const names = [...new Set(types.map((t) => ADDRESS_NAMES[t] ?? t))];
  return names.length ? names.join(', ') : 'nothing';
}

/** Plain-language reason a direct connection failed, from the link's diagnostics. */
export function explainLinkFailure(
  diagnostics: { local: string[]; remote: string[]; stage: string } | null,
  peerName: string,
): string {
  if (!diagnostics) return `Couldn't connect to ${peerName}'s phone yet. Keep both apps open.`;
  if (diagnostics.stage === 'signaling') {
    return (
      `${peerName}'s phone didn't answer the connection request. Both apps must be open at the ` +
      'same time. If they are, try again in a moment.'
    );
  }
  const relay = diagnostics.local.includes('relay') || diagnostics.remote.includes('relay');
  return (
    `Your phone found: ${describeAddresses(diagnostics.local)}. ` +
    `${peerName}'s phone found: ${describeAddresses(diagnostics.remote)}. ` +
    (relay
      ? 'Even the TURN relay could not connect; check its address and password in Settings.'
      : 'No direct path worked, which is common on mobile data or strict Wi-Fi. Putting both ' +
        'phones on the same Wi-Fi usually works, or add a TURN relay in Settings → Connection relay.')
  );
}
