'use client';
import {useState, type ReactNode} from 'react';
import type {Scenario} from '../lib/types';
import {codes, emptyScenario, limits, newForklift, newLot, newResource, newWorker, nextId, validateScenarioInput} from '../lib/scenario-input';

function Input({path,label,value,onChange,error,numeric=false,help,scale=1}: {path:string;label:string;value:string|number;onChange:(v:string|number)=>void;error?:string;numeric?:boolean;help?:string;scale?:number}) {
  const id=`scenario-${path}`;
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={numeric ? 'number':'text'} step={scale===100 ? '0.01':'1'} maxLength={numeric ? undefined : 160} value={typeof value==='number' ? Number.isFinite(value) ? value/scale : '' : value} onChange={e=>onChange(numeric ? e.target.value.trim()==='' ? NaN : Number((Number(e.target.value)*scale).toFixed(6)) : e.target.value)} aria-invalid={Boolean(error)} aria-describedby={`${id}-help ${id}-error`}/><small id={`${id}-help`}>{help}</small>{error && <p id={`${id}-error`} className="field-error">{error}</p>}</div>;
}

export function ScenarioEditor({initial,startEmpty,busy,onSave,onCancel,feedback}: {initial:Scenario;startEmpty:boolean;busy:boolean;onSave:(s:Scenario)=>Promise<boolean>;onCancel:()=>void;feedback:ReactNode}) {
  const [draft,setDraft] = useState<Scenario>(()=>startEmpty ? emptyScenario() : structuredClone({...initial,completed:[]}));
  const [attempted,setAttempted] = useState(false);
  const [touched,setTouched] = useState<string[]>([]);
  const [rawCodes,setRawCodes] = useState<Record<string,string>>({});
  const errors=validateScenarioInput(draft);
  function update(path:string,value:unknown) {
    if (path.endsWith('.actions')) setRawCodes(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!key.startsWith(`${path}.`))));
    setTouched(t=>[...t,path]);
    setDraft(previous=>{
      const copy=structuredClone(previous); const parts=path.split('.');
      let target=copy as unknown as Record<string,unknown>;
      for (const key of parts.slice(0,-1)) target=target[key] as Record<string,unknown>;
      target[parts.at(-1)!]=value; return copy;
    });
  }
  const field=(path:string,label:string,value:string|number,help?:string,scale=1)=><Input key={path} path={path} label={label} value={value} numeric={typeof value==='number'} help={help} scale={scale} onChange={v=>update(path,v)} error={attempted || touched.includes(path) ? errors[path] : undefined}/>;
  const listField=(path:string,label:string,value:string[],help?:string)=><Input key={path} path={path} label={label} value={rawCodes[path] ?? value.join(', ')} help={help} onChange={v=>{setRawCodes(previous=>({...previous,[path]:String(v)}));update(path,codes(String(v)));}} error={attempted || touched.includes(path) ? errors[path] : undefined}/>;
  const check=(path:string,label:string,value:boolean)=><label className="checkbox-row"><input type="checkbox" checked={value} onChange={e=>update(path,e.target.checked)}/>{label}</label>;
  function add(group:'lots'|'workers'|'tarps'|'storage'|'forklifts') {
    const id=nextId(draft[group],{lots:'L',workers:'W',tarps:'T',storage:'S',forklifts:'F'}[group]);
    const item=group==='lots'?newLot(id):group==='workers'?newWorker(id):group==='forklifts'?newForklift(id):newResource(id);
    update(group,[...draft[group],item]);
  }
  const remove=(group:'lots'|'workers'|'tarps'|'storage'|'forklifts',i:number)=>{setRawCodes({});update(group,draft[group].filter((_,index)=>index!==i));};
  async function save() {
    setAttempted(true);
    if (Object.keys(errors).length) {
      const invalid=Object.keys(errors)[0]; const element=document.getElementById(`scenario-${invalid}`);
      const details=element?.closest('details'); if (details) details.open=true;
      (element || document.getElementById('scenario-errors'))?.focus(); return;
    }
    if (await onSave(draft)) onCancel();
  }
  return <section className="panel input-editor" aria-labelledby="scenario-editor-title">
    <div className="panel-heading"><div><h2 id="scenario-editor-title" tabIndex={-1}>Enter your own scenario</h2><p>1. Set weather · 2. Add lots · 3. Add crew · 4. Add equipment · Save and generate.</p></div><button className="text-button" disabled={busy} onClick={onCancel}>Cancel editing</button></div>
    <p className="detail-copy">All values are your demo assumptions. Defaults are editable starting values. No prices, losses, durations or weather are fetched. Required skills apply to every assigned worker. A tarp or bay protects one whole lot and stays occupied through rain; capacity is per lot. Unsaved edits do not affect the current plan.</p>
    <form noValidate onSubmit={e=>{e.preventDefault();void save();}}>
      <fieldset disabled={busy} className="editor-body">
        <div className="editor-actions"><button className="secondary" type="button" onClick={()=>{setDraft(emptyScenario());setAttempted(false);setTouched([]);setRawCodes({});}}>Start with empty inputs</button><button className="secondary" type="button" onClick={()=>{setDraft(structuredClone({...initial,completed:[]}));setAttempted(false);setTouched([]);setRawCodes({});}}>Copy current yard inputs</button></div>
        {attempted && Object.keys(errors).length>0 && <div id="scenario-errors" tabIndex={-1} className="alert error" role="alert">Fix {Object.keys(errors).length} input issue(s) before saving. {errors.lots || errors.size || errors.completed}</div>}
        <h3>1. Weather and scenario</h3><div className="input-grid">{field('name','Scenario name',draft.name)}{field('weather_label','Weather assumption',draft.weather_label)}{field('rain_arrival_minute','Rain arrival (minute)',draft.rain_arrival_minute,'Minutes 0–240 from event start.')}{field('safety_buffer_minutes','Safety buffer (minutes)',draft.safety_buffer_minutes,'Minutes 0–120 before rain.')}{field('deadline','Finish handling by (minute)',draft.deadline,'Must allow the safety buffer before rain.')}{field('now_minute','Elapsed time (minutes)',draft.now_minute,'Start new work at or after this clock.')}</div>
        <h3>2. Material lots ({draft.lots.length}/30)</h3><p>Material value is total lot value. Exposed loss is your estimated loss if left unprotected. Calculated benefit = exposed loss × assumed loss reduction; exposure and condition are descriptive.</p>
        {draft.lots.map((l,i)=><details className="input-row" key={i} open={i===0 ? true:undefined}><summary>Lot {i+1}: {l.description || 'Add a description'} · {l.id}</summary><div className="input-grid">{field(`lots.${i}.id`,'Lot ID',l.id)}{field(`lots.${i}.description`,'Material description',l.description)}{field(`lots.${i}.category`,'Material code',l.category,'Example: paper, cardboard, newsprint. Match equipment compatibility codes.')}{field(`lots.${i}.weight_kg`,'Weight (kg)',l.weight_kg)}{field(`lots.${i}.location`,'Yard location',l.location)}{field(`lots.${i}.condition`,'Current condition',l.condition)}{field(`lots.${i}.value_inr`,'Material value (₹ per lot)',l.value_inr)}{field(`lots.${i}.exposed_loss_inr`,'Estimated exposed loss (₹ per lot)',l.exposed_loss_inr)}<div className="field"><label htmlFor={`status-${i}`}>Initial protection</label><select id={`status-${i}`} value={l.protection_status} onChange={e=>update(`lots.${i}.protection_status`,e.target.value)}><option value="exposed">Exposed</option><option value="already_protected">Already sheltered before this event</option></select></div><div className="field"><label htmlFor={`exposure-${i}`}>Exposure description</label><select id={`exposure-${i}`} value={l.exposure} onChange={e=>update(`lots.${i}.exposure`,e.target.value)}>{['high','medium','low'].map(v=><option key={v}>{v}</option>)}</select></div></div>
          <h4>Allowed handling options</h4><p>Enable only actions safe for this lot. Leaving it exposed is always allowed. Required skills and equipment are enforced.</p>{(['cover','relocate'] as const).map(kind=>{const index=l.actions.findIndex(a=>a.kind===kind),a=l.actions[index];return <div className="handling-input" key={kind}><label className="checkbox-row"><input type="checkbox" checked={Boolean(a)} onChange={e=>update(`lots.${i}.actions`,e.target.checked?[...l.actions,{kind,duration:10,workers:1,forklift:false,required_skills:[],effectiveness_bps:kind==='cover'?8000:10000}]:l.actions.filter(v=>v.kind!==kind))}/>{kind==='cover'?'Cover with a tarp':'Move to a covered bay'}</label>{a && <><div className="input-grid">{field(`lots.${i}.actions.${index}.duration`,`${kind} duration (minutes)`,a.duration)}{field(`lots.${i}.actions.${index}.workers`,`${kind} crew needed (people)`,a.workers)}{field(`lots.${i}.actions.${index}.effectiveness_bps`,`${kind} assumed loss reduction (%)`,a.effectiveness_bps,'0.01–100%; an assumption, not a prediction.',100)}{listField(`lots.${i}.actions.${index}.required_skills`,`${kind} required skills`,a.required_skills,'Comma-separated codes. Every crew member must have all listed skills.')}</div>{check(`lots.${i}.actions.${index}.forklift`,'Requires one available forklift',a.forklift)}</>}</div>;})}<button type="button" className="text-button" onClick={()=>remove('lots',i)}>Remove lot {i+1}</button></details>)}
        <button type="button" className="secondary" disabled={draft.lots.length>=limits.lots} onClick={()=>add('lots')}>Add material lot</button>
        <h3>3. Available workers ({draft.workers.length}/6)</h3><p>Zero workers is allowed and produces no new handling work. Availability is in minutes from event start.</p>
        {draft.workers.map((w,i)=><div className="input-row" key={i}><h4>Worker {i+1}</h4><div className="input-grid">{field(`workers.${i}.id`,'Worker ID',w.id)}{field(`workers.${i}.name`,'Worker name',w.name)}{listField(`workers.${i}.skills`,'Worker skills',w.skills,'Comma-separated codes, e.g. forklift, bale_handling.')}{field(`workers.${i}.available_from`,'Worker available from (minute)',w.available_from)}{field(`workers.${i}.available_until`,'Worker available until (minute)',w.available_until)}</div>{check(`workers.${i}.enabled`,'Worker available',w.enabled)}<button type="button" className="text-button" onClick={()=>remove('workers',i)}>Remove worker {i+1}</button></div>)}<button type="button" className="secondary" disabled={draft.workers.length>=limits.workers} onClick={()=>add('workers')}>Add worker</button>
        <h3>4. Equipment and compatibility</h3><p>Tarps and bays use weight capacity (kg) and exact material codes. Forklifts are scheduled individually by availability; this model has no forklift weight-capacity constraint.</p>
        {(['tarps','storage'] as const).map(group=><div key={group}><h4>{group==='tarps'?'Tarps':'Covered bays'} ({draft[group].length}/{limits[group]})</h4>{draft[group].map((r,i)=><div className="input-row" key={i}><div className="input-grid">{field(`${group}.${i}.id`,'Equipment ID',r.id)}{field(`${group}.${i}.name`,'Equipment name',r.name)}{field(`${group}.${i}.capacity_kg`,'Capacity (kg per lot)',r.capacity_kg)}{listField(`${group}.${i}.categories`,'Compatible material codes',r.categories,'Match the codes in your material lots, separated by commas.')}</div>{check(`${group}.${i}.enabled`,'Equipment available',r.enabled)}<button type="button" className="text-button" onClick={()=>remove(group,i)}>Remove {group==='tarps'?'tarp':'bay'} {i+1}</button></div>)}<button type="button" className="secondary" disabled={draft[group].length>=limits[group]} onClick={()=>add(group)}>Add {group==='tarps'?'tarp':'covered bay'}</button></div>)}
        <h4>Forklifts ({draft.forklifts.length}/3)</h4>{draft.forklifts.map((f,i)=><div className="input-row" key={i}><div className="input-grid">{field(`forklifts.${i}.id`,'Forklift ID',f.id)}{field(`forklifts.${i}.name`,'Forklift name',f.name)}{field(`forklifts.${i}.available_from`,'Forklift available from (minute)',f.available_from)}{field(`forklifts.${i}.available_until`,'Forklift available until (minute)',f.available_until)}</div>{check(`forklifts.${i}.enabled`,'Forklift available',f.enabled)}<button type="button" className="text-button" onClick={()=>remove('forklifts',i)}>Remove forklift {i+1}</button></div>)}<button type="button" className="secondary" disabled={draft.forklifts.length>=limits.forklifts} onClick={()=>add('forklifts')}>Add forklift</button>
        <div className="editor-actions"><button type="submit" className="primary">{busy?'Saving inputs…':'Save scenario inputs'}</button><p>Saving supersedes the current plan and requires a new draft and approval. Inputs persist only in this four-hour demo session; they do not change the sample fixture.</p></div>
      </fieldset>{feedback}
    </form>
  </section>;
}
