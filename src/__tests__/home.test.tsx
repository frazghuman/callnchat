import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

describe('HomeScreen', () => {
  it('shows the unpaired state', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Not paired yet')).toBeTruthy();
  });
});
