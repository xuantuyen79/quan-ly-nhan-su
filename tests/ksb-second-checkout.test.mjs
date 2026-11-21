import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
import {gpsVerify,gpsAllowed,distanceMeters} from '../src/ksb-gps.js';
const req=createRequire(import.meta.url),runtime=createRequire(req.resolve('wrangler/package.json')),{Miniflare,convertV4MiniflareOptions}=runtime('miniflare'),{build}=runtime('esbuild');
const bundle=await build({entryPoints:[resolve(import.meta.dirname,'../src/worker.js')],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.html':'text'}}),migration=await readFile(new URL('../migrations/20261120_gps_attendance.sql',import.meta.url),'utf8');
const gpsDay=t=>new Date(t+7*3600000).toISOString().slice(0,10);
const sha=s=>createHash('sha256').update(s).digest('hex');
async function fixture(t,{migrate=true}={}){const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-09-01',d1Databases:{DB:'gps-fake-only'}}));t.after(()=>mf.dispose());await mf.dispatchFetch('https://local.test/api/qt/toi');const db=await mf.getD1Database('DB'),now=Date.now(),today=gpsDay(now);for(const ma of ['A','B'])await db.prepare('INSERT INTO nv(ma,ten,active,pin,salt,cty) VALUES (?,?,1,?,?,?)').bind(ma,'Synthetic '+ma,'synthetic-pin-hash','synthetic-salt','Company A').run();for(const [token,vai,ma] of [['admin','qt',null],['ql','ql',null],['a','nv','A'],['b','nv','B']])await db.prepare('INSERT INTO phien(tok,vai,ma,created,last) VALUES (?,?,?,?,?)').bind(sha(token),vai,ma,now,now).run();await db.batch([db.prepare("INSERT INTO cfg(k,v) VALUES ('che_do','wifi_hoac_qr') ON CONFLICT(k) DO UPDATE SET v=excluded.v"),db.prepare("INSERT INTO cfg(k,v) VALUES ('ql_pin','fake-setup-only') ON CONFLICT(k) DO NOTHING"),db.prepare("INSERT INTO cfg(k,v) VALUES ('qr_secret','synthetic-qr-secret') ON CONFLICT(k) DO UPDATE SET v=excluded.v"),db.prepare("INSERT INTO ip_vp(ip,nguon,first,last) VALUES ('203.0.113.42','tay',?,?)").bind(now,now)]);
 const call=(path,body,who='a',ip='198.51.100.20')=>mf.dispatchFetch('https://local.test'+path,{method:body===undefined?'GET':'POST',headers:{cookie:who==='admin'?'qtt_qt=admin':who==='ql'?'qtt_ql=ql':who?'qtt_nv='+who:'','cf-connecting-ip':ip,'content-type':'application/json',...(path.startsWith('/api/sync/')?{authorization:'Bearer phien'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function apply(){const sql=migration.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);await db.batch(sql.map(s=>db.prepare(s)));}
 if(migrate)await apply();
 async function location(code,lat=10,lon=106){const r=await call('/api/gps/location',{code,name:'Synthetic '+code,company:'Company A',latitude:lat,longitude:lon,radius:200,active:true},'admin');assert.equal(r.status,200);return (await r.json()).id;}
 async function enable(){assert.equal((await call('/api/gps/config',{enabled:true},'admin')).status,200);}
 return {mf,db,call,now,today,apply,location,enable,gps:(id,loai='vao',extra={})=>call('/api/cham',{cach:'gps',loai,location_id:id,latitude:10,longitude:106,accuracy:25,...extra})};}

for (const methods of [['wifi','wifi','wifi'],['wifi','wifi','gps'],['gps','gps','wifi'],['gps','gps','gps']]) test('second OUT shares daily history: '+methods.join(' → '),async t=>{
 const f=await fixture(t);await f.location('A');await f.location('B',10.001,106);await f.enable();
 const seed=async(kind,method,time)=>f.db.prepare('INSERT INTO cham(ma,t,loai,cach) VALUES (?,?,?,?)').bind('A',time,kind,method).run();
 await seed('vao',methods[0],f.now-3600000);await seed('ra',methods[1],f.now-600000);
 const body={loai:'ra',ra_sau:f.now-600000,...(methods[2]==='gps'?{cach:'gps',latitude:10.001,longitude:106,accuracy:25}:{})};
 const r=await f.call('/api/cham',body,'a',methods[2]==='wifi'?'203.0.113.42':'198.51.100.20');assert.equal(r.status,200);assert.equal((await r.json()).trung,undefined);
 const rows=(await f.db.prepare('SELECT * FROM cham ORDER BY t').all()).results;assert.deepEqual(rows.map(r=>r.loai),['vao','ra','ra']);assert.equal(rows[2].cach,methods[2]);assert.ok(rows[2].t>rows[1].t);
 const third=await f.call('/api/cham',body,'a','203.0.113.42');assert.equal(third.status,409);assert.match((await third.json()).loi,/tối đa 2/);
 const st=await(await f.call('/api/trang-thai')).json();assert.equal(st.thang.length,3);
 const admin=await(await f.call('/api/ql/tong-quan',undefined,'ql')).json();assert.ok(JSON.stringify(admin).includes('A'));
});
test('explicit supplementation within duplicate window is atomic across concurrent requests and methods',async t=>{
 const f=await fixture(t);await f.location('A');await f.enable();await f.call('/api/cham',{loai:'vao'},'a','203.0.113.42');
 const first=await(await f.gps(null,'ra')).json();assert.equal(first.ok,true);
 const results=await Promise.all(Array.from({length:12},(_,i)=>i%2?f.gps(null,'ra',{ra_sau:first.t}):f.call('/api/cham',{loai:'ra',ra_sau:first.t},'a','203.0.113.42')));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal((await f.db.prepare("SELECT count(*) n FROM cham WHERE loai='ra'").first()).n,2);
});
test('cancelled OUT does not consume allowance; manager corrections and Wi-Fi overnight rule remain unchanged',async t=>{
 const f=await fixture(t);await f.location('A');await f.enable();const start=Date.parse(f.today+'T00:00:00+07:00');
 await f.db.prepare("INSERT INTO cham(ma,t,loai,cach) VALUES ('A',?,'vao','wifi')").bind(start-3600000).run();
 const overnightOut=await(await f.call('/api/cham',{loai:'ra'},'a','203.0.113.42')).json();assert.equal(overnightOut.ok,true);
 assert.equal((await f.call('/api/cham',{loai:'ra',ra_sau:overnightOut.t},'a','203.0.113.42')).status,200);
 await f.db.prepare("UPDATE cham SET huy=1 WHERE loai='ra'").run();
 await f.db.prepare("INSERT INTO cham(ma,t,loai,cach) VALUES ('A',?,'vao','tay')").bind(f.now-3600000).run();
 assert.equal((await f.gps(null,'ra')).status,200);
});
