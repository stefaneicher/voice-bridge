import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PairedDevice {
  id: string;
  name: string;
  tokenHash: string;
  pairedAt: string;
  lastSeen?: string;
}

export interface PairingPersistence {
  load(): PairedDevice[];
  save(devices: PairedDevice[]): void;
}

const CODE_TTL_MS = 10 * 60_000;
const MAX_FAILED_ATTEMPTS = 5;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * One-time pairing codes (shown as QR code) and the list of paired phones. Only token hashes are
 * stored. A code expires after 10 minutes, after one use, or after 5 wrong attempts.
 */
export class PairingStore {
  private devices: PairedDevice[];
  private code: { value: string; expiresAt: number } | null = null;
  private failed = 0;

  constructor(
    private readonly persistence: PairingPersistence,
    private readonly now: () => number = Date.now,
  ) {
    this.devices = persistence.load();
  }

  /** Creates a fresh code and invalidates the previous one. */
  newCode(): string {
    this.code = {
      value: randomBytes(16).toString('base64url'),
      expiresAt: this.now() + CODE_TTL_MS,
    };
    this.failed = 0;
    return this.code.value;
  }

  currentCode(): string | null {
    if (!this.code || this.now() > this.code.expiresAt) return null;
    return this.code.value;
  }

  /** Redeems a code. Returns the new device credentials, or null if the code is wrong or expired. */
  redeem(code: string, deviceName: string): { deviceId: string; token: string } | null {
    const current = this.currentCode();
    if (!current || !safeEqual(code, current)) {
      if (current && ++this.failed >= MAX_FAILED_ATTEMPTS) this.code = null;
      return null;
    }
    this.code = null;
    const deviceId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    this.devices = [
      ...this.devices,
      {
        id: deviceId,
        name: deviceName.slice(0, 64) || 'Handy',
        tokenHash: hash(token),
        pairedAt: new Date(this.now()).toISOString(),
      },
    ];
    this.persistence.save(this.devices);
    return { deviceId, token };
  }

  /** Checks a device's token. Updates `lastSeen` on success. */
  verify(deviceId: string, token: string): PairedDevice | null {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device || !safeEqual(hash(token), device.tokenHash)) return null;
    device.lastSeen = new Date(this.now()).toISOString();
    this.persistence.save(this.devices);
    return device;
  }

  list(): PairedDevice[] {
    return this.devices.map((d) => ({ ...d }));
  }

  remove(deviceId: string): void {
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    this.persistence.save(this.devices);
  }
}
