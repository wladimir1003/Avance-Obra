// Local custom fields (Text1-30, Number1-20, Cost, Date, Start, Finish, Duration, Flag), enterprise fields
// (fixed-name or org-defined), plus their names and types.
// Ported from MPXJ (MPP14Reader flag bits, ResourceAssignmentFactory, CustomFieldReader14,
// PopulatedFields.fieldIsNotDefaultValue, FieldTypeHelper, MPPTaskField), LGPL-2.1.
import { getShort, getInt, getUnicodeString } from './bytes.js';
import { CUSTOM_FIELDS, ENTERPRISE_FIELDS } from './field-tables.js';
import { fieldName, enterpriseFieldName } from './fieldmap.js';
import { readProps14 } from './props.js';

const CUSTOM_FIELDS_KEY = 71303169;

// [offset, mask] for FLAG1..FLAG20 in the meta data, built from two runs of consecutive bits.
function flagTable(flag10, [offset1to9, mask1], [offset11to20, mask11]) {
  const table = [];
  for (let i = 0; i < 9; i++) table.push([offset1to9, mask1 * 2 ** i]);
  table.push(flag10 ?? [offset1to9, mask1 * 2 ** 9]);
  for (let i = 0; i < 10; i++) table.push([offset11to20, mask11 * 2 ** i]);
  return table;
}

// Custom flag positions moved between Project 2010 and 2013 (2016+ same as 2013).
export function customFlagBits(cls, applicationVersion) {
  const recent = (applicationVersion ?? 0) > 14;
  switch (cls) {
    case 'task': return recent ? flagTable(null, [24, 0x2], [33, 0x2]) : flagTable(null, [35, 0x40], [35, 0x40 * 2 ** 10]);
    case 'resource': return recent ? flagTable([19, 0x40], [19, 0x80], [24, 0x80]) : flagTable([28, 0x20], [28, 0x40], [28, 0x8000]);
    case 'assignment': return recent ? flagTable([20, 0x1], [20, 0x2], [25, 0x8]) : flagTable([28, 0x2], [28, 0x4], [28, 0x800]);
    default: return [];
  }
}

// Non-default value (empty, zero, false), same check as MPXJ PopulatedFields.
function isPopulated(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object' && 'value' in value) return value.value !== 0;
  return true;
}

// Custom fields of an item that have a value, in CUSTOM_FIELDS order: [{ field, value }].
// read(map, name) reads one field; metaData: item meta data (for flags);
// alternate: fallback map used when the value is missing (assignments only).
export function readCustomFields(fieldMap, read, metaData, flagBits, alternate = null) {
  const result = [];
  CUSTOM_FIELDS.forEach(field => {
    let value = fieldMap.has(field) ? read(fieldMap, field) : null;
    if (alternate?.has(field) && (value === null || (field.startsWith('COST') && value === 0))) value = read(alternate, field);
    if (field.startsWith('FLAG') && metaData) {
      const [offset, mask] = flagBits[Number(field.slice(4)) - 1];
      value = (getInt(metaData, offset) & mask) !== 0;
    }
    if (isPopulated(value)) result.push({ field, value });
  });
  return result;
}

// User-given field names (CUSTOM_FIELDS block in Props): field ID -> name.
export function readFieldAliases(data) {
  const aliases = new Map();
  if (!data || data.length < 12) return aliases;
  const blockSize = getInt(data, 0);
  const count = getInt(data, 8);
  for (let index = 0, offset = 12; index < count && offset < blockSize && offset + 8 <= data.length; index++, offset += 8) {
    const fieldId = getInt(data, offset);
    const aliasOffset = getInt(data, offset + 4) + 4;
    if (aliasOffset >= 0 && aliasOffset < data.length) {
      const alias = getUnicodeString(data, aliasOffset);
      if (alias !== '') aliases.set(fieldId, alias);
    }
  }
  return aliases;
}

// Data type in enterprise field definitions (EnterpriseCustomFieldDataType); anything else is CUSTOM.
const DEFINITION_TYPES = ['CURRENCY', 'DATE', 'DURATION', 'DATE', 'BOOLEAN', 'NUMERIC', 'DATE', 'STRING'];

// Field definitions (88-byte entries after the names and two unknown blocks): field ID -> type.
export function readFieldDefinitions(data) {
  const types = new Map();
  if (!data || data.length < 4) return types;
  let offset = 4 + getInt(data, 0);
  for (let block = 0; block < 2; block++) {
    if (offset + 4 > data.length) return types;
    offset += 4 + getInt(data, offset);
    if (offset > data.length) return types;
  }
  if (offset + 8 > data.length) return types;
  const count = getInt(data, offset);
  offset += 8;
  for (let i = 0; i < count && offset + 88 <= data.length; i++, offset += 88) {
    types.set(getInt(data, offset), DEFINITION_TYPES[getShort(data, offset + 12)] ?? 'CUSTOM');
  }
  return types;
}

// Custom field names and types from the CUSTOM_FIELDS blocks in the task, resource and assignment Props
// (task/resource Props are encrypted like their data, assignment Props are not; same as MPXJ).
// Returns:
// - names: { task: { TEXT1: 'Phase', ENTERPRISE_CUSTOM_FIELD8: 'Code' }, resource: {…}, assignment: {…} };
// - types: org-defined enterprise field types by class (e.g. { task: { ENTERPRISE_CUSTOM_FIELD8: 'NUMERIC' } });
// - enterpriseTypes: field ID -> type, for the field maps.
// Like MPXJ, an enterprise field's type is fixed the first time the field shows up (definition or name).
export function readCustomFieldInfo(propsList) {
  const names = { task: {}, resource: {}, assignment: {} };
  const types = { task: {}, resource: {}, assignment: {} };
  const enterpriseTypes = new Map();
  const named = new Set([...CUSTOM_FIELDS, ...ENTERPRISE_FIELDS]);
  const register = (fieldId, type) => {
    if ((fieldId & 0x8000) !== 0 && !enterpriseTypes.has(fieldId)) enterpriseTypes.set(fieldId, type);
  };
  for (const props of propsList) {
    if (!props) continue;
    const data = readProps14(props).getByteArray(CUSTOM_FIELDS_KEY);
    for (const [fieldId, type] of readFieldDefinitions(data)) register(fieldId, type);
    for (const [fieldId, alias] of readFieldAliases(data)) {
      register(fieldId, 'CUSTOM');
      // Any block can hold names of any class: the class comes from the field ID.
      for (const cls of Object.keys(names)) {
        const name = enterpriseFieldName(cls, fieldId) ?? fieldName(cls, fieldId);
        if (name && (named.has(name) || name.startsWith('ENTERPRISE_CUSTOM_FIELD'))) names[cls][name] = alias;
      }
    }
  }
  for (const [fieldId, type] of enterpriseTypes) {
    for (const cls of Object.keys(types)) {
      const name = enterpriseFieldName(cls, fieldId);
      if (name) types[cls][name] = type;
    }
  }
  return { names, types, enterpriseTypes };
}

// Fixed-name enterprise flags in meta data 2 (processTaskEnterpriseColumns / processResourceEnterpriseColumns).
// For tasks MPXJ reuses the ENTERPRISE_FLAG2-5 masks for 6-9. Kept as is.
const TASK_ENTERPRISE_MASKS = [0x800, 0x1000, 0x2000, 0x4000, 0x8000, 0x1000, 0x2000, 0x4000, 0x8000,
  0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000, 0x400000, 0x800000, 0x1000000, 0x2000000, 0x4000000];

export function enterpriseFlagBits(cls) {
  if (cls === 'task') return TASK_ENTERPRISE_MASKS.map(mask => [29, mask]);
  if (cls === 'resource') return Array.from({ length: 20 }, (_, i) => [16, 0x10 * 2 ** i]);
  return [];
}

// Enterprise fields with a value: fixed-name ones first (ENTERPRISE_TEXT1...), then org-defined ones
// by index: [{ field, value }]. For the latter the enterprise map wins if it has the field,
// otherwise the main map (MPXJ reads the second after the first).
// metaData2: item meta data 2 (fixed-name flags of tasks and resources).
export function readEnterpriseFields(fieldMap, enterpriseMap, read, metaData2, flagBits) {
  const result = [];
  const add = (field, value) => { if (isPopulated(value)) result.push({ field, value }); };
  for (const field of ENTERPRISE_FIELDS) {
    let value = fieldMap.has(field) ? read(fieldMap, field) : null;
    if (field.startsWith('ENTERPRISE_FLAG') && metaData2 && flagBits.length) {
      const [offset, mask] = flagBits[Number(field.slice(15)) - 1];
      value = (getInt(metaData2, offset) & mask) !== 0;
    }
    add(field, value);
  }
  const udf = new Set([...fieldMap.enterpriseNames(), ...(enterpriseMap?.enterpriseNames() ?? [])]);
  for (const field of [...udf].sort((a, b) => Number(a.slice(23)) - Number(b.slice(23)))) {
    add(field, enterpriseMap?.has(field) ? read(enterpriseMap, field) : read(fieldMap, field));
  }
  return result;
}
