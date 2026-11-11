// Lagring på enheten (IndexedDB). Inget skickas någon annanstans.
//
// visits: ett dokument per besök, med rummen inbäddade
// photos: ett dokument per foto { id, visitId, roomId, data (dataURL) }
// meta:   mallen och andra inställningar

const NAME = 'matverktyg';
const VERSION = 1;
let dbPromise;

function open() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('visits', { keyPath: 'id' });
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('visitId', 'visitId');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    const req = fn(tx);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const listVisits = () => run('visits', 'readonly', (tx) => tx.objectStore('visits').getAll());
export const getVisit = (id) => run('visits', 'readonly', (tx) => tx.objectStore('visits').get(id));
export const putVisit = (visit) => run('visits', 'readwrite', (tx) => tx.objectStore('visits').put(visit));

export const deleteVisit = (id) =>
  run(['visits', 'photos'], 'readwrite', (tx) => {
    tx.objectStore('visits').delete(id);
    const cursorReq = tx.objectStore('photos').index('visitId').openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (c) { c.delete(); c.continue(); }
    };
  });

export const photosForVisit = (visitId) =>
  run('photos', 'readonly', (tx) => tx.objectStore('photos').index('visitId').getAll(visitId));
export const putPhoto = (photo) => run('photos', 'readwrite', (tx) => tx.objectStore('photos').put(photo));
export const deletePhoto = (id) => run('photos', 'readwrite', (tx) => tx.objectStore('photos').delete(id));

export const getMeta = (key) => run('meta', 'readonly', (tx) => tx.objectStore('meta').get(key));
export const setMeta = (key, value) => run('meta', 'readwrite', (tx) => tx.objectStore('meta').put(value, key));
