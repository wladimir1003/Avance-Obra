// Assignments (TBkndAssn): task, resource, units, work, start, finish.
// Ported from MPXJ (MPP14Reader.processAssignmentData, ResourceAssignmentFactory.process,
// Task.addResourceAssignment/getExistingResourceAssignment), LGPL-2.1.
import { getInt } from './bytes.js';
import { readFixedMeta, readFixedBlocks, readVarMeta12, VarData, fixedItem } from './blocks.js';
import { createVarDataFieldMap } from './fieldmap.js';
import { ASSIGNMENT_ALTERNATE_KEYS } from './field-tables.js';
import { readCustomFields, customFlagBits, readEnterpriseFields } from './custom-fields.js';

// Unique ID Project uses for "no resource".
const NULL_RESOURCE_ID = -65535;

// tasks/resources: already parsed lists (tasks need duration).
export function readAssignments(ctx, fieldMap, table, tasks, resources) {
  const varData = new VarData(readVarMeta12(table.varMeta), table.varData);
  const fixedMeta = readFixedMeta(table.fixedMeta, 34);
  const fixedData = readFixedBlocks(110, table.encryptedStream('FixedData'));
  const fixed2Data = readFixedBlocks(48, table.encryptedStream('Fixed2Data'));
  const taskByUid = new Map(tasks.map(t => [t.uid, t]));
  const resourceUids = new Set(resources.map(r => r.uid));
  const maxSize = fieldMap.maxFixedDataSize[0];
  const indexByOffset = new Map(fixedData.offsets.map((offset, i) => [offset, i]));
  const seen = new Set(); // "task|resource" pairs already seen
  // Fallback var data keys for custom fields (MPP14Reader.ALTERNATE_VAR_DATA).
  const alternate = createVarDataFieldMap('assignment', ASSIGNMENT_ALTERNATE_KEYS);
  const customFlags = customFlagBits('assignment', ctx.applicationVersion);

  const assignments = [];
  for (let loop = 0; loop < fixedMeta.itemCount; loop++) {
    const meta = fixedItem(fixedMeta, loop);
    if (!meta || meta[0] !== 0) continue;
    const index = indexByOffset.get(getInt(meta, 4)) ?? -1;
    let data = fixedItem(fixedData, index);
    if (!data) continue;
    if (data.length < maxSize) {
      const padded = new Uint8Array(maxSize);
      padded.set(data);
      data = padded;
    }

    const uid = getInt(data, fieldMap.fixedDataOffset('UNIQUE_ID'));
    if (!varData.hasUniqueID(uid)) continue;
    const task = taskByUid.get(getInt(data, fieldMap.fixedDataOffset('TASK_UNIQUE_ID')));
    if (!task) continue;
    // Missing resource (or the "no resource" ID) means an unassigned entry. Only one per task,
    // same as one per resource.
    const rawResourceUid = getInt(data, fieldMap.fixedDataOffset('RESOURCE_UNIQUE_ID'));
    const resourceKey = resourceUids.has(rawResourceUid) ? rawResourceUid : null;
    const key = `${task.uid}|${resourceKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const blocks = [data, fixedItem(fixed2Data, index)];
    const readField = (map, name) => map.read(name, uid, blocks, varData, ctx.calendar);
    // MPXJ defaults (Task.addResourceAssignment), overridden by whatever the field map has.
    const values = { UNIQUE_ID: null, TASK_UNIQUE_ID: task.uid, RESOURCE_UNIQUE_ID: resourceKey, ASSIGNMENT_UNITS: 100, WORK: task.duration, START: null, FINISH: null };
    for (const name of Object.keys(values)) {
      if (fieldMap.has(name)) values[name] = fieldMap.read(name, uid, blocks, varData, ctx.calendar);
    }
    if (values.RESOURCE_UNIQUE_ID === NULL_RESOURCE_ID) values.RESOURCE_UNIQUE_ID = null;

    assignments.push({
      uid: values.UNIQUE_ID,
      taskUid: values.TASK_UNIQUE_ID,
      resourceUid: values.RESOURCE_UNIQUE_ID,
      units: values.ASSIGNMENT_UNITS,
      work: values.WORK,
      start: values.START,
      finish: values.FINISH,
      customFields: readCustomFields(fieldMap, readField, meta, customFlags, alternate),
      enterpriseFields: readEnterpriseFields(fieldMap, ctx.enterpriseMaps?.assignment, readField, null, []),
    });
  }
  return assignments;
}
