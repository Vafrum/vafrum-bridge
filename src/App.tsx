import { useEffect, useRef, useState } from 'react';
import { SettingsPanel } from './components/SettingsPanel';
import { PrinterList } from './components/PrinterList';
import { loadSettings, saveSettings, type Settings } from './lib/store';
import { MultiBackendManager } from './lib/backend-connection';
import { PrinterManager } from './lib/printer-manager';
import type { PrinterStatus } from '../shared/interfaces/printer-status';
import type { ApiPrinter } from './lib/types';
import './App.css';

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  devBackendUrl: '',
  prodBackendUrl: 'https://vafrum-core.de',
  bridgeId: '',
};

export interface KnownPrinter {
  printerId: string;
  serialNumber: string;
  model: string | null;
  ipAddress: string;
}

async function ensurePrinter(manager: PrinterManager, p: ApiPrinter): Promise<KnownPrinter | null> {
  if (!p?.serialNumber || !p?.ipAddress || !p?.accessCode) return null;
  if (!manager.has(p.id)) {
    await manager.addPrinter({
      printerId: p.id,
      serialNumber: p.serialNumber,
      model: p.model ?? null,
      ipAddress: p.ipAddress,
      accessCode: p.accessCode,
    });
  }
  return {
    printerId: p.id,
    serialNumber: p.serialNumber,
    model: p.model ?? null,
    ipAddress: p.ipAddress,
  };
}

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [backendStatus, setBackendStatus] = useState({ dev: false, prod: false });
  const [statusByPrinter, setStatusByPrinter] = useState<Map<string, PrinterStatus>>(new Map());
  const [knownPrinters, setKnownPrinters] = useState<Map<string, KnownPrinter>>(new Map());

  const backendRef = useRef<MultiBackendManager | null>(null);
  const printerManagerRef = useRef<PrinterManager | null>(null);

  if (!printerManagerRef.current) {
    printerManagerRef.current = new PrinterManager({
      onStatus: (status) => {
        setStatusByPrinter((prev) => new Map(prev).set(status.printerId, status));
        backendRef.current?.broadcastStatus(status);
      },
      onDiagnostic: (event) => {
        backendRef.current?.broadcastDiagnostic(event);
      },
    });
  }

  if (!backendRef.current) {
    backendRef.current = new MultiBackendManager({
      onConnect: (backend) => setBackendStatus((prev) => ({ ...prev, [backend]: true })),
      onDisconnect: (backend) => setBackendStatus((prev) => ({ ...prev, [backend]: false })),
      onAuthError: (backend, err) => {
        console.error(`[backend:${backend}] auth error`, err);
        setBackendStatus((prev) => ({ ...prev, [backend]: false }));
      },
      onPrintersList: async (_backend, printers) => {
        const additions: KnownPrinter[] = [];
        for (const p of printers) {
          const known = await ensurePrinter(printerManagerRef.current!, p);
          if (known) additions.push(known);
        }
        if (additions.length > 0) {
          setKnownPrinters((prev) => {
            const next = new Map(prev);
            for (const k of additions) next.set(k.printerId, k);
            return next;
          });
        }
      },
      onPrinterAdd: async (_backend, p) => {
        const known = await ensurePrinter(printerManagerRef.current!, p);
        if (known) {
          setKnownPrinters((prev) => new Map(prev).set(known.printerId, known));
        }
      },
      onPrinterRemove: async (_backend, serialNumber) => {
        await printerManagerRef.current!.removeBySerial(serialNumber);
        setKnownPrinters((prev) => {
          const next = new Map(prev);
          for (const [id, k] of next.entries()) {
            if (k.serialNumber === serialNumber) next.delete(id);
          }
          return next;
        });
        setStatusByPrinter((prev) => {
          const next = new Map(prev);
          for (const [id, st] of next.entries()) {
            if (st.serialNumber === serialNumber) next.delete(id);
          }
          return next;
        });
      },
      onPrinterCommand: async (_backend, message) => {
        const success = await printerManagerRef.current!.sendCommand(
          message.printerId,
          message.command,
        );
        backendRef.current!.broadcastCommandResult({
          printerId: message.printerId,
          command: message.command,
          success,
          ...(success ? {} : { error: 'send_failed' }),
        });
      },
    });
    backendRef.current.setDiagnosticHandler((event) => {
      backendRef.current?.broadcastDiagnostic(event);
    });
  }

  useEffect(() => {
    printerManagerRef.current?.init().catch((err) => {
      console.error('Failed to init PrinterManager', err);
    });
    loadSettings().then(setSettings).catch((err) => {
      console.error('Failed to load settings', err);
    });
  }, []);

  const handleSave = async (next: Settings) => {
    await saveSettings(next);
    setSettings(next);
  };

  const handleConnect = () => {
    if (!backendRef.current) return;
    backendRef.current.configure(
      settings.devBackendUrl,
      settings.prodBackendUrl,
      settings.apiKey,
      settings.bridgeId,
      () => ({
        configured: knownPrinters.size,
        connected: statusByPrinter.size,
      }),
    );
    void backendRef.current.connectAll();
  };

  const handleDisconnect = async () => {
    backendRef.current?.disconnectAll();
    await printerManagerRef.current?.removeAll();
    setStatusByPrinter(new Map());
    setKnownPrinters(new Map());
    setBackendStatus({ dev: false, prod: false });
  };

  return (
    <main className="container">
      <h1>Vafrum Bridge</h1>
      <SettingsPanel
        settings={settings}
        backendStatus={backendStatus}
        onSave={handleSave}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      <PrinterList knownPrinters={knownPrinters} statusByPrinter={statusByPrinter} />
    </main>
  );
}

export default App;
