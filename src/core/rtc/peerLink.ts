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

/** Which kinds of network address each side found: tells a code problem from a blocked network. */
export type LinkDiagnostics = {
  /** host = same network, srflx = public address via STUN, relay = TURN. */
  local: string[];
  remote: string[];
  reason: 'closed' | 'failed' | 'timeout';
  /** How far setup got: no answer at all points at signaling, not the network. */
  stage: 'signaling' | 'connecting' | 'open';
};

/** Max wait for local candidates before sending the description anyway (late ones trickle). */
const GATHER_TIMEOUT_MS = 3_000;
/** Candidates for attempts we haven't seen the offer of yet (relays can reorder events). */
const EARLY_SIDS = 4;

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
  onClose: (reason: 'closed' | 'failed' | 'timeout', diagnostics: LinkDiagnostics) => void;
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
  private earlyCandidates = new Map<string, IceCandidate[]>();
  private hasRemote = false;
  /** Our description went out; candidates found after that are trickled. */
  private described = false;
  private stage: LinkDiagnostics['stage'] = 'signaling';
  private localTypes = new Set<string>();
  private remoteTypes = new Set<string>();
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
          collectTypes(signal.sdp, this.remoteTypes);
          this.stage = 'connecting';
          await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          await this.remoteReady();
          return;
        case 'ice':
          if (!signal.candidate) return;
          if (signal.sid !== this.sid) {
            // Possibly for an offer that hasn't arrived yet: keep it until it does.
            if (!this.options.initiator) this.holdEarly(signal.sid, signal.candidate);
            return;
          }
          collectTypes(signal.candidate.candidate, this.remoteTypes);
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
    await this.describe(pc, 'offer');
  }

  private async answer(sid: string, sdp: string) {
    // A new offer replaces any earlier attempt.
    this.teardown();
    this.sid = sid;
    const pc = this.createConnection();
    this.pendingCandidates = this.earlyCandidates.get(sid) ?? [];
    this.earlyCandidates.clear();
    for (const c of this.pendingCandidates) collectTypes(c.candidate, this.remoteTypes);
    collectTypes(sdp, this.remoteTypes);
    this.stage = 'connecting';
    pc.addEventListener('datachannel', ({ channel }) => this.attachChannel(channel));
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await this.remoteReady();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.describe(pc, 'answer');
  }

  /**
   * Sends our description with the candidates gathered so far baked in, as one message: relays
   * may deliver separate candidate messages before the offer, or drop some under rate limits.
   */
  private async describe(pc: PeerConnectionLike, kind: 'offer' | 'answer') {
    await gathered(pc, GATHER_TIMEOUT_MS);
    if (pc !== this.pc || !this.sid) return;
    const sdp = pc.localDescription?.sdp;
    if (sdp) collectTypes(sdp, this.localTypes);
    this.described = true;
    this.options.sendSignal({ sid: this.sid, kind, sdp });
  }

  private holdEarly(sid: string, candidate: IceCandidate) {
    const list = this.earlyCandidates.get(sid) ?? [];
    if (!this.earlyCandidates.has(sid)) {
      if (this.earlyCandidates.size >= EARLY_SIDS) {
        this.earlyCandidates.delete(this.earlyCandidates.keys().next().value!);
      }
      this.earlyCandidates.set(sid, list);
    }
    if (list.length < 50) list.push(candidate);
  }

  private createConnection(): PeerConnectionLike {
    const pc = this.options.rtc({ iceServers: this.options.iceServers });
    this.pc = pc;
    this.hasRemote = false;
    this.described = false;
    this.pendingCandidates = [];
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (!candidate || pc !== this.pc || !this.sid) return;
      collectTypes(candidate.candidate, this.localTypes);
      // Before the description goes out, candidates ride inside it.
      if (!this.described) return;
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
      this.stage = 'open';
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
    this.timer = setTimeout(() => this.finish('timeout'), this.options.connectTimeoutMs ?? 30_000);
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
    this.options.onClose(reason, {
      local: [...this.localTypes].sort(),
      remote: [...this.remoteTypes].sort(),
      reason,
      stage: this.stage,
    });
  }
}

function collectTypes(sdpOrCandidate: string, into: Set<string>) {
  for (const match of sdpOrCandidate.matchAll(/ typ (host|srflx|prflx|relay)/g))
    into.add(match[1]!);
}

/** Resolves once ICE gathering completes or after `timeoutMs`, whichever is first. */
function gathered(pc: PeerConnectionLike, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function newSid(): string {
  return bytesToHex(randomBytes(8));
}
