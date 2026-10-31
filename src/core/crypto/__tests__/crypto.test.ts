import { bytesToHex, equalBytes, randomBytes } from '../bytes';
import { generateIdentity, identityFromSecretKey, isValidPublicKey } from '../identity';
import { decodePairingCode, encodePairingCode, PairingCodeError } from '../pairingCode';
import { derivePairSecret } from '../pairSecret';
import { safetyCode } from '../safetyCode';

function newCode() {
  return { publicKey: generateIdentity().publicKey, secret: randomBytes(32) };
}

function expectReason(fn: () => unknown, reason: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PairingCodeError);
    expect((e as PairingCodeError).reason).toBe(reason);
    return;
  }
  throw new Error('expected PairingCodeError');
}

describe('identity', () => {
  it('derives the same public key from a stored secret key', () => {
    const id = generateIdentity();
    expect(id.publicKey).toHaveLength(32);
    expect(equalBytes(identityFromSecretKey(id.secretKey).publicKey, id.publicKey)).toBe(true);
  });

  it('rejects public keys that are not on the curve', () => {
    expect(isValidPublicKey(new Uint8Array(32).fill(0xff))).toBe(false);
    expect(isValidPublicKey(new Uint8Array(31))).toBe(false);
  });
});

describe('pairing code', () => {
  it('round-trips and tolerates case and whitespace', () => {
    const code = newCode();
    const text = encodePairingCode(code);
    expect(text.startsWith('cnc1')).toBe(true);

    const decoded = decodePairingCode(`  ${text.toUpperCase()}\n`);
    expect(equalBytes(decoded.publicKey, code.publicKey)).toBe(true);
    expect(equalBytes(decoded.secret, code.secret)).toBe(true);
  });

  it('rejects a single-character typo via the checksum', () => {
    const text = encodePairingCode(newCode());
    const i = 20;
    const typo = text.slice(0, i) + (text[i] === 'q' ? 'p' : 'q') + text.slice(i + 1);
    expectReason(() => decodePairingCode(typo), 'malformed');
  });

  it('rejects junk and other prefixes', () => {
    expectReason(() => decodePairingCode('hello'), 'malformed');
    expectReason(() => decodePairingCode(''), 'malformed');
  });
});

describe('pair secret', () => {
  it('is identical on both sides', () => {
    const a = newCode();
    const b = newCode();
    expect(bytesToHex(derivePairSecret(a, b))).toBe(bytesToHex(derivePairSecret(b, a)));
  });

  it('changes when any input changes', () => {
    const a = newCode();
    const b = newCode();
    const base = bytesToHex(derivePairSecret(a, b));
    expect(bytesToHex(derivePairSecret(a, { ...b, secret: randomBytes(32) }))).not.toBe(base);
    expect(bytesToHex(derivePairSecret(a, { ...b, publicKey: newCode().publicKey }))).not.toBe(
      base,
    );
  });
});

describe('safety code', () => {
  it('is symmetric and well formed', () => {
    const a = generateIdentity().publicKey;
    const b = generateIdentity().publicKey;
    const ab = safetyCode(a, b);
    expect(safetyCode(b, a)).toEqual(ab);
    expect(ab.emoji).toHaveLength(6);
    expect(ab.digits).toMatch(/^\d{4} \d{4} \d{4}$/);
  });

  it('differs for a different peer', () => {
    const a = generateIdentity().publicKey;
    const b = generateIdentity().publicKey;
    const c = generateIdentity().publicKey;
    expect(safetyCode(a, b).digits).not.toBe(safetyCode(a, c).digits);
  });
});
