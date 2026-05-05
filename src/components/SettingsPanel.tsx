import { useEffect, useState } from 'react';
import type { Settings } from '../lib/store';

interface Props {
  settings: Settings;
  backendStatus: { dev: boolean; prod: boolean };
  onSave: (s: Settings) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function SettingsPanel({ settings, backendStatus, onSave, onConnect, onDisconnect }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [devUrl, setDevUrl] = useState(settings.devBackendUrl);
  const [prodUrl, setProdUrl] = useState(settings.prodBackendUrl);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiKey(settings.apiKey);
    setDevUrl(settings.devBackendUrl);
    setProdUrl(settings.prodBackendUrl);
  }, [settings]);

  const isConnected = backendStatus.dev || backendStatus.prod;

  const handleSave = () => {
    onSave({
      apiKey,
      devBackendUrl: devUrl,
      prodBackendUrl: prodUrl,
      bridgeId: settings.bridgeId,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="settings">
      <h2>Einstellungen</h2>
      <div className="field">
        <label>API-Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="vfk_..."
        />
      </div>
      <div className="field">
        <label>DEV-Backend-URL</label>
        <input
          value={devUrl}
          onChange={(e) => setDevUrl(e.target.value)}
          placeholder="z.B. http://192.168.1.x:3000"
        />
      </div>
      <div className="field">
        <label>Production-Backend-URL</label>
        <input
          value={prodUrl}
          onChange={(e) => setProdUrl(e.target.value)}
          placeholder="https://vafrum-core.de"
        />
      </div>
      <div className="actions">
        <button onClick={handleSave}>Speichern{saved ? ' ✓' : ''}</button>
        {!isConnected ? (
          <button onClick={onConnect} className="primary">Verbinden</button>
        ) : (
          <button onClick={onDisconnect}>Trennen</button>
        )}
      </div>
      <div className="status">
        Status:
        <span className={backendStatus.dev ? 'ok' : 'off'}> DEV {backendStatus.dev ? '✓' : '✗'}</span>
        {' · '}
        <span className={backendStatus.prod ? 'ok' : 'off'}>Prod {backendStatus.prod ? '✓' : '✗'}</span>
      </div>
    </section>
  );
}
