/**
 * Node has no IndexedDB, so the Dexie tests run against fake-indexeddb. That
 * keeps the persistence tests honest -- they exercise real transactions,
 * indexes, and version upgrades rather than a mock of them.
 */
import 'fake-indexeddb/auto';
