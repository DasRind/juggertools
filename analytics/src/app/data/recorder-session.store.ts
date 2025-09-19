import { Injectable } from '@angular/core';
import type { AnalyticsSession } from '../types/analytics-session';
import { ensureSessionIndexes } from '../utils/session-index';

const DB_NAME = 'jugger-recorder';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';
const LOCAL_FALLBACK_KEY = 'juggertools:analytics:session';

@Injectable({ providedIn: 'root' })
export class RecorderSessionStore {
  async load(): Promise<AnalyticsSession | null> {
    const fromDb = await this.readFromIndexedDb();
    if (fromDb) {
      return fromDb;
    }

    const fromLocal = this.readFromLocalStorage();
    if (fromLocal) {
      await this.writeToIndexedDb(fromLocal).catch(() => undefined);
      return fromLocal;
    }

    return null;
  }

  async save(session: AnalyticsSession): Promise<void> {
    const normalized = ensureSessionIndexes(session);
    await this.writeToIndexedDb(normalized).catch(() => undefined);
    this.writeToLocalStorage(normalized);
  }

  async clear(): Promise<void> {
    await this.clearIndexedDb().catch(() => undefined);
    this.removeLocalStorage();
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return null;
    }

    return await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => resolve(null);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  private async readFromIndexedDb(): Promise<AnalyticsSession | null> {
    const db = await this.openDb();
    if (!db) {
      return null;
    }

    try {
      const session = await new Promise<AnalyticsSession | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(SESSION_KEY);
        request.onsuccess = () => {
          resolve((request.result as AnalyticsSession | undefined) ?? null);
        };
        request.onerror = () => reject(request.error);
      });
      return session ? ensureSessionIndexes(session) : null;
    } catch (error) {
      console.warn('RecorderSessionStore.readFromIndexedDb failed', error);
      return null;
    } finally {
      db.close();
    }
  }

  private async writeToIndexedDb(session: AnalyticsSession): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      throw new Error('IndexedDB unavailable');
    }

    const normalized = ensureSessionIndexes(session);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(normalized, SESSION_KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  private async clearIndexedDb(): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      throw new Error('IndexedDB unavailable');
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(SESSION_KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  private readFromLocalStorage(): AnalyticsSession | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
      return raw ? ensureSessionIndexes(JSON.parse(raw) as AnalyticsSession) : null;
    } catch (error) {
      console.warn('RecorderSessionStore localStorage read failed', error);
      return null;
    }
  }

  private writeToLocalStorage(session: AnalyticsSession): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(ensureSessionIndexes(session)));
    } catch (error) {
      console.warn('RecorderSessionStore localStorage write failed', error);
    }
  }

  private removeLocalStorage(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.removeItem(LOCAL_FALLBACK_KEY);
  }
}
