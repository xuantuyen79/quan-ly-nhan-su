import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {qltsDocumentPDF} from '../src/qlts-port-pdf.js';
import {assetsTransactionAPI as api,protectedAssetUnitSave as safeSave} from '../src/ksb-assets-api.js';import {encodeUnit,catalogSnapshot} from '../src/ksb-asset-import.js';
test('asset workflows on local D1: server rules, permission, concurrency, idempotency and restart',{timeout:90000},async t=>{
 const {Miniflare,convertV4MiniflareOptions}=createRequire(import.meta.url)('miniflare');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ksb-biz-'));const make=()=>new Miniflare({...convertV4MiniflareOptions({name:'ksb-biz-test',modules:true,script:'export default{fetch(){return new Response("local")}}',compatibilityDate:'2026-11-18',d1Databases:{DB:'biz-only-test'}}),resourcePersistencePath:dir,isolatedResourcePersistencePath:path.join(dir,'isolated')});let mf=make(),db=await mf.getD1Database('DB');
 const admin={sys:true,ten:'Synthetic admin'},base={id:'synthetic-parent',name:'DEV',data:{NV:[{'Mã NV':'TEST-A','Họ và tên':'DEV'}],HD:[{test:1}],CC:[{test:2}],LG:[{test:3}]},ts:{ds:[{id:'a',ma:'TS-TEST',ten:'DEV',loai:'vl',tt:'Sử dụng tốt',giu:'',ls:[]}],pg:[]}};
 const input=(requestId,version=1,loai='Cấp phát')=>({unit:base.id,version,requestId,action:'recordMove',payload:{ds:['TS-TEST'],loai,ngay:'2026-11-26',nguoiNhan:loai==='Thu hồi'?'':'TEST-A'}});
 const read=async()=> (await catalogSnapshot(db)).entries.find(e=>e.unit.id===base.id);
 async function put(k,u){const v=await encodeUnit(u);await db.batch([db.prepare('INSERT INTO qt_kv(k,ver,n,z,size) VALUES(?,1,1,1,?)').bind(k,v.length),db.prepare('INSERT INTO qt_part(k,i,v)VALUES(?,0,?)').bind(k,v)]);}
 try{
 await db.exec('CREATE TABLE qt_kv(k TEXT PRIMARY KEY,ver INTEGER NOT NULL,at INTEGER,nguoi TEXT,n INTEGER,z INTEGER DEFAULT 0,meta TEXT,size INTEGER);CREATE TABLE qt_part(k TEXT NOT NULL,i INTEGER NOT NULL,v TEXT,PRIMARY KEY(k,i));');await put('unit:'+base.id,base);await put('unit:child',{id:'child',data:{NV:[]},ts:{ds:[]}});
 await t.test('anonymous and users without asset permission rejected',async()=>{await assert.rejects(api(db,null,input('test-unauthorized')),e=>e.status===401);await assert.rejects(api(db,{ma:'TEST-A',sys:false},input('test-unauthorized')),e=>e.status===403);assert.equal((await read()).meta.ver,1);});
 await t.test('allocation is atomic, keeps other HR fields and subsidiary unchanged',async()=>{const before=await catalogSnapshot(db);const r=await api(db,admin,input('request-first-0001'));assert.equal(r.version,2);const e=await read();assert.equal(e.unit.ts.ds[0].giu,'TEST-A');assert.deepEqual(e.unit.data,base.data);assert.deepEqual((await catalogSnapshot(db)).entries.find(e=>e.unit.id==='child'),before.entries.find(e=>e.unit.id==='child'));});
 await t.test('PDF endpoint authorizes writer and version, renders only issued server HTML and never writes D1',async()=>{
  const before=await catalogSnapshot(db),entry=await read(),body={unit:base.id,version:entry.meta.ver,table:'gd',key:entry.unit.ts.ksb.gd[0].id,html:'UNTRUSTED-CLIENT-HTML',url:'https://example.invalid/'};
  let calls=0;const browser={quickAction:async(name,opts)=>{calls++;assert.equal(name,'pdf');assert.doesNotMatch(opts.html,/UNTRUSTED-CLIENT-HTML|example.invalid/);assert.match(opts.html,/TS-TEST/);assert.equal(opts.html,entry.unit.ts.ksbDocuments['gd|'+entry.unit.ts.ksb.gd[0].bienBan].html);assert.equal(opts.pdfOptions.format,'a4');return new Response('%PDF-1.7\nsynthetic test');}};
  await assert.rejects(qltsDocumentPDF(db,null,body,browser),e=>e.status===401);
  await assert.rejects(qltsDocumentPDF(db,{sys:false,ma:'NO-RIGHTS'},body,browser),e=>e.status===403);
  await assert.rejects(qltsDocumentPDF(db,admin,{...body,version:0},browser),e=>e.status===409);
  await assert.rejects(qltsDocumentPDF(db,admin,{...body,table:'employees'},browser),e=>e.status===400);
  await assert.rejects(qltsDocumentPDF(db,admin,{...body,table:'nv',key:'UNKNOWN'},browser),e=>e.status===404);
  const archived=await qltsDocumentPDF(db,admin,{...body,format:'html'},null);assert.equal(new TextDecoder().decode(archived),entry.unit.ts.ksbDocuments['gd|'+entry.unit.ts.ksb.gd[0].bienBan].html);
  assert.equal(calls,0);const bytes=await qltsDocumentPDF(db,admin,body,browser);assert.equal(new TextDecoder().decode(bytes).slice(0,5),'%PDF-');
  const report=await qltsDocumentPDF(db,admin,{...body,table:'nv',key:'TEST-A'},{quickAction:async(name,opts)=>{assert.match(opts.html,/TS-TEST/);return new Response('%PDF-1.7 current report');}});assert.equal(new TextDecoder().decode(report).slice(0,5),'%PDF-');
  await assert.rejects(qltsDocumentPDF(db,admin,body,{quickAction:async()=>new Response('not a PDF')}),e=>e.status===502);
  await assert.rejects(qltsDocumentPDF(db,admin,body,null),e=>e.status===503);
  assert.deepEqual(await catalogSnapshot(db),before);
 });
 await t.test('source import rejects cross-company duplicate without touching either company',async()=>{
  const before=await catalogSnapshot(db);await assert.rejects(api(db,admin,{unit:'child',version:1,requestId:'source-cross-unit-001',action:'sourceImportAssets',payload:{rows:[{ma:'TS-TEST',ten:'Duplicate'}],opt:{}}}),/trùng|đơn vị|công ty/i);assert.deepEqual(await catalogSnapshot(db),before);
 });
 await t.test('existing module write permission and object-shaped company scope are respected',async()=>{
  await put('settings',{pq:{on:true,roles:[{id:'asset-role',q:{taisan:'s'}},{id:'view-role',q:{taisan:'x'}}],users:[{nv:'SYNTH-MANAGER',role:'asset-role',dv:[{id:base.id,name:'DEV'}],pb:[]},{nv:'SYNTH-VIEWER',role:'view-role',dv:'all',pb:[]}]}});
  const r=await api(db,{sys:false,ma:'SYNTH-MANAGER',ten:'DEV asset manager'},input('request-first-0001'));assert.equal(r.duplicate,true);
  await assert.rejects(api(db,{sys:false,ma:'SYNTH-MANAGER'}, {...input('request-wrong-company'),unit:'child'}),e=>e.status===403);
  await assert.rejects(api(db,{sys:false,ma:'SYNTH-VIEWER'}, input('request-readonly-user')),e=>e.status===403);assert.equal((await read()).meta.ver,2);
 });
 await t.test('repeated request returns original result; stale request and duplicate allocation blocked',async()=>{const r=await api(db,admin,input('request-first-0001'));assert.equal(r.duplicate,true);assert.equal((await read()).unit.ts.ksb.gd.length,1);await assert.rejects(api(db,admin,input('request-stale-0002')),/Tải lại/);await assert.rejects(api(db,admin,input('request-invalid-002',2)),/trong kho/);assert.equal((await read()).meta.ver,2);});
 await t.test('simultaneous recovery requests accept exactly one; no overwritten history',async()=>{const out=await Promise.allSettled([api(db,admin,input('request-recover-01',2,'Thu hồi')),api(db,admin,input('request-recover-02',2,'Thu hồi'))]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);const e=await read();assert.equal(e.unit.ts.ksb.gd.length,2);assert.equal(e.unit.ts.ds[0].giu,'');assert.equal(e.meta.ver,3);});
 await t.test('whole-unit save cannot overwrite ledger or custody; unrelated edits stay possible',async()=>{
  const e=await read(),edited=structuredClone(e.unit);edited.ts.ds[0].ten='DEV renamed';const result=await safeSave(db,admin,{k:'unit:'+base.id,v:JSON.stringify(edited),z:0,base:e.meta.ver});assert.equal(result.version,e.meta.ver+1);assert.equal((await read()).unit.ts.ds[0].ten,'DEV renamed');
  const current=await read(),bad=structuredClone(current.unit);bad.ts.ksb.gd=[];await assert.rejects(safeSave(db,admin,{k:'unit:'+base.id,v:JSON.stringify(bad),z:0,base:current.meta.ver,force:1}),e=>e.status===403);const wrong=structuredClone(current.unit);wrong.ts.ds[0].giu='TEST-A';await assert.rejects(safeSave(db,admin,{k:'unit:'+base.id,v:JSON.stringify(wrong),z:0,base:current.meta.ver}),e=>e.status===403);
  const stale=await safeSave(db,admin,{k:'unit:'+base.id,v:JSON.stringify(edited),z:0,base:1});assert.ok(stale.conflict);assert.equal((await read()).unit.ts.ksb.gd.length,2);
 });
 await t.test('restarting D1 keeps documents, events, request receipts and unrelated data',async()=>{await mf.dispose();mf=make();db=await mf.getD1Database('DB');const e=await read();assert.equal(e.meta.ver,4);assert.equal(e.unit.ts.ksb.gd[1].bienBan,'001/2026/BBTH');assert.equal(e.unit.ts.ds[0].ls.length,2);assert.deepEqual(e.unit.data,base.data);});
 await t.test('direct pending handover confirmation and idempotency are enforced in D1 API',async()=>{const id='pending-direct',u={...structuredClone(base),id};u.ts.ds[0].ma='TS-PENDING';u.ts.ds[0].tt='Chờ đối chiếu';u.ts.ds[0].qltsImport={status:'Đang sử dụng'};await put('unit:'+id,u);const p={unit:id,version:1,requestId:'pending-confirm-001',action:'recordMove',payload:{ds:['TS-PENDING'],loai:'Cấp phát',ngay:'2026-11-26',nguoiNhan:'TEST-A'}};await assert.rejects(api(db,admin,p),/đối chiếu/);let current=(await catalogSnapshot(db)).entries.find(e=>e.unit.id===id);assert.equal(current.meta.ver,1);p.payload.reconcileCodes=['TS-PENDING'];const result=await api(db,admin,p);assert.equal(result.version,2);await api(db,admin,p);current=(await catalogSnapshot(db)).entries.find(e=>e.unit.id===id);assert.equal(current.unit.ts.ksb.gd.length,1);assert.equal(current.unit.ts.ds[0].qltsImport.status,'Đang sử dụng');assert.deepEqual(current.unit.data,u.data);});
 }finally{await mf.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
