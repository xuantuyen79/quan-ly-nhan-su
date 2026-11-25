import {test} from 'node:test';import assert from 'node:assert/strict';import {fixture,html} from './helpers/attendance-pagination-fixture.mjs';
const gridIds=h=>[...h.matchAll(/class="bc-nm"><b><a data-person="([^"]+)"/g)].map(m=>m[1]);
test('grid has 10/20/30/50/100 rows, keeps all days/order and every employee across pages (325/500)',()=>{
 for(const n of [325,500])for(const size of [10,20,30,50,100]){const {c}=fixture(n),rows=c.bcRows();c.TB['bc-grid']={pageSize:size};let all=[];for(let p=1;p<=Math.ceil(n/size);p++){c.TB['bc-grid'].page=p;if(p===1)c.bcGrid(rows);c.TB['bc-grid'].page=p;const h=c.bcGrid(rows);all.push(...gridIds(h));assert.equal((h.match(/class="bc-d /g)||[]).length,30);assert.match(h,/Giờ vào/);assert.match(h,/Giờ ra/);}assert.deepEqual(all,Array.from(rows,x=>x.p.id));assert.equal(new Set(all).size,n);}
});
test('all attendance tab tables opt into pagination with independent state and complete exports',()=>{
 const {c}=fixture(325),rows=c.bcRows();const cases=[['sum',()=>c.bcSum(rows),['bc-s']],['production',()=>c.bcSumSx(rows.filter(x=>x.p.exc.sch)),['bc-ssx']],['late',()=>c.bcLate(rows),['bc-lt1','bc-lt2']],['ot',()=>c.bcOt(rows),['bc-ot']],['issue',()=>c.bcIssue(rows),['bc-is']],['log',()=>c.bcLog(),['bc-lg']],['xm',()=>c.bcXm(),['bc-xm-pb','bc-xm-tthang']]];
 for(const [view,run,ids]of cases){c.PS.bc.view=view;let h=run();for(const id of ids){assert.match(h,new RegExp('id="ccPageSize-'+id+'"'));assert.equal(c.TB[id].pageSize,20);const total=c.TB[id].cur.list.length;assert.ok(total>0);if(total>20){c.TB[id].page=2;h=run();assert.equal(c.TB[id].page,2);}let exp;c.exportRows=(...a)=>exp=a;c.ACTS['tb-export'](null,id);assert.equal(exp[2].length,total);assert.equal(c.TB[id].cur.list.length,total);}}
 c.PS.bc.xp='ngay';c.PS.bc.xd='2026-11-01';c.PS.bc.xg='nv';assert.match(c.bcXm(),/ccPageSize-bc-xm-d/);c.PS.bc.xp='nam';assert.match(c.bcXm(),/ccPageSize-bc-xm-tnam/);
});
test('filters reset last pages, sorting uses full rows, employee/day totals and Excel remain complete',()=>{
 const {c}=fixture(160);let rows=c.bcRows();const before=JSON.stringify(rows.map(x=>x.p.sum));c.bcGrid(rows);c.TB['bc-grid'].page=8;c.bcGrid(rows);let exp;c.exportRows=(...args)=>exp=args;c.ACTS['bc-export']();assert.equal(exp[2].length,160);assert.equal(exp[1].filter(col=>col.t.includes('Giờ vào')).length,30);assert.equal(exp[1].find(col=>col.t==='Giờ ra').f(rows[0]),'19:15');assert.equal(JSON.stringify(rows.map(x=>x.p.sum)),before);
 for(const [key,value]of [['q','0001'],['dept','Kỹ thuật'],['u','u2'],['m','2026-12'],['k','sx']]){c.PS.bc.q='';c.PS.bc.dept='';c.PS.bc.m='2026-11';c.bcGrid(c.bcRows());c.TB['bc-grid'].page=5;c.PS.bc[key]=value;c.bcGrid(c.bcRows());assert.equal(c.TB['bc-grid'].page,1);}
 c.PS.bc={m:'2026-11',u:'u1',k:'all',q:'',dept:'',view:'sum'};c.bcSum(c.bcRows());c.TB['bc-s'].sort={i:0,dir:-1};c.bcSum(c.bcRows());assert.equal(c.TB['bc-s'].cur.list[0].p.id,'KSB0160');
 c.PS.bc.dept='Kỹ thuật';c.PS.bc.q='0002';c.bcLog();assert.equal(c.TB['bc-lg'].cur.list.length,1);assert.equal(c.TB['bc-lg'].cur.list[0].l.id,'KSB0002');assert.equal(c.TB['bc-lg'].cur.list[0].u.id,'u1');
});
test('one-page/empty lists hide navigation; split grids have unique control IDs; employee behavior unchanged',()=>{
 const {c}=fixture(21);for(const count of [0,1,20]){const h=c.bcGrid(c.bcRows().slice(0,count));assert.doesNotMatch(h,/class="nv-page-nav"/);assert.match(h,new RegExp(' / '+count+' nhân viên'));}
 c.BC_SFX='';const a=c.bcGrid(c.bcRows());c.BC_SFX='-sx';const b=c.bcGrid(c.bcRows());assert.match(a,/id="ccPageSize-bc-grid"/);assert.match(b,/id="ccPageSize-bc-grid-sx"/);assert.equal(c.TB['bc-grid'].page,1);assert.equal(c.TB['bc-grid-sx'].page,1);
 assert.match(html,/ccwifi: \['Bảng Chấm công'/);assert.match(html,/id: 'ccwifi', g: 'tg', t: 'Bảng Chấm công'/);assert.match(html,/pageHead\('Bảng Chấm công'/);assert.match(html,/wifi: 'Wi‑Fi'/);
});
