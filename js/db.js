// Taller — IndexedDB layer. Everything stays on the device.
// v2 adds: equipment register, photos (compressed blobs), richer logs.

const DB_NAME = 'taller-db';
const DB_VERSION = 2;
let _db = null;

// Is this failure "the phone is full"? Storage exhaustion is the single most
// likely write failure on a 2 GB device with a 300-page manual, and it must be
// reported to the technician rather than swallowed.
export function isQuotaError(e) {
  if (!e) return false;
  const n = e.name || (e.target && e.target.error && e.target.error.name) || '';
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED';
}

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
    req.onsuccess = () => {
      _db = req.result;
      // If another tab wipes or upgrades the database, close our handle so its
      // delete/upgrade can complete instead of hanging on us for ever.
      _db.onversionchange = () => { try { _db.close(); } catch (e) { /* ignore */ } _db = null; };
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('db-blocked'));
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
      t.onabort = () => reject(t.error || new Error('tx aborted'));
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
      // Without onabort, a quota abort that does not bubble a request error
      // leaves this promise for ever pending and the import modal spinning.
      t.onabort = () => reject(t.error || new Error('tx aborted'));
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
  // Stamp every local write so a restore can tell which copy of a record is
  // newer. Without this, restoring an older backup silently reverts a machine's
  // status, parts list, PM date and photo with no way to detect it.
  putEquipment(e) {
    e.updatedAt = new Date().toISOString();
    return tx('equipment', 'readwrite', s => s.put(e));
  },
  // Verbatim write, preserving updatedAt — used by restore only.
  putEquipmentRaw(e) { return tx('equipment', 'readwrite', s => s.put(e)); },
  async deleteEquipment(id) {
    const eq = await this.getEquipment(id);
    if (eq && eq.photoId) await this.deletePhoto(eq.photoId);
    // Detach logs from this equipment but KEEP the machine's name on them.
    // Logs written against a registered machine store equipment:'' (the name
    // lived on the equipment record), so simply nulling equipmentId used to
    // turn years of service history into anonymous "No equipment" rows —
    // irreversibly, and exactly when a tech retires and deletes an old asset.
    const label = eq ? (eq.name || [eq.manufacturer, eq.model].filter(Boolean).join(' ')) : '';
    const logs = await this.logsForEquipment(id);
    for (const l of logs) {
      l.equipmentId = null;
      if (!l.equipment && label) l.equipment = label;
      await this.putLog(l);
    }
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
  // Use the byEquipment index instead of loading and sorting EVERY log in the
  // database to answer a per-machine question (a full scan of ~6k entries just
  // to return ~20, on every equipment-detail open).
  async logsForEquipment(equipmentId) {
    if (!equipmentId) return [];
    const d = await openDb();
    try {
      const store = d.transaction('logs').objectStore('logs');
      if (store.indexNames.contains('byEquipment')) {
        const rows = await reqProm(store.index('byEquipment').getAll(IDBKeyRange.only(equipmentId)));
        return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0));
      }
    } catch (e) { /* fall through to the scan */ }
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
