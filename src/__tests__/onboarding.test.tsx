import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import Chat from '@/app/chat';
import Index from '@/app/index';
import Pair from '@/app/onboarding/pair';
import Profile from '@/app/onboarding/profile';
import Verify from '@/app/verify';
import { randomBytes } from '@/core/crypto/bytes';
import { generateIdentity } from '@/core/crypto/identity';
import { encodePairingCode } from '@/core/crypto/pairingCode';
import { createMemorySecretStore } from '@/data/secretStore';
import { useSessionStore } from '@/features/session/sessionStore';

import { createNodeSqliteDb } from '../../test/nodeSqliteDb';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));
jest.mock('react-native-qrcode-svg', () => 'QRCode');

const routes = {
  index: Index,
  'onboarding/profile': Profile,
  'onboarding/pair': Pair,
  verify: Verify,
  chat: Chat,
};

beforeEach(async () => {
  const db = createNodeSqliteDb();
  await useSessionStore.getState().init({
    secrets: createMemorySecretStore(),
    openDb: async () => db,
    now: () => 1,
  });
});

it('walks a new user from launch to a paired chat', async () => {
  await renderRouter(routes, { initialUrl: '/' });
  expect(screen).toHavePathname('/onboarding/profile');

  await fireEvent.changeText(screen.getByLabelText('Your name'), 'Alice');
  await fireEvent.press(screen.getByText('Next'));
  await waitFor(() => expect(screen).toHavePathname('/onboarding/pair'));

  const own = useSessionStore.getState().session!.ownCodeText;
  expect(screen.getByLabelText('Your pairing code')).toHaveTextContent(own);

  await fireEvent.changeText(screen.getByLabelText('Contact name'), 'Bob');
  await fireEvent.changeText(screen.getByTestId('peer-code-input'), own);
  await fireEvent.press(screen.getByText('Add contact'));
  expect(await screen.findByText(/your own code/)).toBeTruthy();

  const bobCode = encodePairingCode({
    publicKey: generateIdentity().publicKey,
    secret: randomBytes(32),
  });
  await fireEvent.changeText(screen.getByTestId('peer-code-input'), bobCode);
  await fireEvent.press(screen.getByText('Add contact'));
  await waitFor(() => expect(screen).toHavePathname('/verify'));
  expect(screen.getByLabelText('Safety emoji')).toBeTruthy();

  await fireEvent.press(screen.getByText('They match'));
  await waitFor(() => expect(screen).toHavePathname('/chat'));
  expect(screen.getByText(/Paired with Bob · verified/)).toBeTruthy();
});
