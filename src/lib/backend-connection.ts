import { io, Socket } from 'socket.io-client';
import type { ApiPrinter, CommandMessage, CommandResult, PrinterStatus } from './types';

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

export class MultiBackendManager {
  private backends: Map<BackendName, BackendConnection> = new Map();

  constructor(private events: BackendEvents) {}

  configure(devUrl: string, prodUrl: string, apiKey: string): void {
    this.disconnectAll();
    if (devUrl && apiKey) {
      this.backends.set('dev', new BackendConnection('dev', devUrl, apiKey, this.events));
    }
    if (prodUrl && apiKey) {
      this.backends.set('prod', new BackendConnection('prod', prodUrl, apiKey, this.events));
    }
  }

  connectAll(): void {
    for (const conn of this.backends.values()) conn.connect();
  }

  disconnectAll(): void {
    for (const conn of this.backends.values()) conn.disconnect();
    this.backends.clear();
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

  getStatus(): { dev: boolean; prod: boolean } {
    return {
      dev: this.backends.get('dev')?.isReady() ?? false,
      prod: this.backends.get('prod')?.isReady() ?? false,
    };
  }
}
