import type { PrinterStatus, PrinterCommand } from '../../shared/interfaces/printer-status';

export type { PrinterStatus, PrinterCommand };

export interface ApiPrinter {
  id: string;
  name: string;
  model: string | null;
  serialNumber: string;
  ipAddress: string;
  accessCode: string;
}

export interface CommandMessage {
  printerId: string;
  serialNumber: string;
  command: PrinterCommand;
}

export interface CommandResult {
  printerId: string;
  command: PrinterCommand | string;
  success: boolean;
  error?: string;
  timestamp: string;
}
