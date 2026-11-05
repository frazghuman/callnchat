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
