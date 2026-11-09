// Field map: where each field lives (fixed block + offset, or var data + key)
// and how values are decoded. Ported from MPXJ (FieldMap, FieldMap14, FieldTypeHelper), LGPL-2.1.
import { getShort, getInt, getDouble, getTimestamp, getDate } from './bytes.js';
import { FIELD_SIZES, FIELDS, CUSTOM_FIELDS, ENTERPRISE_FIELDS } from './field-tables.js';
import { durationTimeUnits, adjustedDuration, TIME_UNITS } from './units.js';

export const CLASS_BASE = { task: 0x0b400000, resource: 0x0c400000, assignment: 0x0f400000, relation: 0x0d400000 };
const CLASS_BY_PREFIX = new Map(Object.entries(CLASS_BASE).map(([cls, base]) => [base, cls]));

// Duration field -> field holding its units (TaskField/ResourceField/AssignmentField.getUnitsType in MPXJ).
const UNITS_FIELD = {
  task: { SCHEDULED_DURATION: 'ACTUAL_DURATION_UNITS', DURATION: 'ACTUAL_DURATION_UNITS', MANUAL_DURATION: 'MANUAL_DURATION_UNITS', BASELINE_ESTIMATED_DURATION: 'BASELINE_DURATION_UNITS' },
  resource: {},
  assignment: {},
};
for (const name of CUSTOM_FIELDS.filter(f => f.startsWith('DURATION'))) {
  for (const cls of ['task', 'resource', 'assignment']) UNITS_FIELD[cls][name] = `${name}_UNITS`;
}
// Assignment enterprise durations have no units field (AssignmentField.ENTERPRISE_DURATIONn).
for (const name of ENTERPRISE_FIELDS.filter(f => f.startsWith('ENTERPRISE_DURATION'))) {
  for (const cls of ['task', 'resource']) UNITS_FIELD[cls][name] = `${name}_UNITS`;
}

// Bytes used in the fixed block per data type (FieldMap.getFixedDataFieldSize), for enterprise fields.
const TYPE_SIZE = { DATE: 4, INTEGER: 4, DURATION: 4, CURRENCY: 8, UNITS: 8, RATE: 8, WORK: 8, BOOLEAN: 2, SHORT: 2 };

// Field index -> name, only for the fields the reader uses.
const NAME_BY_INDEX = {};
for (const [cls, fields] of Object.entries(FIELDS)) {
  NAME_BY_INDEX[cls] = new Map();
  for (const [name, { indexes }] of Object.entries(fields)) for (const i of indexes) NAME_BY_INDEX[cls].set(i, name);
}

// enterpriseTypes: enterprise field ID -> data type (from the definitions in Props).
function fieldSize(fieldId, enterpriseTypes) {
  const cls = CLASS_BY_PREFIX.get((fieldId & 0xffff0000) | 0);
  const index = fieldId & 0xffff;
  if (!cls) return 0;
  // Enterprise fields (bit 0x8000): size depends on the type defined in the file; 0 if undefined.
  if ((index & 0x8000) !== 0) return TYPE_SIZE[enterpriseTypes.get(fieldId)] ?? 0;
  const code = FIELD_SIZES[cls][index];
  return code === 'g' ? 16 : Number(code ?? 0);
}

// Name of the `cls` field with that ID (null if another class, enterprise, or unused).
export function fieldName(cls, fieldId) {
  if (((fieldId & 0xffff0000) | 0) !== CLASS_BASE[cls]) return null;
  const index = fieldId & 0xffff;
  if ((index & 0x8000) !== 0) return null;
  return NAME_BY_INDEX[cls].get(index) ?? null;
}

// Internal name of an org-defined enterprise field (bit 0x8000), same as MPXJ:
// "ENTERPRISE_CUSTOM_FIELD" + (index & 0xFFF) + 1. Null if another class or not enterprise.
export function enterpriseFieldName(cls, fieldId) {
  if (((fieldId & 0xffff0000) | 0) !== CLASS_BASE[cls] || (fieldId & 0x8000) === 0) return null;
  return `ENTERPRISE_CUSTOM_FIELD${(fieldId & 0xfff) + 1}`;
}

// Field map layout in Props: 28-byte entries. Enterprise fields (bit 0x8000) come in with their type.
export function createFieldMap(data, cls, enterpriseTypes = new Map()) {
  const items = new Map();
  const maxFixedDataSize = [0, 0];
  let lastDataBlockOffset = 0;
  let dataBlockIndex = 0;

  for (let index = 0; index + 28 <= data.length; index += 28) {
    const mask = getInt(data, index);
    const dataBlockOffset = getShort(data, index + 4);
    const fieldId = getInt(data, index + 12);
    const category = getShort(data, index + 20);
    const varDataKey = fieldId & 0xffff;

    let location;
    let metaBlock = 0;
    if (category === 0x0b) {
      location = 'META_DATA';
    } else if (category === 0x64) {
      location = 'META_DATA';
      metaBlock = 1;
    } else if (dataBlockOffset !== 65535) {
      location = 'FIXED_DATA';
      if (dataBlockOffset < lastDataBlockOffset) dataBlockIndex++;
      lastDataBlockOffset = dataBlockOffset;
      const size = fieldSize(fieldId, enterpriseTypes);
      if (dataBlockOffset + size > maxFixedDataSize[dataBlockIndex]) maxFixedDataSize[dataBlockIndex] = dataBlockOffset + size;
    } else {
      location = varDataKey !== 0 ? 'VAR_DATA' : 'UNKNOWN';
    }

    const enterprise = enterpriseFieldName(cls, fieldId);
    const name = enterprise ?? fieldName(cls, fieldId);
    const type = enterprise ? enterpriseTypes.get(fieldId) ?? 'CUSTOM' : undefined;
    // Several indexes can point to the same field: the last entry wins, as in MPXJ.
    if (name) items.set(name, { name, type, location, blockIndex: dataBlockIndex, offset: dataBlockOffset, varDataKey, mask, metaBlock });
  }

  return new FieldMap(cls, items, maxFixedDataSize);
}

// Var-data-only map with known keys (FieldMap.createVarDataFieldMap), e.g. the assignment
// fallback keys.
export function createVarDataFieldMap(cls, keys) {
  const items = new Map();
  for (const [name, varDataKey] of Object.entries(keys)) {
    items.set(name, { name, location: 'VAR_DATA', blockIndex: 0, offset: 0, varDataKey, mask: 0, metaBlock: 0 });
  }
  return new FieldMap(cls, items, [0, 0]);
}

// Enterprise field map (FieldMap.createEnterpriseCustomFieldMap): list of 4-byte IDs after a 4-byte
// header; each field of the class is in var data under key ID & 0xFFFF.
export function createEnterpriseFieldMap(data, cls, enterpriseTypes) {
  const items = new Map();
  for (let index = 4; data && index + 4 <= data.length; index += 4) {
    const fieldId = getInt(data, index);
    const name = enterpriseFieldName(cls, fieldId);
    if (!name) continue;
    const type = enterpriseTypes.get(fieldId) ?? 'CUSTOM';
    items.set(name, { name, type, location: 'VAR_DATA', blockIndex: 0, offset: 0, varDataKey: fieldId & 0xffff, mask: 0, metaBlock: 0 });
  }
  return new FieldMap(cls, items, [0, 0]);
}

export class FieldMap {
  // calendar: { minutesPerDay, minutesPerWeek, daysPerMonth, defaultDurationUnits }
  constructor(cls, items, maxFixedDataSize) {
    this.cls = cls;
    this.items = items;
    this.maxFixedDataSize = maxFixedDataSize;
  }

  has(name) {
    return this.items.has(name);
  }

  // Org-defined enterprise field names present in the map, by index.
  enterpriseNames() {
    return [...this.items.keys()].filter(n => n.startsWith('ENTERPRISE_CUSTOM_FIELD'))
      .sort((a, b) => Number(a.slice(23)) - Number(b.slice(23)));
  }

  fixedDataOffset(name) {
    const item = this.items.get(name);
    return item ? item.offset : -1;
  }

  varDataKey(name) {
    return this.items.get(name)?.varDataKey ?? null;
  }

  // Reads a field value for the item with unique ID `id`.
  // fixedData: array of fixed blocks (e.g. [data, data2]); varData: VarData.
  read(name, id, fixedData, varData, calendar) {
    const item = this.items.get(name);
    if (!item) return null;
    const type = item.type ?? FIELDS[this.cls][name].type;
    if (item.location === 'FIXED_DATA') return this.#readFixed(item, type, id, fixedData, varData, calendar);
    if (item.location === 'VAR_DATA') return this.#readVar(item, type, id, fixedData, varData, calendar);
    return null;
  }

  #units(name, id, fixedData, varData, calendar) {
    const unitsField = UNITS_FIELD[this.cls]?.[name];
    return unitsField ? this.read(unitsField, id, fixedData, varData, calendar) : null;
  }

  #readFixed(item, type, id, fixedData, varData, calendar) {
    if (item.blockIndex >= fixedData.length) return null;
    const data = fixedData[item.blockIndex];
    const at = item.offset;
    if (!data || at >= data.length) return null;
    switch (type) {
      case 'DATE': return getTimestamp(data, at);
      case 'INTEGER': return getInt(data, at);
      case 'DURATION': {
        const units = this.#units(item.name, id, fixedData, varData, calendar) ?? calendar.defaultDurationUnits;
        return adjustedDuration(calendar, getInt(data, at), units);
      }
      case 'TIME_UNITS': return durationTimeUnits(getShort(data, at), calendar.defaultDurationUnits);
      case 'CONSTRAINT':
      case 'SHORT': return getShort(data, at);
      // TASK_MODE and RESOURCE_TYPE don't come from the map (null in MPXJ): they come from the flag bits.
      case 'PERCENTAGE': {
        const value = getShort(data, at);
        return value >= 0 && value <= 100 ? value : null;
      }
      case 'BOOLEAN': return getShort(data, at) !== 0;
      case 'CURRENCY':
      case 'UNITS': {
        const amount = getDouble(data, at);
        return (Math.abs(amount) < 0.1 ? 0 : amount) / 100;
      }
      case 'RATE': return { amount: getDouble(data, at), units: 'HOURS' };
      case 'WORK': {
        const duration = getDouble(data, at);
        return { value: (Math.abs(duration) < 1000 ? 0 : duration) / 60000, units: 'HOURS' };
      }
      case 'RATE_UNITS': return TIME_UNITS[getShort(data, at) - 1] ?? 'DAYS';
      default: return null;
    }
  }

  #readVar(item, type, id, fixedData, varData, calendar) {
    const key = item.varDataKey;
    switch (type) {
      case 'STRING': {
        // Lookup values of a custom field aren't supported yet: treated as missing.
        const flag = varData.getShort(id, key);
        if (flag === 0x0701 || flag === 0x0401) return null;
        return varData.getUnicodeString(id, key);
      }
      case 'DURATION': {
        const units = this.#units(item.name, id, fixedData, varData, calendar) ?? 'HOURS';
        // 512 bytes = free text (MPXJ returns a string), can't be shown as a duration.
        const data = varData.getByteArray(id, key);
        if (!data || data.length === 512 || data.length < 4) return null;
        return adjustedDuration(calendar, getInt(data, 0), units);
      }
      case 'TIME_UNITS': return durationTimeUnits(varData.getShort(id, key), calendar.defaultDurationUnits);
      case 'CURRENCY': {
        const amount = varData.getDouble(id, key);
        return (Math.abs(amount) < 0.1 ? 0 : amount) / 100;
      }
      case 'NUMERIC': {
        // Lookup values aren't supported: treated as missing (DoubleVarDataFieldReader).
        const flag = varData.getShort(id, key);
        if (flag === 0x0701 || flag === 0x0401) return null;
        return varData.getDouble(id, key);
      }
      case 'INTEGER': return varData.getInt(id, key);
      case 'PERCENTAGE':
      case 'SHORT': return varData.getShort(id, key);
      case 'BOOLEAN': return varData.getShort(id, key) !== 0;
      case 'BINARY': return varData.getByteArray(id, key);
      case 'RATE_UNITS': return TIME_UNITS[varData.getShort(id, key) - 1] ?? 'DAYS';
      case 'DATE': {
        // Same as TimestampVarDataFieldReader: lookup values (date-only or by ID) aren't supported,
        // 512-byte text can't be a date (null), anything else is date + time.
        const data = varData.getByteArray(id, key);
        if (!data) return null;
        const flag = varData.getShort(id, key);
        if (flag === 0x0701 || flag === 0x0401) return data.length === 4 ? getDate(data, 2) : null;
        if (data.length === 512) return null;
        return data.length >= 4 ? getTimestamp(data, 0) : null;
      }
      default: return null;
    }
  }
}
