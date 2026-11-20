// Read-only adapters for the approved KSB HRM UI v0.7.1 report group.
export const REPORTS = [
 ['K03','Báo cáo tổng hợp nhân sự','nv',[]],
 ['F31','Trạng thái nhân viên hàng ngày','cc',['Tổ chức','Ngày','Điểm danh','Đi muộn','Nghỉ phép','Nhân sự mới','Nghỉ việc']],
 ['F32','Nhật ký nhập dữ liệu','nhap',[]],
 ['F34','Tổng hợp thời gian','cc',['Nhân viên','Ca','Ngày','Giờ vào','Giờ ra','Giờ công','OT']],
 ['F35','Nhật ký chỉnh sửa Chấm công & Nghỉ phép','cc',['Nhân viên','Ngày công','Người sửa','Dữ liệu cũ','Dữ liệu mới']],
 ['F36','Báo cáo thời gian làm việc','cc',['Tháng','Kỳ lương','Tổ chức','Nhóm','Ca','Mã nhân viên']],
 ['F37','Lịch sử điều chỉnh lương','bl',['Nhân viên','Ngày hiệu lực','Lương cơ bản','Phụ cấp','Người cập nhật']],
 ['F38','Báo cáo lương','bl',[]]
];
export const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim();
const list = x => Array.isArray(x) ? x : [];
const text = x => x == null ? '' : String(x).trim();
export function iso(x) { const s=text(x).slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s ? s : ''; }
const num=x => x==null||text(x)===''||!Number.isFinite(Number(x)) ? null : Number(x);
export function deptAt(u,e,at) {
 const current=text(e['Phòng ban']), moves=list(u.dc).filter(x=>x.nv===e['Mã NV']&&iso(x.ngay)).sort((a,b)=>a.ngay.localeCompare(b.ngay)||text(a.at).localeCompare(text(b.at)));
 if(!moves.length||at>=moves.at(-1).ngay)return current;
 const prev=moves.filter(x=>x.ngay<=at).at(-1); return text(prev?prev.pbMoi:moves[0].pbCu)||current;
}
function active(e,at) { const hire=iso(e['Ngày vào làm']),leave=iso(e['Ngày nghỉ việc']);return !(hire&&hire>at)&&!(leave&&leave<at)&&!(e['Trạng thái']==='Đã nghỉ việc'&&!leave); }
const DEFAULT_LEVELS=['Lao động phổ thông (LĐPT)','Sơ cấp nghề','Trung cấp','Cao đẳng','Đại học','Thạc sĩ (ThS)','Cử nhân','Kỹ sư','Tiến sĩ'];
const degreeRank = s => ({'tien si':9,'thac si':8,'thac si (ths)':8,'dai hoc':7,'cu nhan':7,'ky su':7,'cao dang':6,'trung cap':5,'so cap nghe':4,'so cap':4,'lao dong pho thong':3,'lao dong pho thong (ldpt)':3})[fold(s)]||0;
export function education(u,e) {
 const rows=list(u.data?.QT).filter(r=>r['Mã NV']===e['Mã NV']&&r['Loại quá trình']==='Học vấn');
 const levels=[...new Set(rows.map(r=>text(r['Trình độ'])).filter(Boolean))];
 const legacy=text(e['Trình độ']),legacyAccepted=!!degreeRank(legacy)||list(u.profileCatalog?.levels).includes(legacy);
 if(!levels.length&&legacy&&legacyAccepted) levels.push(legacy);
 const majors=[...new Set(rows.map(r=>text(r['Chuyên ngành đào tạo'])).filter(Boolean))];
 const unknown=levels.some(x=>!degreeRank(x));
 const degree=unknown&&levels.length>1?'Chưa xác định bậc cao nhất':levels.sort((a,b)=>degreeRank(b)-degreeRank(a)||a.localeCompare(b,'vi'))[0]||'Chưa cập nhật';
 return {degree,majors:majors.length?majors:['Chưa cập nhật'],universityPlus:!unknown&&degreeRank(degree)>=7,educationAmbiguous:unknown&&levels.length>1,legacyUnmapped:!rows.some(r=>text(r['Trình độ']))&&!!legacy&&!legacyAccepted};
}
export function reportAccess(user, settings, reportId) {
 const report=REPORTS.find(x=>x[0]===reportId);if(!report)throw Object.assign(Error('Không có báo cáo này.'),{status:404});
 const pq=settings?.pq, matches=list(pq?.users).filter(x=>x.nv&&x.nv===user.ma);
 if(matches.length>1)throw Object.assign(Error('Cấu hình tài khoản bị trùng, cần quản trị viên kiểm tra.'),{status:403});
 const entry=matches[0];if(entry?.off)throw Object.assign(Error('Tài khoản đã ngừng sử dụng.'),{status:403});
 if(!entry&&user.sys)return {all:true,units:null,departments:[],report};
 const role=list(pq?.roles).find(r=>r.id===(entry?entry.role:user.r));
 if(!role||(!role.sys&&!['x','s'].includes(role.q?.[report[2]])))throw Object.assign(Error('Không có quyền xem báo cáo này.'),{status:403});
 const units=!entry||entry.dv==='all'?null:list(entry.dv).map(x=>typeof x==='string'?x:x?.id).filter(Boolean);
 const departments=list(entry?.pb).filter(x=>typeof x==='string'&&x);
 return {all:!!role.sys,units,departments,report};
}
export async function readReportValue(db,key) {
 const meta=await db.prepare('SELECT z FROM qt_kv WHERE k=?').bind(key).first();if(!meta)return null;
 const parts=(await db.prepare('SELECT v FROM qt_part WHERE k=? ORDER BY i').bind(key).all()).results;
 let s=parts.map(x=>x.v).join('');if(meta.z){const raw=Uint8Array.from(atob(s),c=>c.charCodeAt(0));s=await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}
 return JSON.parse(s);
}
function group(people,values) {const m=new Map();for(const p of people)for(const value of new Set(values(p)))m.set(value,(m.get(value)||0)+1);return [...m].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'vi'));}
export function personnelData(units,query,scope) {
 const year=String(query.year||query.today.slice(0,4));if(!/^\d{4}$/.test(year)||+year<1900||+year>+query.today.slice(0,4))throw Object.assign(Error('Năm báo cáo không hợp lệ.'),{status:400});
 const cutoff=year===query.today.slice(0,4)?query.today:year+'-12-31',start=iso(query.from)||year+'-01-01',end=iso(query.to)||cutoff;
 if(start>end||start.slice(0,4)!==year||end.slice(0,4)!==year||end>cutoff)throw Object.assign(Error('Khoảng thời gian phải nằm trong năm báo cáo đến ngày chốt.'),{status:400});
 const records=[],seen=new Set();
 for(const u of units)for(const e of list(u.data?.NV)){
  const code=text(e['Mã NV']);if(!code)continue;
  const dept=deptAt(u,e,cutoff);if(scope.departments.length&&!scope.departments.includes(dept))continue;
  if(query.dept&&dept!==query.dept)continue;
  if(seen.has(code))throw Object.assign(Error('Mã nhân viên bị trùng trong phạm vi báo cáo: '+code),{status:409});seen.add(code);
  const ed=education(u,e),gender=['Nam','Nữ'].includes(e['Giới tính'])?e['Giới tính']:'Chưa cập nhật';
  records.push({code,name:text(e['Họ và tên']),org:u.id,company:u.name,dept,pos:text(e['Chức danh công việc']||e['Chức vụ']),joined:iso(e['Ngày vào làm']),leftDate:iso(e['Ngày nghỉ việc']),gender,degree:ed.degree,majors:ed.majors,major:ed.majors.join('; '),universityPlus:ed.universityPlus,educationAmbiguous:ed.educationAmbiguous,legacyUnmapped:ed.legacyUnmapped,active:active(e,cutoff),status:text(e['Trạng thái'])||'Chưa cập nhật'});
 }
 const current=records.filter(x=>x.active),hired=records.filter(x=>x.joined>=start&&x.joined<=end),exited=records.filter(x=>x.leftDate&&x.leftDate>=start&&x.leftDate<=end);
 const monthly=Array.from({length:12},(_,i)=>({month:i+1,hires:hired.filter(x=>x.joined.slice(5,7)===String(i+1).padStart(2,'0')).length,exits:exited.filter(x=>x.leftDate.slice(5,7)===String(i+1).padStart(2,'0')).length}));
 return {year,cutoff,start,end,records,active:current,hired,exited,total:current.length,male:current.filter(x=>x.gender==='Nam').length,female:current.filter(x=>x.gender==='Nữ').length,unknownGender:current.filter(x=>x.gender==='Chưa cập nhật').length,universityPlus:current.filter(x=>x.universityPlus).length,genders:['Nam','Nữ','Chưa cập nhật'].map(name=>({name,count:current.filter(x=>x.gender===name).length})),degrees:group(current,x=>[x.degree]),majors:group(current,x=>x.majors),monthly,companies:group(current,x=>[x.company]),departments:group(current,x=>[x.dept||'Chưa cập nhật']),statuses:group(records,x=>[x.status]),missing:{gender:current.filter(x=>x.gender==='Chưa cập nhật').length,education:current.filter(x=>x.degree==='Chưa cập nhật').length,majors:current.filter(x=>x.majors.includes('Chưa cập nhật')).length,ambiguousEducation:current.filter(x=>x.educationAmbiguous).length,legacyEducation:current.filter(x=>x.legacyUnmapped).length,hireDates:records.filter(x=>!x.joined).length,leaveDates:records.filter(x=>x.status==='Đã nghỉ việc'&&!x.leftDate).length}};
}
function logDate(x) {if(iso(x))return iso(x);const m=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(text(x));return m?iso(m[3]+'-'+m[2]+'-'+m[1]):'';}
function timeInVN(t){const d=new Date(Number(t)+7*3600000);return Number.isNaN(d.getTime())?null:{day:d.toISOString().slice(0,10),clock:d.toISOString().slice(11,16)};}
export function timeRows(u,punches=[]) {
 const all=new Map(),put=r=>{const day=iso(r['Ngày']),id=text(r['Mã NV']);if(day&&id)all.set(id+'|'+day+'|'+text(r['Ca']),{...r});};
 for(const rows of Object.values(u.data?.CC||{}))list(rows).forEach(put);
 for(const lock of Object.values(u.ccx?.lock||{}))list(lock?.rows).forEach(put);
 // Raw phone punches provide clock times only. Do not invent paid hours, overtime or lateness.
 for(const p of punches){const t=timeInVN(p.t);if(!t||p.huy)continue;let found=[...all.values()].find(x=>x['Mã NV']===p.ma&&x['Ngày']===t.day);if(!found){found={'Mã NV':p.ma,'Ngày':t.day,_phone:true};put(found);found=all.get(p.ma+'|'+t.day+'|');}const col=p.loai==='ra'?'Giờ ra':'Giờ vào';if(!found[col]||(found._phone&&(col==='Giờ vào'?t.clock<found[col]:t.clock>found[col])))found[col]=t.clock;}
 for(const [month,changes] of Object.entries(u.ccx?.m||{}))for(const [key,v] of Object.entries(changes||{})){
  const [id,day]=key.split('|');const date=iso(day)||iso(month+'-'+String(day||'').padStart(2,'0'));if(!date)continue;
  let found=[...all.values()].find(x=>x['Mã NV']===id&&x['Ngày']===date);if(!found){put({'Mã NV':id,'Ngày':date});found=all.get(id+'|'+date+'|');}
  for(const [from,to] of [['tin','Giờ vào'],['tout','Giờ ra'],['hours','Số giờ công'],['ot','Giờ tăng ca'],['late','Đi muộn (phút)'],['k','Ký hiệu']])if(Object.hasOwn(v,from))found[to]=v[from];
 }
 return [...all.values()];
}
export function operationalRows(id,units,query,scope,punches=[],leaves=[]) {
 const month=query.month||query.today.slice(0,7),date=iso(query.date)||query.today,rows=[];
 if(!/^\d{4}-\d{2}$/.test(month)||!iso(month+'-01'))throw Object.assign(Error('Tháng không hợp lệ.'),{status:400});
 const allowed=(u,e,at)=>e&&(!scope.departments.length||scope.departments.includes(deptAt(u,e,at)))&&(!query.dept||deptAt(u,e,at)===query.dept);
 for(const u of units){const nv=list(u.data?.NV),by=new Map(nv.map(e=>[e['Mã NV'],e]));
  const base=(e,at)=>({unit:u.id,code:e?.['Mã NV']||'',name:e?.['Họ và tên']||'',company:u.name,dept:e?deptAt(u,e,at):'',state:e?.['Trạng thái']||''});
  const times=timeRows(u,punches.filter(p=>by.has(p.ma)));
  if(id==='F34'||id==='F36')for(const r of times){const at=iso(r['Ngày']),e=by.get(r['Mã NV']);if(!at||at.slice(0,7)!==month||!allowed(u,e,at))continue;rows.push({...base(e,at),date:at,shift:text(r['Ca']),group:text(e['Tổ/Ca']),in:text(r['Giờ vào'])||null,out:text(r['Giờ ra'])||null,hours:num(r['Số giờ công']??r['Giờ công']),ot:num(r['Giờ tăng ca']),period:null,month});}
  if(id==='F31')for(const e of nv){if(!allowed(u,e,date))continue;const code=e['Mã NV'],hire=iso(e['Ngày vào làm']),leave=iso(e['Ngày nghỉ việc']);if(!active(e,date)&&hire!==date&&leave!==date)continue;const ts=times.filter(x=>x['Mã NV']===code&&x['Ngày']===date),ds=list(u.data?.DON).filter(x=>x['Mã NV']===code&&x['Trạng thái']==='Đã duyệt'&&x['Từ ngày']<=date&&date<=(x['Đến ngày']||x['Từ ngày'])),ls=leaves.filter(x=>x.ma===code&&x.trang_thai==='Đã duyệt'&&x.tu<=date&&date<=(x.den||x.tu));rows.push({...base(e,date),date,attendance:ts.length?ts.map(x=>text(x['Ký hiệu'])||[x['Giờ vào'],x['Giờ ra']].filter(Boolean).join('–')).join('; ')||null:null,late:ts.length&&ts.every(x=>num(x['Đi muộn (phút)'])!==null)?ts.reduce((n,x)=>n+num(x['Đi muộn (phút)']),0):null,leave:[...ds.map(x=>x['Loại nghỉ']),...ls.map(x=>x.loai)].filter(Boolean).join('; ')||null,newHire:hire===date?'Có':'Không',exit:leave===date?'Có':'Không'});}
  if(id==='F35')for(const entry of [...list(u.ccx?.log),...list(u.lich?.log)]){const at=iso(entry.iso)||logDate(entry.at),e=by.get(entry.id);if(at&&at.slice(0,7)!==month)continue;if(e?!allowed(u,e,at||date):scope.departments.length||query.dept)continue;rows.push({...base(e,at||date),date:iso(entry.iso)||null,at:text(entry.at)||null,by:text(entry.by)||null,old:entry.old??null,new:entry.nw??null,action:entry.what||null});}
  if(id==='F37')for(const r of list(u.data?.LS)){const at=iso(r['Ngày hiệu lực']),e=by.get(r['Mã NV']);if(!at||at.slice(0,7)!==month||!allowed(u,e,at))continue;rows.push({...base(e,at),date:at,salary:num(r['Lương cơ bản']),allowance:num(r['Phụ cấp']),by:text(r['Người cập nhật'])||null});}
 }
 if(id==='F36'){
  const map=new Map();for(const r of rows){const key=[r.unit,r.code,r.shift,r.group].join('|');if(!map.has(key))map.set(key,{...r,hours:0,ot:0,days:new Set(),missingHours:false,missingOt:false});const x=map.get(key);x.days.add(r.date);if(r.hours===null)x.missingHours=true;else x.hours+=r.hours;if(r.ot===null)x.missingOt=true;else x.ot+=r.ot;}
  return [...map.values()].map(x=>({...x,days:x.days.size,hours:x.missingHours?null:Math.round(x.hours*100)/100,ot:x.missingOt?null:Math.round(x.ot*100)/100}));
 }
 return rows;
}
export async function reportsAPI(db,user,params,today) {
 const id=params.get('id')||'K03',settings=await readReportValue(db,'settings'),scope=reportAccess(user,settings,id);
 const requested=(params.get('units')||'').split(',').filter(Boolean),dept=params.get('dept')||'';
 if(scope.units&&requested.some(x=>!scope.units.includes(x)))throw Object.assign(Error('Công ty ngoài phạm vi được cấp.'),{status:403});
 if(scope.departments.length&&dept&&!scope.departments.includes(dept))throw Object.assign(Error('Phòng ban ngoài phạm vi được cấp.'),{status:403});
 const keys=(await db.prepare("SELECT k FROM qt_kv WHERE k LIKE 'unit:%' ORDER BY k").all()).results.map(x=>x.k.slice(5));
 const ids=keys.filter(x=>(!scope.units||scope.units.includes(x))&&(!requested.length||requested.includes(x))),units=[];
 for(const uid of ids){const u=await readReportValue(db,'unit:'+uid);if(u?.data)units.push(u);}
 const asof=params.get('asof');
 if(asof&&(!iso(asof)||asof>today))throw Object.assign(Error('Ngày chốt không hợp lệ.'),{status:400});
 const query={today:asof||today,year:params.get('year'),from:params.get('from'),to:params.get('to'),dept,month:params.get('month'),date:params.get('date')};
 if(query.from&&!iso(query.from)||query.to&&!iso(query.to)||query.date&&!iso(query.date))throw Object.assign(Error('Ngày báo cáo không hợp lệ.'),{status:400});
 const orgs=units.map(u=>({id:u.id,name:u.name})),departments=[...new Set(units.flatMap(u=>list(u.data.NV).map(e=>deptAt(u,e,today)).concat(list(u.data.PB).map(p=>p['Tên phòng ban']),list(u.dc).flatMap(d=>[d.pbCu,d.pbMoi]))).filter(x=>x&&(!scope.departments.length||scope.departments.includes(x))))].sort((a,b)=>a.localeCompare(b,'vi'));
 if(id==='F32'||id==='F38')return {ok:true,id,designMissing:true,orgs,departments,rows:[],missing:['Bản nguồn v0.7.1 chưa có thiết kế cột, bộ lọc hoặc công thức cho báo cáo này.']};
 if(id==='K03'){const data=personnelData(units,query,scope);return {ok:true,id,orgs,departments,data,levels:[...new Set(DEFAULT_LEVELS.concat(units.flatMap(u=>list(u.profileCatalog?.levels)).concat(data.degrees.map(x=>x.name))))],majors:[...new Set(units.flatMap(u=>list(u.profileCatalog?.majors)).concat(data.majors.map(x=>x.name)))],missing:['Văn bằng/chuyên ngành là thông tin hồ sơ đang lưu; chưa có lịch sử hiệu lực đầy đủ để phục dựng tại mọi thời điểm quá khứ.']};}
 const punchMonth=id==='F31'?(query.date||today).slice(0,7):(query.month||today.slice(0,7));
 const punches=['F31','F34','F36'].includes(id)?(await db.prepare('SELECT ma,t,loai,huy FROM cham WHERE t>=? AND t<? ORDER BY t').bind(Date.parse(punchMonth+'-01T00:00:00+07:00')-864e5,Date.parse(punchMonth+'-01T00:00:00+07:00')+32*864e5).all()).results:[];
 const leaves=id==='F31'?(await db.prepare('SELECT ma,loai,tu,den,trang_thai FROM don WHERE tu<=? AND den>=?').bind(query.date||today,query.date||today).all()).results:[];
 return {ok:true,id,orgs,departments,rows:operationalRows(id,units,query,scope,punches,leaves),missing:id==='F37'?['Nguồn là các quyết định LS đã lưu; không suy ra người cập nhật hoặc ngày hiệu lực từ ảnh chụp lương tháng.']:id==='F35'?['Chỉ hiển thị nhật ký có dữ liệu cũ/mới đã lưu; không tự tái tạo lịch sử sửa chưa được ghi nhận.']:['Giờ công, OT, đi muộn chỉ hiển thị khi đã có số liệu; không tự quy đổi khoảng vào–ra thành giờ công được trả lương.']};
}
