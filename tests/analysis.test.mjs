import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,parseCSV,validateRows,validateSettings,toCSV,example,packSession,unpackSession,nearestIndex,MAX_ROWS} from '../web/analysis.mjs';
const rows = sequences => sequences.map((sequence,i)=>({received_ms:i*100,sequence,value:i,boot_id:'a'}));
test('missing example has ten absent positions and one 1100 ms pause',()=>{
  const m=analyze(example('missing'));
  assert.deepEqual(m.summary,{readings:110,missing:10,duplicates:0,late:0,recovered:0,timingGaps:1,restarts:0,longestGap:1100,durationMs:11900});
  assert.deepEqual(m.events[0].issues,['timing','sequence']);
  assert.equal(m.events[0].baselineSequence,39);assert.equal(m.events[0].sequence,50);
});
test('late recovery is not counted as permanent absence; duplicate is separate',()=>{
  const m=analyze(example('late'));
  assert.equal(m.summary.missing,0);assert.equal(m.summary.late,1);assert.equal(m.summary.duplicates,1);
  assert.equal(m.summary.recovered,1);assert.equal(m.summary.timingGaps,0);
  assert.equal(m.events[0].introduced,1);assert.equal(m.events[0].remaining,0);assert.equal(m.events[0].recovered,1);
});
test('clean example has no flags and seeded examples reproduce',()=>{
  assert.equal(analyze(example('clean')).events.length,0);
  assert.deepEqual(example('missing',42),example('missing',42));
  assert.notDeepEqual(example('missing',42),example('missing',43));
});
test('uint32 wrap is continuous, including a gap recovered across wrap',()=>{
  assert.equal(analyze(rows([4294967294,4294967295,0,1])).summary.missing,0);
  const m=analyze(rows([4294967294,1,4294967295,0,2]));
  assert.equal(m.summary.missing,0);assert.equal(m.summary.recovered,2);assert.equal(m.summary.late,2);
});
test('does not enumerate a billion missing positions',()=>{
  const m=analyze(rows([0,1000000000,5,999999999]));
  assert.equal(m.summary.missing,999999997);assert.equal(m.summary.recovered,2);
});
test('unmarked half-range jump is rejected rather than assigned a direction',()=>assert.throws(()=>analyze(rows([0,2147483648])),/ambiguous/));
test('boot changes reset sequence tracking but retain earlier missing counts',()=>{
  const r=rows([0,3,0,1]);r[2].boot_id=r[3].boot_id='b';
  const m=analyze(r);assert.equal(m.summary.missing,2);assert.equal(m.summary.restarts,1);assert.equal(m.summary.late,0);
});
test('reusing a boot ID after another segment is rejected',()=>{const r=rows([0,1,2]);r[1].boot_id='b';assert.throws(()=>analyze(r),/reused/);});
test('arrival order is retained; backward timestamps are an error',()=>{
  const r=rows([0,2,1]);assert.equal(analyze(r).summary.late,1);
  r[2].received_ms=50;assert.throws(()=>analyze(r),/backward/);
});
test('timing threshold is strict and independently configurable',()=>{
  const r=rows([0,1]);r[1].received_ms=300;assert.equal(analyze(r).summary.timingGaps,0);
  r[1].received_ms=300.1;assert.equal(analyze(r).summary.timingGaps,1);assert.equal(analyze(r,{periodMs:200}).summary.timingGaps,0);
});
test('duplicate with a changed reading is still duplicate and not recovery',()=>{
  const m=analyze(rows([0,3,1,1,2]));assert.equal(m.summary.duplicates,1);assert.equal(m.summary.recovered,2);assert.equal(m.summary.missing,0);
});
test('late arrival from before capture start cannot reduce absence below zero',()=>{
  const m=analyze(rows([10,9,8,11]));assert.equal(m.summary.missing,0);assert.equal(m.summary.late,2);
});
test('one reading makes no continuity claim about the uncaptured stream',()=>{
  const m=analyze(rows([100]));assert.equal(m.events.length,0);assert.equal(m.summary.durationMs,0);
});
test('prefix replay results equal analysis of that prefix, without future recovery',()=>{
  const r=example('late'),full=analyze(r);
  for(let i=0;i<r.length;i++) {const prefix=analyze(r.slice(0,i+1)),frame=full.frames[i];
    for(const field of ['missing','duplicates','late','timingGaps','recovered','restarts'])assert.equal(frame[field],prefix.summary[field]);}
});
test('randomized captures agree with an independent set-based missing-count oracle',()=>{
  for(let seed=1;seed<=80;seed++){
    let state=seed;const rnd=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const sequence=[0];for(let i=1;i<99;i++)if(rnd()>.2)sequence.push(i);sequence.push(99);
    for(let i=1;i<sequence.length-2;i++)if(rnd()<.15)[sequence[i],sequence[i+1]]=[sequence[i+1],sequence[i]];
    const unique=new Set(sequence),repeated=sequence.filter(()=>rnd()<.1);sequence.push(...repeated);
    const m=analyze(rows(sequence));assert.equal(m.summary.missing,100-unique.size);assert.equal(m.summary.duplicates,repeated.length);
  }
});
test('CSV accepts quotes, a BOM, CRLF, blank lines and reordered supported columns',()=>{
  const r=parseCSV('\ufeffvalue,received_ms,sequence\r\n"22.3",0,0\r\n\r\n23,100,1\r\n');
  assert.equal(r.length,2);assert.equal(r[0].value,22.3);assert.equal(r[0].boot_id,'capture');assert.deepEqual(parseCSV(toCSV(r)),r);
});
test('CSV rejects malformed fields and ambiguous schemas with useful errors',()=>{
  for(const text of ['a,b\n1,2','received_ms,sequence,value,value\n0,0,1,1','received_ms,sequence,value\n0,0,',
    'received_ms,sequence,value\n0,1.2,2','received_ms,sequence,value\n0,0,Infinity','received_ms,sequence,value\n"0,0,1',
    'received_ms,sequence,value\n"0"x,0,1','received_ms,sequence,value,extra\n0,0,1,2'])assert.throws(()=>parseCSV(text));
});
test('numeric types and resource bounds reject invalid sessions',()=>{
  for(const mutate of [r=>r[0].received_ms=-1,r=>r[0].sequence=true,r=>r[0].sequence=4294967296,
    r=>r[0].value=NaN,r=>r[0].boot_id='<script>',r=>r[0].value='3']){const r=rows([0]);mutate(r);assert.throws(()=>validateRows(r));}
  assert.throws(()=>validateRows([]));assert.throws(()=>validateRows(Array(MAX_ROWS+1).fill(rows([0])[0])));
  assert.throws(()=>validateSettings({periodMs:0}));assert.throws(()=>validateSettings(null));
});
test('session round trip retains the exact rows and settings; derives findings afresh',()=>{
  const r=example('late'),packed=packSession(r,{periodMs:125,gapFactor:4},'test','simulated');
  const opened=unpackSession(JSON.stringify({...packed,forgedSummary:{missing:99}}));
  assert.deepEqual(opened.rows,r);assert.deepEqual(opened.settings,{periodMs:125,gapFactor:4});
  assert.equal(analyze(opened.rows,opened.settings).summary.missing,0);
  assert.throws(()=>unpackSession('{'));assert.throws(()=>unpackSession(JSON.stringify({...packed,schemaVersion:2})));
});
test('nearest replay index returns the latest reached row, including equal arrival times',()=>{
  const r=rows([0,1,2,3]);r[2].received_ms=100;
  assert.equal(nearestIndex(r,0),0);assert.equal(nearestIndex(r,99),0);assert.equal(nearestIndex(r,100),2);assert.equal(nearestIndex(r,999),3);
});
test('a maximum-row session can be exported and reopened, including long boot IDs',()=>{
  const r=Array.from({length:MAX_ROWS},(_,i)=>({received_ms:i*100,sequence:i,value:123456789.123456,boot_id:'a'.repeat(64)}));
  const text=JSON.stringify(packSession(r,{},'full recording','imported'),null,2);
  assert.ok(text.length<8*1024*1024);assert.equal(unpackSession(text).rows.length,MAX_ROWS);
});

test('range export includes both boundary arrivals and preserves original identities', async()=>{
  const {selectWindow}=await import('../web/analysis.mjs');
  const source=example('late'),clip=selectWindow(source,1700,2300);
  assert.equal(clip[0].received_ms,1700);assert.equal(clip.at(-1).received_ms,2300);
  assert.equal(clip.some(row=>row.sequence===18),true);
  assert.equal(clip.filter(row=>row.sequence===22).length,2);
  assert.deepEqual(parseCSV(toCSV(clip)),clip);assert.equal(source.length,121);
  assert.equal(analyze(clip).summary.duplicates,1);assert.equal(analyze(clip).summary.missing,0);
});
test('range export rejects empty pauses, inverted, unbounded and nonfinite ranges',async()=>{
  const {selectWindow}=await import('../web/analysis.mjs'),source=example('missing');
  for(const bounds of [[4000,4900],[5000,3000],[-1,100],[0,12000],[NaN,100],[0,Infinity]])assert.throws(()=>selectWindow(source,...bounds));
  assert.equal(selectWindow(source,5000,5000).length,1);
  assert.equal(selectWindow(source,3900,5000).length,2);
});
