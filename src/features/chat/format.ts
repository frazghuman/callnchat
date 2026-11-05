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
