// Encrypts small secrets (like the YouTube refresh token) before they go into the database,
// with AES-256-GCM and a key derived from AUTH_SECRET. Anyone reading the table alone
// cannot use the token.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyFor = (secret: string, purpose: string) => createHash('sha256').update(`${purpose}:${secret}`).digest();
const b64 = (b: Buffer) => b.toString('base64url');

export function seal(plain: string, secret: string, purpose = 'secretbox'): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${b64(iv)}.${b64(ct)}.${b64(c.getAuthTag())}`;
}

/** Returns the original text, or null if it was tampered with or sealed with another secret. */
export function unseal(sealed: string, secret: string, purpose = 'secretbox'): string | null {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', keyFor(secret, purpose), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
