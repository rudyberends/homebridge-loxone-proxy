import { createPublicKey, KeyObject } from 'crypto';

/**
 * Pure RSA public-key parsing extracted from LoxoneTalkbackSession.
 *
 * The Loxone intercom signaling challenge can deliver its RSA public key in
 * several encodings: JWK modulus/exponent components, PEM/SPKI text, a JSON JWK,
 * or raw hex/base64 DER (SPKI or PKCS#1). These helpers normalise all of them
 * into a Node KeyObject and are pure, so they can be unit-tested without a live
 * signaling session.
 */
export function createRsaPublicKey(
  modulus?: string,
  exponent?: string,
  fullPublicKey?: string,
): KeyObject {
  const errors: string[] = [];

  if (modulus && exponent) {
    try {
      return createRsaPublicKeyFromComponents(modulus, exponent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`components: ${message}`);
    }
  }

  if (fullPublicKey) {
    try {
      return createRsaPublicKeyFromText(fullPublicKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`fullPublicKey: ${message}`);
    }
  }

  if (!modulus && !fullPublicKey) {
    throw new Error('Missing RSA key parameters from signaling challenge');
  }

  throw new Error(`Unable to parse RSA public key (${errors.join(' | ') || 'unknown format'})`);
}

function createRsaPublicKeyFromComponents(modulus: string, exponent: string): KeyObject {
  const jwk = {
    kty: 'RSA',
    n: bigIntValueToBase64Url(modulus),
    e: bigIntValueToBase64Url(exponent),
  };

  return createPublicKey({
    key: jwk,
    format: 'jwk',
  });
}

function createRsaPublicKeyFromText(fullPublicKey: string): KeyObject {
  const trimmed = fullPublicKey.trim();
  if (!trimmed) {
    throw new Error('empty public key');
  }

  if (
    trimmed.includes('-----BEGIN PUBLIC KEY-----')
    || trimmed.includes('-----BEGIN RSA PUBLIC KEY-----')
  ) {
    return createPublicKey(trimmed);
  }

  if (trimmed.startsWith('{')) {
    try {
      return createPublicKey({
        key: JSON.parse(trimmed) as Record<string, unknown>,
        format: 'jwk',
      });
    } catch {
      // Continue with binary decoding fallbacks.
    }
  }

  const candidates = decodeBinaryKeyCandidates(trimmed);
  let lastError: string | undefined;

  for (const candidate of candidates) {
    try {
      return createPublicKey({ key: candidate, format: 'der', type: 'spki' });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    try {
      return createPublicKey({ key: candidate, format: 'der', type: 'pkcs1' });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError ?? 'unsupported key encoding');
}

function bigIntValueToBase64Url(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('empty RSA component');
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return bufferToBase64Url(bigIntToBuffer(BigInt(trimmed)));
  }

  if (/^[a-fA-F0-9]+$/.test(trimmed)) {
    return hexToBase64Url(trimmed);
  }

  return bufferToBase64Url(decodeBase64Like(trimmed));
}

function hexToBase64Url(hex: string): string {
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
  return bufferToBase64Url(Buffer.from(padded, 'hex'));
}

function decodeBinaryKeyCandidates(value: string): Buffer[] {
  const normalized = value.replace(/\s+/g, '');
  const candidates: Buffer[] = [];

  if (/^[a-fA-F0-9]+$/.test(normalized)) {
    const hex = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
    candidates.push(Buffer.from(hex, 'hex'));
  }

  try {
    candidates.push(decodeBase64Like(normalized));
  } catch {
    // Ignore invalid base64 forms.
  }

  const unique = new Map<string, Buffer>();
  for (const candidate of candidates) {
    if (candidate.length > 0) {
      unique.set(candidate.toString('hex'), candidate);
    }
  }

  return [...unique.values()];
}

function decodeBase64Like(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(padding)}`;
  const decoded = Buffer.from(padded, 'base64');

  if (decoded.length === 0) {
    throw new Error('invalid base64 payload');
  }

  return decoded;
}

function bigIntToBuffer(value: bigint): Buffer {
  if (value < BigInt(0)) {
    throw new Error('negative RSA component');
  }
  const hex = value.toString(16);
  return Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex');
}

function bufferToBase64Url(buffer: Buffer): string {
  let startIndex = 0;
  while (startIndex < buffer.length - 1 && buffer[startIndex] === 0) {
    startIndex++;
  }

  return buffer
    .subarray(startIndex)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
