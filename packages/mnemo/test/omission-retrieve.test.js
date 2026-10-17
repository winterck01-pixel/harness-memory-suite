import {test} from 'node:test'
import assert from 'node:assert/strict'
import {retrieve, signalScore} from '../lib/retrieve.js'
test('D11 prior ranks results but cannot admit a below-signal item',()=>{
 const item={id:'weak',text:'quartz orchard beta gamma delta epsilon zeta eta theta iota',cues:[],entities:[],source:'human',trust:'reported'}
 const options={text:'quartz orchard mu nu xi omicron rho sigma tau upsilon',candidates:[item]}
 assert.ok(signalScore({...options,item,priorOf:()=>1}).parts.signal<0.18)
 for(const prior of [0,1])assert.deepEqual(retrieve({...options,priorOf:()=>prior}),[])
})
