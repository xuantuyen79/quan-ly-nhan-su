// Offline catalog preparation only. No network, employee import or Production writer.
import {createHash} from 'node:crypto';
export const FIELD_MAP = {
  'Mã tài sản':'ma', 'Tên tài sản':'ten', 'Loại tài sản':'nhom',
  'Thương hiệu':'thuongHieu', 'Model':'model', 'Số serial':'serial',
  'Ngày mua':'ngay', 'Nhà cung cấp':'ncc', 'Nguyên giá':'gia',
  'Thời gian khấu hao (năm)':'khNam', 'Hạn bảo hành':'baoHanh',
  'Ngày bảo trì tiếp theo':'baoTri', 'Ảnh (link)':'anhNguon',
  'Ghi chú':'ghi', 'Vị trí':'viTri', 'Tạo lúc':'taoNguon'
};
const dates = new Set(['ngay','baoHanh','baoTri']);
const numbers = new Set(['gia','khNam']);
export function prepareCatalog(source, units, targetId) {
  const target = units.find(u=>u.id===targetId);
  if (!target || target.source!=='qlts-catalog-dev') throw Error('Chỉ cho phép đơn vị nhập thử DEV tách biệt.');
  const allCodes = new Map();
  for (const u of units) for (const x of u.ts?.ds||[]) {
    const codes=allCodes.get(x.ma)||[];codes.push(x);allCodes.set(x.ma,codes);
  }
  const seen = new Set(), added=[], existing=[], review=[];
  for (const row of source.rows) {
    const f=row.fields, code=f['Mã tài sản'];
    if (typeof code!=='string'||!code.trim()||!f['Tên tài sản']) throw Error('Thiếu mã/tên tài sản tại dòng '+row.row);
    if (seen.has(code)) throw Error('Trùng mã trong nguồn: '+code);seen.add(code);
    if(Object.keys(f).some(k=>!Object.hasOwn(FIELD_MAP,k)&&k!=='Tình trạng')) throw Error('Cột nguồn chưa ánh xạ tại '+code);
    if(allCodes.has(code)){existing.push({code,sourceRow:row.row,reason:'Đã có mã trong QLNS; giữ nguyên, không ghi đè'});continue;}
    const x={id:'qlts-'+createHash('sha256').update(source.sourceId+'\0'+code).digest('hex').slice(0,20),loai:'vl',tt:'Chờ đối chiếu',pct:null,giu:'',giuTu:'',anh:[],ls:[]};
    for (const [label,key] of Object.entries(FIELD_MAP)) {
      const v=f[label]??'';
      if (numbers.has(key)) {
        if(v!==''&&(typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('Giá trị số cần kiểm tra: '+code+' / '+label);
        x[key]=v===''?null:v;
      } else if(dates.has(key)) {
        if(v!==''&&!/^\d{4}-\d{2}-\d{2}(?:T00:00:00)?$/.test(v))throw Error('Ngày cần kiểm tra: '+code+' / '+label);
        x[key]=String(v).slice(0,10);
      } else x[key]=String(v);
    }
    // Only asset metadata; no holder, department, account or document history.
    x.qltsImport={sourceId:source.sourceId,sheet:source.sheet,row:row.row,sourceHash:source.sha256,status:String(f['Tình trạng']||''),companyConfirmed:false};
    added.push(x);review.push({code,sourceRow:row.row,sourceStatus:x.qltsImport.status,targetStatus:x.tt,company:'Cần xác nhận',holder:'',result:'Thêm vào DEV'});
  }
  const result=structuredClone(units),u=result.find(u=>u.id===targetId);
  u.ts ||= {v:0,ds:[],pg:[],nhom:[],so:{giao:0,thu:0}};
  u.ts.ds ||= [];u.ts.ds.push(...added);
  return {units:result,added,existing,review};
}
