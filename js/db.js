/**
 * IndexedDB wrapper for ТВ программа
 * Stores: sources, settings, channels, programmes
 */

const DB_NAME = 'tv-programma';
const DB_VERSION = 1;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Sources (EPG links)
      if (!database.objectStoreNames.contains('sources')) {
        const sources = database.createObjectStore('sources', { keyPath: 'id' });
        sources.createIndex('url', 'url', { unique: false });
      }

      // Channels belonging to a source
      if (!database.objectStoreNames.contains('channels')) {
        const channels = database.createObjectStore('channels', { keyPath: 'id' });
        channels.createIndex('sourceId', 'sourceId', { unique: false });
      }

      // Programmes
      if (!database.objectStoreNames.contains('programmes')) {
        const programmes = database.createObjectStore('programmes', { keyPath: 'id' });
        programmes.createIndex('sourceId', 'sourceId', { unique: false });
        programmes.createIndex('channelId', 'channelId', { unique: false });
        programmes.createIndex('start', 'start', { unique: false });
      }

      // App settings (active source, favorites, order, period preference)
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

async function getSetting(key, defaultValue = null) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
    req.onerror = () => reject(req.error);
  });
}

async function setSetting(key, value) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Sources ----------

async function getAllSources() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sources', 'readonly');
    const req = tx.objectStore('sources').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getSource(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sources', 'readonly');
    const req = tx.objectStore('sources').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveSource(source) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sources', 'readwrite');
    const req = tx.objectStore('sources').put(source);
    req.onsuccess = () => resolve(source);
    req.onerror = () => reject(req.error);
  });
}

async function deleteSource(id) {
  const database = await openDB();
  // Also clean related channels & programmes
  await clearSourceData(id);
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sources', 'readwrite');
    const req = tx.objectStore('sources').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearSourceData(sourceId) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['channels', 'programmes'], 'readwrite');

    // Delete channels
    const chStore = tx.objectStore('channels');
    const chIndex = chStore.index('sourceId');
    const chReq = chIndex.openCursor(IDBKeyRange.only(sourceId));
    chReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // Delete programmes
    const prStore = tx.objectStore('programmes');
    const prIndex = prStore.index('sourceId');
    const prReq = prIndex.openCursor(IDBKeyRange.only(sourceId));
    prReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Channels ----------

async function getChannelsBySource(sourceId) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('channels', 'readonly');
    const index = tx.objectStore('channels').index('sourceId');
    const req = index.getAll(sourceId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveChannels(channels) {
  if (!channels || !channels.length) return;
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('channels', 'readwrite');
    const store = tx.objectStore('channels');
    channels.forEach(ch => store.put(ch));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Programmes ----------

async function getProgrammesByChannel(channelId, fromDate, toDate) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('programmes', 'readonly');
    const index = tx.objectStore('programmes').index('channelId');
    const req = index.getAll(channelId);
    req.onsuccess = () => {
      let list = req.result || [];
      if (fromDate) {
        const from = fromDate.getTime();
        list = list.filter(p => p.start >= from);
      }
      if (toDate) {
        const to = toDate.getTime();
        list = list.filter(p => p.start < to);
      }
      list.sort((a, b) => a.start - b.start);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveProgrammes(programmes) {
  if (!programmes || !programmes.length) return;
  const database = await openDB();
  // Batch in chunks to avoid large transactions
  const CHUNK = 500;
  for (let i = 0; i < programmes.length; i += CHUNK) {
    const chunk = programmes.slice(i, i + CHUNK);
    await new Promise((resolve, reject) => {
      const tx = database.transaction('programmes', 'readwrite');
      const store = tx.objectStore('programmes');
      chunk.forEach(p => store.put(p));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

async function searchProgrammes(sourceId, query) {
  const database = await openDB();
  const q = query.toLowerCase().trim();
  if (!q) return [];

  return new Promise((resolve, reject) => {
    const tx = database.transaction('programmes', 'readonly');
    const index = tx.objectStore('programmes').index('sourceId');
    const req = index.getAll(sourceId);
    req.onsuccess = () => {
      const results = (req.result || []).filter(p => {
        const title = (p.title || '').toLowerCase();
        const desc = (p.desc || '').toLowerCase();
        const category = (p.category || '').toLowerCase();
        return title.includes(q) || desc.includes(q) || category.includes(q);
      });
      // Group by channel, keep earliest upcoming or current
      const byChannel = new Map();
      const now = Date.now();
      results.forEach(p => {
        const existing = byChannel.get(p.channelId);
        if (!existing || (p.start >= now && p.start < existing.start) || (existing.start < now && p.start > existing.start)) {
          byChannel.set(p.channelId, p);
        }
      });
      resolve(Array.from(byChannel.values()));
    };
    req.onerror = () => reject(req.error);
  });
}

// Favorites & order are stored in settings as objects keyed by sourceId
async function getFavorites(sourceId) {
  const all = await getSetting('favorites', {});
  return all[sourceId] || [];
}

async function setFavorites(sourceId, favIds) {
  const all = await getSetting('favorites', {});
  all[sourceId] = favIds;
  await setSetting('favorites', all);
}

async function getChannelOrder(sourceId) {
  const all = await getSetting('channelOrder', {});
  return all[sourceId] || [];
}

async function setChannelOrder(sourceId, orderIds) {
  const all = await getSetting('channelOrder', {});
  all[sourceId] = orderIds;
  await setSetting('channelOrder', all);
}
