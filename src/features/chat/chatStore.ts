import { create } from 'zustand';

import { bytesToHex } from '@/core/crypto/bytes';
import { Messenger } from '@/core/messaging/messenger';
import type { PeerPresence } from '@/core/messaging/presence';
import { createRelayTransport, DEFAULT_RELAYS, type RelayTransport } from '@/core/nostr/relayPool';
import { DEFAULT_ICE_SERVERS } from '@/core/rtc/types';
import type { DisappearSeconds } from '@/core/protocol/frames';
import type { LinkStatus, TransferConfig } from '@/core/transfer/transferManager';
import { expoFileStore } from '@/data/expoFileStore';
import { listMessages, searchMessages, type ChatMessage } from '@/data/messages';
import type { PreparedAttachment } from '@/features/attachments/prepare';
import { currentPosition, watchPosition } from '@/features/location/location';
import { nativeRtc } from '@/features/transfer/nativeRtc';
import type { Session } from '@/features/session/session';

export const PAGE_SIZE = 50;
const MAX_JUMP_PAGES = 40;

type ChatState = {
  /** Newest first. */
  messages: ChatMessage[];
  hasMore: boolean;
  presence: PeerPresence | null;
  connectedRelays: number;
  /** When presence or connection last changed; "last seen today/yesterday" is relative to it. */
  statusAt: number;
  running: boolean;
  /** When the peer proved it added our code too. */
  confirmedAt: number | null;
  disappear: DisappearSeconds;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  /** Message to scroll to and flash briefly (from search or a tapped reply quote). */
  highlightId: string | null;
  /** Live bytes moved per attachment while a transfer runs. */
  progress: Record<string, number>;
  linkStatus: LinkStatus;

  /** Overrides are for tests; the app connects to the default relays and uses WebRTC. */
  start(
    session: Session,
    deps?: { transport?: RelayTransport; transfer?: TransferConfig | null },
  ): Promise<void>;
  stop(): Promise<void>;
  loadOlder(): Promise<void>;
  send(text: string): Promise<void>;
  submitEdit(text: string): Promise<void>;
  react(id: string, emoji: string | null): Promise<void>;
  deleteForEveryone(id: string): Promise<void>;
  deleteForMe(id: string): Promise<void>;
  setDisappearing(seconds: DisappearSeconds): Promise<void>;
  sendAttachment(prepared: PreparedAttachment, caption?: string): Promise<void>;
  /** 0 sends a pin; otherwise live location for that many minutes. */
  sendLocation(liveMinutes: number): Promise<void>;
  stopLiveLocation(id: string): Promise<void>;
  fileUri(message: ChatMessage): string | null;
  markRead(): Promise<void>;
  typing(): void;
  search(query: string): Promise<ChatMessage[]>;
  /** Loads history until the message is present; returns false if it can't be found. */
  jumpTo(id: string): Promise<boolean>;
  setReplyTo(message: ChatMessage | null): void;
  setEditing(message: ChatMessage | null): void;
  clearHighlight(): void;
};

let messenger: Messenger | null = null;
let activeSession: Session | null = null;
/** Our running live-location share: position updates are sent while the app is open. */
let liveWatch: { id: string; until: number; sub: { remove(): void } | null } | null = null;

function stopWatching() {
  liveWatch?.sub?.remove();
  liveWatch = null;
}

async function watchLive(id: string, until: number) {
  stopWatching();
  const watch: NonNullable<typeof liveWatch> = { id, until, sub: null };
  liveWatch = watch;
  const sub = await watchPosition((position) => {
    if (!messenger || Date.now() > until) {
      if (liveWatch === watch) stopWatching();
      return;
    }
    void messenger.updateLiveLocation(id, position).then((applied) => {
      if (!applied && liveWatch === watch) stopWatching();
    });
  });
  if (liveWatch === watch) watch.sub = sub;
  else sub.remove();
}

function requireMessenger(): Messenger {
  if (!messenger) throw new Error('Not connected');
  return messenger;
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Reloads the window that is currently loaded, so paging position survives updates. */
  async function reload() {
    if (!activeSession) return;
    const limit = Math.max(PAGE_SIZE, get().messages.length);
    const messages = await listMessages(activeSession.db, limit);
    set({ messages, hasMore: messages.length === limit });
  }

  return {
    messages: [],
    hasMore: false,
    presence: null,
    connectedRelays: 0,
    statusAt: 0,
    running: false,
    confirmedAt: null,
    disappear: 0,
    replyTo: null,
    editing: null,
    highlightId: null,
    progress: {},
    linkStatus: 'idle',

    async start(session, deps = {}) {
      if (messenger || !session.peer || !session.profile) return;
      activeSession = session;
      set({ confirmedAt: session.peer.confirmedAt, running: true });

      messenger = new Messenger(
        {
          transport:
            deps.transport ?? createRelayTransport(DEFAULT_RELAYS, session.identity.secretKey),
          transfer:
            deps.transfer === undefined
              ? { store: expoFileStore, rtc: nativeRtc, iceServers: DEFAULT_ICE_SERVERS }
              : (deps.transfer ?? undefined),
          db: session.db,
          secretKey: session.identity.secretKey,
          publicKeyHex: bytesToHex(session.identity.publicKey),
          profileName: session.profile.displayName,
          peer: {
            publicKeyHex: session.peer.publicKey,
            pairSecretHex: session.peer.pairSecret,
            confirmed: session.peer.confirmedAt !== null,
          },
        },
        {
          messagesChanged: () => void reload(),
          presenceChanged: (presence) => set({ presence, statusAt: Date.now() }),
          connectionChanged: (connectedRelays) => set({ connectedRelays, statusAt: Date.now() }),
          peerConfirmed: (confirmedAt) => set({ confirmedAt }),
          disappearChanged: (disappear) => set({ disappear }),
          transferProgress: (id, bytes) =>
            set((state) => ({ progress: { ...state.progress, [id]: bytes } })),
          linkStatus: (linkStatus) => set({ linkStatus }),
        },
      );
      await reload();
      await messenger.start();

      // Resume our own live location if it is still running.
      const now = Date.now();
      const live = get().messages.find(
        (m) =>
          m.direction === 'out' &&
          m.location?.liveUntil &&
          m.location.liveUntil > now &&
          !m.location.endedAt,
      );
      if (live?.location?.liveUntil) {
        watchLive(live.id, live.location.liveUntil).catch(() => undefined);
      }
    },

    async stop() {
      const current = messenger;
      messenger = null;
      stopWatching();
      set({ running: false, connectedRelays: 0, linkStatus: 'idle' });
      await current?.stop();
      // A quick background → foreground may have started a new messenger meanwhile.
      if (!messenger) activeSession = null;
    },

    async loadOlder() {
      const { messages, hasMore } = get();
      const oldest = messages[messages.length - 1];
      if (!activeSession || !hasMore || !oldest) return;
      const page = await listMessages(activeSession.db, PAGE_SIZE, {
        sentAt: oldest.sentAt,
        id: oldest.id,
      });
      set({ messages: [...get().messages, ...page], hasMore: page.length === PAGE_SIZE });
    },

    async send(text) {
      const replyTo = get().replyTo;
      set({ replyTo: null });
      await requireMessenger().send(text, replyTo?.id);
    },

    async submitEdit(text) {
      const editing = get().editing;
      if (!editing) return;
      set({ editing: null });
      await requireMessenger().edit(editing.id, text);
    },

    async react(id, emoji) {
      await requireMessenger().react(id, emoji);
    },

    async deleteForEveryone(id) {
      await requireMessenger().deleteForEveryone([id]);
    },

    async deleteForMe(id) {
      await requireMessenger().deleteForMe([id]);
    },

    async setDisappearing(seconds) {
      await requireMessenger().setDisappearing(seconds);
    },

    async sendAttachment({ id, attachment }, caption = '') {
      const replyTo = get().replyTo;
      set({ replyTo: null });
      await requireMessenger().sendFile(id, attachment, caption, replyTo?.id);
    },

    async sendLocation(liveMinutes) {
      const position = await currentPosition();
      const replyTo = get().replyTo;
      set({ replyTo: null });
      const liveUntil = liveMinutes > 0 ? Date.now() + liveMinutes * 60_000 : undefined;
      const message = await requireMessenger().sendLocation(
        { ...position, ...(liveUntil ? { liveUntil } : {}) },
        replyTo?.id,
      );
      if (liveUntil) await watchLive(message.id, liveUntil);
    },

    async stopLiveLocation(id) {
      if (liveWatch?.id === id) stopWatching();
      await requireMessenger().stopLiveLocation(id);
    },

    fileUri(message) {
      const file = message.attachment;
      if (!file) return null;
      // Ours are complete from the start; theirs once the transfer finished and verified.
      if (message.direction === 'in' && message.transferState !== 'done') return null;
      return expoFileStore.uri(message.id, file.name);
    },

    async markRead() {
      await messenger?.markRead();
    },

    typing() {
      messenger?.typing();
    },

    async search(query) {
      return activeSession ? searchMessages(activeSession.db, query) : [];
    },

    async jumpTo(id) {
      for (let page = 0; page < MAX_JUMP_PAGES; page++) {
        if (get().messages.some((m) => m.id === id)) {
          set({ highlightId: id });
          return true;
        }
        if (!get().hasMore) return false;
        await get().loadOlder();
      }
      return false;
    },

    setReplyTo(replyTo) {
      set({ replyTo, editing: null });
    },

    setEditing(editing) {
      set({ editing, replyTo: null });
    },

    clearHighlight() {
      set({ highlightId: null });
    },
  };
});
