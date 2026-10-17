import {analyze,example,parseCSV,toCSV,packSession,unpackSession,nearestIndex,VERSION,MAX_FILE,MAX_SESSION,selectWindow} from './analysis.mjs';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = value => value.toLocaleString('en');
const seconds = value => (value/1000).toFixed(2)+' s';
const number = value => Number(value.toPrecision(6)).toLocaleString('en',{maximumFractionDigits:6});
let viewStart, viewEnd;
let model, name, origin, demoKind, selected=0, page=0, cursor=0, playing=false, frame, playFrom, playStarted, playUntil, digest='', generation=0, fileRequest=0;
const descriptions = {
  missing:['Temperature · missing readings','120 samples were generated at 100 ms intervals; ten were deliberately omitted. The complete recording below contains 110 readings.'],
  late:['Temperature · late arrival + duplicate','Sequence 18 was delayed until after sequence 22, and sequence 22 was delivered twice. The complete recording contains 121 readings.'],
  clean:['Temperature · clean recording','120 generated temperature readings at 100 ms intervals. This is the baseline without injected recording faults.']
};
function error(message='') {$('#error').textContent=message; $('#error').hidden=!message;}
function stop() {playing=false; cancelAnimationFrame(frame); $('#play').textContent='Play recording';}
function eventTitle(event) {
  if(event.issues.includes('timing')) return `No readings for ${seconds(event.elapsedMs)}`;
  if(event.introduced) return event.remaining ? `${count(event.remaining)} sequence position${event.remaining===1?'':'s'} still absent` : 'Sequence gap filled later';
  if(event.issues.includes('duplicate')) return `Duplicate sequence ${event.sequence}`;
  if(event.issues.includes('late')) return `Out-of-order sequence ${event.sequence}`;
  return 'New device boot';
}
function chart() {
  const rows=selectWindow(model.rows,viewStart,viewEnd), first=viewStart, end=viewEnd;
  let min=Infinity,max=-Infinity;
  for(const row of rows){min=Math.min(min,row.value);max=Math.max(max,row.value);}
  const padding=(max-min)*.18 || Math.max(Math.abs(min)*.01,1);
  min-=padding;max+=padding;
  const width=Math.max(280,$('#chart').clientWidth), right=width-12, span=right-60;
  const x=time=>60+(time-first)/Math.max(1,end-first)*span;
  const y=value=>20+(max-value)/(max-min)*245;
  let path='';
  rows.forEach((r,i)=>{const previous=rows[i-1]; const move=!previous || r.received_ms-previous.received_ms>model.config.periodMs*model.config.gapFactor || r.boot_id!==previous.boot_id;
    path+=(move?'M':'L')+x(r.received_ms).toFixed(2)+','+y(r.value).toFixed(2);});
  const event=model.events[selected];
  let highlight='';
  if(event && event.timeMs>=first && model.rows[event.previousIndex].received_ms<=end){const start=x(Math.max(first,model.rows[event.previousIndex].received_ms)),finish=x(Math.min(end,event.timeMs));
    highlight=`<rect x="${start}" y="20" width="${Math.max(2,finish-start)}" height="245" fill="#a26f3a" fill-opacity=".2"/><line x1="${finish}" x2="${finish}" y1="20" y2="265" stroke="#e1ac70" stroke-dasharray="3 4"/>`;}
  let grid='';
  for(let i=0;i<5;i++){
    const yy=20+i*245/4, v=max-i*(max-min)/4;
    grid+=`<line class="chart-grid" x1="60" x2="${right}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="48" y="${yy+4}" text-anchor="end">${esc(Math.abs(v)>=100000 || (Math.abs(v)>0 && Math.abs(v)<.001) ? v.toExponential(1) : Number(v.toPrecision(4)))}</text>`;
  }
  for(let i=0;i<5;i++){const xx=60+i*span/4;grid+=`<text class="chart-axis" x="${xx}" y="292" text-anchor="${i===0?'start':i===4?'end':'middle'}">${((first-model.rows[0].received_ms+(end-first)*i/4)/1000).toFixed(2)}s</text>`;}
  $('#chart').innerHTML=`<svg viewBox="0 0 ${width} 310" role="img" aria-labelledby="plot-title plot-description"><title id="plot-title">${esc(demoKind?'Temperature over the recording':'Recorded value over arrival time')}</title><desc id="plot-description">${model.summary.readings} received readings. Lines break at pauses longer than ${number(model.config.periodMs*model.config.gapFactor)} milliseconds and at boot changes. The selected event is highlighted. Exact readings are available in the table below.</desc><defs><clipPath id="plot-clip"><rect x="60" y="15" width="${span}" height="255"/></clipPath></defs>${grid}<g clip-path="url(#plot-clip)">${highlight}<path class="signal-path" d="${path}"/><g id="chart-cursor"><line class="chart-cursor" x1="0" x2="0" y1="15" y2="265"/><circle id="cursor-point" r="4" fill="#c0dfaa" stroke="#11292c" stroke-width="2"/></g></g></svg>`;
  return {x,y};
}
let scale;
function renderCursor() {
  const rows=model.rows, index=nearestIndex(rows,cursor), row=rows[index], stats=model.frames[index], age=Math.max(0,cursor-row.received_ms);
  $('#position').value=String(cursor);
  $('#time-output').textContent=`${((cursor-rows[0].received_ms)/1000).toFixed(2)} / ${((rows.at(-1).received_ms-rows[0].received_ms)/1000).toFixed(2)} s`;
  $('#cursor-label').textContent=`At ${seconds(cursor-rows[0].received_ms)} · value ${number(row.value)}`;
  $('#freshness').textContent=age>model.config.periodMs*model.config.gapFactor ? `No new reading for ${seconds(age)} at this replay time` : `Last reading ${number(age)} ms earlier`;
  $('#freshness').className=age>model.config.periodMs*model.config.gapFactor?'stale':'';
  $('#prefix-summary').textContent=`Replay only: ${count(index+1)} of ${count(rows.length)} readings reached · ${count(stats.missing)} ${stats.missing===1?'sequence position':'sequence positions'} absent so far · ${count(stats.late)} out of order · ${count(stats.duplicates)} ${stats.duplicates===1?'duplicate':'duplicates'}. Full-file totals are below the range controls.`;
  const xx=scale.x(cursor);
  $('#chart-cursor').style.display=cursor<viewStart||cursor>viewEnd?'none':'';
  $('#chart-cursor').setAttribute('transform',`translate(${xx},0)`);
  $('#cursor-point').setAttribute('cx',String(scale.x(row.received_ms)-xx));
  $('#cursor-point').setAttribute('cy',String(scale.y(row.value)));
}
function renderReadings() {
  const event=model.events[selected], center=event?.index ?? 0, low=Math.max(0,center-3), high=Math.min(model.rows.length,center+4);
  $('#readings').innerHTML=`<table><caption class="sr-only">Original arrival-ordered readings, data rows ${low+1} to ${high}</caption><thead><tr><th scope="col">Data row</th><th scope="col">Arrival (ms)</th><th scope="col">Sequence</th><th scope="col">Value</th><th scope="col">Boot</th></tr></thead><tbody>${model.rows.slice(low,high).map((row,i)=>`<tr class="${low+i===center?'current':''}"><td>${low+i+1}</td><td>${number(row.received_ms)}</td><td>${row.sequence}</td><td>${number(row.value)}</td><td>${esc(row.boot_id)}</td></tr>`).join('')}</tbody></table>`;
}
function renderEvents() {
  const events=model.events, event=events[selected];
  $('#event-count').textContent=`${count(events.length)} flagged`;
  $('#event-list').innerHTML=events.length ? events.slice(page*6,page*6+6).map((item,i)=>`<button class="event-button ${page*6+i===selected?'active':''}" data-event="${page*6+i}" ${page*6+i===selected?'aria-current="true"':''}><strong>${esc(eventTitle(item))}</strong><small>${seconds(item.timeMs-model.rows[0].received_ms)} · data row ${item.index+1}</small></button>`).join('') : '<p class="empty-events">No events met the current rules. Try the missing-readings example, or open your own recording.</p>';
  document.querySelectorAll('[data-event]').forEach(button=>button.addEventListener('click',()=>selectEvent(Number(button.dataset.event))));
  $('#event-pages').innerHTML=events.length>6?`<button type="button" class="text-button" id="previous-events" ${page===0?'disabled':''}>← Previous</button><span>${page+1} / ${Math.ceil(events.length/6)}</span><button type="button" class="text-button" id="next-events" ${(page+1)*6>=events.length?'disabled':''}>Next →</button>`:'';
  $('#previous-events')?.addEventListener('click',()=>{page--;renderEvents();});
  $('#next-events')?.addEventListener('click',()=>{page++;renderEvents();});
  if(!event){$('#evidence').innerHTML=`<h3>${model.rows.length===1?'One reading is not enough to assess continuity.':'No gaps detected by these rules.'}</h3><p>${model.rows.length===1?'Add a longer recording with consecutive sequence numbers.':'The received timestamps and sequence numbers agree with the current interval settings. This does not validate sensor accuracy, events before the capture, or device health.'}</p><p class="evidence-note">Gap detection depends on a counter that increments once per produced sample and a correct expected interval.</p>`;renderReadings();return;}
  let parts=[], details=[];
  if(event.issues.includes('timing')) {
    parts.push(`The collector received nothing for ${seconds(event.elapsedMs)}, between ${seconds(model.rows[event.previousIndex].received_ms-model.rows[0].received_ms)} and ${seconds(event.timeMs-model.rows[0].received_ms)}.`);
    details.push(['Expected interval',`${number(model.config.periodMs)} ms`],['Observed pause',`${number(event.elapsedMs)} ms`]);
  }
  if(event.introduced){
    parts.push(`After the highest sequence ${event.baselineSequence}, sequence ${event.sequence} arrived: ${count(event.introduced)} ${event.introduced===1?'position was':'positions were'} skipped at that moment.`);
    parts.push(event.recovered ? `${count(event.recovered)} of those readings arrived later in this recording; ${count(event.remaining)} positions remain absent.` : `${count(event.remaining)} skipped ${event.remaining===1?'sequence position never appears':'sequence positions never appear'} in the rest of this recording.`);
    details.push(['Initially skipped',count(event.introduced)],['Arrived later',count(event.recovered)],['Still absent at end',count(event.remaining)]);
    if(event.lastRecoveryMs!==null) details.push(['Last recovery',seconds(event.lastRecoveryMs-model.rows[0].received_ms)]);
  }
  if(event.issues.includes('duplicate')){parts.push(`Sequence ${event.sequence} has already appeared in this boot. This additional reading is counted as a duplicate even if its value differs.`);details.push(['Repeated sequence',String(event.sequence)]);}
  if(event.issues.includes('late')) {parts.push(`Sequence ${event.sequence} arrived after a higher sequence. It is out of order${event.relatedGapIndex!==null?' and fills an earlier sequence gap':''}.`);details.push(['Arriving sequence',String(event.sequence)]);}
  if(event.issues.includes('restart')) {parts.push(`boot_id changed from ${model.rows[event.previousIndex].boot_id} to ${model.rows[event.index].boot_id}. Sequence tracking starts a new segment; counter resets are not counted as missing positions.`);}
  const caution=event.issues.includes('restart')?'A changed boot label is reported by the recording producer; it does not independently prove a hardware restart.':'These are observations about the recording. Missing transmissions, a paused collector, filtering, or device behavior can produce similar evidence. The cause is not established.';
  $('#evidence').innerHTML=`<p class="origin">EVIDENCE IN THE COMPLETE RECORDING</p><h3>${esc(eventTitle(event))}</h3>${parts.map(p=>`<p>${esc(p)}</p>`).join('')}<dl>${details.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl><div class="event-actions"><button class="secondary" id="isolate-event" type="button">Isolate this event</button><button class="text-button" id="replay-event" type="button">Replay event ↻</button></div><p class="evidence-note">${esc(caution)}</p>`;
  $('#isolate-event').addEventListener('click',()=>{const bounds=eventBounds();setWindow(...bounds);});
  $('#replay-event').addEventListener('click',()=>startPlayback(true));
  renderReadings();
}
function selectEvent(index) {
  stop(); selected=index; page=Math.floor(index/6); cursor=model.events[index].timeMs;
  if(cursor<viewStart||cursor>viewEnd)setWindow(model.rows[0].received_ms,model.rows.at(-1).received_ms);
  renderEvents(); scale=chart(); renderCursor();
  $('#evidence').setAttribute('tabindex','-1'); $('#evidence').focus({preventScroll:true});
}
function startPlayback(eventOnly=false) {
  stop();
  if(eventOnly && model.events[selected]) {
    const bounds=eventBounds();setWindow(...bounds);cursor=bounds[0];playUntil=bounds[1];
  } else {if(cursor>=viewEnd||cursor<viewStart)cursor=viewStart;playUntil=viewEnd;}
  if(cursor>=playUntil)return;
  playing=true; playFrom=cursor; playStarted=performance.now(); $('#play').textContent='Pause replay';
  const tick=now=>{
    if(!playing)return;
    cursor=Math.min(playUntil,playFrom+(now-playStarted)*Number($('#speed').value)); renderCursor();
    if(cursor>=playUntil){stop();return;}
    frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
}
async function load(rows, settings, title, source, kind=null) {
  const next=analyze(rows,settings); const ticket=++generation; stop();
  model=next; name=title; origin=source; demoKind=kind; selected=0; page=0; digest='Computing input fingerprint…';
  cursor=model.rows[0].received_ms; viewStart=cursor;viewEnd=model.rows.at(-1).received_ms;
  $('#period').value=String(model.config.periodMs);$('#factor').value=String(model.config.gapFactor);
  $('#origin').textContent=kind?'Simulated example · generated here':source==='session'?'Imported session · findings recalculated':'Imported CSV · findings recalculated';
  $('#capture-title').textContent=kind?descriptions[kind][0]:title;
  $('#file-description').textContent=kind?descriptions[kind][1]:`${count(model.rows.length)} received readings in arrival order. This analysis covers the entire imported recording.`;
  $('#chart-title').textContent=kind?'Temperature (°C)':'Recorded value';
  const s=model.summary;
  $('#summary').innerHTML=[['readings',s.readings,s.readings===1?'reading':'readings'],['missing',s.missing,s.missing===1?'position absent at end':'positions absent at end'],['timingGaps',s.timingGaps,s.timingGaps===1?'timing gap':'timing gaps'],...(s.late?[['late',s.late,'out of order']]:[]),...(s.duplicates?[['duplicates',s.duplicates,s.duplicates===1?'duplicate':'duplicates']]:[]),...(s.restarts?[['restarts',s.restarts,s.restarts===1?'boot change':'boot changes']]:[])].map(([key,value,label])=>`<p class="${key!=='readings'&&value?'attention':''}"><strong>${count(value)}</strong>${label}</p>`).join('');
  $('#threshold-note').textContent=`Pauses over ${number(model.config.periodMs*model.config.gapFactor)} ms are flagged. Sequence gaps are checked separately.`;
  $('#example-select').value=kind||'';
  $('#position').min=String(model.rows[0].received_ms);$('#position').max=String(model.rows.at(-1).received_ms);$('#position').step='any';$('#position').disabled=model.rows.length===1;
  $('#play').disabled=model.rows.length===1;
  renderEvents();setWindow(viewStart,viewEnd);renderProvenance();error();
  try {
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(toCSV(model.rows)));
    if(ticket!==generation)return;
    digest=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  } catch {if(ticket!==generation)return;digest='Fingerprint unavailable in this browser context.';}
  renderProvenance();
}
function renderProvenance() {$('#provenance').textContent=`Detector ${VERSION} · ${demoKind?'Generated example, seed 42':'Imported content; producer identity is not authenticated'} · Normalized input SHA-256: ${digest}`;}
function download(filename,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#file-input').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  const ticket=++fileRequest;stop();
  try {
    const sessionFile=file.name.toLowerCase().endsWith('.json');
    if(file.size>(sessionFile?MAX_SESSION:MAX_FILE))throw new Error(sessionFile?'Choose a session smaller than 8 MiB.':'Choose a CSV smaller than 2 MiB.');
    const text=await file.text(); if(ticket!==fileRequest)return;
    if(file.name.toLowerCase().endsWith('.json')){const session=unpackSession(text);await load(session.rows,session.settings,file.name,'session');}
    else await load(parseCSV(text),model.config,file.name,'csv');
  } catch(cause) {error(cause.message+' The previous recording is still displayed.');}
  event.target.value='';
});
$('#example-select').addEventListener('change',event=>{fileRequest++;const kind=event.target.value;load(example(kind),{periodMs:100,gapFactor:3},kind,'simulated',kind);});
$('#settings-form').addEventListener('submit',event=>{event.preventDefault();try{load(model.rows,{periodMs:$('#period').value,gapFactor:$('#factor').value},name,origin,demoKind).catch(cause=>error(cause.message));}catch(cause){error(cause.message);}});
$('#play').addEventListener('click',()=>playing?stop():startPlayback());
$('#position').addEventListener('input',()=>{stop();cursor=Number($('#position').value);renderCursor();});
$('#speed').addEventListener('change',()=>{if(playing){playFrom=cursor;playStarted=performance.now();}});
$('#save-session').addEventListener('click',()=>download('signalforge-session.json',JSON.stringify(packSession(model.rows,model.config,name,demoKind?'simulated':'imported'),null,2)+'\n','application/json'));
$('#save-csv').addEventListener('click',()=>download('signalforge-readings.csv',toCSV(model.rows),'text/csv'));
$('#save-report').addEventListener('click',()=>{
  const s=model.summary;
  const text=`SignalForge findings — detector ${VERSION}\nRecording: ${name}\nOrigin: ${demoKind?'Generated example, seed 42':'Imported file; producer not authenticated'}\nNormalized input SHA-256: ${digest}\nExpected interval: ${model.config.periodMs} ms\nTiming gap: strictly greater than ${model.config.periodMs*model.config.gapFactor} ms\n\n${s.readings} readings; ${s.missing} sequence positions absent at end; ${s.late} out-of-order arrivals; ${s.duplicates} duplicates; ${s.timingGaps} timing gaps; ${s.restarts} boot changes.\n\n`+
    model.events.map(event=>`${seconds(event.timeMs-model.rows[0].received_ms)} | data row ${event.index+1} | ${eventTitle(event)} | tags: ${event.issues.join(', ')} | initially skipped ${event.introduced} | later recovered ${event.recovered} | remaining ${event.remaining}`).join('\n')+
    '\n\nSequence gaps and arrival pauses describe this recording. They do not establish a physical fault, network loss or sensor accuracy. Session files and the normalized CSV retain the exact inputs for reproduction.\n';
  download('signalforge-findings.txt',text,'text/plain');
});
function eventBounds() {
  const event=model.events[selected], rows=model.rows;
  return [Math.max(rows[0].received_ms,rows[event.previousIndex].received_ms-model.config.periodMs*2),Math.min(rows.at(-1).received_ms,Math.max(event.timeMs,event.lastRecoveryMs ?? event.timeMs)+model.config.periodMs*3)];
}
function windowInputs() {
  const first=model.rows[0].received_ms;
  if(!$('#window-start').value.trim()||!$('#window-end').value.trim())throw new Error('Enter both an In and an Out time.');
  return [first+Number($('#window-start').value)*1000,first+Number($('#window-end').value)*1000];
}
function setWindow(start,end) {
  const rows=selectWindow(model.rows,start,end);stop();viewStart=start;viewEnd=end;
  const first=model.rows[0].received_ms;
  $('#window-start').value=String((start-first)/1000);$('#window-end').value=String((end-first)/1000);
  $('#window-start').max=$('#window-end').max=String((model.rows.at(-1).received_ms-first)/1000);
  $('#position').min=String(start);$('#position').max=String(end);
  cursor=Math.min(end,Math.max(start,cursor));
  $('#view-label').textContent=start===first&&end===model.rows.at(-1).received_ms?'Full recording':`Isolated · ${seconds(start-first)} to ${seconds(end-first)}`;
  $('#window-note').textContent=`${count(rows.length)} readings in this range. Export keeps original timestamps, sequence numbers and arrival order. Full-file event totals stay below; a reopened clip only describes its own boundaries.`;
  scale=chart();renderCursor();
}
$('#window-form').addEventListener('submit',event=>{event.preventDefault();try{setWindow(...windowInputs());error();}catch(cause){error(cause.message+' The previous view is still displayed.');}});
$('#reset-window').addEventListener('click',()=>{setWindow(model.rows[0].received_ms,model.rows.at(-1).received_ms);error();});
$('#save-clip').addEventListener('click',()=>{try{const bounds=windowInputs(),rows=selectWindow(model.rows,...bounds);setWindow(...bounds);download('signalforge-clip.csv',toCSV(rows),'text/csv');error();}catch(cause){error(cause.message);}});
$('#chart').addEventListener('click',event=>{const box=$('#chart svg').getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(event.clientX-box.left-60)/(box.width-72)));stop();cursor=viewStart+ratio*(viewEnd-viewStart);renderCursor();});

load(example('missing'),{periodMs:100,gapFactor:3},'Temperature — missing readings','simulated','missing');

let chartWidth=$('#chart').clientWidth;
new ResizeObserver(()=>{const width=$('#chart').clientWidth;if(model&&Math.abs(width-chartWidth)>1){chartWidth=width;scale=chart();renderCursor();}}).observe($('#chart'));
