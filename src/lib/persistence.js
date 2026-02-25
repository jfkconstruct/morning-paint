const DB_NAME = 'morning-paint'
const DB_VERSION = 1
const TILE_STORE = 'tiles'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

export async function saveDirtyTilesToDB(tiles, dirtyKeys) {
  if (!dirtyKeys || dirtyKeys.size === 0) return
  const keys = Array.from(dirtyKeys)
  const ops = await Promise.all(keys.map(async (key) => {
    const canvas = tiles.get(key)
    if (!canvas) return { key, blob: null }
    const blob = await canvasToBlob(canvas)
    return { key, blob }
  }))
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TILE_STORE, 'readwrite')
      const store = tx.objectStore(TILE_STORE)
      for (const op of ops) {
        if (op.blob) store.put(op.blob, op.key)
        else store.delete(op.key)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }).catch(() => {})
}

export function loadTilesFromDB(tileSize) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TILE_STORE, 'readonly')
      const store = tx.objectStore(TILE_STORE)
      const req = store.openCursor()
      const tiles = new Map()
      let count = 0
      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (!cursor) {
          if (count === 0) { resolve(null); return }
          resolve(tiles)
          return
        }
        count++
        const key = cursor.key
        const blob = cursor.value
        const img = new Image()
        const url = URL.createObjectURL(blob)
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = tileSize
          c.height = tileSize
          c.getContext('2d').drawImage(img, 0, 0)
          URL.revokeObjectURL(url)
          tiles.set(key, c)
          cursor.continue()
        }
        img.onerror = () => {
          URL.revokeObjectURL(url)
          cursor.continue()
        }
        img.src = url
      }
      req.onerror = () => reject(req.error)
    })
  }).catch(() => null)
}

export function saveSettings(obj) {
  try {
    localStorage.setItem('mp-settings', JSON.stringify(obj))
  } catch {
    // Ignore storage errors (private mode / quota).
  }
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('mp-settings'))
  } catch {
    return null
  }
}
