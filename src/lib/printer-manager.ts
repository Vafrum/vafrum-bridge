import { PrinterEngine } from './mqtt-client';
import type { PrinterConnectionConfig, PrinterClientEvents } from './mqtt-client';
import type { PrinterCommand } from '../../shared/interfaces/printer-status';

export class PrinterManager {
  private engine: PrinterEngine;
  private knownPrinters = new Map<string, PrinterConnectionConfig>();

  constructor(events: PrinterClientEvents) {
    this.engine = new PrinterEngine(events);
  }

  async init(): Promise<void> {
    await this.engine.start();
  }

  async addPrinter(config: PrinterConnectionConfig): Promise<void> {
    if (this.knownPrinters.has(config.printerId)) {
      await this.removePrinter(config.printerId);
    }
    this.knownPrinters.set(config.printerId, config);
    await this.engine.addPrinter(config);
  }

  async removePrinter(printerId: string): Promise<void> {
    await this.engine.removePrinter(printerId);
    this.knownPrinters.delete(printerId);
  }

  async removeBySerial(serialNumber: string): Promise<void> {
    for (const [id, cfg] of this.knownPrinters.entries()) {
      if (cfg.serialNumber === serialNumber) {
        await this.removePrinter(id);
      }
    }
  }

  async removeAll(): Promise<void> {
    for (const id of [...this.knownPrinters.keys()]) {
      await this.removePrinter(id);
    }
  }

  async sendCommand(printerId: string, command: PrinterCommand): Promise<boolean> {
    const cfg = this.knownPrinters.get(printerId);
    if (!cfg) return false;
    return this.engine.sendCommand(printerId, cfg.model, command);
  }

  has(printerId: string): boolean {
    return this.knownPrinters.has(printerId);
  }

  getKnown(): PrinterConnectionConfig[] {
    return [...this.knownPrinters.values()];
  }
}
