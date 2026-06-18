/**
 * Debug Utilities
 *
 * TEMPORARY: These utilities are for development/debugging only
 * TODO: Remove before production release
 */

import { storage } from '@/services/storage/storageFactory';
import { APP_NAME } from '@/config/appIdentity';
import { appToastService } from '@/services/ui/appToastService';

/**
 * Clear all user configs and cache
 * This will delete all stored data including feeds, articles, settings, etc.
 *
 * WARNING: This is a destructive operation and cannot be undone
 */
export async function clearAllConfigs(): Promise<void> {
  try {
    console.log('[DEBUG] Clearing all user configs and cache...');

    // Clear all storage keys
    await storage.clear();

    // Clear localStorage directly when not using the native settings store.
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    // Clear IndexedDB databases
    if (typeof indexedDB !== 'undefined') {
      const databases = [`${APP_NAME}DB`];
      for (const dbName of databases) {
        try {
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = () => {
              console.log(`[DEBUG] Deleted IndexedDB: ${dbName}`);
              resolve();
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
              console.warn(`[DEBUG] Deletion of ${dbName} blocked, will complete when connections close`);
              resolve();
            };
          });
        } catch (error) {
          console.error(`[DEBUG] Error deleting database ${dbName}:`, error);
        }
      }
    }

    console.log('[DEBUG] ✓ All configs and cache cleared successfully');
    window.location.reload();
  } catch (error) {
    console.error('[DEBUG] Error clearing configs:', error);
    appToastService.show('Error clearing configs. Check console for details.');
  }
}
