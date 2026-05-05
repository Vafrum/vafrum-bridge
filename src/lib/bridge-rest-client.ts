import type { BackendName } from './backend-connection';

export interface BridgeRegisterPayload {
  bridgeId: string;
  appVersion: string;
  mode: 'live' | 'dev';
  capabilities: string[];
  configuredPrinterCount: number;
}

export interface BridgeHeartbeatPayload {
  bridgeId: string;
  status: 'online' | 'degraded';
  configuredPrinterCount: number;
  connectedPrinterCount: number;
}

export class BridgeRestClient {
  constructor(
    private name: BackendName,
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async register(payload: BridgeRegisterPayload): Promise<boolean> {
    return this.post('/api/bridge/register', payload);
  }

  async heartbeat(payload: BridgeHeartbeatPayload): Promise<boolean> {
    return this.post('/api/bridge/heartbeat', payload);
  }

  async sendEvent(event: unknown): Promise<boolean> {
    return this.post('/api/bridge/events', event);
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Api-Key': this.apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`[bridge-rest:${this.name}] ${path} → ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[bridge-rest:${this.name}] ${path} → error`, err);
      return false;
    }
  }
}
