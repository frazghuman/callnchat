import { RTCIceCandidate, RTCPeerConnection } from 'react-native-webrtc';

import type { PeerConnectionLike, RtcFactory } from '@/core/rtc/types';

/** react-native-webrtc behind the app's small WebRTC interface. */
export const nativeRtc: RtcFactory = (config) => {
  const pc = new RTCPeerConnection(config);
  const like = pc as unknown as PeerConnectionLike;
  return Object.assign(like, {
    // react-native-webrtc wants its own candidate class rather than a plain init object.
    addIceCandidate: (candidate: Parameters<PeerConnectionLike['addIceCandidate']>[0]) =>
      pc.addIceCandidate(new RTCIceCandidate(candidate)),
  });
};
