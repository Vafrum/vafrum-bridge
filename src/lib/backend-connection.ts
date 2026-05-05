import { io, Socket } from 'socket.io-client';
import type { ApiPrinter, CommandMessage, CommandResult, PrinterStatus } from './types';
import {
  BridgeRestClient,
  type BridgeRegisterPayload,
  type BridgeHeartbeatPayload,
} from './bridge-rest-client';

export type BackendName = 'dev' | 'prod';

export interface BackendEvents {
  onConnect: (backend: BackendName) => void;
  onDisconnect: (backend: BackendName) => void;
  onAuthError: (backend: BackendName, error: string) => void;
  onPrintersList: (backend: BackendName, printers: ApiPrinter[]) => void;
  onPrinterAdd: (backend: BackendName, printer: ApiPrinter) => void;
  onPrinterRemove: (backend: BackendName, serialNumber: string) => void;
  onPrinterCommand: (backend: BackendName, message: CommandMessage) => void;
}

export class BackendConnection {
  private socket: Socket | null = null;
  private isAuthenticated = false;

  constructor(
    public readonly name: BackendName,
    private url: string,
    private apiKey: string,
    private events: BackendEvents,
  ) {}

  connect(): void {
    if (!this.url || !this.apiKey) return;
    this.socket = io(this.url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 5000,
      auth: { apiKey: this.apiKey },
    });

    this.socket.on('connect', () => {
      this.events.onConnect(this.name);
    });

    this.socket.on('disconnect', () => {
      this.isAuthenticated = false;
      this.events.onDisconnect(this.name);
    });

    this.socket.on('authenticated', () => {
      this.isAuthenticated = true;
      this.socket?.emit('printers:request');
    });

    this.socket.on('auth:error', (err: string) => {
      this.isAuthenticated = false;
      this.events.onAuthError(this.name, err);
    });

    this.socket.on('printers:list', (printers: ApiPrinter[]) => {
      this.events.onPrintersList(this.name, Array.isArray(printers) ? printers : []);
    });

    this.socket.on('printer:add', (printer: ApiPrinter) => {
      this.events.onPrinterAdd(this.name, printer);
    });

    this.socket.on('printer:remove', (data: { serialNumber: string }) => {
      if (data?.serialNumber) {
        this.events.onPrinterRemove(this.name, data.serialNumber);
      }
    });

    this.socket.on('printer:command', (data: CommandMessage) => {
      if (data?.printerId && data?.command) {
        this.events.onPrinterCommand(this.name, data);
      }
    });

    this.socket.on('ping', () => this.socket?.emit('pong'));
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.isAuthenticated = false;
  }

  isReady(): boolean {
    return this.socket?.connected === true && this.isAuthenticated;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  emitStatus(status: PrinterStatus): void {
    if (!this.isReady()) return;
    this.socket?.emit('printer:status', status);
  }

  emitCommandResult(result: Omit<CommandResult, 'timestamp'>): void {
    if (!this.isReady()) return;
    const payload: CommandResult = { ...result, timestamp: new Date().toISOString() };
    this.socket?.emit('printer:command:result', payload);
  }
}

const BRIDGE_APP_VERSION = '0.2.1';
const HEARTBEAT_INTERVAL_MS = 60_000;

export interface BridgeCounts {
  configured: number;
  connected: number;
}

export class MultiBackendManager {
  private backends: Map<BackendName, BackendConnection> = new Map();
  private restClients: Map<BackendName, BridgeRestClient> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private bridgeId = '';
  private getCounts: () => BridgeCounts = () => ({ configured: 0, connected: 0 });

  constructor(private events: BackendEvents) {}

  configure(
    devUrl: string,
    prodUrl: string,
    apiKey: string,
    bridgeId: string,
    getCounts: () => BridgeCounts,
  ): void {
    this.disconnectAll();
    this.bridgeId = bridgeId;
    this.getCounts = getCounts;
    if (devUrl && apiKey) {
      this.backends.set('dev', new BackendConnection('dev', devUrl, apiKey, this.events));
      this.restClients.set('dev', new BridgeRestClient('dev', devUrl, apiKey));
    }
    if (prodUrl && apiKey) {
      this.backends.set('prod', new BackendConnection('prod', prodUrl, apiKey, this.events));
      this.restClients.set('prod', new BridgeRestClient('prod', prodUrl, apiKey));
    }
  }

  async connectAll(): Promise<void> {
    if (this.bridgeId) {
      const counts = this.getCounts();
      const registerPayload: BridgeRegisterPayload = {
        bridgeId: this.bridgeId,
        appVersion: BRIDGE_APP_VERSION,
        mode: 'live',
        capabilities: ['bambu-mqtt', 'lan-only'],
        configuredPrinterCount: counts.configured,
      };
      for (const rest of this.restClients.values()) {
        await rest.register(registerPayload);
      }
    }
    for (const conn of this.backends.values()) conn.connect();
    this.startHeartbeat();
  }

  disconnectAll(): void {
    this.stopHeartbeat();
    for (const conn of this.backends.values()) conn.disconnect();
    this.backends.clear();
    this.restClients.clear();
  }

  broadcastStatus(status: PrinterStatus): void {
    for (const conn of this.backends.values()) {
      conn.emitStatus(status);
    }
  }

  broadcastCommandResult(result: Omit<CommandResult, 'timestamp'>): void {
    for (const conn of this.backends.values()) {
      conn.emitCommandResult(result);
    }
  }

  broadcastDiagnostic(event: {
    printerId: string;
    serial: string;
    ip?: string;
    level: string;
    message: string;
  }): void {
    if (!this.bridgeId) return;
    const body = {
      events: [
        {
          type: 'diagnostic.summary',
          occurredAt: new Date().toISOString(),
          printerId: event.printerId,
          data: {
            bridgeId: this.bridgeId,
            level: event.level,
            message: event.message,
            serial: event.serial,
            ...(event.ip !== undefined ? { ip: event.ip } : {}),
          },
        },
      ],
    };
    for (const rest of this.restClients.values()) {
      void rest.sendEvent(body);
    }
  }

  getStatus(): { dev: boolean; prod: boolean } {
    return {
      dev: this.backends.get('dev')?.isReady() ?? false,
      prod: this.backends.get('prod')?.isReady() ?? false,
    };
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const send = async () => {
      if (!this.bridgeId) return;
      const counts = this.getCounts();
      const payload: BridgeHeartbeatPayload = {
        bridgeId: this.bridgeId,
        status: 'online',
        configuredPrinterCount: counts.configured,
        connectedPrinterCount: counts.connected,
      };
      for (const rest of this.restClients.values()) {
        await rest.heartbeat(payload);
      }
    };
    void send();
    this.heartbeatTimer = setInterval(() => {
      void send();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
