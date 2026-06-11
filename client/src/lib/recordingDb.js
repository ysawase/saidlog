// 録音チャンクの IndexedDB 逐次保存。
// ブラウザクラッシュ・誤タブクローズ対策として、MediaRecorder の
// ondataavailable ごとにチャンクを保存し、次回起動時に復元できるようにする。
// スキーマ：{ sessionId, seq, blob, mimeType, ts }（キーは [sessionId, seq]）

const DB_NAME = 'meetlog-recording';
const DB_VERSION = 1;
const STORE = 'chunks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['sessionId', 'seq'] });
        store.createIndex('bySession', 'sessionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 録音チャンクを1件保存する */
export async function saveChunk(sessionId, seq, blob, mimeType) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ sessionId, seq, blob, mimeType, ts: Date.now() });
    await txDone(tx);
  } finally {
    db.close();
  }
}

/**
 * 保存中の録音セッション一覧を返す（復元ダイアログ用）。
 * @returns {Promise<Array<{sessionId, chunkCount, totalBytes, mimeType, startedAt, lastAt}>>}
 */
export async function listSessions() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const sessions = new Map();
    await new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const { sessionId, blob, mimeType, ts } = cursor.value;
        const s = sessions.get(sessionId) || {
          sessionId,
          chunkCount: 0,
          totalBytes: 0,
          mimeType,
          startedAt: ts,
          lastAt: ts,
        };
        s.chunkCount += 1;
        s.totalBytes += blob.size;
        s.startedAt = Math.min(s.startedAt, ts);
        s.lastAt = Math.max(s.lastAt, ts);
        sessions.set(sessionId, s);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return [...sessions.values()];
  } finally {
    db.close();
  }
}

/** セッションの全チャンクを連番順に連結した Blob を返す */
export async function getSessionBlob(sessionId) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('bySession');
    const chunks = await new Promise((resolve, reject) => {
      const req = index.getAll(sessionId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (chunks.length === 0) return null;
    chunks.sort((a, b) => a.seq - b.seq);
    const mimeType = chunks[0].mimeType;
    return new Blob(chunks.map((c) => c.blob), { type: mimeType });
  } finally {
    db.close();
  }
}

/** セッションの全チャンクを削除する（送信完了・端末保存・破棄時） */
export async function clearSession(sessionId) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const index = store.index('bySession');
    await new Promise((resolve, reject) => {
      const req = index.openCursor(sessionId);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** 指定日数より古いチャンクの残骸を削除する（起動時の自動掃除用） */
export async function cleanupStale(maxAgeDays = 7) {
  const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    await new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        if (cursor.value.ts < threshold) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
  } finally {
    db.close();
  }
}
