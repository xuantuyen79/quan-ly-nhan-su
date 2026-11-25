import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {prepareCatalog,FIELD_MAP} from '../tools/qlts-catalog-import.mjs';
const fixture=()=>({id:'dev',source:'qlts-catalog-dev',data:{NV:[{'Mã NV':'TEST-ONLY'}]},ts:{ds:[],pg:[],so:{giao:7,thu:9}}});
const input={sourceId:'test',sheet:'Tài sản',sha256:'test',rows:[{row:2,fields:{'Mã tài sản':'TS-00001','Tên tài sản':'Thiết bị thử','Số serial':'000123','Nguyên giá':1234567.89,'Ngày mua':'2024-02-29T00:00:00','Tình trạng':'Đang sử dụng','Ghi chú':'Ghi chú dài '.repeat(35)}}]};
test('only catalog fields; decimal money, serial, notes and leap date retained; no people/history/counters touched',()=>{
 const u=fixture(),before=structuredClone(u);const r=prepareCatalog(input,[u],'dev');assert.deepEqual(u,before);
 const x=r.added[0];assert.equal(x.serial,'000123');assert.equal(x.gia,1234567.89);assert.equal(x.ngay,'2024-02-29');assert.equal(x.ghi,input.rows[0].fields['Ghi chú']);
 assert.equal(x.tt,'Chờ đối chiếu');assert.equal(x.pct,null);assert.equal(x.giu,'');assert.deepEqual(x.ls,[]);assert.equal(x.qltsImport.companyConfirmed,false);
 assert.deepEqual(r.units[0].data,before.data);assert.deepEqual(r.units[0].ts.pg,before.ts.pg);assert.deepEqual(r.units[0].ts.so,before.ts.so);
});
test('re-run is idempotent; duplicate in another company or unsynced unit is never overwritten',()=>{
 const r=prepareCatalog(input,[fixture()],'dev');assert.equal(prepareCatalog(input,r.units,'dev').added.length,0);
 const other={id:'other',ts:{ds:[{ma:'TS-00001',ten:'Existing',loai:'dt'}]}};
 const j=prepareCatalog(input,[fixture(),other],'dev');assert.equal(j.added.length,0);assert.equal(j.existing.length,1);assert.deepEqual(j.units[1],other);
});
test('Production and unrecognized employee/history fields are rejected',()=>{
 assert.throws(()=>prepareCatalog(input,[{...fixture(),source:'production'}],'dev'),/DEV/);
 const bad=structuredClone(input);bad.rows[0].fields['Người sử dụng (mã NV)']='KSB0001';assert.throws(()=>prepareCatalog(bad,[fixture()],'dev'),/chưa ánh xạ/);
 const twice=structuredClone(input);twice.rows.push(twice.rows[0]);assert.throws(()=>prepareCatalog(twice,[fixture()],'dev'),/Trùng mã/);
});
const html=readFileSync(new URL('../src/phan-mem.html',import.meta.url),'utf8');
test('pending assets are not available for allocation or valued by inference; existing electronics remain available',()=>{
 const ctx=vm.createContext({});for(const name of ['tsPctDef','tsGt','tsFree']){const start=html.indexOf('  function '+name+'(');const end=html.indexOf('\n  ',start+3);vm.runInContext(html.slice(start,end),ctx);}
 vm.runInContext("var TS_PCT={'Sử dụng tốt':100,'Hỏng cần sửa':50}",ctx);
 assert.equal(ctx.tsFree({tt:'Chờ đối chiếu',loai:'vl',giu:''}),false);assert.equal(ctx.tsGt({tt:'Chờ đối chiếu',pct:null,gia:100000}),null);
 assert.equal(ctx.tsFree({tt:'Sử dụng tốt',loai:'vl',giu:''}),true);assert.equal(ctx.tsFree({tt:'Đang dùng',loai:'dt',giu:''}),true);assert.equal(ctx.tsGt({tt:'Sử dụng tốt',loai:'vl',gia:1000,pct:80}),800);
});
test('82-row reconciliation against fresh source (optional local fixture)',{skip:!process.env.KSB_QLTS_SOURCE},()=>{
 const src=JSON.parse(readFileSync(process.env.KSB_QLTS_SOURCE));const r=prepareCatalog(src,[fixture()],'dev');assert.equal(r.added.length,82);assert.equal(new Set(r.added.map(x=>x.ma)).size,82);
 for(let i=0;i<src.rows.length;i++){const f=src.rows[i].fields,x=r.added[i];for(const [key,dest]of Object.entries(FIELD_MAP)){let expected=f[key]??'';if(['gia','khNam'].includes(dest)){if(expected==='')expected=null;}else if(['ngay','baoHanh','baoTri'].includes(dest))expected=String(expected).slice(0,10);else expected=String(expected);assert.equal(x[dest],expected,`${x.ma}: ${key}`);}assert.equal(x.giu,'');assert.equal(x.tt,'Chờ đối chiếu');assert.equal(x.qltsImport.status,f['Tình trạng']);assert.equal(x.qltsImport.companyConfirmed,false);assert.equal(Object.hasOwn(x,'pb'),false);}
 assert.equal(r.units[0].ts.pg.length,0);assert.equal(prepareCatalog(src,r.units,'dev').added.length,0);
 const reloaded=JSON.parse(JSON.stringify(r.units));assert.deepEqual(reloaded,r.units);
 assert.equal(reloaded[0].ts.ds.length,82);assert.equal(prepareCatalog(src,reloaded,'dev').added.length,0);
 assert.equal(reloaded[0].ts.ds.filter(x=>x.qltsImport.status==='Đang sử dụng').length,56);
 assert.equal(reloaded[0].ts.ds.filter(x=>x.qltsImport.status==='Trong kho').length,26);
});
