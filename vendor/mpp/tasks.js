// Tasks (TBkndTask): ID reordering, outline tree, relations (TBkndCons).
// Ported from MPXJ (MPP14Reader.processTaskData, createTaskMap, postProcessTasks, ConstraintFactory,
// MPPReader.read, TaskContainer.updateStructure, Task.generateWBS/generateOutlineNumber), LGPL-2.1.
import { MppError } from './errors.js';
import { getShort, getInt, getLong } from './bytes.js';
import { readFixedMeta, readFixedData, readFixedDataWithSize, itemSizeMatching, readVarMeta12, VarData, fixedItem } from './blocks.js';
import { durationTimeUnits, adjustedDuration } from './units.js';
import { readCustomFields, customFlagBits, readEnterpriseFields, enterpriseFlagBits } from './custom-fields.js';

const TASK_UNIQUE_ID_FIXED_OFFSET = 0;
const TASK_ID_FIXED_OFFSET = 4;
const NULL_TASK_BLOCK_SIZE = 16;
const EPOCH_DATE = '1983-12-31T00:00';

const RELATION_TYPES = ['FINISH_FINISH', 'FINISH_START', 'START_FINISH', 'START_START'];
const CONSTRAINT = { AS_LATE_AS_POSSIBLE: 1, START_NO_LATER_THAN: 5, FINISH_NO_LATER_THAN: 7 };

// Flag bits per Project version: [offset, mask] in the meta data.
function bitFlags(applicationVersion) {
  const v = applicationVersion ?? 0;
  if (v <= 14) return { milestone: [8, 0x20], manual: [8, 0x08] };
  if (v === 15) return { milestone: [10, 0x02], manual: [8, 0x80] };
  return { milestone: [10, 0x02], manual: [8, 0x80] };
}

const flag = (data, [offset, mask]) => data ? (getInt(data, offset) & mask) !== 0 : null;

const compareDates = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function emptyTask(uid, id) {
  return {
    uid, id, name: null, outlineLevel: null, outlineNumber: null, wbs: null, duration: null, start: null, finish: null,
    percentComplete: null, work: null, remainingWork: null, summary: false, milestone: false, null: false, predecessors: [],
    actualStart: null, actualFinish: null, customFields: [], enterpriseFields: [], children: [], parent: null,
  };
}

// Unique ID -> fixed block index (createTaskMap): walks backwards skipping the first three
// items; deleted tasks stay in the map with a null index so they don't get picked up by mistake.
function createTaskMap(fieldMap, fixedMeta, fixedData, fixed2Data, varData) {
  const taskMap = new Map();
  const uniqueIdOffset = fieldMap.fixedDataOffset('UNIQUE_ID');
  const maxSize = fieldMap.maxFixedDataSize[0];
  for (let loop = fixedMeta.adjustedItemCount - 1; loop > 2; loop--) {
    const data = fixedItem(fixedData, loop);
    const data2 = fixedItem(fixed2Data, loop);
    if (!data || !data2) continue;
    const flags = getInt(fixedMeta.items[loop], 0);
    if ((flags & 0x02) !== 0) {
      const uid = getShort(data, TASK_UNIQUE_ID_FIXED_OFFSET);
      if (!taskMap.has(uid)) taskMap.set(uid, null);
    } else if (data.length === NULL_TASK_BLOCK_SIZE) {
      const uid = getInt(data, TASK_UNIQUE_ID_FIXED_OFFSET);
      if (!taskMap.has(uid)) taskMap.set(uid, loop);
    } else if (maxSize === 0 || Math.trunc((data.length * 100) / maxSize) > 75) {
      const uid = getInt(data, uniqueIdOffset);
      const hasVarData = (varData.meta.table.get(uid)?.size ?? 0) > 0;
      if (!taskMap.has(uid) || hasVarData) {
        if (!taskMap.has(uid) || (flags & 0x04) === 0) taskMap.set(uid, loop);
      }
    }
  }
  return taskMap;
}

class TaskList {
  constructor() {
    this.tasks = [];
    this.byUid = new Map();
    this.byId = new Map();
  }

  add(task) {
    this.tasks.push(task);
    this.byUid.set(task.uid, task);
    if (task.id !== null) this.byId.set(task.id, task);
  }

  remove(task) {
    this.tasks.splice(this.tasks.indexOf(task), 1);
    if (this.byUid.get(task.uid) === task) this.byUid.delete(task.uid);
    if (this.byId.get(task.id) === task) this.byId.delete(task.id);
  }

  setId(task, id) {
    if (this.byId.get(task.id) === task) this.byId.delete(task.id);
    task.id = id;
    this.byId.set(id, task);
  }
}

function readTaskRecords(ctx, fieldMap, table) {
  const fixedMeta = readFixedMeta(table.fixedMeta, 47);
  const maxSize = fieldMap.maxFixedDataSize[0];
  const fixedData = readFixedData(fixedMeta, table.fixedData, maxSize);
  const fixed2Meta = readFixedMeta(table.fixed2Meta, itemSizeMatching(fixedData, 92, 93, 94, 95, 96));
  const fixed2Data = readFixedData(fixed2Meta, table.fixed2Data);
  const varData = new VarData(readVarMeta12(table.varMeta), table.varData);
  const taskMap = createTaskMap(fieldMap, fixedMeta, fixedData, fixed2Data, varData);
  const flags = bitFlags(ctx.applicationVersion);
  const read = (name, uid, blocks) => fieldMap.read(name, uid, blocks, varData, ctx.calendar);
  const customFlags = customFlagBits('task', ctx.applicationVersion);
  const enterpriseFlags = enterpriseFlagBits('task');

  const list = new TaskList();
  const taskOrder = []; // [BigInt key, uid]
  const nullTaskOrder = new Map(); // id → uid
  let autoWBS = true;

  const addNullTask = (data) => {
    const id = getInt(data, TASK_ID_FIXED_OFFSET);
    if (!nullTaskOrder.has(id)) {
      const task = emptyTask(getInt(data, TASK_UNIQUE_ID_FIXED_OFFSET), id);
      task.null = true;
      list.add(task);
      nullTaskOrder.set(id, task.uid);
    }
  };

  for (const uid of [...taskMap.keys()].sort((a, b) => a - b)) {
    const offset = taskMap.get(uid);
    if (offset === null || offset < 0 || offset >= fixedData.items.length) continue;

    let data = fixedData.items[offset];
    const metaData = fixedMeta.items[offset];
    const id = getInt(data, fieldMap.fixedDataOffset('ID'));

    if (data.length === NULL_TASK_BLOCK_SIZE) {
      addNullTask(data);
      continue;
    }
    if (data.length < maxSize) {
      const padded = new Uint8Array(maxSize + 8);
      padded.set(data);
      data = padded;
    }
    const metaData2 = fixedItem(fixed2Meta, offset);
    const data2 = fixedItem(fixed2Data, offset);
    const blocks = [data, data2];

    // Duplicate ID: keep the one with var data (the "ghost" ones have none).
    const existing = list.byId.get(id);
    if (existing) {
      if (!varData.hasUniqueID(uid)) continue;
      if (existing.name === null) list.remove(existing);
    }

    const task = emptyTask(uid, id);
    task.name = read('NAME', uid, blocks);
    task.wbs = read('WBS', uid, blocks);
    task.outlineLevel = read('OUTLINE_LEVEL', uid, blocks);
    task.percentComplete = read('PERCENT_COMPLETE', uid, blocks);
    task.work = read('WORK', uid, blocks);
    task.remainingWork = read('REMAINING_WORK', uid, blocks);
    task.start = read('START', uid, blocks);
    task.finish = read('FINISH', uid, blocks);
    task.actualStart = read('ACTUAL_START', uid, blocks);
    task.actualFinish = read('ACTUAL_FINISH', uid, blocks);
    const created = read('CREATED', uid, blocks);
    const constraint = read('CONSTRAINT_TYPE', uid, blocks) ?? 0;
    const lateStart = read('LATE_START', uid, blocks);
    const lateFinish = read('LATE_FINISH', uid, blocks);
    const scheduledStart = read('SCHEDULED_START', uid, blocks);
    const scheduledFinish = read('SCHEDULED_FINISH', uid, blocks);
    const scheduledDuration = read('SCHEDULED_DURATION', uid, blocks);
    const manualDuration = read('MANUAL_DURATION', uid, blocks);
    // MPP14 has no index for the duration field: always missing before the fallback below.
    task.duration = null;

    task.milestone = flag(metaData, flags.milestone) ?? false;
    const manual = flag(metaData2, flags.manual) === true;

    if (task.start === null || (scheduledStart !== null && !manual)) task.start = scheduledStart;
    if (task.finish === null || (scheduledFinish !== null && !manual)) task.finish = scheduledFinish;
    if (task.duration === null || (scheduledDuration !== null && !manual)) task.duration = scheduledDuration;

    if (constraint === CONSTRAINT.AS_LATE_AS_POSSIBLE) {
      if (compareNullable(task.start, lateStart) < 0) task.start = lateStart;
      if (compareNullable(task.finish, lateFinish) < 0) task.finish = lateFinish;
    } else if (constraint === CONSTRAINT.START_NO_LATER_THAN || constraint === CONSTRAINT.FINISH_NO_LATER_THAN) {
      if (compareNullable(task.finish, task.start) < 0) task.finish = lateFinish;
    }

    if (task.wbs !== null) autoWBS = false;
    if (manual) task.duration = manualDuration;
    const readField = (map, name) => map.read(name, uid, blocks, varData, ctx.calendar);
    task.customFields = readCustomFields(fieldMap, readField, metaData, customFlags);
    task.enterpriseFields = readEnterpriseFields(fieldMap, ctx.enterpriseMaps?.task, readField, metaData2, enterpriseFlags);

    // No name and no valid dates: it's really a blank row.
    const missing = d => d === null || d === EPOCH_DATE;
    if (task.name === null && (missing(task.start) || missing(task.finish) || missing(created))) {
      addNullTask(data);
      continue;
    }

    list.add(task);
    if (!data2 || data2.length < 24) nullTaskOrder.set(task.id, task.uid);
    else taskOrder.push([getLong(data2, 16), task.uid]);
  }

  return { list, taskOrder, nullTaskOrder, autoWBS };
}

// Same as LocalDateTimeHelper.compare: null sorts before any date.
function compareNullable(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareDates(a, b);
}

// Rebuilds ID order from the file's sort index, inserting blank rows (postProcessTasks).
function renumber(list, taskOrder, nullTaskOrder) {
  const ordered = new Map();
  const nextIDIncrement = (Math.trunc(nullTaskOrder.size / 1000) + 1) * 2000;
  const hasUid0 = list.byUid.has(0);
  let nextID = hasUid0 ? 0 : nextIDIncrement;

  // Equal keys: last one inserted wins, like a TreeMap.
  const byKey = new Map();
  for (const [key, uid] of taskOrder) byKey.set(key, uid);
  const keys = [...byKey.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    ordered.set(nextID, byKey.get(key));
    nextID += nextIDIncrement;
  }

  let insertionCount = 0;
  const offsetMap = new Map();
  for (const id of [...nullTaskOrder.keys()].sort((a, b) => a - b)) {
    const baseTarget = (id - insertionCount) * nextIDIncrement;
    let target = baseTarget;
    const previous = offsetMap.get(baseTarget);
    let offset = previous === undefined ? 0 : previous + 1;
    insertionCount++;
    while (ordered.has(target)) {
      offset++;
      if (offset === nextIDIncrement) throw new MppError('corrupt', 'The Project file is damaged: the task order cannot be rebuilt.');
      target = baseTarget - (nextIDIncrement - offset);
    }
    offsetMap.set(baseTarget, offset);
    ordered.set(target, nullTaskOrder.get(id));
  }

  nextID = hasUid0 ? 0 : 1;
  for (const position of [...ordered.keys()].sort((a, b) => a - b)) {
    const task = list.byUid.get(ordered.get(position));
    if (task) list.setId(task, nextID);
    nextID++;
  }
}

// Task relations (TBkndCons): 20-byte items with both task IDs, type and lag.
function readRelations(ctx, list) {
  const metaBytes = ctx.stream('   114/TBkndCons/FixedMeta');
  if (!metaBytes) return;
  const meta = readFixedMeta(metaBytes, 10);
  const fixed = readFixedDataWithSize(meta, 20, ctx.decryptedStream('   114/TBkndCons/FixedData'));
  const project15 = (ctx.applicationVersion ?? 0) > 14;
  const unitsOffset = project15 ? 18 : 14;
  const durationOffset = project15 ? 14 : 16;

  for (let loop = 0; loop < meta.itemCount; loop++) {
    const metaData = meta.items[loop];
    if (!metaData) break;
    if (getShort(metaData, 0) !== 0) continue;
    const index = fixed.offsets.indexOf(getInt(metaData, 4));
    if (index === -1) continue;
    const data = fixed.items[index];
    if (!data || data.length < 14) continue;
    const uid1 = getInt(data, 4);
    const uid2 = getInt(data, 8);
    if (uid1 === 0 || uid2 === 0 || uid1 === uid2) continue;
    const predecessor = list.byUid.get(uid1);
    const successor = list.byUid.get(uid2);
    if (!predecessor || !successor) continue;
    const type = RELATION_TYPES[getShort(data, 12)] ?? 'FINISH_START';
    const lag = adjustedDuration(ctx.calendar, getInt(data, durationOffset), durationTimeUnits(getShort(data, unitsOffset)));
    addPredecessor(successor, { task: predecessor, type, lag });
  }
}

// Minutes per unit using Duration.convertUnits defaults (8 h/day, 40 h/week, 20 days/month).
// No years: durationTimeUnits never returns them.
const MINUTES = {
  MINUTES: 1, HOURS: 60, DAYS: 480, WEEKS: 2400, MONTHS: 9600,
  ELAPSED_MINUTES: 1, ELAPSED_HOURS: 60, ELAPSED_DAYS: 1440, ELAPSED_WEEKS: 10080, ELAPSED_MONTHS: 43200,
};

function sameLag(a, b) {
  if (!a || !b) return a === b;
  const bValue = a.units === b.units ? b.value : (b.value * (MINUTES[b.units] ?? 1)) / (MINUTES[a.units] ?? 1);
  return Math.abs(a.value - bValue) < 0.00001;
}

// Only one identical relation between two tasks (RelationContainer.addPredecessor).
function addPredecessor(successor, relation) {
  for (const existing of successor.predecessors) {
    if (existing.task === relation.task) {
      if (existing.type === relation.type && sameLag(existing.lag, relation.lag)) return;
      break;
    }
  }
  successor.predecessors.push(relation);
}

// Outline tree from outline level, in ID order (TaskContainer.updateStructure).
function updateStructure(list, autoWBS) {
  const tasks = list.tasks;
  if (tasks.length <= 1) return;
  tasks.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const roots = [];
  let lastTask = null;
  let lastLevel = -1;

  const generate = (task, parent, field) => {
    let value;
    if (parent === null) {
      value = task.uid === 0 ? '0' : String(roots.length + 1);
    } else {
      value = parent[field];
      if (field === 'outlineNumber') {
        const index = value.lastIndexOf('.0');
        if (index !== -1) value = value.substring(0, index);
      }
      const count = parent.children.length + 1;
      value = value === '0' ? String(count) : `${value}.${count}`;
    }
    task[field] = value;
  };

  for (const task of tasks) {
    task.children = [];
    let parent = null;
    if (!task.null) {
      let level = task.outlineLevel ?? 0;
      if (lastTask !== null) {
        if (level === lastLevel) {
          parent = lastTask.parent;
          level = lastLevel;
        } else if (level > lastLevel) {
          parent = lastTask;
        } else {
          while (level <= lastLevel) {
            parent = lastTask.parent;
            if (parent === null) break;
            lastLevel = parent.outlineLevel ?? 0;
            lastTask = parent;
          }
        }
      }
      lastTask = task;
      lastLevel = level;
      if (autoWBS || task.wbs === null) generate(task, parent, 'wbs');
      generate(task, parent, 'outlineNumber');
    }
    task.parent = parent;
    if (parent === null) roots.push(task);
    else parent.children.push(task);
  }
}

// Drops relations pointing to an ancestor task (MPPReader.validationRelations).
function validateRelations(task) {
  task.predecessors = task.predecessors.filter(r => {
    const source = task.outlineNumber;
    const target = r.task.outlineNumber;
    return !(source !== null && target !== null && source.startsWith(`${target}.`));
  });
}

// Reads all tasks. Returns them in ID order, in model format.
export function readTasks(ctx, fieldMap, table) {
  const { list, taskOrder, nullTaskOrder, autoWBS } = readTaskRecords(ctx, fieldMap, table);
  readRelations(ctx, list);
  renumber(list, taskOrder, nullTaskOrder);
  updateStructure(list, autoWBS);
  for (const task of list.tasks) {
    task.summary = task.children.length > 0;
    validateRelations(task);
  }
  return list.tasks;
}

// Project dates when missing from Props: first and last task date (ProjectFile).
export function earliestStart(tasks) {
  let result = null;
  for (const t of tasks) {
    if (t.uid === 0) continue;
    const d = t.milestone ? (t.actualFinish ?? t.finish) : (t.actualStart ?? t.start);
    if (d !== null && (result === null || d < result)) result = d;
  }
  return result;
}

export function latestFinish(tasks) {
  let result = null;
  for (const t of tasks) {
    if (t.uid === 0) continue;
    const d = t.actualFinish ?? t.finish;
    if (d !== null && (result === null || d > result)) result = d;
  }
  return result;
}
