import { bytesToHex, randomBytes } from '@/core/crypto/bytes';
import type { RtcFrame } from '@/core/protocol/frames';

import type {
  DataChannelLike,
  IceCandidate,
  IceServer,
  PeerConnectionLike,
  RtcFactory,
} from './types';

export type Signal = Omit<RtcFrame, 't'>;

export type PeerLinkOptions = {
  rtc: RtcFactory;
  iceServers: IceServer[];
  /**
   * Exactly one side makes offers (the lower public key), so both phones never offer at once.
   * The other side asks for a connection with a `want` signal.
   */
  initiator: boolean;
  sendSignal: (signal: Signal) => void;
  onOpen: (channel: DataChannelLike) => void;
  /** Connection closed, failed or timed out. */
  onClose: (reason: 'closed' | 'failed' | 'timeout') => void;
  connectTimeoutMs?: number;
};

const CHANNEL_LABEL = 'files';

/**
 * One WebRTC connection with a single ordered, reliable data channel. Signaling travels as
 * sealed Nostr frames, so the DTLS fingerprints in the SDP are authenticated by our identity keys.
 */
export class PeerLink {
  private pc: PeerConnectionLike | null = null;
  private channel: DataChannelLike | null = null;
  private sid: string | null = null;
  private pendingCandidates: IceCandidate[] = [];
  private hasRemote = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  constructor(private readonly options: PeerLinkOptions) {}

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** Initiator: makes an offer. Other side: asks the initiator to make one. */
  start() {
    this.armTimeout();
    if (this.options.initiator) void this.offer();
    else this.options.sendSignal({ sid: newSid(), kind: 'want' });
  }

  async handleSignal(signal: Signal) {
    if (this.done) return;
    try {
      switch (signal.kind) {
        case 'want':
          if (this.options.initiator && !this.pc) {
            this.armTimeout();
            await this.offer();
          }
          return;
        case 'offer':
          if (this.options.initiator || !signal.sdp) return;
          await this.answer(signal.sid, signal.sdp);
          return;
        case 'answer':
          if (signal.sid !== this.sid || !signal.sdp || !this.pc) return;
          await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          await this.remoteReady();
          return;
        case 'ice':
          if (signal.sid !== this.sid || !signal.candidate) return;
          if (this.hasRemote && this.pc) await this.pc.addIceCandidate(signal.candidate);
          else this.pendingCandidates.push(signal.candidate);
          return;
        case 'bye':
          if (signal.sid === this.sid) this.finish('closed');
          return;
      }
    } catch {
      this.finish('failed');
    }
  }

  send(data: string | Uint8Array) {
    this.channel?.send(data);
  }

  close() {
    if (this.sid && !this.done) this.options.sendSignal({ sid: this.sid, kind: 'bye' });
    this.finish('closed');
  }

  private async offer() {
    this.sid = newSid();
    const pc = this.createConnection();
    this.attachChannel(pc.createDataChannel(CHANNEL_LABEL, { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.options.sendSignal({ sid: this.sid, kind: 'offer', sdp: pc.localDescription?.sdp });
  }

  private async answer(sid: string, sdp: string) {
    // A new offer replaces any earlier attempt.
    this.teardown();
    this.sid = sid;
    const pc = this.createConnection();
    pc.addEventListener('datachannel', ({ channel }) => this.attachChannel(channel));
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await this.remoteReady();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.options.sendSignal({ sid, kind: 'answer', sdp: pc.localDescription?.sdp });
  }

  private createConnection(): PeerConnectionLike {
    const pc = this.options.rtc({ iceServers: this.options.iceServers });
    this.pc = pc;
    this.hasRemote = false;
    this.pendingCandidates = [];
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (!candidate || pc !== this.pc || !this.sid) return;
      this.options.sendSignal({
        sid: this.sid,
        kind: 'ice',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        },
      });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed') this.finish('failed');
      if (pc.connectionState === 'closed') this.finish('closed');
    });
    return pc;
  }

  private async remoteReady() {
    this.hasRemote = true;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) await this.pc?.addIceCandidate(candidate);
  }

  private attachChannel(channel: DataChannelLike) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.options.onOpen(channel);
    });
    channel.addEventListener('close', () => {
      if (channel === this.channel) this.finish('closed');
    });
  }

  private armTimeout() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish('timeout'), this.options.connectTimeoutMs ?? 20_000);
  }

  private teardown() {
    const { pc, channel } = this;
    this.pc = null;
    this.channel = null;
    try {
      channel?.close();
    } catch {
      // already closed
    }
    try {
      pc?.close();
    } catch {
      // already closed
    }
  }

  private finish(reason: 'closed' | 'failed' | 'timeout') {
    if (this.done) return;
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.teardown();
    this.options.onClose(reason);
  }
}

function newSid(): string {
  return bytesToHex(randomBytes(8));
}
