import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricResult = 'ok' | 'cancelled' | 'unavailable';

export async function authenticate(promptMessage: string): Promise<BiometricResult> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  if (!hasHardware || !enrolled) return 'unavailable';
  const result = await LocalAuthentication.authenticateAsync({ promptMessage });
  return result.success ? 'ok' : 'cancelled';
}
