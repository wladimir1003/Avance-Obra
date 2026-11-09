import {read,DAY,iso} from './importadores.js';
const metrics=['Duración','Físico','Costos','Recursos'];
const fmt=n=>n==null?'—':n.toLocaleString('es-CL',{maximumFractionDigits:2});
const ratio=(a,b)=>a==null||!(b>0)?null:100*a/b;
const percent=n=>n==null?'—':fmt(n)+' %';
const opts=(items,i=0)=>({items,index:items.length?i:-1});
const sum=values=>Array.from(values).reduce((a,b)=>a+b,0);
const total=m=>m?sum(m.values()):null;
function before(m,day){if(!m)return null;let n=0;for(const [d,v] of m)if(d<day)n+=v;return n}
let projects=[],references=[],rows=[],last=null,branches=[],conf={};
function plan(){return projects[conf.project]}
function modes(){return conf.metric===1?['Porcentaje']:conf.metric===2?['Moneda de origen','Porcentaje']:['Horas','Minutos','Días','Semanas','Porcentaje']}
function reset(index=0){const p=projects[index];conf={project:index,metric:0,unit:0,series:0,branch:0,p6:0,base:0,day:p?.day||p?.tasks.map(t=>t.end).filter(Boolean).sort().at(-1)||iso(Date.now()),hours:8,week:5,together:true,weighted:false,critical:false};
 buildTree(p);if(bases().length>1)conf.base=1}
function bases(){return ['Sin comparación',...new Set((plan()?.tasks||[]).flatMap(t=>Object.keys(t.refs)))]}
function types(){return plan()?.p6?['Todos los tipos P6',...new Set(plan().tasks.map(t=>t.type))]:[]}
function buildTree(p){
 branches=[{index:0,level:0,name:'Todo el proyecto',parent:-1}];if(!p)return;
 const map=new Map(p.groups.map(g=>[g.id,g])),children=new Map();
 for(const g of p.groups){const parent=map.has(g.parent)?g.parent:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(g)}
 const tasks=new Map();for(const t of p.tasks){const parent=map.has(t.parent)?t.parent:null;if(!tasks.has(parent))tasks.set(parent,[]);tasks.get(parent).push(t);t.group=map.get(parent)?.name||t.group||''}
 const visited=new Set();
 function append(id,parent,level){
  for(const g of children.get(id)||[]){if(visited.has(g.id)||level>200)throw Error('Jerarquía cíclica o demasiado profunda.');visited.add(g.id);const index=branches.length;branches.push({index,parent,level,name:g.name});append(g.id,index,level+1)}
  for(const t of tasks.get(id)||[]){const index=branches.length;branches.push({index,parent,level,name:[t.code,t.name].filter(Boolean).join(' ')});t.node=index}
 }
 append(null,0,1);if(visited.size!==map.size)throw Error('La estructura contiene un grupo sin raíz.');
}
function inScope(t){if(conf.critical&&t.critical!==true)return false;if(conf.p6>0&&t.type!==types()[conf.p6])return false;for(let i=t.node;i>=0;i=branches[i].parent)if(i===conf.branch)return true;return false}
function keys(){if(conf.metric===1)return ['Físico declarado'];return [...new Set((plan()?.tasks||[]).flatMap(t=>Object.keys(t.data[metrics[conf.metric]]||{})))].sort()}
function divisor(){
 if(conf.metric===1||conf.metric===2)return 1;
 const n={Minutos:1,Horas:60,'Días':conf.hours*60,Semanas:conf.hours*conf.week*60,Porcentaje:1}[modes()[conf.unit]];
 return conf.metric===3?n/60:n;
}
function dayActual(t,d){if(plan()?.day&&d>plan().day)return null;return before(t.data['Duración'].Real,d)??(t.done===0?0:null)}
function condition(t,d,base){
 const cur=plan()?.day===d;if(plan()?.day&&d>plan().day)return 'Sin evidencia';
 const v=cur?t.done:dayActual(t,d);if(t.marker){if(cur&&t.pct>=100)return 'Cumplida';if(!cur||t.pct==null)return 'Sin evidencia'}
 else{if(v==null||!(t.minutes>0))return 'Sin evidencia';if(v>=t.minutes)return 'Cumplida'}
 const end=t.refs[base]?.end||t.end;if(!end)return 'Sin evidencia';return end<d?'Atrasada':Date.parse(end)<Date.parse(d)+7*DAY?'Cercana':'Pendiente posterior';
}
function groups(title,rows,category){
 const by=new Map();for(const t of rows){const k=category(t);if(!by.has(k))by.set(k,[]);by.get(k).push(t.id)}
 return {title,groups:[...by].map(([k,ids])=>({name:k+' ('+ids.length+')',count:ids.length,ids}))}
}
const compare=(a,b)=>a==null||b==null?'Sin referencia':a<b?'Inferior':a>b?'Superior':'Igual';
function state(){
 const p=plan(),all=(p?.tasks||[]).filter(inScope);rows=all.filter(t=>t.type!=='Resumen WBS');
 const metric=metrics[conf.metric],units=modes(),series=keys(),base=bases()[conf.base],days=new Map(),totals={},weight=t=>conf.weighted?t.weight:1;
 let cols=series.filter((k,i)=>conf.together?(k==='Real'||k==='Programa'||k==='Físico declarado'||k===base):i===conf.series);
 const maps=new Map(),program=rows.reduce((a,t)=>a+(total(t.data[metric]?.Programa)||0)*(conf.metric===0?weight(t):1),0);
 for(const k of cols){
  const m=new Map();for(const t of rows){for(const [d,v] of t.data[metric]?.[k]||[])m.set(d,(m.get(d)||0)+v*(conf.metric===0?weight(t):1))}
  maps.set(k,m);totals[k]=k==='Real'||k==='Programa'?program:total(m);
 }
 if(conf.metric===1){
  const denom=sum(rows.map(t=>(t.minutes??0)*weight(t)));if(rows.length&&p.day&&p.day<=conf.day&&denom>0&&rows.every(t=>t.physical!=null&&t.minutes!=null))days.set(p.day,[sum(rows.map(t=>t.physical*t.minutes*weight(t)))/denom]);
 }else for(const [i,k] of cols.entries()){
  const map=maps.get(k),dates=[...map.keys()].sort();if(!dates.length)continue;const scale=units[conf.unit]==='Porcentaje'?totals[k]/100:divisor();if(!scale)continue;
  let end=dates.at(-1);if(k==='Real'&&end>=conf.day)end=iso(Date.parse(conf.day)-DAY);
  let accum=0;for(let ms=Date.parse(dates[0]);ms<=Date.parse(end);ms+=DAY){const day=iso(ms);accum+=map.get(day)||0;if(!days.has(day))days.set(day,cols.map(()=>null));days.get(day)[i]=accum/scale}
 }
 const daily=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,v])=>({day,v}));
 const gantt=rows.map(t=>{const ref=t.refs[base],m=t.data['Duración'];return {id:t.id,name:t.name,start:t.start,end:t.end,baseStart:ref?.start,baseEnd:ref?.end,pct:ratio(dayActual(t,conf.day),t.minutes),plan:percent(ratio(before(m.Programa,conf.day),total(m.Programa))),basePct:percent(ratio(before(m[base],conf.day),total(m[base]))),marker:t.marker,crit:t.critical,state:condition(t,conf.day,base)}});
 const critical=rows.filter(t=>t.critical).length;
 const boards=[groups('Inicio',rows,t=>compare(t.start,t.refs[base]?.start)),groups('Fin',rows,t=>compare(t.end,t.refs[base]?.end)),groups('Duración',rows,t=>compare(t.minutes,t.refs[base]?.minutes??total(t.data['Duración'][base]))),groups('Avance',rows,t=>t.pct==null?'Sin dato':t.pct>=100?'Terminada':t.pct>0?'En curso':'Sin iniciar'),groups('Trabajo',rows,t=>compare(t.work,t.refs[base]?.work)),groups('Coste',rows,t=>compare(t.cost,t.refs[base]?.cost))];
 const quality=Object.entries({NoPred:'Sin predecesoras',NoSucc:'Sin sucesoras',NoLinks:'Sin vínculos',Constrained:'Con restricción',NoBase:'Sin línea base'}).map(([k,name])=>{const ids=rows.filter(t=>t.quality[k]).map(t=>t.id);return {name,known:rows.filter(t=>t.quality[k]!=null).length,count:ids.length,ids}});
 const scopeActual=rows.every(t=>dayActual(t,conf.day)!=null&&t.minutes!=null)?ratio(sum(rows.map(t=>dayActual(t,conf.day)*weight(t))),sum(rows.map(t=>t.minutes*weight(t)))):null;
 const reference=conf.base&&rows.every(t=>t.data['Duración'][base])?ratio(sum(rows.map(t=>before(t.data['Duración'][base],conf.day)*weight(t))),sum(rows.map(t=>total(t.data['Duración'][base])*weight(t)))):null;
 const summary=p?'Corte '+conf.day+' · Real por duración '+percent(scopeActual)+' · Plan base '+percent(reference):'Abra un cronograma para visualizar las curvas.';
 const status=p?rows.length+' actividades · '+critical+' críticas'+(rows.some(t=>t.critical==null)?' · '+rows.filter(t=>t.critical==null).length+' sin dato de criticidad':'')+'. '+p.note:'Sin proyecto cargado';
 last={title:p?.title||'Control de proyectos',summary,status,project:opts(projects.map(p=>p.title),conf.project),metric:opts(metrics,conf.metric),unit:opts(units,conf.unit),baseline:opts(bases(),conf.base),series:opts(series,conf.series),p6:opts(types(),conf.p6),day:conf.day,originalDay:p?.day,branch:branches.map(n=>({...n,selected:n.index===conf.branch})),critical:conf.critical,weighted:conf.weighted,together:conf.together,hours:conf.hours,week:conf.week,cols,daily,totals,divisor:divisor(),tasks:all,gantt,boards,quality,progress:[p?.title,summary,status,'Referencia: '+base,'Duración total disponible: '+fmt(sum(rows.map(t=>t.minutes||0))/60)+' h'].filter(Boolean).join('\n\n')};return last;
}
reset();
export async function dispatch(route,q,body){
 if(route==='load'||route==='reference'){const parsed=await read(body);if(!parsed.length||!parsed.some(p=>p.tasks.length))throw Error('El archivo no contiene actividades reconocibles.');if(route==='reference'){references=parsed;return {choices:parsed.map(p=>p.title)}}projects=parsed;reset();return state()}
 if(route==='attach'){const src=references[Number(q.index)],p=plan(),key='Base · '+String(q.label||'').trim();if(!src||!p||!q.label?.trim()||bases().includes(key))throw Error('Seleccione un nombre de base único.');
  const active=p.tasks.filter(t=>t.type!=='Resumen WBS'),other=src.tasks.filter(t=>t.type!=='Resumen WBS'),idx=new Map(other.map(t=>[t.key,t]));if(idx.size!==other.length||active.length!==idx.size||new Set(active.map(t=>t.key)).size!==active.length||active.some(t=>!idx.has(t.key)))throw Error('Se requieren identificadores únicos coincidentes en ambas revisiones.');
  for(const t of active){const b=idx.get(t.key);t.refs[key]={start:b.start,end:b.end,minutes:b.minutes,cost:b.cost,work:b.work};for(const m of Object.keys(t.data))if(b.data[m].Programa)t.data[m][key]=new Map(b.data[m].Programa)}conf.base=bases().indexOf(key);references=[];return state()}
 if(route==='set'){const {key,value}=q;if(key==='close'){projects=[];references=[];reset()}
  else if(key==='project')reset(Number(value));else if(key==='metric'){conf.metric=Number(value);conf.unit=0;conf.series=0}
  else if(key==='day'){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Fecha inválida');conf.day=value}
  else if(['weight','critical','together'].includes(key))conf[key==='weight'?'weighted':key]=value===true||value==='true';
  else if(['unit','series','baseline','p6','branch','hours','week'].includes(key))conf[key==='baseline'?'base':key]=Number(value);
  return state()}
 if(route==='day')return rows.filter(t=>conf.metric===1?t.physical!=null:last.cols.some(k=>{const m=t.data[metrics[conf.metric]]?.[k];return m?.has(q.value)&&(k==='Programa'||m.get(q.value)!==0)}));
 if(route==='exit'){projects=[];reset();return {}}
 return state();
}

