export type LocalResult = { day: string; words: string[]; minimum?: number };
export function todayLinkVisible(puzzleDay: string, now = Date.now()) {
  return puzzleDay < new Date(now).toISOString().slice(0, 10);
}
export function readHistory(raw: string | null): LocalResult[] {
  try {
    const rows: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(rows)) return [];
    const byDay = new Map<string, LocalResult>();
    for (const row of rows) {
      if (!row || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
        || !Number.isFinite(Date.parse(row.day)) || new Date(row.day).toISOString().slice(0,10)!==row.day
        || !Array.isArray(row.words) || !row.words.length || row.words.length>15
        || !row.words.every((word: unknown) => typeof word==='string' && /^[a-z]{1,15}$/.test(word))
        || row.words.join('').length!==15) continue;
      const previous = byDay.get(row.day);
      if (!previous || row.words.length<previous.words.length) byDay.set(row.day, {
        day:row.day, words:row.words,
        ...(Number.isInteger(row.minimum) && row.minimum>=1 && row.minimum<=row.words.length ? {minimum:row.minimum} : {}),
      });
    }
    return [...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
  } catch { return []; }
}
export function summarizeHistory(rows: LocalResult[], today: string) {
  const days = new Set(rows.map(row=>row.day));
  const previous = (day: string) => new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
  let current=0, day=days.has(today)?today:previous(today), longest=0, run=0, last='';
  while(days.has(day)){current++;day=previous(day);}
  for(const date of [...days].sort()){run=last===previous(date)?run+1:1;longest=Math.max(longest,run);last=date;}
  return {current,longest,completed:rows.length,averageWords:rows.length?rows.reduce((sum,row)=>sum+row.words.length,0)/rows.length:0,minimumSolves:rows.filter(row=>row.minimum===row.words.length).length};
}
export function resultShare(day: string, words: string[], url: string, reveal=false, minimum?: number) {
  return `JUMBLE ${day}\n${words.length} words · 15 letters${words.length===minimum?' · Minimum found':''}\n${words.map(word=>reveal?word.toUpperCase():'🟦'.repeat(word.length)).join('\n')}\nSame letters. Different minds.\n${url}`;
}

export function swapSpread(minimum:number,counts:Record<string,number>|undefined,preview=false){
  if(!Number.isSafeInteger(minimum)||minimum<0||minimum>1000||(!counts&&!preview))return null;
  const bins=[0,0,0,0,0,0],weights=[3,8,15,16,10,6];
  for(const [score,count] of Object.entries(counts||{})){
    if(!/^(0|[1-9]\d*)$/.test(score)||!Number.isSafeInteger(Number(score))||Number(score)<minimum||Number(score)>1000||!Number.isSafeInteger(count)||count<0)return null;
    bins[Math.min(5,Number(score)-minimum)]+=count;
  }
  const total=bins.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total))return null;
  const sample=preview&&total<58;
  if(sample){const missing=58-total,shares=weights.map(w=>missing*w/58),padding=shares.map(Math.floor),order=shares.map((value,index)=>({index,remainder:value-padding[index]})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);for(let i=0;i<missing-padding.reduce((a,b)=>a+b,0);i++)bins[order[i].index]++;for(let i=0;i<6;i++)bins[i]+=padding[i];}
  return {bins,total:sample?58:total,sample};
}
