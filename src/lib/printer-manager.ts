import { PrinterMqttClient } from './mqtt-client';
import type { PrinterConnectionConfig, PrinterClientEvents } from './mqtt-client';
import type { PrinterCommand } from '../../shared/interfaces/printer-status';

export class PrinterManager {
  private clientsById = new Map<string, PrinterMqttClient>();
  private clientsBySerial = new Map<string, PrinterMqttClient>();
  private idBySerial = new Map<string, string>();

  constructor(private events: PrinterClientEvents) {}

  addPrinter(config: PrinterConnectionConfig): void {
    if (this.clientsById.has(config.printerId)) {
      this.removePrinter(config.printerId);
    }
    const client = new PrinterMqttClient(config, this.events);
    this.clientsById.set(config.printerId, client);
    this.clientsBySerial.set(config.serialNumber, client);
    this.idBySerial.set(config.serialNumber, config.printerId);
    client.connect();
  }

  removePrinter(printerId: string): void {
    const client = this.clientsById.get(printerId);
    if (!client) return;
    client.disconnect();
    this.clientsById.delete(printerId);
    for (const [serial, id] of this.idBySerial.entries()) {
      if (id === printerId) {
        this.clientsBySerial.delete(serial);
        this.idBySerial.delete(serial);
      }
    }
  }

  removeBySerial(serialNumber: string): void {
    const id = this.idBySerial.get(serialNumber);
    if (id) this.removePrinter(id);
  }

  removeAll(): void {
    for (const id of [...this.clientsById.keys()]) this.removePrinter(id);
  }

  sendCommand(printerId: string, command: PrinterCommand): boolean {
    const client = this.clientsById.get(printerId);
    if (!client) return false;
    return client.sendCommand(command);
  }

  has(printerId: string): boolean {
    return this.clientsById.has(printerId);
  }
}
