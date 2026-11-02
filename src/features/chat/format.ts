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
