import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../src/phan-mem.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('  var TB = {};'),html.indexOf('  function exportValue('));
function fixture(){let exported;const ctx=vm.createContext({ACTS:{},document:{addEventListener(){}},S:{showSens:true},fmtInt:String,esc:x=>String(x??''),ic:()=>'',cellText:(_c,r)=>r.id,exportRows:(...a)=>{exported=a;}});vm.runInContext(code,ctx);return {ctx,get exported(){return exported;}};}
const rows=n=>Array.from({length:n},(_,i)=>({id:i+1}));
const cols=[{t:'ID',f:r=>r.id,h:r=>'ROW_'+r.id}];
function ids(h){return [...h.matchAll(/<td[^>]*>ROW_(\d+)<\/td>/g)].map(x=>+x[1]);}
test('default 20 and all five page sizes preserve every record for 325 and 500 employees',()=>{
 for(const total of [325,500])for(const pageSize of [10,20,30,50,100]){const {ctx:c}=fixture();c.TB.nv2={pageSize};let h=c.table('nv2',cols,rows(total),{nvPagination:true,nvFilterKey:'all'});const all=ids(h);const pages=Math.ceil(total/pageSize);for(let p=2;p<=pages;p++){c.TB.nv2.page=p;all.push(...ids(c.table('nv2',cols,rows(total),{nvPagination:true,nvFilterKey:'all'})));}assert.deepEqual(all,rows(total).map(r=>r.id));assert.equal(new Set(all).size,total);assert.equal(c.TB.nv2.cur.list.length,total);}
 const {ctx:c}=fixture();assert.equal(ids(c.table('nv2',cols,rows(325),{nvPagination:true})).length,20);
});
test('search/filter changes reset the last page, including equally sized result sets',()=>{const {ctx:c}=fixture();c.table('nv2',cols,rows(325),{nvPagination:true,nvFilterKey:'all'});c.TB.nv2.page=17;c.table('nv2',cols,rows(325),{nvPagination:true,nvFilterKey:'department-A'});assert.equal(c.TB.nv2.page,1);c.TB.nv2.page=17;const h=c.table('nv2',cols,[{id:325}],{nvPagination:true,nvFilterKey:'search-325'});assert.deepEqual(ids(h),[325]);assert.equal(c.TB.nv2.page,1);});
test('paging follows the complete existing sort and export retains every filtered row',()=>{const f=fixture(),c=f.ctx;c.TB.nv2={sort:{i:0,dir:-1}};let h=c.table('nv2',cols,rows(325),{nvPagination:true,nvFilterKey:'all'});assert.deepEqual(ids(h),rows(20).map((_,i)=>325-i));c.TB.nv2.page=2;h=c.table('nv2',cols,rows(325),{nvPagination:true,nvFilterKey:'all'});assert.deepEqual(ids(h),rows(20).map((_,i)=>305-i));c.ACTS['tb-export'](null,'nv2');assert.equal(f.exported[2].length,325);assert.equal(f.exported[2][0].id,325);});
test('single page and empty results hide navigation; shrinking data clamps the page',()=>{const {ctx:c}=fixture();for(const n of [0,1,20]){let h=c.table('nv2',cols,rows(n),{nvPagination:true,nvFilterKey:'same'});assert.doesNotMatch(h,/<nav class="nv-page-nav"/);assert.match(h,new RegExp('Hiển thị '+(n?1:0)+'–'+n+' / '+n+' nhân viên'));}c.table('nv2',cols,rows(325),{nvPagination:true,nvFilterKey:'same'});c.TB.nv2.page=17;c.table('nv2',cols,rows(21),{nvPagination:true,nvFilterKey:'same'});assert.equal(c.TB.nv2.page,2);});
test('page-number windows include first, last and current without duplicates',()=>{const {ctx:c}=fixture();assert.deepEqual(Array.from(c.nvPageNumbers(1,17)),[1,2,3,4,5,'…',17]);for(let p=1;p<=50;p++){const a=Array.from(c.nvPageNumbers(p,50)),n=a.filter(x=>typeof x==='number');assert.equal(new Set(n).size,n.length);assert.ok(n.includes(1)&&n.includes(p)&&n.includes(50));assert.ok(a.length<=9);}});
test('shared tables now use 20-row pagination while preserving all rows for export',()=>{const {ctx:c}=fixture(),h=c.table('contracts',cols,rows(325),{});assert.equal(ids(h).length,20);assert.doesNotMatch(h,/data-act="tb-more"/);assert.match(h,/ccPageSize-contracts|nv-page-nav/);assert.equal(c.TB.contracts.cur.list.length,325);});
