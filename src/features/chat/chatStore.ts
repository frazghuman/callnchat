import { create } from 'zustand';

import { bytesToHex } from '@/core/crypto/bytes';
import { Messenger } from '@/core/messaging/messenger';
import type { PeerPresence } from '@/core/messaging/presence';
import { createRelayTransport, DEFAULT_RELAYS } from '@/core/nostr/relayPool';
import { listMessages, type Message } from '@/data/messages';
import type { Session } from '@/features/session/session';

const PAGE_SIZE = 200;

type ChatState = {
  messages: Message[];
  presence: PeerPresence | null;
  connectedRelays: number;
  /** When presence or connection last changed; "last seen today/yesterday" is relative to it. */
  statusAt: number;
  running: boolean;
  /** When the peer proved it added our code too. */
  confirmedAt: number | null;

  start(session: Session): Promise<void>;
  stop(): Promise<void>;
  send(text: string): Promise<void>;
  markRead(): Promise<void>;
  typing(): void;
};

let messenger: Messenger | null = null;
let activeSession: Session | null = null;

export const useChatStore = create<ChatState>((set) => {
  async function reload() {
    if (!activeSession) return;
    set({ messages: await listMessages(activeSession.db, PAGE_SIZE) });
  }

  return {
    messages: [],
    presence: null,
    connectedRelays: 0,
    statusAt: 0,
    running: false,
    confirmedAt: null,

    async start(session) {
      if (messenger || !session.peer || !session.profile) return;
      activeSession = session;
      set({ confirmedAt: session.peer.confirmedAt, running: true });

      messenger = new Messenger(
        {
          transport: createRelayTransport(DEFAULT_RELAYS, session.identity.secretKey),
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

    async send(text) {
      await messenger?.send(text);
    },

    async markRead() {
      await messenger?.markRead();
    },

    typing() {
      messenger?.typing();
    },
  };
});
