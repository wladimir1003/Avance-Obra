// Access to OLE container streams by path, with optional XOR decryption.
// Encryption logic ported from MPXJ (DocumentInputStreamFactory, EncryptedDocumentInputStream), LGPL-2.1.

// Paths are relative to the root, e.g. "   114/Props" (MPP names can start with spaces).
export function streamIndex(container) {
  const index = new Map();
  for (let i = 0; i < container.FullPaths.length; i++) {
    const parts = container.FullPaths[i].split('/');
    const path = parts.slice(1).filter(Boolean).join('/');
    const entry = container.FileIndex[i];
    if (entry.type === 2 && path) index.set(path, entry);
  }
  return index;
}

export function getStream(index, path) {
  const entry = index.get(path);
  if (!entry || !entry.content) return null;
  return entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content);
}

// Some streams in password-protected files are "encrypted" with a single-byte XOR.
export function decrypt(data, mask) {
  if (!data || !mask) return data;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ mask;
  return out;
}
