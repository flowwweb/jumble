import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistory,summarizeHistory,resultShare} from '../src/results.ts';
test('local history rejects corrupt data and keeps one best result per day',()=>{
  const rows=readHistory(JSON.stringify([
    {day:'2026-09-18',words:['apple','table','chair']},
    {day:'2026-09-18',words:['outdoors','shelter'],minimum:2},
    {day:'2026-09-19',words:['apple','table','chair']},
    {day:'2026-02-30',words:['outdoors','shelter']},
    {day:'2026-09-20',words:['fake']},
  ]));
  assert.equal(rows.length,2);assert.equal(rows[0].words.length,2);
  assert.deepEqual(summarizeHistory(rows,'2026-09-19'),{current:2,longest:2,completed:2,averageWords:2.5,minimumSolves:1});
  assert.equal(summarizeHistory(rows,'2026-09-21').current,0);
  assert.deepEqual(readHistory('{broken'),[]);
});
test('sharing hides words by default and preserves the dated challenge',()=>{
  const url='https://playjumble.web.app/?day=2026-09-19';
  const text=resultShare('2026-09-19',['outdoors','shelter'],url);
  assert.ok(text.includes(url));assert.ok(!/outdoors|shelter/i.test(text));
  assert.ok(resultShare('2026-09-19',['outdoors','shelter'],url,true,2).includes('OUTDOORS'));
});
