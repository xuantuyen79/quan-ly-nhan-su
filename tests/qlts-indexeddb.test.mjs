import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../src/phan-mem.html',import.meta.url),'utf8');
const between=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const sync=between('  var WF_BUSY =','  function wfAutoMark(');
const refresh=between('  async function qltsRefreshAssets(','  var qltsPdfAvailable=');
const clean=between('  function svClean(','  function svLabel(');
const merge=between('  function svIsObj(','  function svPartName(');
function setup(syncCode=sync){
 const unit={id:'dev',ver:1,wf:{},data:{NV:[]},ts:{ds:Array.from({length:82},(_,i)=>({ma:'DEV-'+i,giu:i<56?'DEV-EMP':'',ls:[]})),ksb:{gd:[],bb:[]}}};
 const server=structuredClone(unit);let resolve,reject,calls=0,writes=0;
 const c={S:{units:[unit]},SV:{base:{'unit:dev':JSON.stringify(unit)},kv:{},hash:{},mute:0},SV_MGU:null,svOn:()=>true,svApi:async()=>({ok:true,v:server,z:0,ver:2}),svDec:v=>structuredClone(v),svHash:v=>v,svKvSave:()=>{},svQueue:()=>{},dbSet:async(k,v)=>{structuredClone(v);writes++;},wfSync0:()=>{calls++;return new Promise((a,b)=>{resolve=a;reject=b;});}};
 vm.createContext(c);vm.runInContext(syncCode+clean+refresh+merge,c);
 return {c,unit,server,resolve:v=>resolve(v),reject:e=>reject(e),calls:()=>calls,writes:()=>writes};
}
function promisePaths(value,path='S.units',seen=new Set()){
 if(!value||typeof value!=='object'||seen.has(value))return [];
 if(typeof value.then==='function')return [path];seen.add(value);
 return Object.keys(value).flatMap(k=>promisePaths(value[k],path+(Array.isArray(value)?`[${k}]`:'.'+k),seen));
}
test('reproduces original bootstrap failure at S.units[0]._wfP without exposing values',async()=>{
 const old=`var WF_BUSY=0; function wfSync(u){if(u._wfP)return u._wfP;WF_BUSY++;var end=function(){WF_BUSY--;u._wfP=null;};u._wfP=wfSync0(u).then(function(r){end();return r;},function(e){end();throw e;});return u._wfP;}`;
 const x=setup(old),p=x.c.wfSync(x.unit);assert.deepEqual(promisePaths(x.c.S.units),['S.units[0]._wfP']);
 await assert.rejects(x.c.qltsRefreshAssets(x.unit),{name:'DataCloneError'});assert.equal(x.writes(),0);x.resolve();await p;
});
test('all asset menu refreshes can persist 82 assets while attendance sync is pending',async()=>{
 const x=setup(),before=structuredClone(x.unit.ts),p=x.c.wfSync(x.unit);
 assert.equal(x.c.wfSync(x.unit),p);assert.equal(x.calls(),1);
 for(const menu of ['overview/list','allocation','loans','maintenance','disposal','audit','reports']){
  await x.c.qltsRefreshAssets(x.unit);
  assert.deepEqual(promisePaths(x.c.S.units),[],menu);
  assert.deepEqual(structuredClone(x.unit.ts),before,menu);
 }
 assert.equal(x.writes(),7);assert.equal(x.c.WF_BUSY,1);x.resolve('done');assert.equal(await p,'done');assert.equal(x.c.WF_BUSY,0);
 const next=x.c.wfSync(x.unit);assert.notEqual(next,p);assert.equal(x.calls(),2);x.resolve();await next;
});
test('failed sync releases the lock and propagates the error for retry',async()=>{
 const x=setup(),p=x.c.wfSync(x.unit),failure=new Error('DEV failure');x.reject(failure);await assert.rejects(p,e=>e===failure);
 assert.equal(x.c.WF_BUSY,0);assert.deepEqual(promisePaths(x.c.S.units),[]);
 const next=x.c.wfSync(x.unit);assert.equal(x.calls(),2);x.resolve();await next;
});
test('auto sync checks the same pending registry and never stores a Promise on units',()=>{
 assert.doesNotMatch(html,/\._wfP\b/);
 assert.match(between('  function wfAutoTick(','  setTimeout(function () { wfAutoTick'),/WF_PENDING\.has\(u\)/);
});
