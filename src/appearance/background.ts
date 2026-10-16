// Decorative assets are stored separately from documents and their undo/export data.
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n));
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && v.getUint32(0) === 0x89504e47) {
    for (let p = 8; p + 12 <= bytes.length;) {
      const n = v.getUint32(p);
      if (ascii(p + 4, 4) === 'acTL') throw new Error('请选择静态图片，不支持动态 PNG。');
      p += n + 12;
    }
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length >= 4 && v.getUint16(0) === 0xffd8) {
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p] !== 0xff) break;
      while (bytes[p] === 0xff) p++;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > bytes.length) break;
      const n = v.getUint16(p);
      if (n < 2 || p + n > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && n >= 7) {
        return { width: v.getUint16(p + 5), height: v.getUint16(p + 3) };
      }
      p += n;
    }
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    const u24 = (p: number) => bytes[p] + (bytes[p + 1] << 8) + (bytes[p + 2] << 16);
    if (chunk === 'VP8X') {
      if (bytes[20] & 2) throw new Error('请选择静态图片，不支持动态 WebP。');
      return { width: u24(24) + 1, height: u24(27) + 1 };
    }
    if (chunk === 'VP8 ') return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const n = v.getUint32(21, true);
      return { width: (n & 0x3fff) + 1, height: ((n >>> 14) & 0x3fff) + 1 };
    }
  }
  throw new Error('无法识别图片尺寸，请选择有效的静态 PNG、JPEG 或 WebP 文件。');
}
export function displaySize(width: number, height: number) {
  if (width < 1 || height < 1 || width * height > 24_000_000) throw new Error('工作台背景不得超过 2400 万像素；此限制不适用于编辑文档。');
  const scale = Math.min(1, 2560 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
export async function prepareBackground(file: File): Promise<Blob> {
  if (file.size > 10 * 1024 * 1024) throw new Error('工作台背景文件不得超过 10 MB，请先缩小图片后重试。');
  const dimensions = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  displaySize(dimensions.width, dimensions.height); // Check before allocating decoded pixels.
  const bitmap = await createImageBitmap(file);
  try {
    const size = displaySize(bitmap.width, bitmap.height);
    const c = document.createElement('canvas');
    c.width = size.width; c.height = size.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('无法准备背景预览，请重试。');
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error('无法生成背景副本。')), 'image/webp', 0.86));
  } finally { bitmap.close(); }
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tjm-workbench-appearance', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('assets');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('本地背景存储被其他窗口占用，请关闭旧窗口后重试。'));
  });
}
export async function backgroundAsset(action: 'read' | 'write' | 'delete', blob?: Blob): Promise<Blob | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', action === 'read' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('assets');
      const req = action === 'read' ? store.get('background') : action === 'write' ? store.put(blob, 'background') : store.delete('background');
      let result: Blob | undefined;
      req.onsuccess = () => { result = req.result instanceof Blob ? req.result : undefined; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('本地背景存储已中断。'));
    });
  } finally { db.close(); }
}
