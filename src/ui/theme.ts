import { useColorScheme } from 'react-native';

export type ThemeColors = {
  background: string;
  surface: string;
  header: string;
  headerText: string;
  text: string;
  textMuted: string;
  accent: string;
  chatBackground: string;
  bubbleOutgoing: string;
  bubbleIncoming: string;
  tickRead: string;
  online: string;
  separator: string;
};

export type Theme = {
  dark: boolean;
  colors: ThemeColors;
  spacing: (units: number) => number;
  radius: { bubble: number; card: number; pill: number };
  font: { title: number; body: number; caption: number };
};

const light: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F0F2F5',
  header: '#008069',
  headerText: '#FFFFFF',
  text: '#111B21',
  textMuted: '#667781',
  accent: '#25D366',
  chatBackground: '#EFEAE2',
  bubbleOutgoing: '#D9FDD3',
  bubbleIncoming: '#FFFFFF',
  tickRead: '#53BDEB',
  online: '#25D366',
  separator: '#E9EDEF',
};

const dark: ThemeColors = {
  background: '#111B21',
  surface: '#202C33',
  header: '#202C33',
  headerText: '#E9EDEF',
  text: '#E9EDEF',
  textMuted: '#8696A0',
  accent: '#00A884',
  chatBackground: '#0B141A',
  bubbleOutgoing: '#005C4B',
  bubbleIncoming: '#202C33',
  tickRead: '#53BDEB',
  online: '#00A884',
  separator: '#222D34',
};

const shared = {
  spacing: (units: number) => units * 4,
  radius: { bubble: 8, card: 12, pill: 999 },
  font: { title: 20, body: 16, caption: 13 },
};

export const lightTheme: Theme = { dark: false, colors: light, ...shared };
export const darkTheme: Theme = { dark: true, colors: dark, ...shared };

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}
