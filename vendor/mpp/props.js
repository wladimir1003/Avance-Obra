// "Props" blocks: list of values identified by a numeric key.
// Ported from MPXJ (org.mpxj.mpp.Props, Props14, PropsKey), LGPL-2.1.
import { getShort, getInt, getTimestamp, getUnicodeString } from './bytes.js';

// Keys used by the reader (values from MPXJ PropsKey).
export const PropsKey = {
  COMPANY: 37748736,
  MANAGER: 37748737,
  PROJECT_START_DATE: 37748738,
  PROJECT_FINISH_DATE: 37748739,
  TITLE: 37748744,
  SUBJECT: 37748745,
  AUTHOR: 37748748,
  STATUS_DATE: 37748805,
  DURATION_UNITS: 37748757,
  MINUTES_PER_DAY: 37748765,
  MINUTES_PER_WEEK: 37748766,
  DAYS_PER_MONTH: 37753743,
  PASSWORD_FLAG: 893386752,
  PROTECTION_PASSWORD_HASH: 893386756,
  ENCRYPTION_CODE: 893386759,
  TASK_FIELD_MAP: 131092,
  TASK_FIELD_MAP2: 50331668,
  RESOURCE_FIELD_MAP: 131093,
  RESOURCE_FIELD_MAP2: 50331669,
  RELATION_FIELD_MAP: 131094,
  ASSIGNMENT_FIELD_MAP: 131095,
  ASSIGNMENT_FIELD_MAP2: 50331671,
  ENTERPRISE_CUSTOM_FIELD_MAP: 37753797,
};

// Props14 layout: 16-byte header (entry count at offset 12), then for each entry
// length, key and a third int (4 bytes each), the data, and 2-byte alignment.
export function readProps14(data) {
  const map = new Map();
  if (data.length < 16) return new Props(map);
  const count = getShort(data, 12);
  let offset = 16;
  for (let found = 0; found < count; found++) {
    if (data.length - offset < 12) break;
    const length = getInt(data, offset);
    const key = getInt(data, offset + 4);
    offset += 12;
    if (data.length - offset < length || length < 1) break;
    map.set(key, data.subarray(offset, offset + length));
    offset += length;
    if (length % 2 !== 0) offset += 1;
  }
  return new Props(map);
}

export class Props {
  constructor(map) {
    this.map = map;
  }

  getByteArray(key) {
    return this.map.get(key) ?? null;
  }

  getByte(key) {
    const item = this.map.get(key);
    return item ? item[0] : 0;
  }

  getShort(key) {
    const item = this.map.get(key);
    return item ? getShort(item, 0) : 0;
  }

  getInt(key) {
    const item = this.map.get(key);
    return item ? getInt(item, 0) : 0;
  }

  getTimestamp(key) {
    const item = this.map.get(key);
    return item ? getTimestamp(item, 0) : null;
  }

  getUnicodeString(key) {
    const item = this.map.get(key);
    return item ? getUnicodeString(item, 0) : null;
  }
}
