import {
  explainLinkFailure,
  formatBytes,
  formatDuration,
  formatLastSeen,
  presenceLabel,
  transferLabel,
} from '../format';

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

describe('transferLabel', () => {
  const base = {
    direction: 'in' as const,
    size: 1000,
    bytes: 0,
    peerOnline: true,
    unreachable: false,
    peerName: 'Bob',
  };

  it('says nothing once a file is done, and explains waiting and failure', () => {
    expect(transferLabel({ ...base, state: 'done' })).toBeNull();
    expect(transferLabel({ ...base, state: 'pending', peerOnline: false })).toBe(
      'Downloads when Bob opens the app',
    );
    expect(transferLabel({ ...base, direction: 'out', state: 'pending', peerOnline: false })).toBe(
      'Sends when Bob opens the app',
    );
    expect(transferLabel({ ...base, state: 'failed' })).toBe("Couldn't download this file");
    expect(transferLabel({ ...base, state: 'pending', unreachable: true })).toMatch(/directly/);
  });

  it('shows progress, never 100% before the hash check', () => {
    expect(transferLabel({ ...base, state: 'active', bytes: 450 })).toBe('Downloading 45%');
    expect(transferLabel({ ...base, state: 'active', bytes: 1000 })).toBe('Downloading 99%');
    expect(transferLabel({ ...base, direction: 'out', state: 'pending', bytes: 100 })).toBe(
      'Sending 10%',
    );
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2_500)).toBe('2 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
    expect(formatDuration(65_400)).toBe('1:05');
  });
});

describe('explainLinkFailure', () => {
  it('separates a silent peer from a network that blocks direct paths', () => {
    expect(explainLinkFailure({ local: ['host'], remote: [], stage: 'signaling' }, 'Bob')).toMatch(
      /didn't answer/,
    );
    const blocked = explainLinkFailure(
      { local: ['host', 'srflx'], remote: ['srflx'], stage: 'connecting' },
      'Bob',
    );
    expect(blocked).toMatch(/Your phone found: local network, public address\./);
    expect(blocked).toMatch(/TURN relay in Settings/);
  });
});
