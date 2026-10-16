/**
 * Bytes for a blank "new document": an uncompressed 24-bit BMP of the background colour.
 * A flat image without alpha is what the engine imports as a real Background layer
 * (transparency + position locked, like File › New in Photoshop), so the eraser paints the
 * background colour there instead of punching transparent holes. BMP is lossless and trivial
 * to synthesise, so the colour is exact (a PSD from ag-psd came in as an unnamed transparent layer).
 */
export function blankImage(width: number, height: number, bg = { r: 255, g: 255, b: 255 }): ArrayBuffer {
  const rowBytes = (width * 3 + 3) & ~3;
  const pixelBytes = rowBytes * height;
  const buf = new ArrayBuffer(54 + pixelBytes);
  const dv = new DataView(buf);
  // BITMAPFILEHEADER
  dv.setUint8(0, 0x42); dv.setUint8(1, 0x4d); // "BM"
  dv.setUint32(2, buf.byteLength, true);
  dv.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // positive = bottom-up rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true); // BI_RGB
  dv.setUint32(34, pixelBytes, true);
  dv.setInt32(38, 2835, true); // 72 dpi
  dv.setInt32(42, 2835, true);
  const px = new Uint8Array(buf, 54);
  for (let y = 0; y < height; y++) {
    let o = y * rowBytes;
    for (let x = 0; x < width; x++) { px[o++] = bg.b; px[o++] = bg.g; px[o++] = bg.r; }
  }
  return buf;
}
