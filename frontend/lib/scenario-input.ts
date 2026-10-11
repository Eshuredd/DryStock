import type {Scenario, Lot, Worker, Resource, Forklift} from './types';

export const limits = {lots:30, workers:6, forklifts:3, tarps:6, storage:6} as const;
export const newLot = (id: string): Lot => ({id,category:'paper',description:'',weight_kg:1,location:'Yard',exposure:'high',condition:'Dry',value_inr:0,vulnerability:3,exposed_loss_inr:0,restrictions:[],protection_status:'exposed',actions:[{kind:'cover',duration:10,workers:1,forklift:false,required_skills:[],effectiveness_bps:8000}]});
export const newWorker = (id:string): Worker => ({id,name:'',skills:[],available_from:0,available_until:240,enabled:true});
export const newResource = (id:string): Resource => ({id,name:'',capacity_kg:1,categories:['paper'],enabled:true});
export const newForklift = (id:string): Forklift => ({id,name:'',available_from:0,available_until:240,enabled:true});
export const emptyScenario = (): Scenario => ({id:'custom-yard',name:'My scenario',weather_label:'SIMULATED · operator-entered weather',rain_arrival_minute:70,safety_buffer_minutes:10,deadline:60,now_minute:0,lots:[newLot('L01')],workers:[newWorker('W1')],tarps:[],storage:[],forklifts:[],completed:[]});
export const codes = (value:string) => value.split(',').map(v=>v.trim()).filter(Boolean);
export function nextId(items: {id:string}[], prefix:string) {
  let n=1; while (items.some(i=>i.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
export function validateScenarioInput(s: Scenario) {
  const errors: Record<string,string> = {};
  const text = (key:string,v:string) => {if (!v.trim() || v.length>160) errors[key]='Enter 1–160 characters.';};
  const number = (key:string,v:number,min:number,max:number) => {if (!Number.isSafeInteger(v) || v<min || v>max) errors[key]=`Enter a whole number from ${min} to ${max.toLocaleString('en-IN')}.`;};
  const list = (key:string,values:string[],required=false) => {
    if ((required && !values.length) || values.length>10 || new Set(values).size!==values.length || values.some(v=>!/^[a-z][a-z0-9_]{0,31}$/.test(v))) errors[key]='Use up to 10 unique lowercase codes, separated by commas (letters, digits, underscores).';
  };
  text('name',s.name); text('weather_label',s.weather_label);
  number('rain_arrival_minute',s.rain_arrival_minute,0,240); number('safety_buffer_minutes',s.safety_buffer_minutes,0,120);
  number('deadline',s.deadline,0,240); number('now_minute',s.now_minute,0,240);
  if (s.deadline>s.rain_arrival_minute-s.safety_buffer_minutes) errors.deadline='Finish handling by rain arrival minus the safety buffer.';
  if (s.now_minute>s.deadline) errors.now_minute='Elapsed time cannot exceed the handling cutoff.';
  if (!s.lots.length) errors.lots='Enter at least one material lot.';
  if (s.completed.length) errors.completed='Reset simulated completed work before editing inputs.';
  for (const group of ['lots','workers','forklifts','tarps','storage'] as const) {
    if (s[group].length>limits[group]) errors[group]=`Use at most ${limits[group]}.`;
    s[group].forEach((item,i)=>{
      const k=`${group}.${i}`;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(item.id) || s[group].filter(v=>v.id===item.id).length!==1) errors[`${k}.id`]='Use a unique ID: 1–32 letters, digits, underscores or hyphens.';
      if ('name' in item) text(`${k}.name`,item.name);
      if ('available_from' in item) {
        number(`${k}.available_from`,item.available_from,0,240); number(`${k}.available_until`,item.available_until,0,240);
        if (item.available_from>item.available_until) errors[`${k}.available_until`]='Availability must end at or after its start.';
      }
      if ('skills' in item) list(`${k}.skills`,item.skills);
      if ('capacity_kg' in item) {
        number(`${k}.capacity_kg`,item.capacity_kg,1,1_000_000_000); list(`${k}.categories`,item.categories,true);
        if (item.categories.some(c=>!s.lots.some(l=>l.category===c))) errors[`${k}.categories`]='Match material codes in your lots exactly.';
      }
    });
  }
  s.lots.forEach((l,i)=>{
    const k=`lots.${i}`; text(`${k}.description`,l.description); text(`${k}.location`,l.location); text(`${k}.condition`,l.condition);
    list(`${k}.category`,[l.category],true); number(`${k}.weight_kg`,l.weight_kg,1,1_000_000_000);
    number(`${k}.value_inr`,l.value_inr,0,9_000_000_000); number(`${k}.exposed_loss_inr`,l.exposed_loss_inr,0,9_000_000_000);
    if (l.exposed_loss_inr>l.value_inr) errors[`${k}.exposed_loss_inr`]='Estimated exposed loss cannot exceed material value.';
    l.actions.forEach((a,j)=>{
      const p=`${k}.actions.${j}`; number(`${p}.duration`,a.duration,1,240); number(`${p}.workers`,a.workers,1,10);
      number(`${p}.effectiveness_bps`,a.effectiveness_bps,1,10000); list(`${p}.required_skills`,a.required_skills);
    });
  });
  if (new TextEncoder().encode(JSON.stringify({revision:0,scenario:s})).length>32768) errors.size='Scenario exceeds 32 KiB. Shorten descriptions or remove entries.';
  return errors;
}
