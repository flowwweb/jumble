import { readHistory, summarizeHistory, resultShare } from './results.js';
type Puzzle = { id: string; letters: string[]; dictionaryVersion: string };
type Result = { puzzleId: string; words: string[]; wordCount: number; minimum: number; elapsedMs: number; rank: number; total: number; tied: number; rankingAsOf: number };
type Save = { version: 1; puzzleId: string; dictionaryVersion: string; words: string[]; used: number[]; order: number[]; bestWords?: string[]; sessionId?: string; result?: Result };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const message = (text: string) => { el('message').textContent = text; };
const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { message('Storage is unavailable. Keep this tab open to save your progress.'); } },
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (response.status === 204) return undefined as T;
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Jumble could not connect. Please try again.');
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not connect. Please try again.'), {code:data.code});
  return data as T;
}
const track = (name: string) => { void api('event', { name }).catch(() => {}); };
let puzzle: Puzzle, save: Save, dictionary: Set<string>;
let selected: number[] = [], playing = false, submitting = false, sessionReady = false;
let sessionRequest: Promise<void> | undefined;
const colors: Record<string, string> = { A:'#FFB7BC',B:'#AADEB7',C:'#A9D2FF',D:'#FFE099',E:'#D7BFFF',F:'#BAC4FF',G:'#AADEB7',H:'#FFB7BC',I:'#FFE099',J:'#A9D2FF',K:'#D7BFFF',L:'#BAC4FF',M:'#FFE099',N:'#D7BFFF',O:'#FFB7BC',P:'#A9D2FF',Q:'#BAC4FF',R:'#A9D2FF',S:'#AADEB7',T:'#FFE099',U:'#FFB7BC',V:'#D7BFFF',W:'#A9D2FF',X:'#BAC4FF',Y:'#FFE099',Z:'#AADEB7' };
const complete = () => save.used.length === 15;
function persist() { storage.set(`jumble:${puzzle.id}`, JSON.stringify(save)); }
function ensureSession() {
  if (sessionReady) return Promise.resolve();
  if (!sessionRequest) sessionRequest = api<{sessionId:string}>('session', {puzzleId:puzzle.id}).then(data => {
    save.sessionId = data.sessionId; sessionReady = true; persist();
  }).finally(() => { sessionRequest = undefined; });
  return sessionRequest;
}
function focusTile(index?: number) {
  const tile = index === undefined ? el('tiles').querySelector<HTMLButtonElement>('button:not(:disabled)') : el<HTMLButtonElement>(`tile-${index}`);
  tile?.focus({ preventScroll: true });
}
function toggleTile(index: number) {
  if (!playing || complete() || save.used.includes(index)) return;
  selected = selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index];
  void ensureSession().catch(error => message(error.message));
  render();
  message(selected.length ? selected.map(i => puzzle.letters[i]).join('') : '');
}
function render() {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const board = el('tiles'); board.replaceChildren();
  save.order.forEach(index => {
    const letter = puzzle.letters[index];
    const used = save.used.includes(index), chosen = selected.includes(index);
    const button = document.createElement('button');
    button.id = `tile-${index}`;
    button.className = `tile${chosen ? ' selected' : ''}${used ? ' used' : ''}`;
    button.textContent = letter; button.style.backgroundColor = colors[letter];
    button.disabled = used || complete();
    button.setAttribute('aria-label', `${letter}, tile ${index+1} of 15${used ? ', used' : chosen ? ', selected' : ', available'}`);
    button.setAttribute('aria-pressed', String(chosen));
    button.onclick = () => toggleTile(index);
    board.append(button);
  });
  const composed = el('word'); composed.replaceChildren();
  selected.forEach(index => {
    const button = document.createElement('button');
    button.id = `selected-${index}`; button.textContent = puzzle.letters[index];
    button.setAttribute('aria-label', `Remove ${puzzle.letters[index]}, tile ${index+1}, from word`);
    button.onclick = () => { toggleTile(index); focusTile(index); };
    composed.append(button);
  });
  el<HTMLButtonElement>('confirm').disabled = !selected.length || complete();
  el<HTMLButtonElement>('backspace').disabled = !selected.length || complete();
  el<HTMLButtonElement>('reset').disabled = complete() || (!save.used.length && !selected.length);
  el<HTMLButtonElement>('shuffle').disabled = complete();
  el('remaining').textContent = `${15-save.used.length} left`;
  el('words').replaceChildren(...wordItems(save.words));
  el('entry').hidden = playing;
  el('play').textContent = complete()?'View result':save.used.length?'Continue':'Play';
  el('play-header').hidden = !playing;
  el('game').hidden = !playing || complete();
  el('result').hidden = !playing || !complete();
  el('view-best').hidden = !save.bestWords || complete();
  el('report-word').hidden = true;
  if (complete()) showResult();
  if (focused && document.getElementById(focused) instanceof HTMLButtonElement) {
    const target = el<HTMLButtonElement>(focused);
    if (!target.disabled && !target.closest('[hidden]')) target.focus({ preventScroll: true });
  }
}
function wordItems(words: string[]) {
  return words.map(word => { const li = document.createElement('li'); li.textContent = word.toUpperCase(); return li; });
}
function streak() {
  const rows = readHistory(storage.get('jumble:history'));
  const old = rows.find(row=>row.day===puzzle.id);
  if (!old || save.words.length<=old.words.length) {
    storage.set('jumble:history',JSON.stringify([...rows.filter(row=>row.day!==puzzle.id),{day:puzzle.id,words:save.words,minimum:save.result?.minimum??old?.minimum}]));
  }
  if (!save.bestWords || save.words.length<save.bestWords.length) { save.bestWords=[...save.words]; persist(); }
  const count = summarizeHistory(readHistory(storage.get('jumble:history')),new Date().toISOString().slice(0,10)).current;
  el('streak').textContent = count ? `${count} day${count===1?'':'s'} in a row on this device` : '';
}
function showResult() {
  el<HTMLButtonElement>('replay').disabled=submitting;
  el('result-title').textContent = `${save.words.length} word${save.words.length===1?'':'s'}. All 15 letters.`;
  el('result-words').replaceChildren(...wordItems(save.words));
  el('result-detail').textContent = save.result ? (save.words.length===save.result.minimum ? 'You found the minimum.' : `The fewest possible: ${save.result.minimum}.`) : 'Solved on this device. Online result not yet verified.';
  el('result-time').textContent = save.result ? `${Math.floor(save.result.elapsedMs/60000)}m ${Math.floor(save.result.elapsedMs/1000)%60}s from your first play · time does not affect rank` : '';
  el('rank').textContent = save.result ? `At submission: rank ${save.result.rank} of ${save.result.total}${save.result.tied>1?` · ${save.result.tied} tied`:''}` : submitting ? 'Checking your result…' : 'Daily ranking is not verified yet.';
  el('today-link').hidden = puzzle.id === new Date().toISOString().slice(0,10);
  streak();
}
async function submit() {
  if (!complete() || submitting) return;
  submitting = true; delete save.result;
  el('retry-submit').hidden = true; showResult();
  try {
    await ensureSession();
    const result = await api<Result>('result', {puzzleId:puzzle.id,sessionId:save.sessionId,words:save.words,dictionaryVersion:puzzle.dictionaryVersion});
    // Only the current authenticated server response can establish a rank or minimum.
    save.result = result; save.words = result.words; persist(); render();
    if (el<HTMLDialogElement>('share-dialog').open) updateShare();
  } catch (error) {
    el('rank').textContent = `${error instanceof Error?error.message:'Could not submit your result.'} Your solve is saved on this device.`;
    el('retry-submit').hidden = false;
  } finally { submitting = false; el<HTMLButtonElement>('replay').disabled=false; }
}
el('confirm').onclick = () => {
  if (!playing || !selected.length || complete()) return;
  const word = selected.map(i => puzzle.letters[i]).join('').toLowerCase();
  if (!dictionary.has(word)) { message('Not in the word list.'); el('report-word').hidden=false; track('word_invalid'); return; }
  save.words.push(word); save.used.push(...selected); selected = []; persist(); render(); track('word_valid');
  if (complete()) { message('Every letter used.'); el('share').focus(); void submit(); }
  else { message(`${word.toUpperCase()} added.`); focusTile(); }
};
el('backspace').onclick = () => { if (complete()) return; selected.pop(); render(); message(selected.map(i => puzzle.letters[i]).join('')); };
function resetAttempt() {
  save.words = []; save.used = []; delete save.result; selected = []; persist(); render(); message('A fresh start. Same 15 letters.'); track('puzzle_reset'); focusTile();
}
el('reset').onclick = () => { if (save.words.length) el<HTMLDialogElement>('reset-dialog').showModal(); else resetAttempt(); };
el('reset-confirm').onclick = () => { el<HTMLDialogElement>('reset-dialog').close(); resetAttempt(); };
el('replay').onclick = () => { if (!submitting) resetAttempt(); };
el('view-best').onclick = () => {
  if (!save.bestWords) return;
  save.words=[...save.bestWords];save.used=Array.from({length:15},(_,i)=>i);selected=[];persist();render();void submit();
};
el('shuffle').onclick = () => {
  if (complete()) return;
  const available = save.order.filter(index => !save.used.includes(index));
  for (let i=available.length-1;i>0;i--) { const j = Math.floor(Math.random()*(i+1)); [available[i],available[j]] = [available[j],available[i]]; }
  let next = 0; save.order = save.order.map(index => save.used.includes(index) ? index : available[next++]);
  persist(); render(); message('Letters shuffled.');
};
el('retry-submit').onclick = () => void submit();
el('play').onclick = () => {
  playing = true; render();
  if (!complete()) {
    void ensureSession().catch(error => message(error.message));
    if (!storage.get('jumble:help-seen')) { storage.set('jumble:help-seen','1'); el<HTMLDialogElement>('help-dialog').showModal(); }
    else focusTile();
  } else if (!save.result) void submit();
};
el('back').onclick = () => { playing = false; render(); el('play').focus(); };
el('retry-load').onclick = () => location.reload();
function challengeUrl() { const url=new URL(location.origin);url.searchParams.set('day',puzzle.id);return url.href; }
function shareText() { return resultShare(puzzle.id,save.words,challengeUrl(),el<HTMLInputElement>('reveal-words').checked,save.result?.minimum); }
function updateShare() {
  el<HTMLTextAreaElement>('share-preview').value=shareText();
  el<HTMLAnchorElement>('share-x').href=`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}`;
}
el('share').onclick = () => { el<HTMLInputElement>('reveal-words').checked=false;updateShare();el('share-status').textContent='';el<HTMLDialogElement>('share-dialog').showModal(); };
el('reveal-words').onchange=updateShare;
async function copyShare(text: string) {
  try { await navigator.clipboard.writeText(text);el('share-status').textContent='Copied.';track('share'); }
  catch { const area=el<HTMLTextAreaElement>('share-preview');area.value=text;area.focus();area.select();el('share-status').textContent='Select and copy the text above.'; }
}
el('copy-result').onclick=()=>void copyShare(shareText());
el('copy-link').onclick=()=>void copyShare(challengeUrl());
el('native-share').onclick=async()=>{
  try { if(navigator.share){await navigator.share({text:shareText()});track('share');}else await copyShare(shareText()); }
  catch(error){if(!(error instanceof DOMException && error.name==='AbortError'))await copyShare(shareText());}
};
el('download-result').onclick=async()=>{
  try {
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=630;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image download is unavailable. Copy your result instead.');
    ctx.fillStyle='#faf9f6';ctx.fillRect(0,0,1200,630);
    const logo=new Image();logo.src='/assets/jumble-logo-v2.png';await logo.decode();ctx.drawImage(logo,40,12,360,189);
    ctx.fillStyle='#17212e';ctx.font='bold 40px system-ui';ctx.fillText(`${save.words.length} words. All 15 letters.`,430,100);
    ctx.font='24px system-ui';ctx.fillText(puzzle.id,430,145);
    const reveal=el<HTMLInputElement>('reveal-words').checked;
    save.words.forEach((word,row)=>{
      const y=218+row*22;ctx.font='18px system-ui';
      if(reveal){ctx.fillStyle='#17212e';ctx.fillText(word.toUpperCase(),60,y+16);}
      else for(let i=0;i<word.length;i++){ctx.fillStyle='#a9d2ff';ctx.fillRect(60+i*24,y,18,18);}
    });
    ctx.fillStyle='#17212e';ctx.font='22px system-ui';ctx.fillText('Same letters. Different minds.',60,580);ctx.font='18px system-ui';ctx.fillText(challengeUrl(),60,612,1080);
    const link=document.createElement('a');link.download=`jumble-${puzzle.id}${reveal?'-words':''}.png`;link.href=canvas.toDataURL('image/png');link.click();track('share');
  } catch(error){el('share-status').textContent=error instanceof Error?error.message:'Image download failed. Copy your result instead.';}
};
function showHistory() {
  const rows=readHistory(storage.get('jumble:history')),stats=summarizeHistory(rows,new Date().toISOString().slice(0,10));
  el('history-summary').textContent=stats.completed?`${stats.completed} solved · ${stats.current} day streak · longest ${stats.longest} · ${stats.averageWords.toFixed(1)} average words · ${stats.minimumSolves} minimum solves recorded`:'No solves saved yet. Your first one starts here.';
  el('history-list').replaceChildren(...rows.slice(-30).reverse().map(row=>{const li=document.createElement('li'),a=document.createElement('a');a.href=`/?day=${encodeURIComponent(row.day)}`;a.textContent=`${row.day} · ${row.words.length} words`;li.append(a);return li;}));
  el<HTMLDialogElement>('history-dialog').showModal();
}
el('history').onclick=showHistory;el('result-history').onclick=showHistory;
el('report-word').onclick=()=>{el<HTMLInputElement>('report-input').value=selected.map(i=>puzzle.letters[i]).join('').toLowerCase();el('report-status').textContent='';el<HTMLDialogElement>('report-dialog').showModal();};
el<HTMLFormElement>('report-form').onsubmit=async event=>{
  event.preventDefault();const button=el('report-form').querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;
  try {await api('report',{puzzleId:puzzle.id,dictionaryVersion:puzzle.dictionaryVersion,word:el<HTMLInputElement>('report-input').value,reason:el<HTMLTextAreaElement>('report-reason').value});el('report-status').textContent='Sent for review. Today’s word list stays the same.';}
  catch(error){el('report-status').textContent=error instanceof Error?error.message:'Report could not send. Try again.';}
  finally{button.disabled=false;}
};
const dark = storage.get('jumble:theme')==='dark' || (!storage.get('jumble:theme') && matchMedia('(prefers-color-scheme:dark)').matches);
document.body.classList.toggle('dark',dark);
function themeName() {
  const dark = document.body.classList.contains('dark');
  el('theme').setAttribute('aria-label',dark?'Use light theme':'Use dark theme');
  document.querySelectorAll<HTMLImageElement>('img[data-logo]').forEach(image => { image.src = `/assets/jumble-logo-v2${dark?'-dark':''}.png`; });
}
themeName();
el('theme').onclick = () => { document.body.classList.toggle('dark'); storage.set('jumble:theme',document.body.classList.contains('dark')?'dark':'light'); themeName(); track('theme_toggle'); };
el('help').onclick = () => el<HTMLDialogElement>('help-dialog').showModal();
document.querySelectorAll<HTMLButtonElement>('dialog .close, .close-help').forEach(button => button.onclick = () => { button.closest('dialog')?.close(); if (button.classList.contains('close-help') && playing && !complete()) focusTile(); });
async function openSponsors() {
  el<HTMLDialogElement>('sponsor-dialog').showModal(); track('sponsor_open');
  try {
    const data = await api<{rows:{name:string;url:string;cents:number}[];topCents:number}>('sponsors');
    const wall = el('sponsor-wall'); wall.replaceChildren();
    if (!data.rows.length) wall.textContent = 'Be the first to back Jumble.';
    for (const sponsor of data.rows) {
      const row = document.createElement('article'), name = document.createElement('a');
      name.textContent = `${sponsor.name} · $${(sponsor.cents/100).toFixed(2)}`;
      const url = new URL(sponsor.url);
      if (url.protocol==='https:') { name.href = url.href; name.target = '_blank'; name.rel = 'noopener noreferrer sponsored'; }
      row.append(name); wall.append(row);
    }
    el('takeover-detail').textContent = `Top contribution: $${(data.topCents/100).toFixed(2)}. Checkout calculates the amount to pass it, including your link’s existing credit. Rank can change before payment is confirmed.`;
  } catch (error) { el('sponsor-wall').textContent = error instanceof Error?error.message:'Sponsors could not load.'; }
}
el('sponsors-link').onclick = () => void openSponsors();
el('entry-sponsors').onclick = () => void openSponsors();
el('sponsor-mode').onchange = () => {
  const takeover = el<HTMLSelectElement>('sponsor-mode').value==='takeover';
  el('amount-label').hidden = takeover; el('takeover-detail').hidden = !takeover;
  el<HTMLInputElement>('sponsor-amount').disabled = takeover;
};
el<HTMLFormElement>('sponsor-form').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!; button.disabled = true;
  try {
    const data = new FormData(form), mode = data.get('mode');
    const payload = {name:data.get('name'),url:data.get('url'),mode,puzzleId:puzzle.id,returnTo:playing&&complete()?'result':'entry',...(mode==='takeover'?{}:{amount:Number(data.get('amount'))*100})};
    const fingerprint = JSON.stringify(payload);
    let pending: {fingerprint:string;submissionId:string}|null = null;
    try { pending = JSON.parse(storage.get('jumble:checkout')||'null'); } catch {}
    if (pending?.fingerprint!==fingerprint || typeof pending.submissionId!=='string') pending = {fingerprint,submissionId:crypto.randomUUID()};
    storage.set('jumble:checkout',JSON.stringify(pending));
    const response = await api<{url:string}>('checkout',{...payload,submissionId:pending.submissionId});
    const destination = new URL(response.url);
    if (destination.protocol!=='https:' || destination.hostname!=='checkout.stripe.com') throw new Error('Checkout returned an unexpected destination.');
    location.assign(destination.href);
  } catch (error) {
    el('sponsor-message').textContent = error instanceof Error?error.message:'Checkout could not start.'; button.disabled = false;
    if (error instanceof Error && 'code' in error && ['SUBMISSION_EXPIRED','CHECKOUT_EXPIRED'].includes(String(error.code))) {
      const restart=document.createElement('button');restart.type='button';restart.textContent='Start a new checkout';
      restart.onclick=()=>{storage.set('jumble:checkout','null');restart.remove();el('sponsor-message').textContent='Ready for a new checkout. Your previous payment status has not changed.';};
      el('sponsor-message').append(restart);
    }
  }
};
document.addEventListener('keydown',event => {
  if (!puzzle || !playing || complete() || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if (event.key==='Enter') {
    // Native Enter keeps navigation, tile and composed-letter buttons operable.
    if (event.target instanceof HTMLButtonElement && event.target.id!=='confirm' && !event.target.classList.contains('tile')) return;
    event.preventDefault(); el('confirm').click();
  } else if (event.key==='Backspace') { event.preventDefault(); el('backspace').click(); }
  else if (/^[a-z]$/i.test(event.key)) {
    const index = save.order.find(i => puzzle.letters[i]===event.key.toUpperCase() && !save.used.includes(i) && !selected.includes(i));
    if (index!==undefined) { event.preventDefault(); toggleTile(index); }
  }
});
async function boot() {
  try {
    const params = new URLSearchParams(location.search), requested = params.get('day');
    puzzle = await api<Puzzle>(`puzzle${requested?`?day=${encodeURIComponent(requested)}`:''}`);
    puzzle.letters = Array.from(puzzle.letters, letter => letter.toUpperCase());
    if (puzzle.letters.length!==15 || puzzle.letters.some(letter => !/^[A-Z]$/.test(letter))) throw new Error('This puzzle could not be loaded. Try again.');
    const response = await fetch(`/data/words-${encodeURIComponent(puzzle.dictionaryVersion)}.json`,{signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('The word list could not load. Try again.');
    const lexicon = await response.json();
    if (lexicon.version!==puzzle.dictionaryVersion || !Array.isArray(lexicon.words)) throw new Error('The word list could not be verified.');
    dictionary = new Set(lexicon.words);
    save = {version:1,puzzleId:puzzle.id,dictionaryVersion:puzzle.dictionaryVersion,words:[],used:[],order:Array.from({length:15},(_,i)=>i)};
    try {
      const restored = JSON.parse(storage.get(`jumble:${puzzle.id}`)||'null');
      const indices = (value: unknown): value is number[] => Array.isArray(value) && value.every(i => Number.isInteger(i) && i>=0 && i<15) && new Set(value).size===value.length;
      if (restored?.version===1 && restored.puzzleId===puzzle.id && restored.dictionaryVersion===puzzle.dictionaryVersion
        && Array.isArray(restored.words) && restored.words.length<=15 && indices(restored.used)
        && restored.words.every((word:unknown) => typeof word==='string' && dictionary.has(word))
        && restored.words.join('').split('').sort().join('')===restored.used.map((i:number)=>puzzle.letters[i].toLowerCase()).sort().join('')) {
        // Do not restore session authority, ranking, minimum, time or arbitrary saved fields.
        save.words = restored.words; save.used = restored.used;
        if (indices(restored.order) && restored.order.length===15) save.order = restored.order;
        if (Array.isArray(restored.bestWords) && restored.bestWords.length<=15
          && restored.bestWords.every((word:unknown)=>typeof word==='string' && dictionary.has(word))
          && restored.bestWords.join('').split('').sort().join('')===puzzle.letters.join('').toLowerCase().split('').sort().join('')) save.bestWords=restored.bestWords;
      }
    } catch {}
    el('day').textContent = puzzle.id; el('entry-status').textContent = '';
    el<HTMLButtonElement>('play').disabled = false;
    el('play').textContent = complete()?'View result':save.used.length?'Continue':'Play';
    playing = complete() || save.used.length>0;
    render(); track('puzzle_view');
    if (complete()) void submit();
    const updateCountdown = () => {
      const now = Date.now(), next = (Math.floor(now/86400000)+1)*86400000;
      el('countdown').textContent = `Next Jumble in ${Math.floor((next-now)/3600000)}h ${Math.floor((next-now)%3600000/60000)}m · midnight UTC`;
      if (puzzle.id < new Date(now).toISOString().slice(0,10)) {
        el('today-link').hidden = false;
        if (playing && !complete()) message('A new Jumble is available. Finish this puzzle, or open today’s Jumble below.');
      }
    };
    updateCountdown(); setInterval(updateCountdown,60000);
    if (params.get('sponsor')==='thanks' || params.get('sponsor')==='cancelled') {
      storage.set('jumble:checkout','null');
      playing = params.get('view')==='result' && complete(); render(); el('sponsor-return').hidden = false;
      el('sponsor-return').textContent = params.get('sponsor')==='thanks'?'Thanks. Your listing appears after payment confirmation.':'Checkout cancelled. You can try again whenever you like.';
    }
  } catch (error) {
    el('entry-status').textContent = error instanceof Error?error.message:'Jumble could not load. Try again.';
    el('retry-load').hidden = false;
  }
}
void boot();
