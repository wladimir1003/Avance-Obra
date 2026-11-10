// Minutes of local project time. UTC arithmetic avoids client timezone and DST shifts.
const dayMs=86400000, minuteMs=60000;
const children=(e,k)=>Array.from(e?.children||[]).filter(x=>x.localName===k);
const one=(e,k)=>children(e,k)[0];
const field=(e,k)=>one(e,k)?.textContent.trim();
const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function clock(s){const m=/^(\d\d?):(\d\d)(?::(\d\d))?/.exec(s||'');return m?Number(m[1])*60+Number(m[2])+Number(m[3]||0)/60:null}
function local(s){const m=/^(\d{4}-\d\d-\d\d)(?:[ T](\d\d?:\d\d(?::\d\d)?))?/.exec(s||'');return m?Date.parse(m[1]+'T00:00:00Z')+(clock(m[2])||0)*minuteMs:NaN}
const blank=()=>({week:new Map(),exceptions:new Map(),periods:[],parent:null,unsupported:false});
function intervals(pairs){return pairs.filter(([a,b])=>a!=null&&b!=null&&b>a).sort((a,b)=>a[0]-b[0])}
function resolve(cals,id,d,w,visited=new Set()){
 const cal=cals.get(String(id));if(!cal||cal.unsupported||visited.has(id))return null;visited.add(id);
 if(cal.exceptions.has(d))return cal.exceptions.get(d);
 for(const p of cal.periods)if(d>=p.from&&d<=p.to&&p.week.has(w))return p.week.get(w);
 if(cal.week.has(w))return cal.week.get(w);
 return cal.parent!=null?resolve(cals,cal.parent,d,w,visited):[];
}
export function dailyHours(cals,id,start,finish){
 const a=local(start),b=local(finish);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return [];
 const daily=[];for(let cur=Math.floor(a/dayMs)*dayMs;cur<b;cur+=dayMs){
  const date=new Date(cur),day=date.toISOString().slice(0,10);
  const shifts=resolve(cals,id,day,date.getUTCDay());if(shifts===null)return [];
  let minutes=0,last=0;for(const [lo,hi] of shifts){const begin=Math.max(lo,last,(a-cur)/minuteMs),end=Math.min(hi,(b-cur)/minuteMs);minutes+=Math.max(0,end-begin);last=Math.max(last,hi)}
  if(minutes>0)daily.push([day,minutes]);
 }return daily;
}
export function msCalendars(root){
 const cals=new Map();const standard=blank();for(let w=0;w<7;w++)standard.week.set(w,w>0&&w<6?[[480,720],[780,1020]]:[]);
 cals.set('standard',standard);
 const shifts=e=>intervals(children(one(e,'WorkingTimes'),'WorkingTime').map(t=>[clock(field(t,'FromTime')),clock(field(t,'ToTime'))]));
 function week(e){const map=new Map();for(const wd of children(one(e,'WeekDays'),'WeekDay')){const n=Number(field(wd,'DayType'));if(n>=1&&n<=7)map.set(n-1,shifts(wd))}return map}
 for(const c of children(one(root,'Calendars'),'Calendar')){
  const cal=blank(),id=field(c,'UID'),base=field(c,'BaseCalendarUID');cal.parent=base&&base!=='-1'?base:null;cal.week=week(c);
  for(const ww of children(one(c,'WorkWeeks'),'WorkWeek')){const range=one(ww,'TimePeriod');cal.periods.push({from:field(range,'FromDate')?.slice(0,10),to:field(range,'ToDate')?.slice(0,10),week:week(ww)})}
  for(const ex of [...children(one(c,'Exceptions'),'Exception'),...children(one(c,'WeekDays'),'WeekDay').filter(w=>field(w,'DayType')==='0')]){
   const r=one(ex,'TimePeriod'),a=local(field(r,'FromDate')),b=local(field(r,'ToDate'));
   if((Number(field(ex,'Occurrences')||1)>1)||!Number.isFinite(a)||!Number.isFinite(b)){cal.unsupported=true;continue}
   for(let d=Math.floor(a/dayMs)*dayMs;d<=b;d+=dayMs)cal.exceptions.set(new Date(d).toISOString().slice(0,10),shifts(ex));
  }
  cals.set(id,cal);
 }return cals;
}
function xerBlock(s,key){const marker='||'+key+'()(';const i=s.indexOf(marker);return i<0?'':body(s,i+marker.length-1)}
function body(s,pos){let depth=1;for(let j=pos+1;j<s.length;j++){if(s[j]==='(')depth++;if(s[j]===')'&&--depth===0)return s.slice(pos+1,j)}return ''}
function xerShifts(s){return intervals([...s.matchAll(/\(([^()]*(?:s\||f\|)[^()]*)\)/g)].map(m=>{const kv=m[1].split('|');return [clock(kv[kv.indexOf('s')+1]),clock(kv[kv.indexOf('f')+1])] }))}
export function xerCalendars(records){
 const cals=new Map();for(const c of records){const cal=blank(),s=c.clndr_data||'';cal.parent=c.base_clndr_id||null;
  const wk=xerBlock(s,'DaysOfWeek');for(const m of wk.matchAll(/\(\d+\|\|([1-7])\(\)\(/g))cal.week.set(Number(m[1])-1,xerShifts(body(wk,m.index+m[0].length-1)));
  const ex=xerBlock(s,'Exceptions');for(const m of ex.matchAll(/\(\d+\|\|\d+\(d\|(\d+)\)\(/g)){
   const day=new Date(Date.UTC(1899,11,30)+Number(m[1])*dayMs).toISOString().slice(0,10);cal.exceptions.set(day,xerShifts(body(ex,m.index+m[0].length-1)));
  }
  if(!wk&&!cal.parent)cal.unsupported=true;cals.set(c.clndr_id,cal);
 }return cals;
}
export function pmCalendars(root,project){
 const cals=new Map();const shifts=e=>intervals(children(e,'WorkTime').map(t=>{
  const a=clock(field(t,'Start')),b=clock(field(t,'Finish'));return [a,b!=null&&b%30===29?b+1:b];
 }));
 for(const c of [...children(root,'Calendar'),...children(project,'Calendar')]){
  const cal=blank();cal.parent=field(c,'BaseCalendarObjectId')||null;
  for(const w of children(one(c,'StandardWorkWeek'),'StandardWorkHours'))cal.week.set(names.indexOf(field(w,'DayOfWeek')),shifts(w));
  for(const ex of Array.from(one(c,'HolidayOrExceptions')?.children||[])){const d=field(ex,'Date')?.slice(0,10);if(d)cal.exceptions.set(d,shifts(ex));else cal.unsupported=true}
  cals.set(field(c,'ObjectId'),cal);
 }return cals;
}

