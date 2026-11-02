import { formatLastSeen, presenceLabel } from '../format';

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();

describe('presenceLabel', () => {
  const now = at(2026, 11, 2, 15, 0);

  it('prefers connecting, then typing, then online', () => {
    expect(presenceLabel({ state: 'online', typing: true }, 0, now)).toBe('connecting…');
    expect(presenceLabel({ state: 'online', typing: true }, 2, now)).toBe('typing…');
    expect(presenceLabel({ state: 'online', typing: false }, 1, now)).toBe('online');
    expect(presenceLabel({ state: 'offline', lastSeen: null }, 1, now)).toBe('');
  });

  it('formats last seen relative to today', () => {
    expect(formatLastSeen(at(2026, 11, 2, 9, 5), now)).toBe('last seen today at 09:05');
    expect(formatLastSeen(at(2026, 11, 1, 23, 59), now)).toBe('last seen yesterday at 23:59');
    expect(formatLastSeen(at(2026, 10, 28, 7, 30), now)).toBe('last seen 28 Oct at 07:30');
  });
});
