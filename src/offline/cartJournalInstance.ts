import { CartJournalClient, type JournalStorage } from './cartJournal';
import { api } from '../api/client';
import { getOrInitTabId, subscribeTabIdChange, waitForTabIdentitySettled } from '../utils/tabSession';

let instance: CartJournalClient | null = null;
let tabSyncBound = false;

function createFallbackStorage(): JournalStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    }
  };
}

export function getCartJournal(): CartJournalClient {
  if (!instance) {
    const storage: JournalStorage =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : createFallbackStorage();

    instance = new CartJournalClient({
      storage,
      ownerTabId: getOrInitTabId(),
      send: (payload, options) => api.sendCartJournalEvents(payload, options.keepalive)
    });
    instance.start();
    if (!tabSyncBound && typeof window !== 'undefined') {
      tabSyncBound = true;
      subscribeTabIdChange((newTabId) => {
        instance?.setOwnerTabId(newTabId);
      });
      void waitForTabIdentitySettled().then((settledTabId) => {
        if (settledTabId) {
          instance?.setOwnerTabId(settledTabId);
        }
      });
    }
  }
  return instance;
}
