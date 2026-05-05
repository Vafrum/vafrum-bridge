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

function ensurePrinter(manager: PrinterManager, p: ApiPrinter): void {
  if (!p?.serialNumber || !p?.ipAddress || !p?.accessCode) return;
  if (manager.has(p.id)) return;
  manager.addPrinter({
    printerId: p.id,
    serialNumber: p.serialNumber,
    model: p.model ?? null,
    ipAddress: p.ipAddress,
    accessCode: p.accessCode,
  });
}

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [backendStatus, setBackendStatus] = useState({ dev: false, prod: false });
  const [statusByPrinter, setStatusByPrinter] = useState<Map<string, PrinterStatus>>(new Map());

  const backendRef = useRef<MultiBackendManager | null>(null);
  const printerManagerRef = useRef<PrinterManager | null>(null);

  if (!printerManagerRef.current) {
    printerManagerRef.current = new PrinterManager({
      onStatus: (status) => {
        setStatusByPrinter((prev) => new Map(prev).set(status.printerId, status));
        backendRef.current?.broadcastStatus(status);
      },
      onConnectionState: (printerId, connected) => {
        setStatusByPrinter((prev) => {
          const existing = prev.get(printerId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(printerId, { ...existing, online: connected });
          return next;
        });
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
      onPrintersList: (_backend, printers) => {
        for (const p of printers) ensurePrinter(printerManagerRef.current!, p);
      },
      onPrinterAdd: (_backend, p) => {
        ensurePrinter(printerManagerRef.current!, p);
      },
      onPrinterRemove: (_backend, serialNumber) => {
        printerManagerRef.current!.removeBySerial(serialNumber);
        setStatusByPrinter((prev) => {
          const next = new Map(prev);
          for (const [id, st] of next.entries()) {
            if (st.serialNumber === serialNumber) next.delete(id);
          }
          return next;
        });
      },
      onPrinterCommand: (_backend, message) => {
        const success = printerManagerRef.current!.sendCommand(message.printerId, message.command);
        backendRef.current!.broadcastCommandResult({
          printerId: message.printerId,
          command: message.command,
          success,
          ...(success ? {} : { error: 'send_failed' }),
        });
      },
    });
  }

  useEffect(() => {
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
        configured: statusByPrinter.size,
        connected: statusByPrinter.size,
      }),
    );
    void backendRef.current.connectAll();
  };

  const handleDisconnect = () => {
    backendRef.current?.disconnectAll();
    printerManagerRef.current?.removeAll();
    setStatusByPrinter(new Map());
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
      <PrinterList statusByPrinter={statusByPrinter} />
    </main>
  );
}

export default App;
