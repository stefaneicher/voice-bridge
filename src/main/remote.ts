import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { AgentRegistry, InputEvent, SessionController } from '../core';
import { RemoteBridge } from '../remote/bridge';
import { PairingStore, type PairedDevice } from '../remote/pairing';
import { pairingUri } from '../remote/protocol';
import type { SwitchingRecorder } from '../remote/remote-recorder';
import { RemoteServer } from '../remote/server';
import { loadOrCreateIdentity, type TlsIdentity } from '../remote/tls';
import type { RemoteData } from '../shared/ipc';
import { readJson, writeJson } from './store';

export interface RemoteManagerOptions {
  dataDir: string;
  profile: string;
  controller: SessionController;
  agents: AgentRegistry;
  recorder: SwitchingRecorder;
  emit: (event: InputEvent) => void;
  log: (msg: string) => void;
}

/** IPv4 addresses of this PC in the local network (shown in the QR code). */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
}

/** Starts and stops the phone server according to the settings (ADR-013). */
export class RemoteManager {
  private readonly pairing: PairingStore;
  private readonly bridge: RemoteBridge;
  private identity: TlsIdentity | null = null;
  private server: RemoteServer | null = null;
  private enabled = false;
  private port = 47613;
  private error: string | undefined;

  constructor(private readonly o: RemoteManagerOptions) {
    const file = join(o.dataDir, 'remote-devices.json');
    this.pairing = new PairingStore({
      load: () => {
        const raw = readJson(file);
        return Array.isArray(raw) ? (raw as PairedDevice[]) : [];
      },
      save: (devices) => writeJson(file, devices),
    });
    this.bridge = new RemoteBridge({
      pcName: hostname(),
      profile: o.profile,
      controller: o.controller,
      agents: o.agents,
      recorder: o.recorder,
      emit: o.emit,
    });
  }

  async apply(settings: { enabled: boolean; port: number }): Promise<void> {
    if (
      settings.enabled === this.enabled &&
      settings.port === this.port &&
      (this.server || !this.enabled)
    ) {
      return;
    }
    await this.stopServer();
    this.enabled = settings.enabled;
    this.port = settings.port;
    this.error = undefined;
    if (!this.enabled) return;
    try {
      this.identity ??= await loadOrCreateIdentity(this.o.dataDir);
      const server = new RemoteServer({
        port: this.port,
        identity: this.identity,
        pairing: this.pairing,
        app: this.bridge,
        log: this.o.log,
      });
      await server.start();
      this.server = server;
    } catch (err) {
      this.error = `Server konnte nicht starten: ${err instanceof Error ? err.message : String(err)}`;
      this.o.log(`remote: ${this.error}`);
    }
  }

  newCode(): void {
    this.pairing.newCode();
  }

  removeDevice(id: string): void {
    this.pairing.remove(id);
  }

  data(): RemoteData {
    const hosts = lanAddresses();
    const code = this.pairing.currentCode();
    return {
      enabled: this.enabled,
      running: this.server !== null,
      ...(this.error ? { error: this.error } : {}),
      port: this.port,
      hosts,
      ...(code && this.server && this.identity && hosts.length
        ? {
            pairingUri: pairingUri({
              hosts,
              port: this.server.port,
              fingerprint: this.identity.fingerprint,
              code,
              pc: hostname(),
            }),
          }
        : {}),
      devices: this.pairing.list().map(({ id, name, pairedAt, lastSeen }) => ({
        id,
        name,
        pairedAt,
        ...(lastSeen ? { lastSeen } : {}),
      })),
    };
  }

  async stop(): Promise<void> {
    this.bridge.dispose();
    await this.stopServer();
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    await server?.stop();
  }
}
