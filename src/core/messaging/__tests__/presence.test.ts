import { ONLINE_WINDOW_MS, PresenceTracker, TYPING_SHOW_MS } from '../presence';

describe('PresenceTracker', () => {
  it('starts offline with the persisted last-seen time', () => {
    expect(new PresenceTracker(123).current(1_000)).toEqual({ state: 'offline', lastSeen: 123 });
  });

  it('is online after a heartbeat and goes offline after the window', () => {
    const p = new PresenceTracker(null);
    p.heartbeat(1_000);
    expect(p.current(1_000 + ONLINE_WINDOW_MS - 1)).toEqual({ state: 'online', typing: false });
    expect(p.current(1_000 + ONLINE_WINDOW_MS)).toEqual({ state: 'offline', lastSeen: 1_000 });
    expect(p.nextChangeAt(1_000)).toBe(1_000 + ONLINE_WINDOW_MS);
  });

  it('goes offline immediately on an explicit offline frame', () => {
    const p = new PresenceTracker(null);
    p.heartbeat(1_000);
    p.wentOffline(2_000);
    expect(p.current(2_001)).toEqual({ state: 'offline', lastSeen: 2_000 });
    expect(p.nextChangeAt(2_001)).toBeNull();
  });

  it('shows typing briefly, and clears it when the message arrives', () => {
    const p = new PresenceTracker(null);
    p.typing(1_000);
    expect(p.current(1_000 + TYPING_SHOW_MS - 1)).toEqual({ state: 'online', typing: true });
    expect(p.current(1_000 + TYPING_SHOW_MS)).toEqual({ state: 'online', typing: false });

    p.typing(10_000);
    p.messageReceived();
    expect(p.current(10_001)).toEqual({ state: 'online', typing: false });
  });
});
