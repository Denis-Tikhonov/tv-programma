const DB = {
  _db: null,
  NAME: 'tv-programma',
  VERSION: 2,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('channels')) {
          const ch = db.createObjectStore('channels', { keyPath: 'id' });
          ch.createIndex('sourceId', 'sourceId', { unique: false });
        }
        if (!db.objectStoreNames.contains('programmes')) {
          const pr = db.createObjectStore('programmes', { keyPath: 'uid' });
          pr.createIndex('channelId', 'channelId', { unique: false });
          pr.createIndex('start', 'start', { unique: false });
        }
        if (!db.objectStoreNames.contains('favorites')) {
          db.createObjectStore('favorites', { keyPath: 'channelId' });
        }
        if (!db.objectStoreNames.contains('sources')) {
          db.createObjectStore('sources', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this._db = req.result;
        resolve(this._db);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getMeta(key) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  },

  async setMeta(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveSource(source) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sources', 'readwrite');
      tx.objectStore('sources').put(source);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getSources() {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('sources', 'readonly');
      const req = tx.objectStore('sources').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },

  async getSource(id) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('sources', 'readonly');
      const req = tx.objectStore('sources').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  },

  async clearSourceData(sourceId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['channels', 'programmes'], 'readwrite');
      const chStore = tx.objectStore('channels');
      const prStore = tx.objectStore('programmes');
      const chIdx = chStore.index('sourceId');
      const chReq = chIdx.getAllKeys(sourceId);
      chReq.onsuccess = () => {
        (chReq.result || []).forEach(k => chStore.delete(k));
      };
      // Clear all programmes for simplicity when switching source
      prStore.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async putChannels(channels) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('channels', 'readwrite');
      const store = tx.objectStore('channels');
      channels.forEach(c => store.put(c));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async putProgrammes(programmes) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('programmes', 'readwrite');
      const store = tx.objectStore('programmes');
      // clear old first
      store.clear();
      programmes.forEach(p => store.put(p));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getChannels(sourceId) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('channels', 'readonly');
      const idx = tx.objectStore('channels').index('sourceId');
      const req = idx.getAll(sourceId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },

  async getAllChannels() {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('channels', 'readonly');
      const req = tx.objectStore('channels').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },

  async getProgrammesByChannel(channelId) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('programmes', 'readonly');
      const idx = tx.objectStore('programmes').index('channelId');
      const req = idx.getAll(channelId);
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => a.start - b.start);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  },

  async searchProgrammes(query) {
    const db = await this.open();
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return new Promise((resolve) => {
      const tx = db.transaction('programmes', 'readonly');
      const req = tx.objectStore('programmes').getAll();
      req.onsuccess = () => {
        const results = (req.result || []).filter(p => {
          const title = (p.title || '').toLowerCase();
          const desc = (p.desc || '').toLowerCase();
          const cat = (p.category || '').toLowerCase();
          const ch = (p.channelName || '').toLowerCase();
          return title.includes(q) || desc.includes(q) || cat.includes(q) || ch.includes(q);
        }).sort((a, b) => a.start - b.start);
        resolve(results);
      };
      req.onerror = () => resolve([]);
    });
  },

  async getFavorites() {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('favorites', 'readonly');
      const req = tx.objectStore('favorites').getAll();
      req.onsuccess = () => resolve(new Set((req.result || []).map(f => f.channelId)));
      req.onerror = () => resolve(new Set());
    });
  },

  async toggleFavorite(channelId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('favorites', 'readwrite');
      const store = tx.objectStore('favorites');
      const getReq = store.get(channelId);
      getReq.onsuccess = () => {
        if (getReq.result) {
          store.delete(channelId);
          resolve(false);
        } else {
          store.put({ channelId });
          resolve(true);
        }
      };
      tx.onerror = () => reject(tx.error);
    });
  }
};
