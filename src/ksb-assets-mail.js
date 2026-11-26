// Uses the QLNS mail configuration and existing scheduled Worker. No new service.
import {catalogSnapshot,writeAtomic} from './ksb-asset-import.js';
import {runAssetAction} from './ksb-assets-engine.js';
export async function sendAssetMail(cfg, job, transport=fetch){
 if(!cfg.mail_key||!cfg.mail_from)throw new Error('Chưa cấu hình email QLNS');
 const msg={from:cfg.mail_name?cfg.mail_name+' <'+cfg.mail_from+'>':cfg.mail_from,to:[job.to],subject:job.subject,html:job.html};if(cfg.mail_reply)msg.reply_to=cfg.mail_reply;
 const r=await transport('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+cfg.mail_key,'content-type':'application/json','Idempotency-Key':'ksb-asset-'+job.id},body:JSON.stringify(msg)});
 if(!r.ok)throw new Error('Nhà cung cấp email chưa nhận thư (HTTP '+r.status+')');return (await r.json()).id||'';
}
export async function assetMailCron(db,cfg,{now=new Date().toISOString(),daily=true,unitId='',transport=fetch}={}){
 if(!cfg.mail_key||!cfg.mail_from)return {configured:false,sent:0};
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',hour12:false}).format(new Date(now)));
 let snapshot=await catalogSnapshot(db),sent=0;
 for(const initial of snapshot.entries){if(unitId&&initial.unit.id!==unitId)continue;let u=initial.unit;
  if(daily&&u.ts?.ksbMail?.nhacHan&&hour>=u.ts.ksbMail.gioGui&&u.ts.ksb?.mailDay!==date){
   try{const out=runAssetAction(u,'queueDailyMail',{appUrl:cfg.origin?cfg.origin+'/quan-tri?unit='+encodeURIComponent(u.id)+'#taisan':''},'Hệ thống nhắc hạn',now);await writeAtomic(db,snapshot,out.unit,'Nhắc hạn tài sản',initial.meta.k);}catch{continue;}
  }
  for(let n=0;n<20;n++){
   snapshot=await catalogSnapshot(db);let entry=snapshot.entries.find(e=>e.meta.k===initial.meta.k);if(!entry)break;
   const job=entry.unit.ts?.ksb?.mail?.find(j=>j.state==='queued');if(!job)break;
   const claimed=structuredClone(entry.unit),target=claimed.ts.ksb.mail.find(j=>j.id===job.id);target.state='sending';target.startedAt=now;
   try{await writeAtomic(db,snapshot,claimed,'Gửi email tài sản',entry.meta.k);}catch{break;}
   let status='sent',providerId='';try{providerId=await sendAssetMail(cfg,job,transport);sent++;}catch{status='failed';}
   snapshot=await catalogSnapshot(db);entry=snapshot.entries.find(e=>e.meta.k===initial.meta.k);if(!entry)break;
   const updated=structuredClone(entry.unit),current=updated.ts?.ksb?.mail?.find(j=>j.id===job.id);if(!current||current.state!=='sending')break;
   current.state=status;current.finishedAt=now;if(providerId)current.providerId=providerId;
   try{await writeAtomic(db,snapshot,updated,'Kết quả email tài sản',entry.meta.k);}catch{break;}
  }
 }
 return {configured:true,sent};
}
