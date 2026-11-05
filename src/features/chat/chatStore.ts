import { create } from 'zustand';

import { bytesToHex } from '@/core/crypto/bytes';
import { Messenger } from '@/core/messaging/messenger';
import type { PeerPresence } from '@/core/messaging/presence';
import { createRelayTransport, DEFAULT_RELAYS, type RelayTransport } from '@/core/nostr/relayPool';
import type { DisappearSeconds } from '@/core/protocol/frames';
import { listMessages, searchMessages, type ChatMessage } from '@/data/messages';
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

  /** `transport` is for tests; the app connects to the default relays. */
  start(session: Session, transport?: RelayTransport): Promise<void>;
  stop(): Promise<void>;
  loadOlder(): Promise<void>;
  send(text: string): Promise<void>;
  submitEdit(text: string): Promise<void>;
  react(id: string, emoji: string | null): Promise<void>;
  deleteForEveryone(id: string): Promise<void>;
  deleteForMe(id: string): Promise<void>;
  setDisappearing(seconds: DisappearSeconds): Promise<void>;
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

    async start(session, transport) {
      if (messenger || !session.peer || !session.profile) return;
      activeSession = session;
      set({ confirmedAt: session.peer.confirmedAt, running: true });

      messenger = new Messenger(
        {
          transport: transport ?? createRelayTransport(DEFAULT_RELAYS, session.identity.secretKey),
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
        },
      );
      await reload();
      await messenger.start();
    },

    async stop() {
      const current = messenger;
      messenger = null;
      set({ running: false, connectedRelays: 0 });
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
