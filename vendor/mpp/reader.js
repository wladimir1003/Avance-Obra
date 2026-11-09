// Entry point: from file bytes to the project model.
// Flow taken from MPXJ (MPP14Reader.populateMemberData, ProjectPropertiesReader), LGPL-2.1.
import { MppError } from './errors.js';
import { openMpp } from './format.js';
import { streamIndex, getStream, decrypt } from './container.js';
import { readProps14, PropsKey } from './props.js';
import { readPropertySetStrings, SUMMARY_PID, DOC_SUMMARY_PID } from './summary.js';
import { createFieldMap, createEnterpriseFieldMap } from './fieldmap.js';
import { durationTimeUnits } from './units.js';
import { readTasks, earliestStart, latestFinish } from './tasks.js';
import { readResources } from './resources.js';
import { readAssignments } from './assignments.js';
import { readCustomFieldInfo } from './custom-fields.js';

const PROJECT_DIR = '   114';

// Document properties first, then Project's own; empty string means missing.
function populated(value, fallback) {
  if (value) return value;
  const other = fallback();
  return other ? other : null;
}

function readProject(projectProps, index) {
  const summary = readPropertySetStrings(getStream(index, '\u0005SummaryInformation'));
  const docSummary = readPropertySetStrings(getStream(index, '\u0005DocumentSummaryInformation'));
  return {
    title: populated(summary.get(SUMMARY_PID.TITLE), () => projectProps.getUnicodeString(PropsKey.TITLE)),
    subject: populated(summary.get(SUMMARY_PID.SUBJECT), () => projectProps.getUnicodeString(PropsKey.SUBJECT)),
    author: populated(summary.get(SUMMARY_PID.AUTHOR), () => projectProps.getUnicodeString(PropsKey.AUTHOR)),
    company: populated(docSummary.get(DOC_SUMMARY_PID.COMPANY), () => projectProps.getUnicodeString(PropsKey.COMPANY)),
    manager: populated(docSummary.get(DOC_SUMMARY_PID.MANAGER), () => projectProps.getUnicodeString(PropsKey.MANAGER)),
    start: projectProps.getTimestamp(PropsKey.PROJECT_START_DATE),
    finish: projectProps.getTimestamp(PropsKey.PROJECT_FINISH_DATE),
    statusDate: projectProps.getTimestamp(PropsKey.STATUS_DATE),
  };
}

// Opens the file and sets up what every read needs (properties, encryption, stream index).
export function openProject(bytes, CFB) {
  const { format, applicationName, container } = openMpp(bytes, CFB);
  const index = streamIndex(container);

  const rootProps = readProps14(getStream(index, 'Props14') ?? new Uint8Array());
  const passwordFlag = rootProps.getByte(PropsKey.PASSWORD_FLAG);
  // Open-password flag set but no encryption data: Project opens it without asking.
  if ((passwordFlag & 0x1) && rootProps.getByteArray(PropsKey.PROTECTION_PASSWORD_HASH)) {
    throw new MppError('password',
      'The file is password protected: open it in Project, remove the password (File › Info › Protect) and save it again.');
  }
  const code = rootProps.getByte(PropsKey.ENCRYPTION_CODE);
  const mask = passwordFlag !== 0 && code !== 0 ? 0xff - code : 0;

  const propsData = getStream(index, `${PROJECT_DIR}/Props`);
  if (!propsData) throw new MppError('corrupt', 'The Project file is incomplete or damaged (project properties are missing).');
  const projectProps = readProps14(decrypt(propsData, mask));

  // Project version (e.g. 16 for 2016/2019/2021/365), from "Microsoft.Project 16.0" (same pattern as CompObj in MPXJ).
  const match = /^Microsoft.Project.(\d+)\.0$/.exec(applicationName ?? '');
  const applicationVersion = match ? Number(match[1]) : null;

  // Project calendar settings used to convert durations.
  const calendar = {
    minutesPerDay: projectProps.getInt(PropsKey.MINUTES_PER_DAY),
    minutesPerWeek: projectProps.getInt(PropsKey.MINUTES_PER_WEEK),
    daysPerMonth: projectProps.getShort(PropsKey.DAYS_PER_MONTH),
    defaultDurationUnits: durationTimeUnits(projectProps.getShort(PropsKey.DURATION_UNITS)),
  };

  const ctx = {
    format, applicationName, applicationVersion, index, mask, projectProps, calendar,
    stream: path => getStream(index, path),
    decryptedStream: path => decrypt(getStream(index, path), mask),
  };
  // Custom field names and types before the field maps (like MPXJ processCustomFields):
  // enterprise field types are needed to size the fixed blocks.
  // Task/resource Props are encrypted like their data, assignment Props are not.
  ctx.customFieldInfo = readCustomFieldInfo([
    openTable(ctx, 'TBkndTask').encryptedStream('Props'),
    openTable(ctx, 'TBkndRsc').encryptedStream('Props'),
    openTable(ctx, 'TBkndAssn').stream('Props'),
  ]);
  // Org-defined enterprise field maps, per class.
  const enterpriseData = projectProps.getByteArray(PropsKey.ENTERPRISE_CUSTOM_FIELD_MAP);
  ctx.enterpriseMaps = Object.fromEntries(['task', 'resource', 'assignment']
    .map(cls => [cls, createEnterpriseFieldMap(enterpriseData, cls, ctx.customFieldInfo.enterpriseTypes)]));
  return ctx;
}

// Internal table (e.g. "TBkndTask"): fixed blocks and var data, unencrypted.
// Careful (MPP14Reader): in write-protected files the subfolder Props and the FixedData/Fixed2Data
// of resources (TBkndRsc) and assignments (TBkndAssn) are XOR-encrypted: use encryptedStream(name)
// for those. Task streams (TBkndTask) are never encrypted.
export function openTable(ctx, dirName) {
  const dir = `${PROJECT_DIR}/${dirName}`;
  return {
    varMeta: getStream(ctx.index, `${dir}/VarMeta`),
    varData: getStream(ctx.index, `${dir}/Var2Data`),
    fixedMeta: getStream(ctx.index, `${dir}/FixedMeta`),
    fixedData: getStream(ctx.index, `${dir}/FixedData`),
    fixed2Meta: getStream(ctx.index, `${dir}/Fixed2Meta`),
    fixed2Data: getStream(ctx.index, `${dir}/Fixed2Data`),
    stream: name => getStream(ctx.index, `${dir}/${name}`),
    encryptedStream: name => decrypt(getStream(ctx.index, `${dir}/${name}`), ctx.mask),
  };
}

// Field map for a class, read from the project Props (first key found).
export function fieldMapFor(ctx, cls) {
  const keys = {
    task: [PropsKey.TASK_FIELD_MAP, PropsKey.TASK_FIELD_MAP2],
    resource: [PropsKey.RESOURCE_FIELD_MAP, PropsKey.RESOURCE_FIELD_MAP2],
    assignment: [PropsKey.ASSIGNMENT_FIELD_MAP, PropsKey.ASSIGNMENT_FIELD_MAP2],
    relation: [PropsKey.RELATION_FIELD_MAP],
  }[cls];
  for (const key of keys) {
    const data = ctx.projectProps.getByteArray(key);
    if (data) return createFieldMap(data, cls, ctx.customFieldInfo.enterpriseTypes);
  }
  // MPXJ falls back to a default map here: not ported yet.
  throw new MppError('unsupported-structure', 'Unsupported internal file structure (the field map is missing).');
}

// Task in model format (no internal object references).
function taskModel(task) {
  return {
    uid: task.uid,
    id: task.id,
    name: task.name,
    outlineLevel: task.outlineLevel,
    outlineNumber: task.outlineNumber,
    wbs: task.wbs,
    duration: task.duration,
    start: task.start,
    finish: task.finish,
    percentComplete: task.percentComplete,
    work: task.work,
    remainingWork: task.remainingWork,
    summary: task.summary,
    milestone: task.milestone,
    null: task.null,
    predecessors: task.predecessors.map(r => ({ uid: r.task.uid, type: r.type, lag: r.lag })),
    customFields: task.customFields,
    enterpriseFields: task.enterpriseFields,
  };
}

// Reads the whole model: project, tasks, resources and assignments.
// propertiesOnly: project info only (like MPXJ readPropertiesOnly).
export function readMpp(bytes, CFB, { propertiesOnly = false } = {}) {
  const ctx = openProject(bytes, CFB);
  const project = readProject(ctx.projectProps, ctx.index);
  if (propertiesOnly) return { format: ctx.format, applicationName: ctx.applicationName, project };
  const tasks = readTasks(ctx, fieldMapFor(ctx, 'task'), openTable(ctx, 'TBkndTask'));
  // Like MPXJ: project dates missing from Props -> first/last task date.
  project.start ??= earliestStart(tasks);
  project.finish ??= latestFinish(tasks);
  const resources = readResources(ctx, fieldMapFor(ctx, 'resource'), openTable(ctx, 'TBkndRsc'));
  const assignments = readAssignments(ctx, fieldMapFor(ctx, 'assignment'), openTable(ctx, 'TBkndAssn'), tasks, resources);
  return {
    format: ctx.format,
    applicationName: ctx.applicationName,
    project,
    tasks: tasks.map(taskModel),
    resources,
    assignments,
    customFieldNames: ctx.customFieldInfo.names,
    enterpriseFieldTypes: ctx.customFieldInfo.types,
  };
}
