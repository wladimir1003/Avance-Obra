// Resources (TBkndRsc): name, type, initials, group, max units, standard rate.
// Ported from MPXJ (MPP14Reader.processResourceData, createResourceMap, MPPUtility.convertRateFromHours,
// RateHelper.convertFromHours, CostRateTableFactory, AvailabilityFactory, Resource.calculateStandardRate/
// calculateMaxUnits), LGPL-2.1.
import { getShort, getInt, getDouble, EPOCH_MS } from './bytes.js';
import { readFixedMeta, readFixedData, itemSizeMatching, readVarMeta12, VarData, fixedItem } from './blocks.js';
import { TIME_UNITS } from './units.js';
import { readCustomFields, customFlagBits, readEnterpriseFields, enterpriseFlagBits } from './custom-fields.js';

// Dates as "UTC" milliseconds that stand for the file's local time (like MPXJ LocalDateTime).
const MINUTE_MS = 60000;
const START_DATE_NA = Date.UTC(1984, 0, 1);
const END_DATE_NA = Date.UTC(2049, 11, 31, 23, 59);
const tenths = (data, offset) => EPOCH_MS + getInt(data, offset) * 6000;

// Current PC time in the same format (MPXJ uses LocalDateTime.now()).
export function localNow() {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}

// Unique ID -> fixed block index. Like MPXJ: 2-byte ID, first occurrence wins.
function createResourceMap(fieldMap, fixedMeta, fixedData) {
  const resourceMap = new Map();
  const maxSize = fieldMap.maxFixedDataSize[0];
  const uniqueIdOffset = fieldMap.fixedDataOffset('UNIQUE_ID');
  for (let loop = 0; loop < fixedMeta.adjustedItemCount; loop++) {
    const data = fixedItem(fixedData, loop);
    if (!data || data.length < maxSize) continue;
    const uid = getShort(data, uniqueIdOffset);
    if (!resourceMap.has(uid)) resourceMap.set(uid, loop);
  }
  return resourceMap;
}

// Hourly amount -> rate in the given unit, rounded to 2 decimals (RateHelper.convertFromHours).
function rateFromHours(amount, units, calendar) {
  let value = amount;
  switch (units) {
    case 'MINUTES': value = value / 60; break;
    case 'DAYS': value = (value * calendar.minutesPerDay) / 60; break;
    case 'WEEKS': value = (value * calendar.minutesPerWeek) / 60; break;
    case 'MONTHS': value = (value * calendar.minutesPerDay * calendar.daysPerMonth) / 60; break;
    case 'YEARS': value = (value * calendar.minutesPerWeek * 52) / 60; break;
    default: break;
  }
  return { amount: Math.round(value * 100) / 100, units };
}

// Flat rates (material or cost resources): Project stores elapsed minutes, leave them in hours.
const rateUnits = units => (units === 'ELAPSED_MINUTES' ? 'HOURS' : units);

// Rate stored per hour -> rate in the unit the user picked.
export function convertRateFromHours(rate, targetUnits, calendar) {
  if (!rate || !targetUnits) return rate;
  return rateFromHours(rate.amount, rateUnits(targetUnits), calendar);
}

// Standard rate in effect at `now` from cost rate table A (44-byte entries after a 16-byte header).
// No table: the resource's own rate applies, up to Project's max date.
export function currentStandardRate(data, fallback, calendar, now) {
  if (!data) return now < END_DATE_NA ? fallback : null;
  const entries = [];
  for (let i = 16; i + 44 <= data.length; i += 44) {
    const format = getShort(data, i + 8);
    const units = format === 0xffff ? 'HOURS' : rateUnits(TIME_UNITS[format - 1] ?? 'DAYS');
    const rate = rateFromHours(getDouble(data, i), units, calendar);
    let end = tenths(data, i + 40);
    if (end > END_DATE_NA) end = END_DATE_NA;
    else if (new Date(end).getUTCMinutes() % 5 === 0) end -= MINUTE_MS;
    if (new Date(end).getUTCSeconds() !== 0) continue;
    entries.push({ end, rate });
  }
  entries.sort((a, b) => a.end - b.end);
  return entries.find(e => now < e.end)?.rate ?? null;
}

// Max units in effect at `now` from the availability table (20-byte entries after a 12-byte header;
// zero entries are skipped). No table: the resource's max units within
// "Available from / to" (model date format, missing = open-ended).
export function currentMaxUnits(data, fallback, now, availableFrom = null, availableTo = null) {
  if (!data) {
    const from = availableFrom ? Date.parse(`${availableFrom}Z`) : START_DATE_NA;
    const to = availableTo ? Date.parse(`${availableTo}Z`) : END_DATE_NA;
    return now >= from && now <= to ? fallback : null;
  }
  const entries = [];
  const items = getShort(data, 0);
  for (let loop = 0, offset = 12; loop < items; loop++, offset += 20) {
    const units = getDouble(data, offset + 4);
    if (units === 0) continue;
    const start = Math.max(tenths(data, offset), START_DATE_NA);
    const end = Math.min(tenths(data, offset + 20) - MINUTE_MS, END_DATE_NA);
    entries.push({ start, end, units: units / 100 });
  }
  entries.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const e of entries) {
    if (now < e.start) break;
    if (now <= e.end) return e.units;
  }
  return null;
}

// now: the instant used to pick the rate and units in effect (default: current PC time).
export function readResources(ctx, fieldMap, table, now = localNow()) {
  const varData = new VarData(readVarMeta12(table.varMeta), table.varData);
  const fixedMeta = readFixedMeta(table.fixedMeta, 37);
  const fixedData = readFixedData(fixedMeta, table.encryptedStream('FixedData'));
  const fixed2Meta = readFixedMeta(table.fixed2Meta, itemSizeMatching(fixedData, 50, 51));
  const fixed2Data = readFixedData(fixed2Meta, table.encryptedStream('Fixed2Data'));
  const resourceMap = createResourceMap(fieldMap, fixedMeta, fixedData);

  // Resource type: flag bits in the meta data, at a different spot from Project 2013 on.
  const [typeOffset, typeMask] = (ctx.applicationVersion ?? 0) > 14 ? [12, 0x10] : [9, 0x02];
  const customFlags = customFlagBits('resource', ctx.applicationVersion);
  const enterpriseFlags = enterpriseFlagBits('resource');

  const resources = [];
  for (const uid of [...varData.meta.table.keys()].sort((a, b) => a - b)) {
    const offset = resourceMap.get(uid);
    if (offset === undefined) continue;
    const data = fixedItem(fixedData, offset);
    const blocks = [data, fixedItem(fixed2Data, offset)];
    const read = name => fieldMap.read(name, uid, blocks, varData, ctx.calendar);
    const metaData = fixedMeta.items[offset];
    const metaData2 = fixedItem(fixed2Meta, offset);
    const readField = (map, name) => map.read(name, uid, blocks, varData, ctx.calendar);

    let type;
    if ((metaData[typeOffset] & typeMask) !== 0) type = 'WORK';
    else type = metaData2 && (metaData2[8] & 0x10) !== 0 ? 'COST' : 'MATERIAL';

    resources.push({
      uid,
      id: getInt(data, fieldMap.fixedDataOffset('ID')),
      name: read('NAME'),
      type,
      initials: read('INITIALS'),
      group: read('GROUP'),
      maxUnits: currentMaxUnits(read('AVAILABILITY_DATA'), read('MAX_UNITS'), now, read('AVAILABLE_FROM'), read('AVAILABLE_TO')),
      standardRate: currentStandardRate(read('COST_RATE_A'),
        convertRateFromHours(read('STANDARD_RATE'), read('STANDARD_RATE_UNITS'), ctx.calendar), ctx.calendar, now),
      customFields: readCustomFields(fieldMap, readField, metaData, customFlags),
      enterpriseFields: readEnterpriseFields(fieldMap, ctx.enterpriseMaps?.resource, readField, metaData2, enterpriseFlags),
    });
  }
  return resources;
}
