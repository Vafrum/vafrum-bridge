import { Store } from '@tauri-apps/plugin-store';

export interface Settings {
  apiKey: string;
  devBackendUrl: string;
  prodBackendUrl: string;
  bridgeId: string;
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  devBackendUrl: '',
  prodBackendUrl: 'https://vafrum-core.de',
  bridgeId: '',
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('settings.json');
  }
  return store;
}

function generateBridgeId(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `bridge-${hex}`;
}

export async function loadSettings(): Promise<Settings> {
  const s = await getStore();
  let settings = await s.get<Settings>('settings');
  if (!settings) settings = { ...DEFAULT_SETTINGS };
  if (!settings.bridgeId) {
    settings.bridgeId = generateBridgeId();
    await s.set('settings', settings);
    await s.save();
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set('settings', settings);
  await s.save();
}
