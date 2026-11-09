// Opens the OLE2 container and detects the .mpp file version.
// CompObj parsing ported from MPXJ (org.mpxj.mpp.CompObj, MPPReader), LGPL-2.1.
import { MppError } from './errors.js';

export const SUPPORTED_FORMATS = ['MSProject.MPP14', 'MSProject.MPT14'];

// Project versions that save in unsupported formats, for readable error messages.
const LEGACY_FORMATS = {
  'MSProject.MPP4': 'Project 4.0',
  'MSProject.MPP8': 'Project 98',
  'MSProject.MPT8': 'Project 98',
  'MSProject.MPP9': 'Project 2000, 2002 or 2003',
  'MSProject.MPT9': 'Project 2000, 2002 or 2003',
  'MSProject.GLOBAL9': 'Project 2000, 2002 or 2003',
  'MSProject.MPP12': 'Project 2007',
  'MSProject.MPT12': 'Project 2007',
  'MSProject.GLOBAL12': 'Project 2007',
};

const COMPOBJ = '\u0001CompObj';

// Reads CompObj: 28-byte header, then length-prefixed (int32 LE), null-terminated strings.
export function readCompObj(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 28;

  const readString = () => {
    if (offset + 4 > bytes.length) return null;
    const length = view.getInt32(offset, true);
    offset += 4;
    if (length <= 0 || offset + length > bytes.length) return null;
    let text = '';
    for (let i = 0; i < length - 1; i++) text += String.fromCharCode(bytes[offset + i]);
    offset += length;
    return text;
  };

  const applicationName = readString();
  if (applicationName === 'Microsoft Project 4.0') {
    return { applicationName, fileFormat: 'MSProject.MPP4' };
  }
  return { applicationName, fileFormat: readString() };
}

// Contents of a stream sitting directly in the container root.
function rootEntry(container, name) {
  for (let i = 0; i < container.FileIndex.length; i++) {
    const entry = container.FileIndex[i];
    const depth = container.FullPaths[i].split('/').filter(Boolean).length;
    if (entry.name === name && depth === 2) return entry;
  }
  return null;
}

// Opens .mpp bytes with cfb (passed in by the caller) and checks the format.
export function openMpp(bytes, CFB) {
  let container;
  try {
    container = CFB.read(bytes, { type: 'array' });
  } catch {
    throw new MppError('not-ole', 'This is not a Microsoft Project file, or it is damaged.');
  }

  const compObj = rootEntry(container, COMPOBJ);
  if (!compObj || !compObj.content) {
    throw new MppError('not-mpp', 'This does not look like a Microsoft Project file (.mpp).');
  }

  const { applicationName, fileFormat } = readCompObj(Uint8Array.from(compObj.content));

  if (!fileFormat || !fileFormat.startsWith('MSProject.')) {
    throw new MppError('not-mpp', 'This does not look like a Microsoft Project file (.mpp).');
  }
  if (LEGACY_FORMATS[fileFormat]) {
    throw new MppError('unsupported-version',
      `This file is in ${LEGACY_FORMATS[fileFormat]} format: only files from Project 2010 or later (including Project 365) are supported for now. ` +
      'Open it in Project and save it again in the current format.');
  }
  if (!SUPPORTED_FORMATS.includes(fileFormat)) {
    throw new MppError('unsupported-version', `Unsupported Project format (${fileFormat}).`);
  }

  return { format: fileFormat, applicationName, container };
}
