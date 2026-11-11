/**
 * Local idea store — IndexedDB for audio buffers, localStorage for last-opened id.
 */

const DB_NAME = 'mrzesty-sketchpad';
const DB_VERSION = 1;
const STORE = 'ideas';
const LAST_KEY = 'mrzesty.lastIdeaId';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {Float32Array | null} samples
 * @returns {Blob | null}
 */
function samplesToBlob(samples) {
  if (!samples || samples.length === 0) return null;
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return new Blob([copy.buffer], { type: 'application/octet-stream' });
}

/**
 * @param {Blob | null} blob
 * @returns {Promise<Float32Array | null>}
 */
async function blobToSamples(blob) {
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return new Float32Array(buf);
}

/**
 * Persist a sketchpad idea (tracks as binary blobs).
 * @param {object} idea
 * @returns {Promise<string>} id
 */
export async function saveIdea(idea) {
  const id = idea.id || crypto.randomUUID();
  const record = {
    id,
    name: idea.name || 'Untitled idea',
    updatedAt: Date.now(),
    bpm: idea.bpm,
    bars: idea.bars,
    autoLoop: idea.autoLoop,
    metronome: idea.metronome,
    swing: idea.swing,
    drumsOn: idea.drumsOn,
    bassOn: idea.bassOn,
    chopsOn: idea.chopsOn,
    drumsMute: idea.drumsMute,
    bassMute: idea.bassMute,
    chopsMute: idea.chopsMute,
    drumVolume: idea.drumVolume,
    bassVolume: idea.bassVolume,
    chopVolume: idea.chopVolume,
    styleId: idea.styleId,
    drumPatternId: idea.drumPatternId,
    bassPatternId: idea.bassPatternId,
    variation: idea.variation,
    bassRootSemis: idea.bassRootSemis,
    bassOctave: idea.bassOctave,
    bassVoice: idea.bassVoice,
    masterVolume: idea.masterVolume,
    micGainDb: idea.micGainDb,
    micAutoLevel: idea.micAutoLevel,
    harmony: idea.harmony,
    tracks: (idea.tracks || []).map((t) => ({
      name: t.name,
      mute: t.mute,
      volume: t.volume,
      sampleRate: t.sampleRate,
      samples: samplesToBlob(t.samples),
    })),
  };

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* */
  }
  return id;
}

/**
 * @returns {Promise<Array<{ id: string, name: string, updatedAt: number }>>}
 */
export async function listIdeas() {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows
    .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function loadIdea(id) {
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!record) return null;

  const tracks = [];
  for (const t of record.tracks || []) {
    tracks.push({
      name: t.name,
      mute: t.mute,
      volume: t.volume,
      sampleRate: t.sampleRate,
      samples: await blobToSamples(t.samples),
    });
  }

  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* */
  }

  return { ...record, tracks };
}

/**
 * @param {string} id
 */
export async function deleteIdea(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  try {
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
  } catch {
    /* */
  }
}

export function getLastIdeaId() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
