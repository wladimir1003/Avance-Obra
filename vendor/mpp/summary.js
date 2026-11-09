// OLE document properties (SummaryInformation and DocumentSummaryInformation, MS-OLEPS):
// title, subject, author, manager, company. Replaces the POI library MPXJ uses.
import { getShort, getInt } from './bytes.js';

export const SUMMARY_PID = { TITLE: 2, SUBJECT: 3, AUTHOR: 4 };
export const DOC_SUMMARY_PID = { MANAGER: 14, COMPANY: 15 };

const VT_LPSTR = 0x1e;
const VT_LPWSTR = 0x1f;
const PID_CODEPAGE = 1;

function decode8bit(bytes, codepage) {
  const label = codepage === 65001 ? 'utf-8' : `windows-${codepage}`;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return Array.from(bytes, b => String.fromCharCode(b)).join('');
  }
}

// Reads the strings of a property set's first section. Returns Map(pid -> string).
// Malformed data: returns what was read so far (Project ignores it too).
export function readPropertySetStrings(data) {
  const result = new Map();
  if (!data || data.length < 48 || getShort(data, 0) !== 0xfffe) return result;
  const sets = getInt(data, 24);
  if (sets < 1) return result;
  const section = getInt(data, 44);
  if (section < 0 || section + 8 > data.length) return result;
  const count = getInt(data, section + 4);

  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = section + 8 + i * 8;
    if (at + 8 > data.length) break;
    entries.push({ pid: getInt(data, at), offset: section + getInt(data, at + 4) });
  }

  let codepage = 1252;
  const cp = entries.find(e => e.pid === PID_CODEPAGE);
  if (cp && cp.offset + 6 <= data.length) codepage = getShort(data, cp.offset + 4);

  for (const { pid, offset } of entries) {
    if (offset + 8 > data.length) continue;
    const type = getShort(data, offset);
    const size = getInt(data, offset + 4);
    if (type === VT_LPSTR && size > 0 && offset + 8 + size <= data.length) {
      let bytes = data.subarray(offset + 8, offset + 8 + size);
      if (codepage === 1200) {
        let text = '';
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const c = getShort(bytes, i);
          if (c === 0) break;
          text += String.fromCharCode(c);
        }
        result.set(pid, text);
        continue;
      }
      const zero = bytes.indexOf(0);
      if (zero >= 0) bytes = bytes.subarray(0, zero);
      result.set(pid, decode8bit(bytes, codepage));
    } else if (type === VT_LPWSTR && size > 0 && offset + 8 + size * 2 <= data.length) {
      let text = '';
      for (let i = 0; i < size; i++) {
        const c = getShort(data, offset + 8 + i * 2);
        if (c === 0) break;
        text += String.fromCharCode(c);
      }
      result.set(pid, text);
    }
  }
  return result;
}
