#!/usr/bin/env node
// Offline calendar-twins scan over data/calendars/*.ics (see ../SKILL.md).
//   cd <repo> && node .claude/skills/twins-scan/scripts/twins-scan.js
const fs=require('fs'),path=require('path');
const {SharedCore}=require(process.cwd()+'/scripts/shared-core.js');const {EventSchema}=require(process.cwd()+'/scripts/event-schema.js');
const sc=require(process.cwd()+'/scripts/scraper-cities.js');const CITIES=(sc&&sc.cities)||sc||{};
const core=new SharedCore(CITIES,{eventSchema:EventSchema});
const dir=process.cwd()+'/data/calendars';const start=new Date();start.setDate(start.getDate()-1);const end=new Date();end.setDate(end.getDate()+400);
const saved={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.ics')&&f!=='festivals.ics')){const city=f.replace('.ics','');const records=(core.parsePublishedCalendarIcs||SharedCore.parsePublishedCalendarIcs).call(core,fs.readFileSync(path.join(dir,f),'utf8'));if(!Array.isArray(records))continue;
 const events=(core.expandPublishedCalendarEventsInWindow||SharedCore.expandPublishedCalendarEventsInWindow).call(core,records,start,end).events;const per=new Map();for(const e of events){const id=String(e.identifier||'');if(id)per.set(id,(per.get(id)||0)+1);}
 saved[city]={source:'published',events:events.map(e=>({identifier:String(e.identifier||''),uid:core.savedEventUid?core.savedEventUid(e.identifier):String(e.identifier||''),title:String(e.title||''),startDate:e.startDate,endDate:e.endDate||null,location:String(e.location||''),notes:String(e.notes||''),url:String(e.url||''),isAllDay:e.isAllDay===true,series:Boolean(e.recurrence)||(per.get(String(e.identifier||''))||0)>1}))};}
const out=core.buildCalendarTwinCandidates(saved,{cities:CITIES});
console.log(JSON.stringify(out.summary));
for(const c of out.candidates) console.log(`${c.city} ${String(c.startDate).slice(0,10)} EXTRA "${c.title}" [${c.bar||'-'} | ${c.address||'-'}] ← KEEP "${c.twinOf.title}" [${c.twinOf.bar||'-'} | ${c.twinOf.address||'-'}] why=${c.why.join('; ')} extra=${c.extraWhy.join(', ')||'(tie by uid)'} ${c.tie?'TIE':''}`);
