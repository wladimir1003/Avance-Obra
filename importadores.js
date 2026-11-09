import {readMpp,openProject} from './vendor/mpp/reader.js';
export const DAY=86400000;
export const iso=ms=>new Date(ms).toISOString().slice(0,10);
const val=(e,k)=>Array.from(e?.children||[]).find(n=>n.localName===k)?.textContent.trim()||null;
const list=(e,k)=>Array.from(e?.children||[]).filter(n=>n.localName===k);
const child=(e,k)=>list(e,k)[0];
const number=v=>v==null||v===''||!Number.isFinite(Number(String(v).replaceAll(',','')))?null:Number(String(v).replaceAll(',',''));
const num=(e,k)=>number(val(e,k));
const truth=v=>v==null?null:/^(true|1|y)$/i.test(v);
const date=v=>v&&/^\d{4}-\d{2}-\d{2}/.test(v)?v.slice(0,10):null;
const stamp=v=>v&&BigInt(v)>0n?iso(Number(BigInt(v)/10000n)-11644473600000):null;
const hours=v=>v==null?null:v*60;
const project=(title,day,p6=false)=>({title,day,p6,tasks:[],groups:[],note:''});
function task(id,name){return {id:String(id),name:name||String(id),type:'Tarea',minutes:null,done:null,critical:null,weight:1,steps:[],quality:{},refs:{},data:{'Duración':{},'Costos':{},'Recursos':{}},code:'',parent:null,group:'',pct:null}}
function add(t,metric,key,d,v){if(!d||v==null||!Number.isFinite(v))return;const m=t.data[metric][key]??=new Map();m.set(d,(m.get(d)||0)+v)}
function tracker(root,name){
 const info=child(root,'ProjectInfo'),p=project(val(info,'Name')||name,stamp(val(info,'DataDate')));
 for(const n of list(child(root,'OutlineCodes'),'Outline'))p.groups.push({id:val(n,'ID'),parent:val(n,'ParentID'),name:val(n,'Name')});
 for(const n of list(child(root,'Tasks'),'Task')){
  const t=task(val(n,'TaskID'),val(n,'Name'));Object.assign(t,{key:val(n,'UniqueID')||t.id,parent:val(n,'OutlineCode'),group:val(n,'Parent')||'',start:stamp(val(n,'TaskStart')),end:stamp(val(n,'TaskFinish')),minutes:num(n,'Minutes'),done:num(n,'MinutesDone'),pct:num(n,'OverallProgress'),physical:num(n,'PhysicalProgress'),work:num(n,'OverallWork'),cost:num(n,'OverallCost'),weight:num(n,'Weighting')??1});
  const fl=num(n,'Float');t.critical=fl==null?null:fl<=0;t.marker=t.minutes===0&&t.start===t.end;if(t.marker)t.type='Hito';
  for(const k of ['NoPred','NoSucc','NoLinks','Constrained','NoBase'])t.quality[k]=truth(val(n,k));
  for(const item of list(child(n,'Items'),'Item')){
   const type=val(item,'Type');if(!['1','2','3'].includes(type))continue;
   const d=stamp(val(item,'Date')),key=type==='1'?'Programa':'Base '+(Number(type)-1),progress=num(item,'Progress');
   for(const [m,k] of [['Duración','Minutes'],['Costos','Cost'],['Recursos','Work']]){
    const value=num(item,k);add(t,m,key,d,value);
    if(type==='1'&&progress>0&&value!=null)add(t,m,'Real',d,value*progress/100);
   }
   if(type!=='1'){const prefix='B'+(Number(type)-1);t.refs[key]={start:stamp(val(n,prefix+'Start')),end:stamp(val(n,prefix+'Finish')),cost:num(n,prefix+'Cost'),work:num(n,prefix+'Work')}}
  }
  if(t.data['Duración'].Real && p.day){const d=iso(Date.parse(p.day)-DAY);add(t,'Duración','Real',d,0)}
  p.tasks.push(t);
 }
 return p;
}
function duration(v){const m=/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v||'');return m?Number(m[1]||0)*1440+Number(m[2]||0)*60+Number(m[3]||0)+Number(m[4]||0)/60:null}
// When an interchange file has totals only, display accumulation on its dated endpoints.
function endpoints(t,actualEnd){
 for(const [m,total,done] of [['Duración',t.minutes,t.done],['Costos',t.cost,t.actualCost],['Recursos',t.work,t.actualWork]]){
  if(total!=null&&t.end){if(t.start&&t.start<t.end)add(t,m,'Programa',t.start,0);add(t,m,'Programa',t.end,total)}
  if(done!=null&&actualEnd)add(t,m,'Real',actualEnd,done);
 }
 for(const [key,ref] of Object.entries(t.refs))for(const [m,v] of [['Duración',ref.minutes],['Costos',ref.cost],['Recursos',ref.work]]){if(ref.start&&ref.start<ref.end&&v!=null)add(t,m,key,ref.start,0);add(t,m,key,ref.end,v)}
}
const profileNote='Perfil por fechas de fin: los totales del programa se acumulan al término de cada actividad. El real se ubica en su fin real o inmediatamente antes del corte de origen. No representa una distribución por calendario laboral.';
function external(p,t,actualEnd){t.marker=t.marker??false;t.type=t.marker&&t.type==='Tarea'?'Hito':t.type;t.key??=t.id;endpoints(t,actualEnd||(p.day?iso(Date.parse(p.day)-DAY):null));p.tasks.push(t);p.note=profileNote}
function microsoft(root,name){
 const p=project(val(root,'Name')||name,date(val(root,'StatusDate'))),stack=[];
 for(const n of list(child(root,'Tasks'),'Task')){
  if(truth(val(n,'IsNull')))continue;
  const t=task(val(n,'UID'),val(n,'Name')),level=num(n,'OutlineLevel')??1;
  while(stack.length&&stack.at(-1).level>=level)stack.pop();t.parent=stack.at(-1)?.id;t.code=val(n,'OutlineNumber')||val(n,'WBS')||'';
  if(truth(val(n,'Summary'))){p.groups.push({id:t.id,parent:t.parent,name:t.code+' '+t.name});stack.push({id:t.id,level});continue}
  Object.assign(t,{start:date(val(n,'Start')),end:date(val(n,'Finish')),minutes:duration(val(n,'Duration')),done:duration(val(n,'ActualDuration')),pct:num(n,'PercentComplete'),physical:num(n,'PhysicalPercentComplete'),critical:truth(val(n,'Critical')),marker:truth(val(n,'Milestone')),cost:num(n,'Cost'),actualCost:num(n,'ActualCost')});
  const work=duration(val(n,'Work')),actual=duration(val(n,'ActualWork'));t.work=work==null?null:work/60;t.actualWork=actual==null?null:actual/60;
  for(const b of list(n,'Baseline')){const w=duration(val(b,'Work'));t.refs['Base MS '+(val(b,'Number')||'0')]={start:date(val(b,'Start')),end:date(val(b,'Finish')),minutes:duration(val(b,'Duration')),cost:num(b,'Cost'),work:w==null?null:w/60}}
  external(p,t,date(val(n,'ActualFinish')));
 }
 return p;
}
const p6type={TT_Task:'Dependiente de tarea',TT_Rsrc:'Dependiente de recursos',TT_LOE:'Nivel de esfuerzo',TT_Mile:'Hito de inicio',TT_FinMile:'Hito de fin',TT_WBS:'Resumen WBS','Task Dependent':'Dependiente de tarea','Resource Dependent':'Dependiente de recursos','Level of Effort':'Nivel de esfuerzo','Start Milestone':'Hito de inicio','Finish Milestone':'Hito de fin','WBS Summary':'Resumen WBS'};
function xer(text){
 const tables={};let active=null,fields=[];
 for(const line of text.split(/\r?\n/)){const [tag,...v]=line.split('\t');if(tag==='%T')active=tables[v[0]]??=[];else if(tag==='%F')fields=v;else if(tag==='%R'&&active)active.push(Object.fromEntries(fields.map((k,i)=>[k,v[i]??''])))}
 return (tables.PROJECT||[]).map(pr=>{
  const p=project(pr.proj_short_name||pr.proj_id,date(pr.last_recalc_date),true);const groups=(tables.PROJWBS||[]).filter(n=>n.proj_id===pr.proj_id);
  p.groups=groups.map(n=>({id:n.wbs_id,parent:n.parent_wbs_id,name:n.wbs_short_name+' '+n.wbs_name}));
  for(const n of (tables.TASK||[]).filter(n=>n.proj_id===pr.proj_id)){
   const t=task(n.task_id,n.task_name);Object.assign(t,{key:n.task_code,code:n.task_code,parent:n.wbs_id,start:date(n.act_start_date||n.early_start_date||n.target_start_date),end:date(n.act_end_date||n.early_end_date||n.target_end_date),type:p6type[n.task_type]||n.task_type,minutes:hours(number(n.target_drtn_hr_cnt)),physical:number(n.phys_complete_pct),work:number(n.target_work_qty),actualWork:number(n.act_work_qty)});t.marker=t.type.startsWith('Hito');const rem=number(n.remain_drtn_hr_cnt);
   if(n.status_code==='TK_NotStart')t.done=0;else if(t.minutes!=null&&rem!=null)t.done=Math.max(0,t.minutes-rem*60);
   t.pct=n.status_code==='TK_Complete'?100:t.minutes>0&&t.done!=null?100*t.done/t.minutes:null;
   const fl=number(n.total_float_hr_cnt);t.critical=pr.critical_path_type==='CT_DrivPath'?truth(n.driving_path_flag):fl==null?null:fl<=(number(pr.critical_drtn_hr_cnt)??0);
   t.steps=(tables.TASKPROC||[]).filter(a=>a.task_id===t.id).map(a=>({Nombre:a.proc_name,Orden:number(a.seq_num),Peso:number(a.proc_wt),Avance:number(a.complete_pct)}));external(p,t,date(n.act_end_date));
  }return p;
 });
}
function p6xml(root){return list(root,'Project').map(n=>{
 const p=project(val(n,'Name'),date(val(n,'DataDate')),true);p.groups=list(n,'WBS').map(w=>({id:val(w,'ObjectId'),parent:val(w,'ParentObjectId'),name:(val(w,'Code')||'')+' '+val(w,'Name')}));
 for(const a of list(n,'Activity')){const t=task(val(a,'ObjectId'),val(a,'Name'));Object.assign(t,{parent:val(a,'WBSObjectId'),key:val(a,'Id'),code:val(a,'Id'),type:p6type[val(a,'Type')]||val(a,'Type'),start:date(val(a,'StartDate')),end:date(val(a,'FinishDate')),minutes:hours(num(a,'AtCompletionDuration')),done:hours(num(a,'ActualDuration')),work:num(a,'AtCompletionLaborUnits'),actualWork:num(a,'ActualLaborUnits'),cost:num(a,'AtCompletionTotalCost'),actualCost:num(a,'ActualTotalCost')});t.marker=t.type?.startsWith('Hito');t.physical=num(a,'PhysicalPercentComplete')==null?null:num(a,'PhysicalPercentComplete')*100;t.pct=num(a,'PercentComplete')==null?null:num(a,'PercentComplete')*100;
  const fl=num(a,'TotalFloat');t.critical=val(n,'CriticalActivityPathType')==='Longest Path'?truth(val(a,'IsLongestPath')):fl==null?null:fl<=(num(n,'CriticalActivityFloatThreshold')??0);
  t.steps=list(n,'ActivityStep').filter(x=>val(x,'ActivityObjectId')===t.id).map(x=>({Nombre:val(x,'Name'),Orden:num(x,'SequenceNumber'),Peso:num(x,'Weight'),Avance:num(x,'PercentComplete')==null?null:100*num(x,'PercentComplete')}));external(p,t,date(val(a,'ActualFinishDate')));
 }return p;
})}
function mpp(bytes,name){
 const ctx=openProject(bytes,window.CFB),m=readMpp(bytes,window.CFB),p=project(m.project.title||name,date(m.project.statusDate)),stack=[];
 const units={MINUTES:1,HOURS:60,DAYS:ctx.calendar.minutesPerDay,WEEKS:ctx.calendar.minutesPerWeek,MONTHS:ctx.calendar.minutesPerDay*ctx.calendar.daysPerMonth,ELAPSED_MINUTES:1,ELAPSED_HOURS:60,ELAPSED_DAYS:1440,ELAPSED_WEEKS:10080,ELAPSED_MONTHS:43200};
 const mins=d=>d&&units[d.units]?d.value*units[d.units]:null;
 for(const n of m.tasks.filter(n=>!n.null)){const t=task(n.uid,n.name),level=n.outlineLevel??1;while(stack.length&&stack.at(-1).level>=level)stack.pop();t.parent=stack.at(-1)?.id;t.code=n.outlineNumber||'';
  if(n.summary){p.groups.push({id:t.id,parent:t.parent,name:t.code+' '+t.name});stack.push({id:t.id,level});continue}
  Object.assign(t,{start:date(n.start),end:date(n.finish),minutes:mins(n.duration),pct:n.percentComplete,marker:n.milestone});if(t.minutes!=null&&t.pct!=null)t.done=t.minutes*t.pct/100;const work=mins(n.work),rem=mins(n.remainingWork);t.work=work==null?null:work/60;t.actualWork=work!=null&&rem!=null?(work-rem)/60:null;external(p,t,null);
 }return p;
}
// XML intermedio emitido por Importar.java en la distribución Windows.
function prepared(root,name){
 return list(root,'Project').map(n=>{
  const p=project(val(n,'Title')||name,date(val(n,'Status')),val(n,'Origen')==='P6');
  p.groups=list(child(n,'OutlineCodes'),'Outline').map(w=>({id:val(w,'ID'),parent:val(w,'ParentID'),name:[val(w,'OutlineNumber')||val(w,'oCode'),val(w,'Name')].filter(Boolean).join(' ')}));
  for(const a of list(child(n,'Tasks'),'Task')){
   const t=task(val(a,'TaskID'),val(a,'Name'));
   Object.assign(t,{key:val(a,'ActivityCode')||t.id,parent:val(a,'OutlineCode'),code:val(a,'OutlineNumber')||val(a,'ActivityCode')||'',start:date(val(a,'Inicio')),end:date(val(a,'Fin')),minutes:num(a,'Minutes'),done:num(a,'MinutesDone'),pct:num(a,'Progreso'),physical:num(a,'Fisico'),cost:num(a,'Coste'),critical:truth(val(a,'Critical')),marker:truth(val(a,'Hito')),profile:val(a,'Perfil')});
   const w=num(a,'Trabajo');t.work=w==null?null:w/60;const type=val(a,'TipoP6');t.type=({RESOURCE_DEPENDENT:'Dependiente de recursos',TASK_DEPENDENT:'Dependiente de tarea',LEVEL_OF_EFFORT:'Nivel de esfuerzo',START_MILESTONE:'Hito de inicio',FINISH_MILESTONE:'Hito de fin',WBS_SUMMARY:'Resumen WBS'})[type]||(t.marker?'Hito':'Tarea');
   for(const b of list(a,'Baseline')){const work=num(b,'Trabajo');t.refs[b.getAttribute('name')]={start:date(val(b,'Inicio')),end:date(val(b,'Fin')),minutes:num(b,'Minutes'),cost:num(b,'Coste'),work:work==null?null:work/60}}
   if(val(a,'BaseInicio')&&val(a,'BaseFin')){const work=num(a,'BaseTrabajo');t.refs['Base 1 (calendario)']={start:date(val(a,'BaseInicio')),end:date(val(a,'BaseFin')),minutes:num(a,'BaseMinutos'),cost:num(a,'BaseCoste'),work:work==null?null:work/60}}
   for(const point of list(a,'Point')){
    let k=point.getAttribute('serie'),m='Duración',v=number(point.getAttribute('minutos'));
    if(k.startsWith('Recurso/')){m='Recursos';k=k.slice(8);if(v!=null)v/=60}else if(k.startsWith('Coste/')){m='Costos';k=k.slice(6)}
    if(k.startsWith('Programa ('))k='Programa';else if(k.startsWith('Real ('))k='Real';
    add(t,m,k,date(point.getAttribute('fecha')),v);
   }
   t.steps=list(a,'Paso').map(x=>({Orden:num(x,'Orden'),Nombre:val(x,'Nombre'),Peso:num(x,'Peso'),Avance:num(x,'Avance')}));p.tasks.push(t);
  }
  p.note='Distribución diaria importada del motor Windows.';return p;
 });
}
export async function read(file){
 const ext=file.name.split('.').pop().toLowerCase();
 if(ext==='mpp'){try{return [mpp(new Uint8Array(await file.arrayBuffer()),file.name)]}catch(e){throw Error('MPP: '+e.message+' Alternativa: guardar el proyecto como XML de Microsoft Project.')}}
 const bytes=await file.arrayBuffer();let text=new TextDecoder('utf-8').decode(bytes);
 if(text.charCodeAt(0)===65533&&new Uint8Array(bytes)[0]===255)text=new TextDecoder('utf-16le').decode(bytes);
 if(ext==='xer'){if(text.includes('\uFFFD'))text=new TextDecoder('windows-1252').decode(bytes);return xer(text)}
 const doc=new DOMParser().parseFromString(text,'application/xml'),r=doc.documentElement;
 if(doc.querySelector('parsererror'))throw Error('XML mal formado.');
 if(r.localName==='Projects')return prepared(r,file.name);
 if(r.localName==='Project'&&child(r,'ProjectInfo'))return [tracker(r,file.name)];
 if(r.localName==='Project'&&r.namespaceURI?.includes('microsoft.com/project'))return [microsoft(r,file.name)];
 if(r.localName==='APIBusinessObjects')return p6xml(r);
 throw Error('Formato desconocido. Seleccione XML de Tracker, Microsoft Project o Primavera P6, XER o MPP.');
}

