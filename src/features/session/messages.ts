import { PairingCodeError } from '@/core/crypto/pairingCode';

import { PairingError } from './session';

/** User-facing text for pairing failures. */
export function pairingErrorMessage(error: unknown): string {
  if (error instanceof PairingCodeError) {
    switch (error.reason) {
      case 'malformed':
        return "That code isn't valid. Check it was copied completely.";
      case 'unsupported-version':
        return 'That code is from a different app version. Ask your contact to update.';
      case 'invalid-key':
        return 'That code is damaged. Ask your contact to send it again.';
    }
  }
  if (error instanceof PairingError) {
    switch (error.reason) {
      case 'own-code':
        return "That's your own code. Paste your contact's code instead.";
      case 'already-paired':
        return 'You are already paired. Reset in Settings to pair again.';
      case 'empty-name':
        return 'Enter a name.';
    }
  }
  return 'Something went wrong. Try again.';
}
