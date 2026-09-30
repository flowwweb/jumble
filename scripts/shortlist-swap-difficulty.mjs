// Offline private shortlist only. Never overwrites the active daily corpus.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {generateSwapPuzzles} from './generate-swap-puzzles.mjs';
import {enumerateSwapGoals,solveSwapExact} from '../engine/swap-solver.mjs';
import {createSwapDictionary,evaluateBoard,replaySwapSession,SWAP_RULES_VERSION} from '../engine/swap.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex'),read=async path=>JSON.parse(await readFile(path,'utf8'));
const vocabulary=await read('data/swap/words.json'),seeds=(await read('data/swap/familiar-v1.json')).words,commonData=await read('docs/research/swap-common-words-v2.json'),common=new Set(commonData.words);
const dictionary=createSwapDictionary(vocabulary.words),triple=goal=>[goal.slice(0,5),goal.slice(5,10),goal.slice(10)].map(w=>w.toLowerCase()).sort().join(','),natural=goal=>triple(goal).split(',').every(w=>common.has(w));
const directory='.cache/difficulty-20260923',path=directory+'/shortlist.json',binding={rulesVersion:SWAP_RULES_VERSION,dictionaryVersion:vocabulary.version,dictionaryHash:hash(JSON.stringify(dictionary.words)),commonHash:hash(JSON.stringify([...common].sort()))};
await mkdir(directory,{recursive:true});let receipt;try{receipt=await read(path);}catch(error){if(error.code!=='ENOENT')throw error;receipt={binding,proposals:0,rejections:{},candidates:[]};}if(JSON.stringify(receipt.binding)!==JSON.stringify(binding))throw Error('Shortlist binding changed');
const reject=reason=>receipt.rejections[reason]=(receipt.rejections[reason]||0)+1,started=performance.now(),seen=new Set(receipt.candidates.map(p=>p.letters.join('')));
while(receipt.candidates.length<14&&performance.now()-started<60000){
 const proposal=generateSwapPuzzles(seeds,vocabulary.words,vocabulary.version,1,2026092300+receipt.proposals,4+receipt.proposals%2)[0];receipt.proposals++;
 const board=proposal.letters.join('');if(seen.has(board)){reject('duplicate');continue;}seen.add(board);
 const commonGoals=enumerateSwapGoals(board,[...common].filter(w=>dictionary.has(w))),sets=new Set(commonGoals.map(triple));if(sets.size<3){reject('fewCommonTriples');continue;}
 const budget=()=>({maxStates:200000,maxMilliseconds:Math.max(1,Math.min(3000,60000-(performance.now()-started)))});
 const global=solveSwapExact(board,vocabulary.words,{...budget(),maxDistance:5});if(global.status!=='PROVEN'){reject(global.status==='OUTSIDE_LIMIT'?'minimumBand':'globalUnverified');continue;}if(global.minimum<3||global.minimum>5){reject('minimumBand');continue;}
 // Ensure the batch median is four and at least ten of fourteen are below five.
 if(global.minimum===5&&receipt.candidates.filter(p=>p.optimality.minimumMoves===5).length>=4){reject('batchFiveLimit');continue;}
 if(global.minimum===3&&receipt.candidates.filter(p=>p.optimality.minimumMoves===3).length>=6){reject('batchThreeLimit');continue;}
 const nearby=[],excluded=new Set();let failure;
 for(let i=0;i<3;i++){
  const found=solveSwapExact(board,vocabulary.words,{...budget(),maxDistance:global.minimum+(i===0?0:i===1?1:2),goalFilter:goal=>natural(goal)&&!excluded.has(triple(goal))});
  if(found.status!=='PROVEN'){failure=found.status==='OUTSIDE_LIMIT'?'nearbyDistance':'nearbyUnverified';break;}
  if((i===0&&found.minimum!==global.minimum)||(i===1&&found.minimum>global.minimum+1)||found.minimum>global.minimum+2){failure='nearbyDistance';break;}
  const actions=found.solution.map(action=>({type:'swap',...action})),replay=replaySwapSession(board,actions,dictionary);if(!replay.won||replay.moves!==found.minimum)throw Error('Invalid nearby witness');const key=[...replay.rows].sort().join(',');excluded.add(key);nearby.push({words:replay.rows,moves:found.minimum,actions,proof:found.certificate});
 }
 if(failure){reject(failure);continue;}
 const {rulesVersion,boardSha256,dictionaryWordsSha256,algorithm,elapsedMs,...proof}=global.certificate;
 const optimality={status:'PROVEN',rulesVersion,dictionaryVersion:vocabulary.version,boardSha256,dictionaryWordsSha256,minimumMoves:global.minimum,optimalActions:nearby[0].actions,optimalWords:nearby[0].words,proof:{method:algorithm,...proof}};
 receipt.candidates.push({...proposal,id:`candidate-${receipt.candidates.length+1}`,optimality,difficulty:{allCommonTriples:sets.size,commonWordsInTriples:new Set([...sets].flatMap(s=>s.split(','))).size,allAdmittedTriples:global.certificate.goalCount/6,nearby,initialValidRows:evaluateBoard(board,dictionary).validRows.filter(Boolean).length}});
 await writeFile(path,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({accepted:receipt.candidates.length,proposals:receipt.proposals,minimum:global.minimum,nearby:nearby.map(p=>p.moves),commonTriples:sets.size}));
}
receipt.checkedAt=new Date().toISOString();receipt.status=receipt.candidates.length===14?'SHORTLIST_READY':'INCOMPLETE';receipt.elapsedMs=performance.now()-started;await writeFile(path,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,candidates:receipt.candidates.length,proposals:receipt.proposals,rejections:receipt.rejections,elapsedMs:receipt.elapsedMs}));
