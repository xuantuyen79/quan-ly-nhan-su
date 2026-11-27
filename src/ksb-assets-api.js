import {catalogSnapshot,decodeUnit,writeAtomic,canonical,digest} from './ksb-asset-import.js';
import {runAssetAction} from './ksb-assets-engine.js';
function fail(msg,status=409){throw Object.assign(new Error(msg),{status});}
export async function authorizeAssetWriter(db,user,unitId){
 if(!user)fail('Chưa đăng nhập',401);
 if(!/^[A-Za-z0-9._-]{1,80}$/.test(unitId||''))fail('Đơn vị không hợp lệ',400);
 if(!user.sys){
  const m=await db.prepare("SELECT * FROM qt_kv WHERE k='settings'").first();if(!m)fail('Không có quyền tài sản',403);
  const chunks=await db.prepare("SELECT v FROM qt_part WHERE k='settings' ORDER BY i").all();
  const settings=await decodeUnit(chunks.results.map(x=>x.v).join(''),m.z),pq=settings.pq;
  const person=pq?.users?.find(x=>x.nv===user.ma&&!x.off),role=pq?.roles?.find(x=>x.id===person?.role);
  if(!pq?.on||!person||!(role?.sys||role?.q?.taisan==='s')||person.pb?.length||person.dv&&person.dv!=='all'&&!(Array.isArray(person.dv)?person.dv.some(d=>(typeof d==='string'?d:d?.id)===unitId):person.dv===unitId))fail('Không có quyền sửa tài sản trong đơn vị này',403);
 }
}
export async function assetsTransactionAPI(db,user,body,context={}){
 await authorizeAssetWriter(db,user,body.unit);
 if(!/^[A-Za-z0-9._-]{12,100}$/.test(body.requestId||''))fail('Thiếu mã giao dịch',400);
 if(body.action==='saveSourceSettings'&&body.payload?.tuLuuPdf&&context.pdfConfigured===false)fail('Chưa cấu hình bộ sinh PDF máy chủ Cloudflare',400);
 if(body.action==='queueTestMail'&&context.mailConfigured===false)fail('Chưa thiết lập email QLNS. Vào Cài đặt → Gửi email tự động.',400);
 const snapshot=await catalogSnapshot(db),entry=snapshot.entries.find(x=>x.meta.k==='unit:'+body.unit);
 if(!entry)fail('Không tìm thấy công ty',404);
 const requestHash=await digest({action:body.action,payload:body.payload});
 const seen=entry.unit.ts?.ksb?.requests?.find(x=>x.id===body.requestId);
 if(seen?.hash&&seen.hash!==requestHash)fail('Mã lượt ghi đã dùng với nội dung khác. Đối chiếu dữ liệu rồi mở thao tác mới.');
 if(seen)return {ok:true,duplicate:true,ts:entry.unit.ts,unitVersion:entry.unit.ver,version:entry.meta.ver,result:seen.result};
 if(entry.meta.ver!==body.version)fail('Dữ liệu vừa thay đổi. Tải lại trước khi ghi, không tự ghi đè.');
 if(body.action==='attachDocument') {
  const file=body.payload?.file;if(!/^f[A-Za-z0-9._-]{6,100}$/.test(file||''))fail('File không hợp lệ',400);
  const record=await db.prepare('SELECT meta FROM qt_kv WHERE k=?').bind('kho:'+file).first();let meta;try{meta=JSON.parse(record?.meta||'null');}catch{}
  if(!meta||meta.u!==body.unit||meta.kho!=='ts'||meta.ref!==body.payload.key)fail('Tệp chưa được lưu đúng đơn vị và biên bản',400);
 }
 const images=body.action==='catalogSave'?(body.payload?.rows||[]).map(r=>r.anhNguon):body.action==='sourceImportAssets'?[...(body.payload?.rows||[]).map(r=>r.anh),body.payload?.opt?.anhLo]:[];
 for(const image of images)if(String(image||'').startsWith('kho:')){const file=String(image).slice(4);if(!/^f[A-Za-z0-9._-]{6,100}$/.test(file))fail('Ảnh không hợp lệ',400);const record=await db.prepare('SELECT meta FROM qt_kv WHERE k=?').bind('kho:'+file).first();let meta;try{meta=JSON.parse(record?.meta||'null');}catch{}if(!meta||meta.u!==body.unit||meta.kho!=='ts'||meta.ref!=='asset-photo')fail('Ảnh không thuộc kho tài sản của đơn vị',400);}
 if(body.action==='sourceImportAssets')for(const row of body.payload?.rows||[]){if(snapshot.entries.some(e=>e.meta.k!==entry.meta.k&&(e.unit.ts?.ds||[]).some(x=>x.ma===row.ma)))fail('Mã tài sản '+row.ma+' đã thuộc đơn vị khác',409);}
 if(body.action==='catalogSave')for(const v of body.payload?.rows||[]){const matches=snapshot.entries.flatMap(e=>(e.unit.ts?.ds||[]).filter(x=>x.ma===v.ma||v.id&&x.id===v.id).map(x=>({key:e.meta.k,x})));const creating=v.create===undefined?!!body.payload.create:!!v.create;if(creating&&matches.length||!creating&&(matches.length!==1||matches[0].key!==entry.meta.k))fail('Mã tài sản trùng hoặc không thuộc đúng đơn vị',409);}
 const {unit,result}=runAssetAction(entry.unit,body.action,body.action==='recordMove'?{...body.payload,appUrl:context.appUrl||''}:body.payload,user.ten);
 (unit.ts.ksb.requests||=[]).push({id:body.requestId,result,hash:requestHash}); // Never drop used operation IDs: retries cannot repeat a transaction.
 const version=await writeAtomic(db,snapshot,unit,user.ten,'unit:'+body.unit);
 return {ok:true,ts:unit.ts,unitVersion:unit.ver,version,result};
}

// Compatibility fence for the existing whole-unit save path. Only units using
// the new asset ledger enter this branch; other module persistence stays as-is.
export function assetProtectedProjection(unit, reference=unit) {
 const T=unit.ts||{},R=reference.ts||{},protectedIds=new Set((R.ds||[]).filter(x=>x.ksbStatus||x.qltsImport).map(x=>x.id));
 return {mailConfig:T.ksbMail||null,issuedDocuments:T.ksbDocuments||null,templates:T.ksbTemplates||null,config:T.ksbConfig||null,catalogs:T.ksbCatalogs||null,ledger:T.ksb||null,documents:(T.pg||[]).filter(p=>p.ksbLedger),assets:[...protectedIds].sort().map(id=>{const x=(T.ds||[]).find(x=>x.id===id);return x?{id:x.id,ma:x.ma,giu:x.giu||'',giuTu:x.giuTu||'',phongBan:x.phongBan||'',ksbStatus:x.ksbStatus||'',tt:x.ksbStatus?x.tt:null,history:x.ksbStatus?x.ls||[]:null,source:x.qltsImport||null}:null;})};
}
export async function protectedAssetUnitSave(db,user,body) {
 if(!String(body.k||'').startsWith('unit:'))return null;
 const proposed=await decodeUnit(String(body.v||''),body.z),snapshot=await catalogSnapshot(db),entry=snapshot.entries.find(e=>e.meta.k===body.k);
 if(!entry?.unit.ts?.ksb&&!proposed?.ts?.ksb&&!(entry?.unit.ts?.ds||[]).some(x=>x.qltsImport))return null;
 if(!entry||proposed.id!==entry.unit.id)fail('Không đổi định danh đơn vị',400);
 if(!body.force&&body.base!==entry.meta.ver)return {conflict:entry};
 const oldIds=new Set((entry.unit.ts?.ds||[]).map(x=>x.id));
 for(const x of proposed.ts?.ds||[])if(!oldIds.has(x.id)&&x.loai!=='dt'&&(x.giu||x.phongBan||x.ksbStatus||x.ls?.length))fail('Tài sản vật lý mới phải chưa gán người/phòng ban. Lập nghiệp vụ giao nhận sau khi thêm danh mục.',403);
 if(canonical(assetProtectedProjection(proposed,entry.unit))!==canonical(assetProtectedProjection(entry.unit)))fail('Dữ liệu giao dịch/người giữ tài sản phải được cập nhật qua nghiệp vụ tài sản. Tải lại để giữ lịch sử mới nhất.',403);
 const version=await writeAtomic(db,snapshot,proposed,user.ten,body.k,body.meta?JSON.stringify(body.meta).slice(0,4000):undefined);
 return {version};
}
