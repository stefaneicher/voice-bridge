import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';

export interface TlsIdentity {
  cert: string;
  key: string;
  /** SHA-256 of the certificate, lowercase hex without separators (pinned by the app). */
  fingerprint: string;
}

export function fingerprintOf(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();
}

/**
 * Self-signed certificate per profile, valid for 5 years. The phone does not trust it through a
 * CA but pins its fingerprint from the QR code. A new certificate requires pairing again.
 */
export async function loadOrCreateIdentity(dir: string, now = new Date()): Promise<TlsIdentity> {
  const certPath = join(dir, 'remote-cert.pem');
  const keyPath = join(dir, 'remote-key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = readFileSync(certPath, 'utf8');
    const validTo = new Date(new X509Certificate(cert).validTo);
    if (validTo.getTime() - now.getTime() > 30 * 24 * 3600_000) {
      return { cert, key: readFileSync(keyPath, 'utf8'), fingerprint: fingerprintOf(cert) };
    }
  }
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + 5);
  const pems = await generate([{ name: 'commonName', value: 'Voice-Bridge' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: now,
    notAfterDate: notAfter,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(certPath, pems.cert, { mode: 0o600 });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  return { cert: pems.cert, key: pems.private, fingerprint: fingerprintOf(pems.cert) };
}
