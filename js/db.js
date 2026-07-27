// Taller — IndexedDB layer. Everything stays on the device.
// v2 adds: equipment register, photos (compressed blobs), richer logs.

const DB_NAME = 'taller-db';
const DB_VERSION = 2;
let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // --- v1 stores ---
      if (!db.objectStoreNames.contains('manuals')) db.createObjectStore('manuals', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: ['manualId', 'page'] });
        s.createIndex('byManual', 'manualId', { unique: false });
      }
      if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      // --- v2 stores ---
      if (!db.objectStoreNames.contains('equipment')) db.createObjectStore('equipment', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      // add index on logs.equipmentId if the logs store already existed (v1→v2)
      try {
        const tx = ev.target.transaction;
        const logStore = tx.objectStore('logs');
        if (!logStore.indexNames.contains('byEquipment')) logStore.createIndex('byEquipment', 'equipmentId', { unique: false });
      } catch (e) { /* ignore */ }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  }));
}

function reqProm(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  // --- manuals ---
  async listManuals() {
    const d = await openDb();
    const all = await reqProm(d.transaction('manuals').objectStore('manuals').getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async getManual(id) {
    const d = await openDb();
    return reqProm(d.transaction('manuals').objectStore('manuals').get(id));
  },
  putManual(m) { return tx('manuals', 'readwrite', s => s.put(m)); },
  async deleteManualCascade(id) {
    const d = await openDb();
    await tx('manuals', 'readwrite', s => s.delete(id));
    await tx('files', 'readwrite', s => s.delete(id));
    // unlink from equipment
    const eqs = await this.listEquipment();
    for (const eq of eqs) {
      if (eq.manualId === id) { eq.manualId = null; await this.putEquipment(eq); }
    }
    return new Promise((resolve, reject) => {
      const t = d.transaction('pages', 'readwrite');
      const idx = t.objectStore('pages').index('byManual');
      idx.openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { cur.delete(); cur.continue(); }
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },

  // --- file blobs ---
  putFile(id, blob) { return tx('files', 'readwrite', s => s.put({ id, blob })); },
  async getFile(id) {
    const d = await openDb();
    const rec = await reqProm(d.transaction('files').objectStore('files').get(id));
    return rec ? rec.blob : null;
  },

  // --- page texts ---
  async putPages(records) {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const t = d.transaction('pages', 'readwrite');
      const s = t.objectStore('pages');
      for (const r of records) s.put(r);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
  async getPage(manualId, page) {
    const d = await openDb();
    return reqProm(d.transaction('pages').objectStore('pages').get([manualId, page]));
  },
  async getPagesForManual(manualId) {
    const d = await openDb();
    return reqProm(d.transaction('pages').objectStore('pages').index('byManual').getAll(IDBKeyRange.only(manualId)));
  },

  // --- equipment ---
  async listEquipment() {
    const d = await openDb();
    const all = await reqProm(d.transaction('equipment').objectStore('equipment').getAll());
    return all.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  async getEquipment(id) {
    const d = await openDb();
    return reqProm(d.transaction('equipment').objectStore('equipment').get(id));
  },
  putEquipment(e) { return tx('equipment', 'readwrite', s => s.put(e)); },
  async deleteEquipment(id) {
    const eq = await this.getEquipment(id);
    if (eq && eq.photoId) await this.deletePhoto(eq.photoId);
    // detach logs from this equipment (keep the history entries themselves)
    const logs = await this.logsForEquipment(id);
    for (const l of logs) { l.equipmentId = null; await this.putLog(l); }
    return tx('equipment', 'readwrite', s => s.delete(id));
  },

  // --- photos (compressed blobs) ---
  putPhoto(id, blob) { return tx('photos', 'readwrite', s => s.put({ id, blob })); },
  async getPhoto(id) {
    if (!id) return null;
    const d = await openDb();
    const rec = await reqProm(d.transaction('photos').objectStore('photos').get(id));
    return rec ? rec.blob : null;
  },
  deletePhoto(id) { return tx('photos', 'readwrite', s => s.delete(id)); },

  // --- logs ---
  async listLogs() {
    const d = await openDb();
    const all = await reqProm(d.transaction('logs').objectStore('logs').getAll());
    return all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0));
  },
  async logsForEquipment(equipmentId) {
    const all = await this.listLogs();
    return all.filter(l => l.equipmentId === equipmentId);
  },
  putLog(entry) { return tx('logs', 'readwrite', s => s.put(entry)); },
  async deleteLog(id) {
    const d = await openDb();
    const log = await reqProm(d.transaction('logs').objectStore('logs').get(id));
    if (log && log.photoId) { try { await this.deletePhoto(log.photoId); } catch (e) { /* ignore */ } }
    return tx('logs', 'readwrite', s => s.delete(id));
  },

  // --- key/value ---
  async kvGet(k) {
    const d = await openDb();
    const rec = await reqProm(d.transaction('kv').objectStore('kv').get(k));
    return rec ? rec.v : undefined;
  },
  kvSet(k, v) { return tx('kv', 'readwrite', s => s.put({ k, v })); },
  kvDel(k) { return tx('kv', 'readwrite', s => s.delete(k)); },

  async counterBump(name, by = 1) {
    const cur = (await this.kvGet('counters')) || {};
    cur[name] = (cur[name] || 0) + by;
    await this.kvSet('counters', cur);
    return cur;
  },
  counters() { return this.kvGet('counters').then(c => c || {}); },

  async wipeAll() {
    const d = await openDb();
    d.close(); _db = null;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = resolve; req.onerror = () => reject(req.error); req.onblocked = resolve;
    });
    try { localStorage.removeItem('taller-lang'); } catch (e) { /* keep theme */ }
  },

  async storageEstimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage: usage || 0, quota: quota || 0 };
      }
    } catch (e) { /* ignore */ }
    return { usage: 0, quota: 0 };
  },
};
