import { Store } from '@tauri-apps/plugin-store';

export interface Settings {
  apiKey: string;
  devBackendUrl: string;
  prodBackendUrl: string;
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  devBackendUrl: '',
  prodBackendUrl: 'https://vafrum-core.de',
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('settings.json');
  }
  return store;
}

export async function loadSettings(): Promise<Settings> {
  const s = await getStore();
  const settings = await s.get<Settings>('settings');
  return settings ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set('settings', settings);
  await s.save();
}
