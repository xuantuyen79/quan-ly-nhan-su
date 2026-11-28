import {authorizeAssetWriter,assetConfiguredLogo} from './ksb-assets-api.js';
import {catalogSnapshot} from './ksb-asset-import.js';
import {renderAssetDocument} from './ksb-assets-engine.js';
export async function qltsDocumentPDF(db,user,body,browser){
 await authorizeAssetWriter(db,user,body.unit);
 if(!['gd','bt','tl','kk','nv'].includes(body.table)||typeof body.key!=='string'||body.key.length>140)throw Object.assign(new Error('Biên bản không hợp lệ'),{status:400});
 const snapshot=await catalogSnapshot(db),entry=snapshot.entries.find(e=>e.meta.k==='unit:'+body.unit);
 if(!entry)throw Object.assign(new Error('Không có đơn vị'),{status:404});
 if(entry.meta.ver!==body.version)throw Object.assign(new Error('Dữ liệu vừa thay đổi. Tải lại trước khi lưu PDF.'),{status:409});
 if(body.table==='nv'&&!(entry.unit.data?.NV||[]).some(n=>n['Mã NV']===body.key))throw Object.assign(new Error('Không có nhân viên trong đơn vị'),{status:404});
 const rows=entry.unit.ts?.ksb?.[body.table]||[],record=rows.find(r=>r.id===body.key),documentKey=record?(body.table==='kk'?record.dot:record.bienBan||record.id):body.key;
 const html=renderAssetDocument(entry.unit,body.table,documentKey,{logo:await assetConfiguredLogo(db,entry.unit)});
 if(body.format==='html')return new TextEncoder().encode(html);
 if(!browser?.quickAction)throw Object.assign(new Error('Chưa cấu hình Browser Run để sinh và lưu PDF tự động; không có dữ liệu nào bị thay đổi.'),{status:503});
 // Only server-issued HTML is rendered. Never execute submitted client HTML or a client URL.
 const response=await browser.quickAction('pdf',{html,pdfOptions:{format:'a4',printBackground:true,preferCSSPageSize:true},rejectResourceTypes:['script','xhr','fetch','websocket'],rejectRequestPattern:['/^https?:/']});
 if(!response.ok){const info=await response.json().catch(()=>({}));const code=info.errors?.[0]?.message||info.error||info.message||response.status;throw Object.assign(new Error('Bộ sinh PDF chưa trả kết quả ('+String(code).slice(0,180)+'); chưa lưu tài liệu.'),{status:502});}
 const bytes=await response.arrayBuffer();if(bytes.byteLength>12*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Object.assign(new Error('Tệp PDF trả về không hợp lệ'),{status:502});
 return bytes;
}
