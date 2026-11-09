// MPP table blocks: FixedMeta/FixedData (fixed-size records) and VarMeta/Var2Data
// (variable-length values keyed by unique ID and field key).
// Ported from MPXJ (FixedMeta, FixedData, VarMeta12, AbstractVarMeta, Var2Data), LGPL-2.1.
import { MppError } from './errors.js';
import { getShort, getInt, getDouble, getUnicodeString } from './bytes.js';

const MAGIC = 0xfadfadba | 0;
const FIXED_META_HEADER = 16;

// itemSize: a number, or (fileSize, itemCount) => number.
export function readFixedMeta(data, itemSize) {
  if (!data || data.length < FIXED_META_HEADER || getInt(data, 0) !== MAGIC) {
    throw new MppError('corrupt', 'The Project file is damaged (invalid data block).');
  }
  const itemCount = getInt(data, 8);
  const size = typeof itemSize === 'function' ? itemSize(data.length, itemCount) : itemSize;
  const adjustedItemCount = Math.floor((data.length - FIXED_META_HEADER) / size);
  const items = [];
  for (let i = 0; i < adjustedItemCount; i++) {
    const start = FIXED_META_HEADER + i * size;
    items.push(data.subarray(start, start + size));
  }
  return { itemCount, adjustedItemCount, items };
}

// Picks the FixedMeta item size by checking it against another block (e.g. Fixed2Meta).
export function itemSizeMatching(otherFixedData, ...itemSizes) {
  return (fileSize, itemCount) => {
    let itemSize = itemSizes[0];
    const available = fileSize - FIXED_META_HEADER;
    let distance = -Infinity;
    for (const test of itemSizes) {
      if (available % test === 0) {
        if (available / test === otherFixedData.items.length) {
          itemSize = test;
          break;
        }
        const testDistance = itemCount * test - available;
        if (testDistance <= 0 && testDistance > distance) {
          itemSize = test;
          distance = testDistance;
        }
      }
    }
    return itemSize;
  };
}

// FixedData driven by FixedMeta: each item runs from its offset to the next one.
export function readFixedData(meta, buffer, maxExpectedSize = 0, minSize = 0) {
  buffer = buffer ?? new Uint8Array();
  const count = meta.adjustedItemCount;
  const items = new Array(count).fill(null);
  const offsets = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    const itemOffset = getInt(meta.items[i], 4);
    if (itemOffset < 0 || itemOffset > buffer.length) continue;
    let itemSize = i + 1 === count ? buffer.length - itemOffset : getInt(meta.items[i + 1], 4) - itemOffset;
    if (itemSize === 0) itemSize = minSize;
    const available = buffer.length - itemOffset;
    if (itemSize < 0 || itemSize > available) itemSize = maxExpectedSize === 0 ? available : Math.min(maxExpectedSize, available);
    if (maxExpectedSize !== 0 && itemSize > maxExpectedSize) itemSize = maxExpectedSize;
    if (itemSize > 0) {
      items[i] = buffer.slice(itemOffset, itemOffset + itemSize);
      offsets[i] = itemOffset;
    }
  }
  return { items, offsets };
}

// FixedData driven by FixedMeta with a fixed item size. Like MPXJ, once the size is cut short
// by missing data it stays that way for the following items.
export function readFixedDataWithSize(meta, itemSize, buffer) {
  buffer = buffer ?? new Uint8Array();
  const count = meta.adjustedItemCount;
  const items = new Array(count).fill(null);
  const offsets = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    const itemOffset = getInt(meta.items[i], 4);
    if (itemOffset < 0 || itemOffset > buffer.length) continue;
    const available = buffer.length - itemOffset;
    if (itemSize < 0 || itemSize > available) itemSize = available;
    items[i] = buffer.slice(itemOffset, itemOffset + itemSize);
    offsets[i] = itemOffset;
  }
  return { items, offsets };
}

// FixedData without meta: back-to-back items of the same size.
export function readFixedBlocks(itemSize, buffer, readRemainderBlock = false) {
  buffer = buffer ?? new Uint8Array();
  let count = Math.floor(buffer.length / itemSize);
  if (readRemainderBlock && buffer.length % itemSize !== 0) count++;
  const items = [];
  const offsets = [];
  for (let i = 0; i < count; i++) {
    const start = i * itemSize;
    offsets.push(start);
    items.push(buffer.slice(start, Math.min(start + itemSize, buffer.length)));
  }
  return { items, offsets };
}

export function fixedItem(fixed, index) {
  return index >= 0 && index < fixed.items.length ? fixed.items[index] : null;
}

// VarMeta12: unique ID -> field key -> offset into Var2Data.
export function readVarMeta12(data) {
  if (!data || data.length < 24) throw new MppError('corrupt', 'The Project file is damaged (invalid data index).');
  const magic = getInt(data, 0);
  if (magic !== 0 && magic !== MAGIC) throw new MppError('corrupt', 'The Project file is damaged (invalid data index).');
  const itemCount = getInt(data, 8);
  const table = new Map();
  const offsets = [];
  let pos = 24;
  for (let i = 0; i < itemCount; i++) {
    if (data.length - pos < 12) break;
    const uniqueID = getInt(data, pos);
    const offset = getInt(data, pos + 4);
    const type = getShort(data, pos + 8);
    pos += 12;
    if (!table.has(uniqueID)) table.set(uniqueID, new Map());
    table.get(uniqueID).set(type, offset);
    offsets.push(offset);
  }
  // Same as MPXJ: if the data ends early, missing offsets are 0.
  while (offsets.length < itemCount) offsets.push(0);
  offsets.sort((a, b) => a - b);
  return { table, offsets };
}

export class VarData {
  constructor(meta, buffer) {
    this.meta = meta;
    this.map = new Map();
    buffer = buffer ?? new Uint8Array();
    for (const itemOffset of meta.offsets) {
      if (itemOffset >= buffer.length || this.map.has(itemOffset)) continue;
      if (itemOffset < 0 || buffer.length - itemOffset < 4) continue;
      const size = getInt(buffer, itemOffset);
      if (size < 0 || size > buffer.length - itemOffset - 4) continue;
      this.map.set(itemOffset, buffer.slice(itemOffset + 4, itemOffset + 4 + size));
    }
  }

  hasUniqueID(id) {
    return this.meta.table.has(id);
  }

  uniqueIDs() {
    return [...this.meta.table.keys()].sort((a, b) => a - b);
  }

  getByteArray(id, type) {
    const offset = this.meta.table.get(id)?.get(type);
    return offset === undefined ? null : this.map.get(offset) ?? null;
  }

  getUnicodeString(id, type) {
    const value = this.getByteArray(id, type);
    return value ? getUnicodeString(value, 0) : null;
  }

  getShort(id, type) {
    const value = this.getByteArray(id, type);
    return value && value.length >= 2 ? getShort(value, 0) : 0;
  }

  getInt(id, type) {
    const value = this.getByteArray(id, type);
    return value && value.length >= 4 ? getInt(value, 0) : 0;
  }

  // Same as Var2Data.getDouble: fewer than 8 bytes or NaN gives 0.
  getDouble(id, type) {
    const value = this.getByteArray(id, type);
    return value && value.length >= 8 ? getDouble(value, 0) : 0;
  }
}
