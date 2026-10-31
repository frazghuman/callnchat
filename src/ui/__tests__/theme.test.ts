import { darkTheme, lightTheme } from '../theme';

describe('theme', () => {
  it('defines the same color tokens for light and dark', () => {
    expect(Object.keys(darkTheme.colors).sort()).toEqual(Object.keys(lightTheme.colors).sort());
  });

  it('uses a 4pt spacing scale', () => {
    expect(lightTheme.spacing(3)).toBe(12);
  });
});
