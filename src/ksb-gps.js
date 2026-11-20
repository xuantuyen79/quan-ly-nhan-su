// GPS extends existing punches. Never creates personnel, changes roles or tracks a route.
export const GPS_MAX_ACCURACY = 200;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const str=(v,n=120)=>typeof v==='string'?v.trim().slice(0,n):'';
const coordinate=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function distanceMeters(a,b,c,d){const rad=x=>x*Math.PI/180,p=(c-a)*Math.PI/180,q=(d-b)*Math.PI/180,h=Math.sin(p/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(q/2)**2;return 6371000*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));}
export async function gpsReady(db){const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gps_locations'").all()).results;if(tables.length!==1)return false;const cols=(await db.prepare('PRAGMA table_info(cham)').all()).results.map(x=>x.name);return ['gps_location_id','gps_location_label','gps_distance','gps_accuracy'].every(x=>cols.includes(x));}
export async function gpsAllowed(db,cfg){return {enabled:cfg.gps_on==='1'&&await gpsReady(db),max_accuracy:GPS_MAX_ACCURACY};}
export async function gpsVerify(db,cfg,_ma,body,_now){
 if(cfg.gps_on!=='1')fail('Chấm công GPS chưa được bật.',403);
 if(!await gpsReady(db))fail('Chưa áp dụng migration GPS đã được duyệt.',503);
 if(!coordinate(body.latitude,-90,90)||!coordinate(body.longitude,-180,180))fail('Không thể xác định vị trí. Vui lòng thử lại.');
 if(typeof body.accuracy!=='number'||!Number.isFinite(body.accuracy)||body.accuracy<=0||body.accuracy>GPS_MAX_ACCURACY)fail('Chưa xác định được vị trí đủ chính xác. Vui lòng thử lại ở khu vực thông thoáng.');
 // Company/department and client-supplied location IDs never restrict or select the match.
 const locations=(await db.prepare('SELECT id,code,name,latitude,longitude,radius FROM gps_locations WHERE active=1 ORDER BY code,id').all()).results;
 let best=null;
 for(const location of locations){const distance=distanceMeters(body.latitude,body.longitude,location.latitude,location.longitude);if(distance<=location.radius&&(!best||distance<best.distance))best={location,distance};}
 if(!best)fail('Bạn đang ở ngoài khu vực được phép chấm công.',403);
 return {location_id:best.location.id,label:best.location.code+' · '+best.location.name,distance:Math.round(best.distance*100)/100,accuracy:body.accuracy};
}
export async function gpsAdmin(db,cfg,action,method,body,now){
 const ready=await gpsReady(db);
 if(method==='GET'&&action==='admin')return {ok:true,ready,enabled:ready&&cfg.gps_on==='1',max_accuracy:GPS_MAX_ACCURACY,locations:ready?(await db.prepare('SELECT * FROM gps_locations ORDER BY company,name,code').all()).results:[]};
 if(method!=='POST')fail('Không có API GPS này.',404);
 if(!ready)fail('Chưa áp dụng migration GPS đã được duyệt.',503);
 if(action==='config'){if(typeof body.enabled!=='boolean')fail('Trạng thái GPS không hợp lệ.');await db.prepare("INSERT INTO cfg(k,v) VALUES ('gps_on',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(body.enabled?'1':'0').run();return {ok:true};}
 if(action==='location'){
  const id=str(body.id,80)||crypto.randomUUID(),code=str(body.code,30).toUpperCase(),name=str(body.name),company=str(body.company),radius=body.radius===undefined?200:body.radius;
  if(!/^[A-Z0-9_-]{1,30}$/.test(code)||!name||!company)fail('Nhập mã, tên và công ty/đơn vị quản lý địa điểm.');
  if(!coordinate(body.latitude,-90,90)||!coordinate(body.longitude,-180,180))fail('Tọa độ địa điểm không hợp lệ.');
  if(typeof radius!=='number'||!Number.isFinite(radius)||radius<=0||radius>100000)fail('Bán kính phải lớn hơn 0 và không quá 100.000 mét.');
  if(typeof body.active!=='boolean')fail('Trạng thái địa điểm không hợp lệ.');
  const same=await db.prepare('SELECT id FROM gps_locations WHERE code=? AND id<>?').bind(code,id).first();if(same)fail('Mã địa điểm đã được sử dụng.',409);
  await db.prepare('INSERT INTO gps_locations(id,code,name,company,latitude,longitude,radius,active,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,company=excluded.company,latitude=excluded.latitude,longitude=excluded.longitude,radius=excluded.radius,active=excluded.active,updated=excluded.updated').bind(id,code,name,company,body.latitude,body.longitude,radius,body.active?1:0,now,now).run();return {ok:true,id};
 }
 fail('Không có API GPS này.',404);
}
