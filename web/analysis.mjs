/** Original single-channel capture analysis. Arrival order is preserved. */
export const VERSION = '0.1.0';
export const MAX_ROWS = 20000;
export const MAX_FILE = 2 * 1024 * 1024;
export const MAX_SESSION = 8 * 1024 * 1024;
const MOD = 4294967296;
const HALF = MOD / 2;
const uint = n => Number.isInteger(n) && n >= 0 && n < MOD;
export function validateSettings(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Interval settings must be an object.');
  const periodMs = Number(settings.periodMs ?? 100);
  const gapFactor = Number(settings.gapFactor ?? 3);
  if (!Number.isFinite(periodMs) || periodMs < 0.01 || periodMs > 3600000)
    throw new Error('Expected interval must be from 0.01 to 3,600,000 ms.');
  if (!Number.isFinite(gapFactor) || gapFactor < 1.1 || gapFactor > 1000)
    throw new Error('Gap threshold must be from 1.1 to 1,000 expected intervals.');
  return {periodMs, gapFactor};
}
function fields(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE) throw new Error('Choose a UTF-8 CSV smaller than 2 MiB.');
  const records = []; let row = [], value = '', quoted = false, closed = false;
  for (let i = 0; i <= text.length; i++) {
    const c = i === text.length ? '\n' : text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') {value += '"'; i++;}
      else if (c === '"') {quoted = false; closed = true;}
      else if (i === text.length) throw new Error('CSV ends inside a quoted field.');
      else value += c;
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(value); value = ''; closed = false;
      if (c !== ',') {
        if (row.some(v => v.trim())) records.push(row);
        row = [];
        if (c === '\r' && text[i+1] === '\n') i++;
      }
    } else if (closed) {
      if (!/\s/.test(c)) throw new Error('Unexpected text after a quoted CSV field.');
    } else if (c === '"') throw new Error('Quote inside an unquoted CSV field.');
    else value += c;
    if (records.length > MAX_ROWS + 1) throw new Error('This version supports up to 20,000 readings.');
  }
  return records;
}
export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV must be text.');
  const parsed = fields(text.replace(/^\ufeff/, ''));
  if (parsed.length < 2) throw new Error('The CSV needs a header and at least one reading.');
  const headers = parsed.shift().map(s => s.trim());
  if (new Set(headers).size !== headers.length) throw new Error('CSV headers must be unique.');
  for (const required of ['received_ms','sequence','value'])
    if (!headers.includes(required)) throw new Error(`Missing column ${required}. Use received_ms,sequence,value and optional boot_id.`);
  const allowed = new Set(['received_ms','sequence','value','boot_id']);
  if (headers.some(h => !allowed.has(h))) throw new Error('Use only received_ms,sequence,value and optional boot_id. Export one signal at a time.');
  return validateRows(parsed.map((row,index) => {
    if (row.length !== headers.length) throw new Error(`Data row ${index+1}: expected ${headers.length} columns.`);
    const record = Object.fromEntries(headers.map((h,i)=>[h,row[i].trim()]));
    for (const key of ['received_ms','sequence','value']) if (!record[key]) throw new Error(`Data row ${index+1}: ${key} is empty.`);
    if (!/^\d+$/.test(record.sequence)) throw new Error(`Data row ${index+1}: sequence must be an unsigned whole number.`);
    return {received_ms:Number(record.received_ms),sequence:Number(record.sequence),value:Number(record.value),boot_id:record.boot_id ?? 'capture'};
  }));
}
export function validateRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw new Error('Provide between 1 and 20,000 readings.');
  let previousTime = -Infinity, currentBoot, finishedBoots = new Set();
  return rows.map((row,index) => {
    const fail = message => {throw new Error(`Data row ${index+1}: ${message}`);};
    if (!row || typeof row !== 'object') fail('expected a reading.');
    if (typeof row.received_ms !== 'number' || !Number.isFinite(row.received_ms) || row.received_ms < 0 || row.received_ms > 1e12)
      fail('received_ms must be finite, from 0 to 1,000,000,000,000.');
    if (row.received_ms < previousTime) fail('received_ms goes backward. Use collector arrival time; do not sort by sequence.');
    if (!uint(row.sequence)) fail('sequence must be from 0 to 4,294,967,295.');
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || Math.abs(row.value) > 1e12) fail('value must be finite, between -1e12 and 1e12.');
    const boot = row.boot_id ?? 'capture';
    if (typeof boot !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(boot)) fail('boot_id must contain 1–64 letters, digits, dots, underscores or hyphens.');
    if (boot !== currentBoot) {
      if (finishedBoots.has(boot)) fail('boot_id was reused after another boot. Use a unique ID for each capture segment.');
      if (currentBoot !== undefined) finishedBoots.add(currentBoot);
      currentBoot = boot;
    }
    previousTime = row.received_ms;
    return {received_ms:row.received_ms,sequence:row.sequence,value:row.value,boot_id:boot};
  });
}
export function toCSV(rows) {
  return 'received_ms,sequence,value,boot_id\n' + rows.map(r=>[r.received_ms,r.sequence,r.value,r.boot_id].join(',')).join('\n') + '\n';
}
export function analyze(input, settings = {}) {
  const rows = validateRows(input), config = validateSettings(settings);
  const events = [], gaps = [], frames = [];
  let stream, previous, missing = 0, duplicates = 0, late = 0, recovered = 0, timingGaps = 0, restarts = 0, longestGap = 0;
  for (const [index,row] of rows.entries()) {
    const issues = [];
    const dt = previous ? row.received_ms - previous.received_ms : 0;
    longestGap = Math.max(longestGap, dt);
    let introduced = 0, recoveredGap = null, isDuplicate = false, isLate = false, restarted = false;
    if (!stream || row.boot_id !== previous.boot_id) {
      restarted = !!stream;
      if (restarted) {restarts++; issues.push('restart');}
      stream = {first:row.sequence,high:row.sequence,seen:new Set(),gaps:[]};
    }
    const baselineSequence = stream.high % MOD;
    let extended;
    const delta = (row.sequence - (stream.high % MOD) + MOD) % MOD;
    if (delta === HALF) throw new Error(`Data row ${index+1}: a sequence jump of 2^31 is ambiguous. Start a new boot_id for a reset.`);
    if (delta > 0 && delta < HALF) {
      extended = stream.high + delta;
      if (delta > 1) {
        introduced = delta - 1; missing += introduced;
        const gap = {first:stream.high+1,last:extended-1,introduced,recovered:0,index,event:null};
        stream.gaps.push(gap); gaps.push(gap);
        issues.push('sequence');
      }
      stream.high = extended;
    } else extended = delta === 0 ? stream.high : stream.high - (MOD - delta);
    if (stream.seen.has(extended)) {duplicates++; isDuplicate = true; issues.push('duplicate');}
    else {
      stream.seen.add(extended);
      if (extended < stream.high) {
        late++; isLate = true; issues.push('late');
        // Gap intervals are disjoint and ordered; binary search avoids walking missing positions.
        let low=0, high=stream.gaps.length-1;
        while (low <= high) {
          const middle=(low+high)>>1, gap=stream.gaps[middle];
          if (extended < gap.first) high=middle-1;
          else if (extended > gap.last) low=middle+1;
          else {gap.recovered++; gap.lastRecoveryMs=row.received_ms; missing--; recovered++; recoveredGap=gap; break;}
        }
      }
    }
    const hasTimingGap = previous && dt > config.periodMs * config.gapFactor;
    if (hasTimingGap) {timingGaps++; issues.unshift('timing');}
    if (issues.length) {
      const event = {id:`event-${index}`,index,timeMs:row.received_ms,previousIndex:Math.max(0,index-1),
        issues,elapsedMs:dt,introduced,recovered:0,remaining:introduced,
        previousSequence:previous?.sequence ?? null,baselineSequence,sequence:row.sequence,
        relatedGapIndex:recoveredGap?.index ?? null};
      if (introduced) stream.gaps.at(-1).event = event;
      events.push(event);
    }
    frames.push({missing,duplicates,late,timingGaps,recovered,restarts,isDuplicate,isLate,restarted});
    previous=row;
  }
  for (const gap of gaps) if (gap.event) {
    gap.event.recovered=gap.recovered;
    gap.event.lastRecoveryMs=gap.lastRecoveryMs ?? null;
    gap.event.remaining=gap.introduced-gap.recovered;
  }
  return {version:VERSION,rows,config,events,frames,
    summary:{readings:rows.length,missing,duplicates,late,recovered,timingGaps,restarts,longestGap,
      durationMs:rows.at(-1).received_ms-rows[0].received_ms}};
}
export function example(kind = 'missing', seed = 42) {
  let state = seed >>> 0;
  const next = () => {state = (Math.imul(1664525,state)+1013904223)>>>0; return state/MOD;};
  let rows = Array.from({length:120},(_,i)=>({received_ms:i*100,sequence:i,
    value:Number((22 + Math.sin(i/11)*1.3+(next()-.5)*.18).toFixed(4)),boot_id:'demo-1'}));
  if (kind === 'missing') rows=rows.filter(r=>r.sequence<40 || r.sequence>49);
  else if (kind === 'late') {
    rows.find(r=>r.sequence===18).received_ms=2250;
    rows.push({...rows.find(r=>r.sequence===22),received_ms:2260});
    rows.sort((a,b)=>a.received_ms-b.received_ms);
  } else if (kind !== 'clean') throw new Error('Unknown example.');
  return rows;
}
export function packSession(rows, config, name, origin) {
  return {format:'signalforge-session',schemaVersion:1,detectorVersion:VERSION,
    name:String(name).slice(0,120),origin:origin==='simulated'?'simulated':'imported',
    settings:validateSettings(config),rows:validateRows(rows)};
}
export function unpackSession(text) {
  if (text.length > MAX_SESSION) throw new Error('Choose a session smaller than 8 MiB.');
  let data;
  try {data=JSON.parse(text);} catch {throw new Error('The session is not valid JSON. Choose a SignalForge session file.');}
  if (!data || data.format !== 'signalforge-session' || data.schemaVersion !== 1 ||
      typeof data.name !== 'string' || data.name.length>120 || !['simulated','imported'].includes(data.origin))
    throw new Error('This is not a supported SignalForge session.');
  return {...data,settings:validateSettings(data.settings),rows:validateRows(data.rows)};
}
export function nearestIndex(rows, time) {
  let lo=0,hi=rows.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2); if(rows[mid].received_ms<=time) lo=mid; else hi=mid-1;}
  return lo;
}

// Bounds are absolute collector times, inclusive. Keep original timestamps and
// arrival order so an exported clip can be traced back to its source recording.
export function selectWindow(rows, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs)
    throw new Error('Choose a finite In time at or before the Out time.');
  if (startMs < rows[0].received_ms || endMs > rows.at(-1).received_ms)
    throw new Error('Keep the range inside the recording.');
  const selected = rows.filter(row => row.received_ms >= startMs && row.received_ms <= endMs);
  if (!selected.length) throw new Error('No readings arrived in that range. Include a reading on either side of the pause.');
  return selected;
}
