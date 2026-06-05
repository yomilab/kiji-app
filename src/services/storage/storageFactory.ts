import type { IStorage } from './storage';
import { LocalStorageAdapter } from './localStorageAdapter';

export class StorageFactory {
  private static storage: IStorage | null = null;

  static getStorage(): IStorage {
    if (!this.storage) {
      this.storage = new LocalStorageAdapter();
    }
    return this.storage;
  }
}

export const storage = StorageFactory.getStorage();
