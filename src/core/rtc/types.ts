/**
 * The slice of the W3C WebRTC API the app uses, so the same code runs on react-native-webrtc
 * (phone) and @roamhq/wrtc (tests).
 */

export type SessionDescription = { type: 'offer' | 'answer'; sdp: string };

export type IceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

export type IceServer = { urls: string | string[] };

export interface DataChannelLike {
  readonly readyState: string;
  binaryType: string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(): void;
  addEventListener(
    type: 'open' | 'close' | 'error' | 'bufferedamountlow',
    listener: () => void,
  ): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface PeerConnectionLike {
  readonly connectionState: string;
  readonly localDescription: { type: string; sdp: string } | null;
  createDataChannel(label: string, init?: { ordered?: boolean }): DataChannelLike;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(description: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(description: SessionDescription): Promise<void>;
  addIceCandidate(candidate: IceCandidate): Promise<void>;
  close(): void;
  addEventListener(
    type: 'icecandidate',
    listener: (event: { candidate: IceCandidate | null }) => void,
  ): void;
  addEventListener(type: 'connectionstatechange', listener: () => void): void;
  addEventListener(
    type: 'datachannel',
    listener: (event: { channel: DataChannelLike }) => void,
  ): void;
}

export type RtcFactory = (config: { iceServers: IceServer[] }) => PeerConnectionLike;

/** Free public STUN servers. No TURN relay: networks that block direct paths can't transfer files. */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
