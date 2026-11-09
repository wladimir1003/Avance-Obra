// Little-endian readers and basic MPP value conversions.
// Ported from MPXJ (org.mpxj.common.ByteArrayHelper, org.mpxj.mpp.MPPUtility), LGPL-2.1.

export function getShort(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

export function getInt(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) | 0;
}

export function getLong(data, offset) {
  const low = BigInt(getInt(data, offset) >>> 0);
  const high = BigInt(getInt(data, offset + 4));
  return (high << 32n) | low;
}

// Same as MPPUtility.getDouble: NaN in the file reads as 0.
export function getDouble(data, offset) {
  const value = new DataView(data.buffer, data.byteOffset + offset, 8).getFloat64(0, true);
  return Number.isNaN(value) ? 0 : value;
}

// UTF-16LE string, terminated by a zero char or the end of the array.
export function getUnicodeString(data, offset, maxBytes = data.length - offset) {
  const end = Math.min(data.length, offset + maxBytes);
  let text = '';
  for (let i = offset; i + 1 < end; i += 2) {
    const code = getShort(data, i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

// MPP dates count from 1983-12-31. Everything is done in UTC to avoid time zone shifts:
// the result is a zone-less "project local" date.
export const EPOCH_MS = Date.UTC(1983, 11, 31);
const DAY_MS = 86400000;

// Same output as Java's LocalDateTime.toString(): YYYY-MM-DDTHH:MM, :SS only when non-zero.
export function formatDateTime(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  let text = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (d.getUTCSeconds() !== 0) text += `:${pad(d.getUTCSeconds())}`;
  return text;
}

// Date + time: 2 bytes of time (tenths of a minute) + 2 bytes of days since the epoch.
export function getTimestamp(data, offset) {
  const days = getShort(data, offset + 2);
  if (days <= 1 || days === 65535) return null;
  let time = getShort(data, offset);
  if (time === 65535) time = 0;
  const seconds = time * 6;
  // Tiny day counts with non-zero seconds: Project shows these as "NA".
  if (days < 100 && seconds % 60 !== 0) return null;
  return formatDateTime(EPOCH_MS + days * DAY_MS + seconds * 1000);
}

// Date only (2 bytes of days since the epoch), at midnight.
export function getDate(data, offset) {
  const days = getShort(data, offset);
  if (days === 65535) return null;
  return formatDateTime(EPOCH_MS + days * DAY_MS);
}

// Date/time as tenths of a minute since the epoch (4-byte int).
export function getTimestampFromTenths(data, offset) {
  return formatDateTime(EPOCH_MS + getInt(data, offset) * 6000);
}
