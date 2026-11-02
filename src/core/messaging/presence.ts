export const HEARTBEAT_MS = 20_000;
/** Peer counts as online while its last heartbeat is younger than this (2.5 beats). */
export const ONLINE_WINDOW_MS = 50_000;
export const TYPING_SEND_INTERVAL_MS = 3_000;
export const TYPING_SHOW_MS = 5_000;

export type PeerPresence =
  { state: 'online'; typing: boolean } | { state: 'offline'; lastSeen: number | null };

/** Pure presence/typing model for the peer, driven by received frames and the clock. */
export class PresenceTracker {
  private lastBeat: number | null = null;
  private lastTyping: number | null = null;

  constructor(private lastSeen: number | null) {}

  heartbeat(at: number) {
    this.lastBeat = at;
    this.lastSeen = at;
  }

  wentOffline(at: number) {
    this.lastBeat = null;
    this.lastTyping = null;
    this.lastSeen = at;
  }

  typing(at: number) {
    this.heartbeat(at);
    this.lastTyping = at;
  }

  /** A message arrived: whatever they were typing has been sent. */
  messageReceived() {
    this.lastTyping = null;
  }

  current(now: number): PeerPresence {
    if (this.lastBeat !== null && now - this.lastBeat < ONLINE_WINDOW_MS) {
      const typing = this.lastTyping !== null && now - this.lastTyping < TYPING_SHOW_MS;
      return { state: 'online', typing };
    }
    return { state: 'offline', lastSeen: this.lastSeen };
  }

  /** When the presence shown for `now` will change on its own, so the UI can re-check then. */
  nextChangeAt(now: number): number | null {
    const times: number[] = [];
    if (this.lastBeat !== null) times.push(this.lastBeat + ONLINE_WINDOW_MS);
    if (this.lastTyping !== null) times.push(this.lastTyping + TYPING_SHOW_MS);
    const future = times.filter((t) => t > now);
    return future.length ? Math.min(...future) : null;
  }

  get lastSeenAt(): number | null {
    return this.lastSeen;
  }
}
