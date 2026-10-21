#!/usr/bin/env node
// Replay drop / validator rules over the last saved runs (see ../SKILL.md).
//   node scripts/replay-rules.js <repo-root> [--runs 12]
// Prints title-shape hits, event URLs and classified pages the validator
// would now refuse, each with how many runs the record appeared in.
const REJECT_REASONS = ['calendar-view-route', 'shop-route', 'wordpress-infrastructure'];
const fs=require('fs'),path=require('path');
const RUNS=process.env.CHUNKY_RUNS_DIR||(process.env.HOME+"/Library/Mobile Documents/com~apple~CloudDocs/chunky-dad-data/runs/");
if(!process.argv[2]){console.error('usage: node replay-rules.js <repo-root> [--runs N]');process.exit(2);}
const {AiWebParser}=require(require('path').resolve(process.argv[2])+'/scripts/parsers/ai-web-parser.js');
const p=new AiWebParser({normalizeUrl:(u,b)=>{try{return new URL(u,b).href}catch{return null}}});
const runsArg=process.argv.indexOf('--runs');const RUN_COUNT=runsArg>0?Number(process.argv[runsArg+1])||12:12;
const files=fs.readdirSync(RUNS).filter(f=>f.endsWith('.json')).sort().slice(-RUN_COUNT);
const titleHits=new Map(), urlHits=new Map(), pageHits=new Map(); let kept=0, pages=0;
const seenTitles=new Set();
for(const f of files){const r=JSON.parse(fs.readFileSync(RUNS+f,'utf8'));
  const sets=[['kept',r.analyzedEvents||[]],['dropped',r.bearDroppedEvents||[]]];
  for(const [kind,evs] of sets) for(const e of evs){ if(kind==='kept')kept++;
    const t=String(e.title||''); const shape=AiWebParser.furnitureTitleShape? AiWebParser.furnitureTitleShape(t):null;
    if(shape){const k=kind+'|'+t; if(!titleHits.has(k)) titleHits.set(k,{kind,title:t,shape,src:e.source||e._parserConfig?.name,bar:e.bar,date:String(e.startDate).slice(0,10),n:0}); titleHits.get(k).n++;}
    for(const u of [e.url,e.website,e.ticketUrl]) if(u){const v=p.validateEventUrl(u,'https://example.invalid/x',{});
      if(REJECT_REASONS.includes(v.reason)){const k=kind+'|'+u; if(!urlHits.has(k))urlHits.set(k,{kind,url:u,reason:v.reason,title:t,n:0}); urlHits.get(k).n++;}}
  }
  for(const pr of (r.parserResults||[])) for(const [u,c] of Object.entries(pr.urlClassifications||{})){pages++;
    const cls=typeof c==='string'?c:(c&&c.classification||JSON.stringify(c)).slice(0,30);
    const v=p.validateEventUrl(u,'https://example.invalid/x',{});
    if(REJECT_REASONS.includes(v.reason)){const k=u; if(!pageHits.has(k))pageHits.set(k,{url:u,reason:v.reason,cls,parser:pr.name,n:0}); pageHits.get(k).n++;}}
}
console.log('runs',files.length,'kept events',kept,'classified pages',pages);
console.log('\n== TITLE SHAPE hits ==');
for(const h of [...titleHits.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||b.n-a.n)) console.log(`${h.kind}\t${h.n}x\t[${h.shape}]\t"${h.title}"\t${h.src}\t${h.bar||''}\t${h.date}`);
console.log('\n== EVENT URL hits (kept/dropped event urls the crawler would now refuse) ==');
for(const h of urlHits.values()) console.log(`${h.kind}\t${h.n}x\t${h.reason}\t${h.url}\t"${h.title}"`);
console.log('\n== CLASSIFIED PAGE hits ==');
for(const h of [...pageHits.values()].sort((a,b)=>b.n-a.n)) console.log(`${h.n}x\t${h.reason}\t${h.cls}\t${h.parser}\t${h.url}`);
