import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {assetCatalogAPI,catalogSnapshot,encodeUnit,ASSET_TARGET,APPROVED_ASSETS_HASH,digest} from '../src/ksb-asset-import.js';
const sourceFile=process.env.KSB_QLTS_ASSETS;
test('D1 catalog adapter: approved package, atomicity, global conflicts, restart and targeted undo',{skip:!sourceFile,timeout:90000},async t=>{
 const assets=JSON.parse(fs.readFileSync(sourceFile));assert.equal(await digest(assets),APPROVED_ASSETS_HASH);
 const {Miniflare,convertV4MiniflareOptions}=createRequire(new URL('../package.json',import.meta.url))('miniflare');
 const persist=fs.mkdtempSync(path.join(os.tmpdir(),'ksb-assets-d1-'));
 const make=()=>new Miniflare({...convertV4MiniflareOptions({name:'asset-adapter-local',modules:true,script:'export default{fetch(){return new Response("local")}}',compatibilityDate:'2026-11-18',d1Databases:{DB:'asset-adapter-local'}}),resourcePersistencePath:persist,isolatedResourcePersistencePath:path.join(persist,'isolated')});
 let mf=make(),db=await mf.getD1Database('DB');const admin={sys:true,ten:'Local synthetic admin'},batchId='LOCAL-CATALOG-TEST-001';
 const base=()=>({id:ASSET_TARGET.slice(5),name:'KSB · DEV synthetic data',source:'manual',ver:9,data:{NV:[{'Mã NV':'FAKE-ONLY'}],HD:[{id:'FAKE-HD'}],CC:[{hours:8}],LG:[{salary:12345}]},ts:{v:2,ds:[],pg:[],nhom:['Existing'],so:{giao:7,thu:8},electronicSetting:30}});
 const child=()=>({id:'synthetic-child',name:'DEV company only',source:'manual',ver:2,data:{NV:[]},ts:{ds:[],pg:[]}});
 async function put(k,u,ver){const v=await encodeUnit(u);await db.batch([db.prepare('DELETE FROM qt_part WHERE k=?').bind(k),db.prepare('INSERT INTO qt_part(k,i,v)VALUES(?,0,?)').bind(k,v),db.prepare('INSERT OR REPLACE INTO qt_kv(k,ver,n,z,size,at,nguoi)VALUES(?,?,1,1,?,0,?)').bind(k,ver,v.length,'synthetic')]);}
 async function reset(){await db.exec('DELETE FROM qt_part; DELETE FROM qt_kv;');await put(ASSET_TARGET,base(),10);await put('unit:synthetic-child',child(),2);}
 async function unit(){return(await catalogSnapshot(db)).entries.find(e=>e.meta.k===ASSET_TARGET).unit;}
 const input=(action='preview',extra={})=>({target:ASSET_TARGET,batchId,assets,action,...extra});
 async function preview(){return assetCatalogAPI(db,admin,input());}
 async function apply(p,api=db){return assetCatalogAPI(api,admin,input('apply',{planId:p.planId,confirm:'APPLY_APPROVED_82_ASSETS'}));}
 await db.exec('CREATE TABLE qt_kv(k TEXT PRIMARY KEY,ver INTEGER NOT NULL,at INTEGER,nguoi TEXT,n INTEGER,z INTEGER DEFAULT 0,meta TEXT,size INTEGER); CREATE TABLE qt_part(k TEXT NOT NULL,i INTEGER NOT NULL,v TEXT,PRIMARY KEY(k,i));');
 try{
 await t.test('authorization, target, source digest and confirmation gates',async()=>{
  await assert.rejects(assetCatalogAPI({}, {sys:false},input()),e=>e.status===403);
  await assert.rejects(assetCatalogAPI({},admin,input('preview',{target:'unit:synthetic-child'})),e=>e.status===400);
  await reset();const bad=structuredClone(assets);bad[0].ten+=' edited';await assert.rejects(assetCatalogAPI(db,admin,input('preview',{assets:bad})),/khác bản/);
  const p=await preview();await assert.rejects(assetCatalogAPI(db,admin,input('apply',{planId:p.planId})),/xác nhận/);assert.equal((await unit()).ts.ds.length,0);
 });
 await t.test('preview is read-only; applies 82 only in KSB and preserves all other business data',async()=>{
  await reset();const before=await catalogSnapshot(db),p=await preview();assert.equal(p.add,82);assert.equal(p.written,false);assert.equal((await catalogSnapshot(db)).token,before.token);
  const r=await apply(p);assert.equal(r.written,true);const u=await unit();assert.equal(u.ts.ds.length,82);assert.deepEqual(u.data,base().data);assert.equal(u.source,base().source);assert.equal(u.name,base().name);assert.deepEqual(u.ts.pg,[]);assert.deepEqual(u.ts.so,base().ts.so);assert.equal(u.ts.electronicSetting,30);
  assert.equal(u.ts.ds.filter(x=>x.qltsImport.status==='Đang sử dụng').length,56);assert.equal(u.ts.ds.filter(x=>x.qltsImport.status==='Trong kho').length,26);assert.ok(u.ts.ds.every(x=>x.legalOwner===''&&x.phongBan===''&&x.giu===''&&x.tt==='Chờ đối chiếu'&&x.ls.length===0&&x.qltsImport.managementUnit===ASSET_TARGET));
  const after=await catalogSnapshot(db);assert.deepEqual(after.entries.find(x=>x.meta.k==='unit:synthetic-child'),before.entries.find(x=>x.meta.k==='unit:synthetic-child'));
 });
 await t.test('restarting local D1 retains 82; rerun adds zero without metadata writes',async()=>{
  await mf.dispose();mf=make();db=await mf.getD1Database('DB');assert.equal((await unit()).ts.ds.length,82);const before=await catalogSnapshot(db),p=await preview();assert.equal(p.add,0);assert.equal(p.existing,82);assert.equal((await apply(p)).written,false);assert.equal((await catalogSnapshot(db)).token,before.token);
 });
 await t.test('duplicate code in child blocks entire import; electronic assets retained',async()=>{
  await reset();const c=child();c.ts.ds=[{id:'synthetic-electronic',ma:assets[0].ma,loai:'dt',phi:100,gh:'2030-01-01'}];await put('unit:synthetic-child',c,3);const before=await catalogSnapshot(db),p=await preview();assert.equal(p.conflicts.length,1);await assert.rejects(apply(p),/mã tài sản/);assert.equal((await catalogSnapshot(db)).token,before.token);
 });
 await t.test('changed preview and cross-company race reject stale writes',async()=>{
  await reset();const p=await preview();await put('unit:synthetic-child',child(),3);await assert.rejects(apply(p),/preview/);assert.equal((await unit()).ts.ds.length,0);
  const fresh=await preview();let raced=false;const race={prepare:(...a)=>db.prepare(...a),batch:async st=>{if(st[0].toString&&st.length>=3&&!raced){raced=true;await put('unit:synthetic-child',child(),4);}return db.batch(st);}};
  await assert.rejects(apply(fresh,race),/vừa thay đổi/);assert.equal((await unit()).ts.ds.length,0);
 });
 await t.test('an error in the write batch rolls back metadata and parts',async()=>{
  await reset();const p=await preview(),before=await catalogSnapshot(db);const broken={prepare:(...a)=>db.prepare(...a),batch:st=>db.batch(st.length>=3?[...st,db.prepare('INSERT INTO missing_synthetic_table VALUES(1)')]:st)};await assert.rejects(apply(p,broken));assert.equal((await catalogSnapshot(db)).token,before.token);
 });
 await t.test('targeted undo keeps later synthetic payroll changes and preexisting electronics',async()=>{
  await reset();let u=base();u.ts.ds=[{id:'old',ma:'PM-SYNTHETIC',loai:'dt',phi:123,gh:'2031-01-01'}];await put(ASSET_TARGET,u,10);await apply(await preview());u=await unit();u.data.LG[0].salary=54321;await put(ASSET_TARGET,u,12);
  const p=await assetCatalogAPI(db,admin,input('preview-undo'));assert.equal(p.remove,82);await assetCatalogAPI(db,admin,input('undo',{planId:p.planId,confirm:'UNDO_APPROVED_ASSET_BATCH'}));u=await unit();assert.equal(u.ts.ds.length,1);assert.equal(u.ts.ds[0].ma,'PM-SYNTHETIC');assert.equal(u.data.LG[0].salary,54321);assert.equal((await assetCatalogAPI(db,admin,input('preview-undo'))).remove,0);
 });
 await t.test('edited imported records or later handover references prevent undo',async()=>{
  await reset();await apply(await preview());let u=await unit();u.ts.ds[0].ghi+=' synthetic edit';await put(ASSET_TARGET,u,12);await assert.rejects(assetCatalogAPI(db,admin,input('preview-undo')),/đã thay đổi/);
  await reset();await apply(await preview());u=await unit();u.ts.pg.push({so:'SYNTHETIC',ds:[{id:u.ts.ds[0].id}]});await put(ASSET_TARGET,u,12);await assert.rejects(assetCatalogAPI(db,admin,input('preview-undo')),/đã có phiếu/);
 });
 }finally{await mf.dispose();fs.rmSync(persist,{recursive:true,force:true});}
});
