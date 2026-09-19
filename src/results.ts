export type LocalResult = { day: string; words: string[]; minimum?: number };
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
