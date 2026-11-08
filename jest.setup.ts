// Reanimated 4's own mock fails under Jest (its JS fallback lacks setCSSEventHandler), so the only
// Reanimated-backed component we use is replaced by a pass-through. Swipe gestures aren't unit-tested.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: forwardRef(function Swipeable(props: { children?: import('react').ReactNode }, _ref) {
      return props.children;
    }),
  };
});

// Native-only modules the chat screen imports. Screen tests run without the direct file link
// (transfer: null), so these only need to load.
jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: jest.fn(),
  RTCIceCandidate: jest.fn(),
}));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: View, Marker: View };
});
jest.mock('expo-audio', () => {
  const player = {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    setPlaybackRate: jest.fn(),
  };
  return {
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    useAudioRecorder: () => ({
      prepareToRecordAsync: jest.fn(async () => undefined),
      record: jest.fn(),
      stop: jest.fn(async () => undefined),
      uri: null,
    }),
    useAudioPlayer: () => player,
    useAudioPlayerStatus: () => ({
      playing: false,
      currentTime: 0,
      duration: 0,
      didJustFinish: false,
    }),
  };
});
