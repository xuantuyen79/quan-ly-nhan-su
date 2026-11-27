// KSB: business functions ported from the customized QLTS 2/Code.gs.
// Storage/auth adapters below replace Sheets/Apps Script; business functions retain source conditions.
// Same decision helper drives the picker and the Worker; source custody always wins over legacy labels.
export function assetActionEligibility(unit, x, action, type) {
 if(!x||x.loai==='dt')return {allowed:false,reason:'Không phải tài sản vật lý'};
 const pending=x.tt==='Chờ đối chiếu'&&(!x.ksbStatus||x.ksbStatus==='Chờ đối chiếu');
 const state=x.ksbStatus||(pending?'Chờ đối chiếu':x.giu||x.phongBan?'Đang sử dụng':({'Sử dụng tốt':'Trong kho','Hỏng cần sửa':'Hỏng','Hỏng không dùng được':'Hỏng','Mất':'Thất lạc','Thanh lý':'Đã thanh lý'})[x.tt]||x.tt);
 const held=!!(x.giu||x.phongBan),loan=(unit.ts?.ksb?.mt||[]).some(r=>r.ma===x.ma&&!r.ngayTra);
 const no=reason=>({allowed:false,reason}),yes=requiresReconciliation=>({allowed:true,requiresReconciliation:!!requiresReconciliation,reason:requiresReconciliation?'Cần xác nhận hiện trạng trước khi lưu':'Đủ điều kiện'});
 if(state==='Đã thanh lý'||x.tt==='Đã hủy')return no('Đã thanh lý / ngừng quản lý');
 if(action==='recordMove'){
  if(type==='Cấp phát')return !held&&!loan&&(pending||state==='Trong kho')?yes(pending):no('Chỉ cấp phát tài sản đang trong kho hoặc đã xác nhận sẵn sàng; chưa có người/phòng ban giữ hoặc lượt mượn mở');
  if(type==='Thu hồi')return held&&!loan&&['Đang sử dụng','Hỏng','Đang sửa chữa','Chờ thanh lý'].includes(state)?yes(false):no('Không có bàn giao QLNS cần thu hồi; tài sản mượn phải dùng Nhận trả');
  if(type==='Luân chuyển')return held&&!loan&&state==='Đang sử dụng'?yes(false):no('Chỉ luân chuyển tài sản đã bàn giao QLNS và đang sử dụng');
  return no('Loại giao dịch không hợp lệ');
 }
 if(action==='loanOut')return !held&&!loan&&(pending||state==='Trong kho')?yes(pending):no('Tài sản chưa sẵn sàng cho mượn');
 if(action==='dispose')return !held&&!loan&&state!=='Đang sửa chữa'?yes(pending):no('Cần thu hồi hoặc kết thúc giao dịch trước; còn người/phòng ban giữ, đang mượn hoặc đang sửa chữa');
 if(action==='saveMaint'||action==='setStatus')return yes(false);
 return yes(false);
}
export function runAssetAction(original, action, payload, actor = 'Quản trị viên', now = new Date().toISOString()) {
 const unit = structuredClone(original); snapshotAssetDocuments(unit, actor, now); const T = unit.ts ||= {ds:[],pg:[]}; T.ds ||= []; T.pg ||= [];
 const ledger = T.ksb ||= {gd:[],bt:[],mt:[],tl:[],kk:[],nk:[]};
 for (const k of ['gd','bt','mt','tl','kk','nk']) ledger[k] ||= [];
 const status = x => x.ksbStatus || (x.tt === 'Chờ đối chiếu' ? 'Chờ đối chiếu' : x.giu ? 'Đang sử dụng' : ({'Sử dụng tốt':'Trong kho','Hỏng cần sửa':'Hỏng','Hỏng không dùng được':'Hỏng','Mất':'Thất lạc','Thanh lý':'Đã thanh lý'})[x.tt] || x.tt);
 const asset = x => ({ma:x.ma,ten:x.ten,loai:x.nhom,thuongHieu:x.thuongHieu||'',model:x.model||'',serial:x.serial||'',nhaCungCap:x.ncc||'',ngayMua:x.ngay||'',nguyenGia:x.gia,thoiGianKH:x.khNam,hanBH:x.baoHanh||'',ngayBTTiep:x.baoTri||'',tinhTrang:status(x),nguoiSD:x.giu||'',phongBan:x.phongBan||'',viTri:x.viTri||'',ghiChu:x.ghi||'',anh:x.anhNguon||''});
 const nv = (unit.data?.NV || []).map(x=>({ma:x['Mã NV'],hoTen:x['Họ và tên'],phongBan:x['Phòng ban']||'',chucVu:x['Chức danh công việc']||x['Chức vụ']||'',email:x['Email công ty']||x['Email']||x['Email cá nhân']||'',viTriLamViec:x['Nơi làm việc']||''}));
 const assets = T.ds.filter(x=>x.loai!=='dt').map(asset);
 const rows = {ts:assets,nv,...ledger};
 function dbRows_(k) { return rows[k] || []; }
 function dbFind_(k,id) { return dbRows_(k).find(x=>(k==='ts'||k==='nv'?x.ma:x.id)===id); }
 function dbNextId_(k,count) { const pre={gd:'GD',bt:'BT',mt:'MT',tl:'TL',kk:'KKD'}[k];let n=Math.max(0,...dbRows_(k).concat((ledger.voided||[]).filter(v=>v.table===k).map(v=>v.record)).map(x=>+(String(x.id).match(/(\d+)$/)||[])[1]||0));return Array.from({length:count},()=>pre+String(++n).padStart(6,'0')); }
 function dbAppend_(k,list) { for(const r of list)r._actor=actor;rows[k].push(...list); }
 function dbUpdate_(k,patches) { for(const [id,v] of Object.entries(patches)){const x=dbFind_(k,id);if(!x)throw new Error('Không có bản ghi '+id);Object.assign(x,v);} }
 function dbRead_() { return {idx:{bienBan:0}}; }
 function authGate_() { return null; } // Worker authenticates/authorizes before invoking this pure transaction.
 function api_(fn) { return fn(); }
 function khoa_(fn) { return fn(); } // Worker commits the resulting unit with an atomic version guard.
 function duLieu_() { return {}; }
 function bayGio_() { return now; }
 function homNay_() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)); }
 function caiDat_() { return {mauBB:JSON.stringify(T.ksbTemplates||{}),tenCongTy:unit.name,baoTruocBH:T.ksbConfig?.baoTruocBH??30,baoTruocBT:T.ksbConfig?.baoTruocBT??7,...(T.ksbMail||{})}; }
 function nhatKy_(thaoTac,doiTuong,chiTiet) { ledger.nk.push({luc:now,thaoTac,doiTuong,chiTiet,nguoi:actor}); }
 const REQ_={}, Utilities={getUuid:()=> 'local-transaction',formatDate:()=>homNay_()},tz_=()=> 'Asia/Ho_Chi_Minh';
 function bbDiag_() {} function bbDiagSo_() {return '';}

function laEmailMau_(e) { return /@(.+\.)?example\.(com|org|net)$/i.test(e) || /\.(test|example|invalid|localhost)$/i.test(e); }
function dsEmail_(x) {
  var out = [];
  String(x || '').split(/[,;\s]+/).forEach(function (e) { e = e.trim(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !laEmailMau_(e) && out.indexOf(e) < 0) out.push(e); });
  return out;
}
function emailKhung_(tieuDe, than) {
  var url = urlApp_();
  return '<div style="font-family:Arial,Helvetica,sans-serif;background:#F2F3F5;padding:24px 12px"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ECEBF3;border-radius:16px;padding:24px">' +
    '<div style="font-size:12px;color:#6B7280;margin-bottom:6px">' + escHtml_(caiDat_().tenCongTy || '') + '</div>' +
    '<div style="font-size:19px;font-weight:bold;color:#181925;margin-bottom:14px">' + escHtml_(tieuDe) + '</div>' + than +
    (url ? '<div style="margin-top:20px"><a href="' + url + '" style="display:inline-block;background:#6A5AE0;color:#fff;text-decoration:none;font-weight:bold;padding:11px 22px;border-radius:9999px">Mở web app quản lý tài sản</a></div>' : '') +
    '<div style="font-size:11px;color:#A1A5AF;margin-top:20px">Email tự động từ web app Quản lý tài sản.</div></div></div>';
}
function escHtml_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function bangEmail_(cot, rows) {
  return '<table style="width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 14px"><tr>' + cot.map(function (c) {
    return '<th style="text-align:left;background:#F6F5FF;color:#2E2F3E;padding:8px;border-bottom:1px solid #ECEBF3">' + escHtml_(c) + '</th>';
  }).join('') + '</tr>' + rows.map(function (r) {
    return '<tr>' + r.map(function (x) { return '<td style="padding:8px;border-bottom:1px solid #F3F2F8;color:#2E2F3E">' + escHtml_(x) + '</td>'; }).join('') + '</tr>';
  }).join('') + '</table>';
}
function ngayVN_(s) { if (!s) return ''; var p = String(s).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }

// ───────── Báo khi giao nhận ─────────
// Cấp phát: người nhận. Thu hồi: người trả. Luân chuyển: cả hai. Mỗi biên bản một email.
function emailGiaoNhan_(loai, rows) {
  var nhom = {}, gui = 0;
  rows.forEach(function (r) { (nhom[r.bienBan] = nhom[r.bienBan] || []).push(r); });
  Object.keys(nhom).forEach(function (so) {
    var rs = nhom[so], r0 = rs[0], nguoi = [];
    if (loai !== 'Thu hồi' && r0.nguoiNhan) nguoi.push(r0.nguoiNhan);
    if (loai !== 'Cấp phát' && r0.nguoiGiao) nguoi.push(r0.nguoiGiao);
    nguoi.forEach(function (ma) {
      var nv = dbFind_('nv', ma); if (!nv || !nv.email) return;
      var cau = loai === 'Cấp phát' ? 'Bạn vừa được bàn giao ' + rs.length + ' tài sản' : loai === 'Thu hồi' ? 'Công ty đã thu hồi ' + rs.length + ' tài sản bạn đang giữ'
        : ma === r0.nguoiNhan ? 'Bạn vừa nhận luân chuyển ' + rs.length + ' tài sản' : 'Đã chuyển ' + rs.length + ' tài sản bạn đang giữ sang người khác';
      var than = '<p style="font-size:14px;color:#2E2F3E;line-height:1.6;margin:0 0 8px">Chào ' + escHtml_(nv.hoTen) + ',<br>' + cau + ' ngày ' + ngayVN_(r0.ngay) +
        ' (biên bản ' + escHtml_(so) + ').' + (r0.lyDo ? ' Lý do: ' + escHtml_(r0.lyDo) + '.' : '') + '</p>' +
        bangEmail_(['Mã', 'Tên tài sản', 'Số serial', 'Tình trạng'], rs.map(function (x) { var a = dbFind_('ts', x.ma) || {}; return [x.ma, a.ten || '', a.serial || '', x.tinhTrangGiao || '']; }));
      gui += guiEmail_(nv.email, loai + ' tài sản · ' + so, emailKhung_(loai + ' tài sản', than));
    });
  });
  return gui;
}

function noiDungNhacHan_() {
  var cd = caiDat_(), hn = homNay_(), T = TT_(), ts = dbRows_('ts').filter(function (a) { return a.tinhTrang !== T.TL && a.tinhTrang !== T.MAT; });
  var muonQH = dbRows_('mt').filter(function (m) { return !m.ngayTra && m.hanTra && m.hanTra < hn; });
  var btQH = ts.filter(function (a) { return a.ngayBTTiep && a.ngayBTTiep < hn; });
  var btSap = ts.filter(function (a) { var n = soNgay_(hn, a.ngayBTTiep); return a.ngayBTTiep && n >= 0 && n <= cd.baoTruocBT; });
  var bhSap = ts.filter(function (a) { var n = soNgay_(hn, a.hanBH); return a.hanBH && n >= 0 && n <= cd.baoTruocBH; });
  var tenNV = function (ma) { var n = dbFind_('nv', ma); return n ? n.hoTen : ma; };
  var than = '', muc = function (t, cot, rows) { if (rows.length) than += '<div style="font-size:15px;font-weight:bold;color:#181925;margin:16px 0 4px">' + t + ' (' + rows.length + ')</div>' + bangEmail_(cot, rows); };
  muc('Mượn quá hạn chưa trả', ['Mã', 'Tài sản', 'Người mượn', 'Hạn trả'], muonQH.map(function (m) { var a = dbFind_('ts', m.ma) || {}; return [m.ma, a.ten || '', tenNV(m.nguoiMuon), ngayVN_(m.hanTra)]; }));
  muc('Quá hạn bảo trì', ['Mã', 'Tài sản', 'Vị trí', 'Hẹn bảo trì'], btQH.map(function (a) { return [a.ma, a.ten, a.viTri, ngayVN_(a.ngayBTTiep)]; }));
  muc('Bảo trì trong ' + cd.baoTruocBT + ' ngày tới', ['Mã', 'Tài sản', 'Vị trí', 'Hẹn bảo trì'], btSap.map(function (a) { return [a.ma, a.ten, a.viTri, ngayVN_(a.ngayBTTiep)]; }));
  muc('Sắp hết bảo hành', ['Mã', 'Tài sản', 'Nhà cung cấp', 'Hết bảo hành'], bhSap.map(function (a) { return [a.ma, a.ten, a.nhaCungCap, ngayVN_(a.hanBH)]; }));
  return { than: than, tong: muonQH.length + btQH.length + btSap.length + bhSap.length, muonQH: muonQH,
    tomTat: [muonQH.length ? muonQH.length + ' mượn quá hạn' : '', btQH.length ? btQH.length + ' quá hạn bảo trì' : '', btSap.length ? btSap.length + ' sắp bảo trì' : '', bhSap.length ? bhSap.length + ' sắp hết bảo hành' : ''].filter(String).join(', ') };
}
function nguoiNhanNhacHan_() {
  var cd = caiDat_();
  if (dsEmail_(cd.emailNhan).length) return dsEmail_(cd.emailNhan);
  return dsEmail_(dbRows_('nv').filter(function (n) { return n.quanLyKho && n.trangThai !== 'Đã nghỉ' && n.email; }).map(function (n) { return n.email; }).join(','));
}

 function urlApp_(){return /^https?:\/\//.test(payload?.appUrl||'')?String(payload.appUrl).replace(/[<>"']/g,''):'';}
 function soNgay_(a,b){return Math.round((Date.parse(b)-Date.parse(a))/864e5);}
 function guiEmail_(to,subject,html){const targets=dsEmail_(Array.isArray(to)?to.join(','):to);for(const email of targets)(ledger.mail||=[]).push({id:crypto.randomUUID(),to:email,subject,html,state:'queued',at:now});return targets.length;}
 function saveMailConfig(p){const c=p.config||{},emails=String(c.emailNhan||'').trim();if(emails&&emails.split(/[,;\s]+/).some(e=>!/^([^@\s]+)@([^@\s]+)\.[^@\s]+$/.test(e)))throw new Error('Email nhận nhắc hạn không hợp lệ');if(c.nhacHan&&!dsEmail_(emails).length)throw new Error('Nhập email nhận nhắc hạn hợp lệ; dùng nhân sự QLNS, không tạo danh mục quản lý kho riêng');if(!Number.isInteger(c.gioGui)||c.gioGui<0||c.gioGui>23)throw new Error('Giờ gửi từ 0 đến 23');T.ksbMail={emailNhan:emails,nhacHan:!!c.nhacHan,nhacNguoiMuon:!!c.nhacNguoiMuon,gioGui:c.gioGui,emailGiaoNhan:!!c.emailGiaoNhan};nhatKy_('Cấu hình email tài sản','','');return {};}
 function queueTestMail(p){const to=String(p.email||'').trim();if(!dsEmail_(caiDat_().emailNhan).includes(to))throw new Error('Chọn email đã lưu trong cấu hình nhận nhắc hạn');const nd=noiDungNhacHan_();return {queuedEmail:guiEmail_(to,'Gửi thử nhắc hạn tài sản '+ngayVN_(homNay_()),emailKhung_('Việc cần xử lý hôm nay',nd.than||'<p>Hôm nay không có việc cần nhắc.</p>'))};}
 function queueDailyMail(){const cd=caiDat_(),day=homNay_();if(!cd.nhacHan||ledger.mailDay===day)return {queued:0};const nd=noiDungNhacHan_();ledger.mailDay=day;let count=0;if(nd.tong)count+=guiEmail_(nguoiNhanNhacHan_(),'Nhắc hạn tài sản '+ngayVN_(day)+': '+nd.tomTat,emailKhung_('Việc cần xử lý hôm nay',nd.than));if(cd.nhacNguoiMuon)for(const m of nd.muonQH){const n=dbFind_('nv',m.nguoiMuon),a=dbFind_('ts',m.ma)||{};if(n?.email)count+=guiEmail_(n.email,'Nhắc trả tài sản '+m.ma,emailKhung_('Nhắc trả tài sản đã mượn','<p>Chào '+escHtml_(n.hoTen)+', bạn mượn '+escHtml_(a.ten||m.ma)+' từ ngày '+ngayVN_(m.ngayMuon)+', hạn trả '+ngayVN_(m.hanTra)+'. Vui lòng sắp xếp trả bộ phận quản lý tài sản.</p>'));}return {queued:count};}

function TT_() {
  return { KHO: 'Trong kho', DUNG: 'Đang sử dụng', MUON: 'Đang cho mượn', SUA: 'Đang sửa chữa', HONG: 'Hỏng',
    MAT: 'Thất lạc', CHO_TL: 'Chờ thanh lý', TL: 'Đã thanh lý' };
}

function TT_LIST_() {
  var t = TT_();
  return [t.DUNG, t.KHO, t.MUON, t.SUA, t.HONG, t.MAT, t.CHO_TL, t.TL];
}
function KK_KQ_() { return ['Có mặt', 'Thiếu', 'Hỏng', 'Sai vị trí']; }

// Mỗi bảng: tên sheet, cột khoá, tiền tố mã phiếu, các cột [khoá, tiêu đề trên sheet, kiểu].
// Đọc / ghi theo TIÊU ĐỀ cột nên khách chèn hay đổi thứ tự cột không làm lệch dữ liệu.
function BANG_() {
  return {
    ts: { sheet: 'Tài sản', key: 'ma', mau: '#EFEEFE', cols: [
      ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['loai', 'Loại tài sản'], ['thuongHieu', 'Thương hiệu'], ['model', 'Model'],
      ['serial', 'Số serial'], ['ngayMua', 'Ngày mua', 'date'], ['nhaCungCap', 'Nhà cung cấp'], ['nguyenGia', 'Nguyên giá', 'num'],
      ['thoiGianKH', 'Thời gian khấu hao (năm)', 'num'], ['hanBH', 'Hạn bảo hành', 'date'], ['tinhTrang', 'Tình trạng'],
      ['nguoiSD', 'Người sử dụng (mã NV)'], ['phongBan', 'Phòng ban'], ['viTri', 'Vị trí'], ['ngayBTTiep', 'Ngày bảo trì tiếp theo', 'date'],
      ['anh', 'Ảnh (link)'], ['ghiChu', 'Ghi chú'], ['taoLuc', 'Tạo lúc']] },
    gd: { sheet: 'Cấp phát - Thu hồi', key: 'id', pre: 'GD', mau: '#E8F0FE', cols: [
      ['id', 'Mã phiếu'], ['ngay', 'Ngày', 'date'], ['ma', 'Mã tài sản'], ['loai', 'Loại giao dịch'], ['nguoiGiao', 'Người giao (mã NV)'],
      ['nguoiNhan', 'Người nhận (mã NV)'], ['phongBan', 'Phòng ban nhận'], ['viTri', 'Vị trí'], ['lyDo', 'Lý do'],
      ['tinhTrangGiao', 'Tình trạng khi giao'], ['nguoiDuyet', 'Người duyệt (mã NV)'], ['ghiChu', 'Ghi chú'], ['bienBan', 'Biên bản'], ['taoLuc', 'Tạo lúc'], ['fileBB', 'File biên bản'], ['truoc', 'Trước khi ghi (tự động)'], ['banKy', 'Bản đã ký']] },
    bt: { sheet: 'Bảo trì', key: 'id', pre: 'BT', mau: '#E6F4EA', cols: [
      ['id', 'Mã phiếu'], ['ngay', 'Ngày bảo trì', 'date'], ['ma', 'Mã tài sản'], ['loai', 'Loại bảo trì'], ['noiDung', 'Nội dung'],
      ['donVi', 'Đơn vị thực hiện'], ['chiPhi', 'Chi phí', 'num'], ['ketQua', 'Kết quả'], ['ngayTiep', 'Ngày bảo trì tiếp theo', 'date'],
      ['ghiChu', 'Ghi chú'], ['bienBan', 'Biên bản'], ['taoLuc', 'Tạo lúc'], ['fileBB', 'File biên bản'], ['truoc', 'Trước khi ghi (tự động)'], ['banKy', 'Bản đã ký']] },
    mt: { sheet: 'Mượn - trả', key: 'id', pre: 'MT', mau: '#FEF7E0', cols: [
      ['id', 'Mã phiếu'], ['ma', 'Mã tài sản'], ['nguoiMuon', 'Người mượn (mã NV)'], ['ngayMuon', 'Ngày mượn', 'date'], ['hanTra', 'Hạn trả', 'date'],
      ['ngayTra', 'Ngày trả', 'date'], ['tinhTrangTra', 'Tình trạng khi trả'], ['ghiChu', 'Ghi chú'], ['taoLuc', 'Tạo lúc']] },
    tl: { sheet: 'Thanh lý', key: 'id', pre: 'TL', mau: '#FCE8E6', cols: [
      ['id', 'Mã phiếu'], ['ngay', 'Ngày thanh lý', 'date'], ['ma', 'Mã tài sản'], ['lyDo', 'Lý do'], ['hinhThuc', 'Hình thức'],
      ['giaTriThuHoi', 'Giá trị thu hồi', 'num'], ['gtcl', 'Giá trị còn lại lúc thanh lý', 'num'], ['laiLo', 'Lãi / lỗ', 'num'],
      ['nguoiDuyet', 'Người duyệt (mã NV)'], ['soQD', 'Số quyết định'], ['ghiChu', 'Ghi chú'], ['bienBan', 'Biên bản'], ['taoLuc', 'Tạo lúc'],
      ['fileBB', 'File biên bản'], ['truoc', 'Trước khi ghi (tự động)'], ['banKy', 'Bản đã ký']] },
    kk: { sheet: 'Kiểm kê', key: 'id', pre: 'KKD', mau: '#F3E8FD', cols: [
      ['id', 'Mã dòng'], ['dot', 'Mã đợt'], ['bienBan', 'Số biên bản'], ['ngayKiem', 'Ngày kiểm', 'date'], ['ma', 'Mã tài sản'], ['viTriSo', 'Vị trí theo sổ'],
      ['nguoiSo', 'Người sử dụng theo sổ (mã NV)'], ['ketQua', 'Kết quả'], ['viTriTT', 'Vị trí thực tế'], ['nguoiKiem', 'Người kiểm (mã NV)'],
      ['ghiChu', 'Ghi chú'], ['daApDung', 'Ngày áp dụng', 'date'], ['taoLuc', 'Tạo lúc'], ['fileBB', 'File biên bản'], ['banKy', 'Bản đã ký']] },
    nv: { sheet: 'Nhân viên', key: 'ma', mau: '#E8F0FE', cols: [
      ['ma', 'Mã NV'], ['hoTen', 'Họ tên'], ['phongBan', 'Phòng ban'], ['chucVu', 'Chức vụ'], ['email', 'Email'], ['sdt', 'Số điện thoại'],
      ['viTriLamViec', 'Nơi làm việc'], ['trangThai', 'Trạng thái'], ['quanLyKho', 'Quản lý kho', 'bool']] },
    nk: { sheet: 'Nhật ký', key: '', mau: '#F1F3F4', cols: [
      ['luc', 'Thời gian'], ['thaoTac', 'Thao tác'], ['doiTuong', 'Đối tượng'], ['chiTiet', 'Chi tiết'], ['nguoi', 'Người thực hiện']] }
  };
}

function TIEN_TO_BB_() { return { 'Cấp phát': 'BBBG', 'Thu hồi': 'BBTH', 'Luân chuyển': 'BBLC', 'Bảo trì': 'BBBT', 'Thanh lý': 'BBTL', 'Kiểm kê': 'BBKK' }; }
// Biên bản loại nào nằm ở bảng nào
function BANG_BB_(loai) { return loai === 'Bảo trì' ? 'bt' : loai === 'Thanh lý' ? 'tl' : loai === 'Kiểm kê' ? 'kk' : 'gd'; }

// Danh mục mặc định của file mới (bản bán). "Hoàn thành" phải có trong Kết quả bảo trì.
function DM_MAC_DINH_() {
  return {
    loai: ['Thiết bị IT', 'Nội thất', 'Thiết bị VP', 'Thiết bị điện', 'Phương tiện', 'Máy móc SX', 'Phần mềm', 'Khác'],
    phongBan: ['Ban Giám đốc', 'Phòng Kế toán', 'Phòng Nhân sự', 'Phòng Kinh doanh', 'Phòng Hành chính', 'Kho'],
    viTri: ['Kho chính'], nhaCungCap: [],
    hinhThucTL: ['Bán lại', 'Cho tặng', 'Hủy bỏ', 'Trả nhà cung cấp'],
    loaiBT: ['Định kỳ', 'Sửa chữa', 'Nâng cấp', 'Đột xuất'],
    ketQuaBT: ['Hoàn thành', 'Đang xử lý', 'Chờ vật tư']
  };
}

function BANG_BB_(loai) { return loai === 'Bảo trì' ? 'bt' : loai === 'Thanh lý' ? 'tl' : loai === 'Kiểm kê' ? 'kk' : 'gd'; }

// Danh mục mặc định của file mới (bản bán). "Hoàn thành" phải có trong Kết quả bảo trì.
function DM_MAC_DINH_() {
  return {
    loai: ['Thiết bị IT', 'Nội thất', 'Thiết bị VP', 'Thiết bị điện', 'Phương tiện', 'Máy móc SX', 'Phần mềm', 'Khác'],
    phongBan: ['Ban Giám đốc', 'Phòng Kế toán', 'Phòng Nhân sự', 'Phòng Kinh doanh', 'Phòng Hành chính', 'Kho'],
    viTri: ['Kho chính'], nhaCungCap: [],
    hinhThucTL: ['Bán lại', 'Cho tặng', 'Hủy bỏ', 'Trả nhà cung cấp'],
    loaiBT: ['Định kỳ', 'Sửa chữa', 'Nâng cấp', 'Đột xuất'],
    ketQuaBT: ['Hoàn thành', 'Đang xử lý', 'Chờ vật tư']
  };
}

function batBuoc_(v, ten) { if (v === undefined || v === null || String(v).trim() === '') throw new Error('Thiếu ' + ten); return String(v).trim(); }
function ngayHopLe_(v, ten, coTheTrong) {
  var s = ngayChuoi_(v);
  if (!s) { if (coTheTrong && (v === '' || v === null || v === undefined)) return ''; throw new Error(ten + ' không hợp lệ'); }
  return s;
}

function ngayHopLe_(v, ten, coTheTrong) {
  var s = ngayChuoi_(v);
  if (!s) { if (coTheTrong && (v === '' || v === null || v === undefined)) return ''; throw new Error(ten + ' không hợp lệ'); }
  return s;
}

function tsCanCo_(ma) {
  var a = dbFind_('ts', ma); if (!a) throw new Error('Không có tài sản ' + ma);
  return a;
}

function nvCo_(ma, ten) {
  if (!ma) return '';
  if (!dbFind_('nv', ma)) throw new Error(ten + ': không có nhân viên mã ' + ma);
  return ma;
}

function dsMa_(p) {
  var ds = (p.ds || []).map(function (x) { return String(x).trim(); }).filter(String);
  if (!ds.length) throw new Error('Chưa chọn tài sản nào');
  var trung = ds.filter(function (x, i) { return ds.indexOf(x) !== i; });
  if (trung.length) throw new Error('Chọn trùng tài sản ' + trung[0]);
  return ds;
}

function tenTT_(a) { return a.ma + ' (' + a.tinhTrang + ')'; }
// Ảnh chụp trạng thái tài sản trước khi ghi phiếu: để Huỷ phiếu đưa tài sản về đúng như cũ
function chupTruoc_(a) { return JSON.stringify({ tinhTrang: a.tinhTrang, nguoiSD: a.nguoiSD, phongBan: a.phongBan, viTri: a.viTri, ngayBTTiep: a.ngayBTTiep }); }

// ───────── Tài sản ─────────
function saveAsset(p, laMoi) {
  var __g = authGate_('saveAsset', arguments); if (__g) return __g;
  // Giữ API/quyền thêm tài sản cũ; lô dùng lại kiểm tra nhập Excel nhưng không cập nhật/bỏ qua mã trùng.
  if (laMoi && p && Object.prototype.hasOwnProperty.call(p, 'loTaiSan')) {
    return importAssets(p.loTaiSan, { chiThemMoi: true, anhLo: p.anhLo || '' });
  }
  return api_(function () {
    return khoaTaoTaiSan_(function () {
      var ma = batBuoc_(p.ma, 'mã tài sản'), ten = batBuoc_(p.ten, 'tên tài sản');
      if (!/^[A-Za-z0-9._\/-]+$/.test(ma)) throw new Error('Mã tài sản chỉ gồm chữ không dấu, số và - _ . /');
      var cu = dbFind_('ts', ma);
      if (laMoi && cu) throw new Error('Mã ' + ma + ' đã có');
      if (!laMoi && !cu) throw new Error('Không có tài sản ' + ma);
      var ng = Number(p.nguyenGia) || 0, tg = Number(p.thoiGianKH) || 0;
      if (ng < 0) throw new Error('Nguyên giá không được âm');
      if (tg < 0 || tg > 100) throw new Error('Thời gian khấu hao phải từ 0 đến 100 năm');
      var o = { ma: ma, ten: ten, loai: p.loai || '', thuongHieu: p.thuongHieu || '', model: p.model || '', serial: p.serial || '',
        ngayMua: ngayHopLe_(p.ngayMua, 'Ngày mua'), nhaCungCap: p.nhaCungCap || '', nguyenGia: Math.round(ng), thoiGianKH: tg,
        hanBH: ngayHopLe_(p.hanBH, 'Hạn bảo hành', true), ngayBTTiep: ngayHopLe_(p.ngayBTTiep, 'Ngày bảo trì tiếp theo', true),
        anh: p.anh || '', ghiChu: p.ghiChu || '' };
      if (laMoi) {
        o.tinhTrang = TT_().KHO; o.viTri = p.viTri || 'Kho chính'; o.phongBan = ''; o.nguoiSD = ''; o.taoLuc = bayGio_();
        dbAppend_('ts', [o]); nhatKy_('Thêm tài sản', ma, ten);
      } else {
        if (p.viTri !== undefined) o.viTri = p.viTri;
        if (o.anh !== String(cu.anh || '')) xoaAnhCu_(cu.anh); // đổi hoặc bỏ ảnh trong ngăn kéo Sửa: tệp Drive cũ vào thùng rác
        var pt = {}; pt[ma] = o; dbUpdate_('ts', pt); nhatKy_('Sửa tài sản', ma, ten);
      }
      return duLieu_();
    });
  });
}

function chupTruoc_(a) { return JSON.stringify({ tinhTrang: a.tinhTrang, nguoiSD: a.nguoiSD, phongBan: a.phongBan, viTri: a.viTri, ngayBTTiep: a.ngayBTTiep }); }

// ───────── Tài sản ─────────
function saveAsset(p, laMoi) {
  var __g = authGate_('saveAsset', arguments); if (__g) return __g;
  // Giữ API/quyền thêm tài sản cũ; lô dùng lại kiểm tra nhập Excel nhưng không cập nhật/bỏ qua mã trùng.
  if (laMoi && p && Object.prototype.hasOwnProperty.call(p, 'loTaiSan')) {
    return importAssets(p.loTaiSan, { chiThemMoi: true, anhLo: p.anhLo || '' });
  }
  return api_(function () {
    return khoaTaoTaiSan_(function () {
      var ma = batBuoc_(p.ma, 'mã tài sản'), ten = batBuoc_(p.ten, 'tên tài sản');
      if (!/^[A-Za-z0-9._\/-]+$/.test(ma)) throw new Error('Mã tài sản chỉ gồm chữ không dấu, số và - _ . /');
      var cu = dbFind_('ts', ma);
      if (laMoi && cu) throw new Error('Mã ' + ma + ' đã có');
      if (!laMoi && !cu) throw new Error('Không có tài sản ' + ma);
      var ng = Number(p.nguyenGia) || 0, tg = Number(p.thoiGianKH) || 0;
      if (ng < 0) throw new Error('Nguyên giá không được âm');
      if (tg < 0 || tg > 100) throw new Error('Thời gian khấu hao phải từ 0 đến 100 năm');
      var o = { ma: ma, ten: ten, loai: p.loai || '', thuongHieu: p.thuongHieu || '', model: p.model || '', serial: p.serial || '',
        ngayMua: ngayHopLe_(p.ngayMua, 'Ngày mua'), nhaCungCap: p.nhaCungCap || '', nguyenGia: Math.round(ng), thoiGianKH: tg,
        hanBH: ngayHopLe_(p.hanBH, 'Hạn bảo hành', true), ngayBTTiep: ngayHopLe_(p.ngayBTTiep, 'Ngày bảo trì tiếp theo', true),
        anh: p.anh || '', ghiChu: p.ghiChu || '' };
      if (laMoi) {
        o.tinhTrang = TT_().KHO; o.viTri = p.viTri || 'Kho chính'; o.phongBan = ''; o.nguoiSD = ''; o.taoLuc = bayGio_();
        dbAppend_('ts', [o]); nhatKy_('Thêm tài sản', ma, ten);
      } else {
        if (p.viTri !== undefined) o.viTri = p.viTri;
        if (o.anh !== String(cu.anh || '')) xoaAnhCu_(cu.anh); // đổi hoặc bỏ ảnh trong ngăn kéo Sửa: tệp Drive cũ vào thùng rác
        var pt = {}; pt[ma] = o; dbUpdate_('ts', pt); nhatKy_('Sửa tài sản', ma, ten);
      }
      return duLieu_();
    });
  });
}

function recordMove(p) {
  var __g = authGate_('recordMove', arguments); if (__g) return __g;
  return api_(function () {
    // BEGIN KSB_BB_DIAG_20261021_V1 start
    try { REQ_.__bbDiag = Utilities.getUuid(); bbDiag_('recordMove.enter', {}); } catch (ignored) {}
    // END KSB_BB_DIAG_20261021_V1 start
    return khoa_(function () {
      var T = TT_(), loai = p.loai, ds = dsMa_(p), ngay = ngayHopLe_(p.ngay, 'Ngày');
      if (['Cấp phát', 'Thu hồi', 'Luân chuyển'].indexOf(loai) < 0) throw new Error('Loại giao dịch không hợp lệ');
      var nhan = nvCo_(p.nguoiNhan, 'Người nhận'), duyet = nvCo_(p.nguoiDuyet, 'Người duyệt'), giao = nvCo_(p.nguoiGiao, 'Người giao');
      if (loai !== 'Thu hồi' && !nhan && !p.phongBan) throw new Error('Chọn người nhận hoặc phòng ban nhận');
      var ids = dbNextId_('gd', ds.length), rows = [], pt = {}, nvNhan = nhan ? dbFind_('nv', nhan) : null;
      // Một lần giao nhận = một biên bản. Thu hồi / luân chuyển từ nhiều người: mỗi người giao một biên bản (ai ký phần người đó)
      var daCap = {}, soTheoNguoi = {}, dsBB = [];
      ds.forEach(function (ma, i) {
        var a = tsCanCo_(ma);
        if (loai === 'Cấp phát' && a.tinhTrang !== T.KHO) throw new Error('Chỉ cấp phát tài sản đang trong kho: ' + tenTT_(a));
        if (loai === 'Luân chuyển' && a.tinhTrang !== T.DUNG) throw new Error('Chỉ luân chuyển tài sản đang sử dụng: ' + tenTT_(a));
        if (loai === 'Thu hồi' && [T.DUNG, T.HONG, T.SUA, T.CHO_TL].indexOf(a.tinhTrang) < 0) throw new Error('Không thu hồi được ' + tenTT_(a) + (a.tinhTrang === T.MUON ? ', đang cho mượn thì nhận trả ở mục Mượn - trả' : ''));
        // Để trống vị trí: thu hồi về Kho chính; cấp phát / luân chuyển lấy nơi làm việc của người nhận
        var viTri = p.viTri || (loai === 'Thu hồi' ? 'Kho chính' : (nvNhan && nvNhan.viTriLamViec) || a.viTri);
        var pb = loai === 'Thu hồi' ? 'Kho' : (p.phongBan || (nvNhan ? nvNhan.phongBan : ''));
        var nguoiGiao = giao || (loai !== 'Cấp phát' ? a.nguoiSD : '');
        var k = loai === 'Cấp phát' ? '' : nguoiGiao;
        if (!soTheoNguoi[k]) { soTheoNguoi[k] = soBienBan_(loai, ngay, daCap); dsBB.push(soTheoNguoi[k]); }
        var soBB = soTheoNguoi[k];
        // BEGIN KSB_BB_DIAG_20261021_V1 allocated
        try { bbDiag_('recordMove.allocated', { item: i, number: bbDiagSo_(soBB) }); } catch (ignored) {}
        // END KSB_BB_DIAG_20261021_V1 allocated
        rows.push({ id: ids[i], ngay: ngay, ma: ma, loai: loai, nguoiGiao: nguoiGiao, nguoiNhan: nhan,
          phongBan: pb, viTri: viTri, lyDo: p.lyDo || '', tinhTrangGiao: p.tinhTrangGiao || '', nguoiDuyet: duyet, ghiChu: p.ghiChu || '', bienBan: soBB, taoLuc: bayGio_(),
          truoc: chupTruoc_(a) });
        // Thu hồi tài sản hỏng / đang sửa / chờ thanh lý: về kho nhưng GIỮ tình trạng, để không bị cấp phát nhầm
        pt[ma] = loai === 'Thu hồi' ? { tinhTrang: a.tinhTrang === T.DUNG ? T.KHO : a.tinhTrang, nguoiSD: '', phongBan: '', viTri: viTri }
          : { tinhTrang: T.DUNG, nguoiSD: nhan, phongBan: pb, viTri: viTri };
      });
      // BEGIN KSB_BB_DIAG_20261021_V1 beforeAppend
      try { rows.forEach(function (r, i) { bbDiag_('recordMove.beforeAppend', { item: i, number: bbDiagSo_(r.bienBan) }); }); } catch (ignored) {}
      // END KSB_BB_DIAG_20261021_V1 beforeAppend
      dbAppend_('gd', rows); dbUpdate_('ts', pt);
      nhatKy_(loai, ds.join(', '), (nhan ? 'Người nhận ' + nhan + ' · ' : '') + dsBB.join(', '));
      var daGui = 0;
      if (p.guiEmail) { try { daGui = emailGiaoNhan_(loai, rows); } catch (e) { nhatKy_('Lỗi gửi email', dsBB.join(', '), String(e.message || e)); } }
      var d = duLieu_(); d.moi = ids; d.bienBan = dsBB[0]; d.dsBienBan = dsBB; d.daGuiEmail = daGui; return d;
    });
  });
}

function soBienBan_(loai, ngay, daCap) {
  var bang = BANG_BB_(loai);
  var pre = TIEN_TO_BB_()[loai] || 'BB';
  // Cấp phát là nghiệp vụ; chứng từ bắt buộc là BIÊN BẢN BÀN GIAO (BBBG).
  // Không để mẫu cũ đã lưu BBCP ghi đè quy ước này.
  if (loai !== 'Cấp phát' && loai !== 'Kiểm kê') {
    try {
      var m = JSON.parse(caiDat_().mauBB || '{}');
      var k = m[loai] && String(m[loai].kyHieu || '').trim().replace(/[^A-Za-z0-9._]/g, '');
      if (k) pre = k;
    } catch (e) {}
  }
  var nam = String(ngay).slice(0, 4),
    // Đọc cả kiểu cũ BBCP[-/]YYYY[-/]NNN để tránh cấp lại cùng số thứ tự.
    preEsc = loai === 'Cấp phát' ? '(?:BBBG|BBCP)' : pre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    re = new RegExp('^' + preEsc + '[-/]' + nam + '[-/](\\d+)$'),
    max = 0;
  dbRows_(bang).concat((ledger.voided||[]).filter(v=>v.table===bang).map(v=>v.record)).map(function (r) { return r.bienBan; }).concat(Object.keys(daCap || {})).forEach(function (b) {
    var x = String(b || '').match(re); if (x) max = Math.max(max, Number(x[1]));
    // Tương thích số kiểm kê cũ không có dấu: BBKK2026002.
    if (loai === 'Kiểm kê') { var cu = String(b || '').match(/^BBKK(\d{4})(\d+)$/); if (cu && cu[1] === nam) max = Math.max(max, Number(cu[2])); }
  });
  var so = pre + '/' + nam + '/' + String(max + 1).padStart(3,'0');
  // BEGIN KSB_BB_DIAG_20261021_V1 generated
  try { bbDiag_('soBienBan.return', { max: max, number: bbDiagSo_(so) }); } catch (ignored) {}
  // END KSB_BB_DIAG_20261021_V1 generated
  if (daCap) daCap[so] = 1;
  return so;
}

function saveMaint(p) {
  var __g = authGate_('saveMaint', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), ds = dsMa_(p), ngay = ngayHopLe_(p.ngay, 'Ngày bảo trì'), tiep = ngayHopLe_(p.ngayTiep, 'Ngày bảo trì tiếp theo', true);
      if (tiep && tiep < ngay) throw new Error('Ngày bảo trì tiếp theo phải sau ngày bảo trì');
      var chiPhi = Math.round(Number(p.chiPhi) || 0); if (chiPhi < 0) throw new Error('Chi phí không được âm');
      var kq = p.ketQua || 'Hoàn thành', ids = dbNextId_('bt', ds.length), rows = [], pt = {}, soBB = soBienBan_('Bảo trì', ngay, {});
      var cuoi = {}; dbRows_('bt').forEach(function (r) { if (!cuoi[r.ma] || r.ngay > cuoi[r.ma]) cuoi[r.ma] = r.ngay; });
      ds.forEach(function (ma, i) {
        var a = tsCanCo_(ma); if (a.tinhTrang === T.TL) throw new Error(ma + ' đã thanh lý');
        rows.push({ id: ids[i], ngay: ngay, ma: ma, loai: p.loai || '', noiDung: p.noiDung || '', donVi: p.donVi || '',
          chiPhi: ds.length > 1 && p.chiaDeu ? Math.round(chiPhi / ds.length) : chiPhi, ketQua: kq, ngayTiep: tiep, ghiChu: p.ghiChu || '', taoLuc: bayGio_(),
          bienBan: soBB, truoc: chupTruoc_(a) });
        var o = {};
        if (tiep && (!cuoi[ma] || ngay >= cuoi[ma])) o.ngayBTTiep = tiep;
        if (kq !== 'Hoàn thành' && [T.KHO, T.DUNG, T.HONG].indexOf(a.tinhTrang) >= 0) o.tinhTrang = T.SUA;
        if (kq === 'Hoàn thành' && (a.tinhTrang === T.SUA || a.tinhTrang === T.HONG)) o.tinhTrang = a.nguoiSD || a.phongBan ? T.DUNG : T.KHO;
        if (Object.keys(o).length) pt[ma] = o;
      });
      dbAppend_('bt', rows); dbUpdate_('ts', pt);
      nhatKy_('Bảo trì', ds.join(', '), (p.loai || '') + ' · ' + kq + ' · ' + soBB);
      var d = duLieu_(); d.moi = ids; d.bienBan = soBB; return d;
    });
  });
}

function loanOut(p) {
  var __g = authGate_('loanOut', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), ds = dsMa_(p), muon = batBuoc_(p.nguoiMuon, 'người mượn');
      nvCo_(muon, 'Người mượn');
      var ngay = ngayHopLe_(p.ngayMuon, 'Ngày mượn'), han = ngayHopLe_(p.hanTra, 'Hạn trả');
      if (han < ngay) throw new Error('Hạn trả phải sau ngày mượn');
      var ids = dbNextId_('mt', ds.length), rows = [], pt = {};
      ds.forEach(function (ma, i) {
        var a = tsCanCo_(ma); if (a.tinhTrang !== T.KHO) throw new Error('Chỉ cho mượn tài sản đang trong kho: ' + tenTT_(a));
        rows.push({ id: ids[i], ma: ma, nguoiMuon: muon, ngayMuon: ngay, hanTra: han, ghiChu: p.ghiChu || '', taoLuc: bayGio_() });
        pt[ma] = { tinhTrang: T.MUON, nguoiSD: muon };
      });
      dbAppend_('mt', rows); dbUpdate_('ts', pt); nhatKy_('Cho mượn', ds.join(', '), 'Người mượn ' + muon + ', hạn ' + han);
      return duLieu_();
    });
  });
}

function loanReturn(id, p) {
  var __g = authGate_('loanReturn', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), r = dbFind_('mt', id); if (!r) throw new Error('Không có phiếu mượn ' + id);
      if (r.ngayTra) throw new Error('Phiếu ' + id + ' đã trả ngày ' + r.ngayTra);
      var ngay = ngayHopLe_(p.ngayTra, 'Ngày trả'); if (ngay < r.ngayMuon) throw new Error('Ngày trả trước ngày mượn');
      var pm = {}; pm[id] = { ngayTra: ngay, tinhTrangTra: p.tinhTrangTra || '', ghiChu: p.ghiChu !== undefined && p.ghiChu !== '' ? p.ghiChu : r.ghiChu };
      dbUpdate_('mt', pm);
      var a = dbFind_('ts', r.ma);
      if (a && a.tinhTrang === T.MUON) { var pt = {}; pt[r.ma] = { tinhTrang: p.hong ? T.HONG : T.KHO, nguoiSD: '' }; dbUpdate_('ts', pt); }
      nhatKy_('Nhận trả', r.ma, id + (p.hong ? ' · trả về bị hỏng' : ''));
      return duLieu_();
    });
  });
}

function dispose(p) {
  var __g = authGate_('dispose', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), ds = dsMa_(p), ngay = ngayHopLe_(p.ngay, 'Ngày thanh lý'), thu = Math.round(Number(p.giaTriThuHoi) || 0);
      if (thu < 0) throw new Error('Giá trị thu hồi không được âm');
      var duyet = nvCo_(p.nguoiDuyet, 'Người duyệt'), ids = dbNextId_('tl', ds.length), rows = [], pt = {}, soBB = soBienBan_('Thanh lý', ngay, {});
      ds.forEach(function (ma, i) {
        var a = tsCanCo_(ma);
        if (a.tinhTrang === T.TL) throw new Error(ma + ' đã thanh lý');
        if (a.tinhTrang === T.MUON) throw new Error(ma + ' đang cho mượn, nhận trả trước rồi mới thanh lý');
        if (a.ngayMua && ngay < a.ngayMua) throw new Error('Ngày thanh lý trước ngày mua của ' + ma);
        var g = Math.round(khauHao_(a, ngay).gtcl), tien = ds.length > 1 && p.chiaDeu ? Math.round(thu / ds.length) : thu;
        rows.push({ id: ids[i], ngay: ngay, ma: ma, lyDo: p.lyDo || '', hinhThuc: p.hinhThuc || '', giaTriThuHoi: tien, gtcl: g, laiLo: tien - g,
          nguoiDuyet: duyet, soQD: p.soQD || '', ghiChu: p.ghiChu || '', taoLuc: bayGio_(), bienBan: soBB, truoc: chupTruoc_(a) });
        pt[ma] = { tinhTrang: T.TL, nguoiSD: '' };
      });
      dbAppend_('tl', rows); dbUpdate_('ts', pt); nhatKy_('Thanh lý', ds.join(', '), (p.hinhThuc || '') + ' · thu ' + thu + ' · ' + soBB);
      var d = duLieu_(); d.moi = ids; d.bienBan = soBB; return d;
    });
  });
}

function createAudit(p) {
  var __g = authGate_('createAudit', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), ngay = ngayHopLe_(p.ngay, 'Ngày kiểm kê'), nguoi = nvCo_(p.nguoiKiem, 'Người kiểm');
      var pv = p.phamVi || 'tat_ca', gt = p.giaTri || '';
      var ds = dbRows_('ts').filter(function (a) {
        if (a.tinhTrang === T.TL) return false;
        if (pv === 'phong_ban') return a.phongBan === gt;
        if (pv === 'vi_tri') return a.viTri === gt;
        if (pv === 'loai') return a.loai === gt;
        return true;
      });
      if (!ds.length) throw new Error('Không có tài sản nào trong phạm vi đã chọn');
      var goc = 'KK-' + ngay.replace(/-/g, ''), dot = goc, n = 1, daCo = {};
      dbRows_('kk').concat((ledger.voided||[]).filter(v=>v.table==='kk').map(v=>v.record)).forEach(function (r) { daCo[r.dot] = 1; });
      while (daCo[dot]) dot = goc + '-' + (++n);
      // Cột riêng để mã đợt KK-... không bị dùng làm số văn bản.
      if (dbRead_('kk').idx.bienBan < 0) throw new Error('Thiếu cột Số biên bản ở sheet Kiểm kê. Tải lại ứng dụng để tự nâng cấp cấu trúc dữ liệu.');
      var soBB = soBienBan_('Kiểm kê', ngay, {}), ids = dbNextId_('kk', ds.length);
      dbAppend_('kk', ds.map(function (a, i) {
        return { id: ids[i], dot: dot, bienBan: soBB, ngayKiem: ngay, ma: a.ma, viTriSo: a.viTri, nguoiSo: a.nguoiSD, ketQua: '', viTriTT: '', nguoiKiem: nguoi,
          ghiChu: '', daApDung: '', taoLuc: bayGio_() };
      }));
      nhatKy_('Tạo đợt kiểm kê', dot, soBB + ' · ' + ds.length + ' tài sản' + (gt ? ' · ' + gt : ''));
      var d = duLieu_(); d.moi = [dot]; d.bienBan = soBB; return d;
    });
  });
}

function setAuditResults(kq) {
  var __g = authGate_('setAuditResults', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var pt = {}, hop = KK_KQ_(), dots = {};
      (kq || []).forEach(function (x) {
        var r = dbFind_('kk', x.id); if (!r) throw new Error('Không có dòng kiểm kê ' + x.id);
        dots[r.dot] = 1;
        if (r.daApDung) throw new Error('Đợt ' + r.dot + ' đã áp dụng, không sửa kết quả được');
        if (x.ketQua && hop.indexOf(x.ketQua) < 0) throw new Error('Kết quả không hợp lệ');
        if (x.ketQua === 'Sai vị trí' && !String(x.viTriTT || '').trim()) throw new Error('Sai vị trí: ghi vị trí thực tế cho ' + r.ma);
        pt[x.id] = { ketQua: x.ketQua || '', viTriTT: x.ketQua === 'Sai vị trí' ? x.viTriTT : '', ghiChu: x.ghiChu || '' };
      });
      dbUpdate_('kk', pt);
      if (Object.keys(pt).length) nhatKy_('Ghi kết quả kiểm kê', Object.keys(dots).join(', '), Object.keys(pt).length + ' dòng');
      return duLieu_();
    });
  });
}

function applyAudit(dot) {
  var __g = authGate_('applyAudit', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), hn = homNay_(), rs = dbRows_('kk').filter(function (r) { return r.dot === dot; });
      if (!rs.length) throw new Error('Không có đợt ' + dot);
      if (rs.some(function (r) { return r.daApDung; })) throw new Error('Đợt ' + dot + ' đã áp dụng');
      var chua = rs.filter(function (r) { return !r.ketQua; }).length;
      var pt = {}, pk = {}, dem = { hong: 0, mat: 0, viTri: 0, ve: 0 };
      rs.forEach(function (r) {
        pk[r.id] = { daApDung: hn };
        var a = dbFind_('ts', r.ma); if (!a || a.tinhTrang === T.TL || !r.ketQua) return;
        if (r.ketQua === 'Hỏng' && a.tinhTrang !== T.HONG) { pt[r.ma] = { tinhTrang: T.HONG }; dem.hong++; }
        if (r.ketQua === 'Thiếu' && a.tinhTrang !== T.MAT) { pt[r.ma] = { tinhTrang: T.MAT }; dem.mat++; }
        if (r.ketQua === 'Sai vị trí' && r.viTriTT) { pt[r.ma] = { viTri: r.viTriTT }; dem.viTri++; }
        if (r.ketQua === 'Có mặt' && a.tinhTrang === T.MAT) { pt[r.ma] = { tinhTrang: a.nguoiSD || a.phongBan ? T.DUNG : T.KHO }; dem.ve++; }
      });
      dbUpdate_('kk', pk); dbUpdate_('ts', pt);
      nhatKy_('Áp dụng kiểm kê', dot, 'Hỏng ' + dem.hong + ', thất lạc ' + dem.mat + ', đổi vị trí ' + dem.viTri + ', tìm lại ' + dem.ve + (chua ? ', ' + chua + ' dòng chưa kiểm' : ''));
      var d = duLieu_(); d.ketQua = dem; return d;
    });
  });
}

function soThang_(tu, den) {
  if (!tu || !den) return 0;
  var a = tu.split('-').map(Number), b = den.split('-').map(Number);
  var t = (b[0] - a[0]) * 12 + (b[1] - a[1]) - (b[2] < a[2] ? 1 : 0);
  return Math.max(0, t);
}

function khauHao_(ts, denNgay) {
  var ng = Number(ts.nguyenGia) || 0, tg = Number(ts.thoiGianKH) || 0, den = denNgay || homNay_();
  if (!ng || !tg || !ts.ngayMua) return { khNam: tg ? ng / tg : 0, khLuyKe: 0, gtcl: ng, thang: 0, tongThang: tg * 12, het: false };
  var tong = tg * 12, th = Math.min(soThang_(ts.ngayMua, den), tong), lk = ng / tong * th;
  return { khNam: ng / tg, khLuyKe: lk, gtcl: Math.max(ng - lk, 0), thang: th, tongThang: tong, het: th >= tong };
}

function ngayChuoi_(x) {
  if (x === null || x === undefined || x === '') return '';
  if (typeof x === 'number') return x > 0 ? new Date(Math.round((Math.floor(x + 1e-9) - 25569) * 864e5)).toISOString().slice(0, 10) : '';
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x.getTime()) ? '' : Utilities.formatDate(x, tz_(), 'yyyy-MM-dd');
  var s = String(x).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ngayThat_(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return ngayThat_(+m[3], +m[2], +m[1]);
  return '';
}

function ngayThat_(y, mo, d) {
  var t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2200 || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

function setStatus(ma, tt, ghiChu) {
  var __g = authGate_('setStatus', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var a = tsCanCo_(ma), T = TT_();
      if (TT_LIST_().indexOf(tt) < 0) throw new Error('Tình trạng không hợp lệ');
      if (a.tinhTrang === T.TL) throw new Error(ma + ' đã thanh lý');
      if (tt === T.TL) throw new Error('Dùng chức năng Thanh lý để thanh lý tài sản');
      if (tt === T.MUON || a.tinhTrang === T.MUON) throw new Error('Cho mượn và nhận trả ở mục Mượn - trả');
      var pt = {}; pt[ma] = { tinhTrang: tt };
      if (tt === T.KHO) { pt[ma].nguoiSD = ''; pt[ma].phongBan = ''; }
      dbUpdate_('ts', pt); nhatKy_('Đổi tình trạng', ma, a.tinhTrang + ' > ' + tt + (ghiChu ? ' · ' + ghiChu : ''));
      return duLieu_();
    });
  });
}
 function dbDeleteMany_(table,keys) { const list=rows[table],removed=list.filter(r=>keys.includes(r.id));(ledger.voided||=[]).push(...removed.map(r=>({table,record:structuredClone(r),at:now,actor})));for(let i=list.length-1;i>=0;i--)if(keys.includes(list[i].id))list.splice(i,1); }
 function deleteAudit(dot){const list=dbRows_('kk').filter(r=>r.dot===dot);if(!list.length)throw new Error('Không có đợt '+dot);if(list.some(r=>r.daApDung))throw new Error('Đợt đã áp dụng vào sổ, không xoá được');dbDeleteMany_('kk',list.map(r=>r.id));nhatKy_('Xoá đợt kiểm kê',dot,list.length+' dòng');return {};}
function docTruoc_(r) { try { return r.truoc ? JSON.parse(r.truoc) : null; } catch (e) { return null; } }
function soId_(id) { var m = String(id).match(/(\d+)$/); return m ? Number(m[1]) : 0; }
function phieuGD_(key) {
  var rs = dbRows_('gd').filter(function (r) { return r.bienBan && r.bienBan === key; });
  if (!rs.length) rs = dbRows_('gd').filter(function (r) { return r.id === key; });
  if (!rs.length) throw new Error('Không có phiếu ' + key);
  return rs;
}
function coViecSau_(ma, taoLuc, boQuaBang) {
  var sau = function (r) { return r.ma === ma && String(r.taoLuc) > String(taoLuc); };
  return ['mt', 'tl', 'bt'].some(function (t) { return t !== boQuaBang && dbRows_(t).some(sau); }) ||
    dbRows_('kk').some(function (r) { return r.ma === ma && r.daApDung && String(r.taoLuc) > String(taoLuc); });
}
function updateMove(key, p) {
  var __g = authGate_('updateMove', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var rs = phieuGD_(key), pt = {}, o = {};
      if (p.ngay !== undefined) o.ngay = ngayHopLe_(p.ngay, 'Ngày');
      if (p.nguoiDuyet !== undefined) o.nguoiDuyet = nvCo_(p.nguoiDuyet, 'Người duyệt');
      ['lyDo', 'tinhTrangGiao', 'ghiChu'].forEach(function (k) { if (p[k] !== undefined) o[k] = String(p[k] || '').trim(); });
      rs.forEach(function (r) { pt[r.id] = o; });
      dbUpdate_('gd', pt);
      nhatKy_('Sửa phiếu ' + rs[0].loai.toLowerCase(), key, rs.map(function (r) { return r.ma; }).join(', '));
      return duLieu_();
    });
  });
}
function undoMove(key) {
  var __g = authGate_('undoMove', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), rs = phieuGD_(key), gd = dbRows_('gd'), pt = {};
      rs.forEach(function (r) {
        var a = tsCanCo_(r.ma);
        var cua = gd.filter(function (x) { return x.ma === r.ma; }).sort(function (x, y) { return soId_(x.id) - soId_(y.id); });
        if (cua[cua.length - 1].id !== r.id) throw new Error(r.ma + ' đã có phiếu giao nhận sau ' + key + '. Huỷ phiếu sau trước.');
        if (coViecSau_(r.ma, r.taoLuc, 'bt')) throw new Error(r.ma + ' đã có mượn trả, thanh lý hoặc kiểm kê sau phiếu này, không huỷ được');
        if (r.loai !== 'Thu hồi' && (a.tinhTrang !== T.DUNG || a.nguoiSD !== r.nguoiNhan)) throw new Error(r.ma + ' đã đổi sang ' + a.tinhTrang + ' sau phiếu này, không huỷ được');
        if (r.loai === 'Thu hồi' && a.nguoiSD) throw new Error(r.ma + ' đã giao cho người khác sau phiếu này, không huỷ được');
        var truoc = docTruoc_(r);
        if (!truoc) { // phiếu cũ không có ảnh chụp: suy ra từ phiếu giao nhận ngay trước
          var trc = cua.length > 1 ? cua[cua.length - 2] : null, nv = r.nguoiGiao ? dbFind_('nv', r.nguoiGiao) : null;
          truoc = r.loai === 'Cấp phát' ? { tinhTrang: T.KHO, nguoiSD: '', phongBan: '', viTri: trc ? trc.viTri : 'Kho chính' }
            : { tinhTrang: T.DUNG, nguoiSD: r.nguoiGiao, phongBan: trc && trc.loai !== 'Thu hồi' ? trc.phongBan : (nv ? nv.phongBan : ''), viTri: trc ? trc.viTri : '' };
        }
        pt[r.ma] = { tinhTrang: truoc.tinhTrang, nguoiSD: truoc.nguoiSD || '', phongBan: truoc.phongBan || '', viTri: truoc.viTri || '' };
      });
      dbDeleteMany_('gd', rs.map(function (r) { return r.id; }));
      dbUpdate_('ts', pt);
      nhatKy_('Huỷ phiếu ' + rs[0].loai.toLowerCase(), key, rs.map(function (r) { return r.ma; }).join(', '));
      return duLieu_();
    });
  });
}
function capNhatTheoBT_(ma, daXoa) {
  var T = TT_(), a = dbFind_('ts', ma); if (!a || a.tinhTrang === T.TL) return;
  var rs = dbRows_('bt').filter(function (r) { return r.ma === ma; }).sort(function (x, y) { return x.ngay < y.ngay ? -1 : x.ngay > y.ngay ? 1 : soId_(x.id) - soId_(y.id); });
  var cuoi = rs[rs.length - 1], o = {}, truoc = daXoa ? docTruoc_(daXoa) : null;
  var xoaCuoi = daXoa && (!cuoi || daXoa.ngay > cuoi.ngay || (daXoa.ngay === cuoi.ngay && soId_(daXoa.id) > soId_(cuoi.id)));
  if (cuoi && cuoi.ngayTiep) o.ngayBTTiep = cuoi.ngayTiep;
  else if (xoaCuoi) o.ngayBTTiep = truoc ? truoc.ngayBTTiep || '' : '';
  if (cuoi && cuoi.ketQua !== 'Hoàn thành' && [T.KHO, T.DUNG, T.HONG].indexOf(a.tinhTrang) >= 0) o.tinhTrang = T.SUA;
  if (a.tinhTrang === T.SUA && (!cuoi || cuoi.ketQua === 'Hoàn thành'))
    o.tinhTrang = xoaCuoi && truoc && truoc.tinhTrang && truoc.tinhTrang !== T.SUA ? truoc.tinhTrang : (a.nguoiSD || a.phongBan ? T.DUNG : T.KHO);
  if (Object.keys(o).length) { var pt = {}; pt[ma] = o; dbUpdate_('ts', pt); }
}
function updateMaint(id, p) {
  var __g = authGate_('updateMaint', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var r = dbFind_('bt', id); if (!r) throw new Error('Không có phiếu bảo trì ' + id);
      var ngay = ngayHopLe_(p.ngay, 'Ngày bảo trì'), tiep = ngayHopLe_(p.ngayTiep, 'Ngày bảo trì tiếp theo', true);
      if (tiep && tiep < ngay) throw new Error('Ngày bảo trì tiếp theo phải sau ngày bảo trì');
      var chiPhi = Math.round(Number(p.chiPhi) || 0); if (chiPhi < 0) throw new Error('Chi phí không được âm');
      var pt = {}; pt[id] = { ngay: ngay, loai: p.loai || '', noiDung: p.noiDung || '', donVi: p.donVi || '', chiPhi: chiPhi, ketQua: p.ketQua || 'Hoàn thành', ngayTiep: tiep, ghiChu: p.ghiChu || '' };
      dbUpdate_('bt', pt);
      capNhatTheoBT_(r.ma, null);
      nhatKy_('Sửa phiếu bảo trì', id, r.ma);
      return duLieu_();
    });
  });
}
function deleteMaint(id) {
  var __g = authGate_('deleteMaint', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var r = dbFind_('bt', id); if (!r) throw new Error('Không có phiếu bảo trì ' + id);
      dbDeleteMany_('bt', [id]);
      capNhatTheoBT_(r.ma, r);
      nhatKy_('Xoá phiếu bảo trì', id, r.ma + ' · ' + r.noiDung);
      return duLieu_();
    });
  });
}
function updateLoan(id, p) {
  var __g = authGate_('updateLoan', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), r = dbFind_('mt', id); if (!r) throw new Error('Không có phiếu mượn ' + id);
      var muon = batBuoc_(p.nguoiMuon, 'người mượn'); nvCo_(muon, 'Người mượn');
      var ngay = ngayHopLe_(p.ngayMuon, 'Ngày mượn'), han = ngayHopLe_(p.hanTra, 'Hạn trả');
      if (han < ngay) throw new Error('Hạn trả phải sau ngày mượn');
      var o = { nguoiMuon: muon, ngayMuon: ngay, hanTra: han, ghiChu: p.ghiChu || '' };
      if (r.ngayTra) {
        o.ngayTra = ngayHopLe_(p.ngayTra, 'Ngày trả'); if (o.ngayTra < ngay) throw new Error('Ngày trả trước ngày mượn');
        o.tinhTrangTra = p.tinhTrangTra || '';
      }
      var pm = {}; pm[id] = o; dbUpdate_('mt', pm);
      var a = dbFind_('ts', r.ma);
      if (!r.ngayTra && a && a.tinhTrang === T.MUON && a.nguoiSD !== muon) { var pt = {}; pt[r.ma] = { nguoiSD: muon }; dbUpdate_('ts', pt); }
      nhatKy_('Sửa phiếu mượn', id, r.ma);
      return duLieu_();
    });
  });
}
function deleteLoan(id) {
  var __g = authGate_('deleteLoan', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), r = dbFind_('mt', id); if (!r) throw new Error('Không có phiếu mượn ' + id);
      var a = dbFind_('ts', r.ma);
      if (!r.ngayTra) { // chưa trả: tài sản về kho như trước khi mượn
        if (a && (a.tinhTrang !== T.MUON || a.nguoiSD !== r.nguoiMuon)) throw new Error(r.ma + ' không còn ở trạng thái cho mượn, không huỷ được');
        if (a) { var pt = {}; pt[r.ma] = { tinhTrang: T.KHO, nguoiSD: '' }; dbUpdate_('ts', pt); }
      }
      dbDeleteMany_('mt', [id]);
      nhatKy_('Huỷ phiếu mượn', id, r.ma + (r.ngayTra ? ' (đã trả, chỉ xoá lịch sử)' : ''));
      return duLieu_();
    });
  });
}
function updateDisposal(id, p) {
  var __g = authGate_('updateDisposal', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var r = dbFind_('tl', id); if (!r) throw new Error('Không có phiếu thanh lý ' + id);
      var a = tsCanCo_(r.ma), ngay = ngayHopLe_(p.ngay, 'Ngày thanh lý'), thu = Math.round(Number(p.giaTriThuHoi) || 0);
      if (thu < 0) throw new Error('Giá trị thu hồi không được âm');
      if (a.ngayMua && ngay < a.ngayMua) throw new Error('Ngày thanh lý trước ngày mua');
      var g = Math.round(khauHao_(a, ngay).gtcl);
      var pt = {}; pt[id] = { ngay: ngay, hinhThuc: p.hinhThuc || '', giaTriThuHoi: thu, gtcl: g, laiLo: thu - g, lyDo: p.lyDo || '', soQD: p.soQD || '',
        nguoiDuyet: nvCo_(p.nguoiDuyet, 'Người duyệt'), ghiChu: p.ghiChu || '' };
      dbUpdate_('tl', pt);
      nhatKy_('Sửa phiếu thanh lý', id, r.ma);
      return duLieu_();
    });
  });
}
function undoDisposal(id) {
  var __g = authGate_('undoDisposal', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      var T = TT_(), r = dbFind_('tl', id); if (!r) throw new Error('Không có phiếu thanh lý ' + id);
      var a = tsCanCo_(r.ma); if (a.tinhTrang !== T.TL) throw new Error(r.ma + ' không còn ở trạng thái đã thanh lý');
      var truoc = docTruoc_(r) || { tinhTrang: T.KHO, nguoiSD: '', phongBan: '', viTri: 'Kho chính' };
      var pt = {}; pt[r.ma] = { tinhTrang: truoc.tinhTrang === T.TL ? T.KHO : truoc.tinhTrang, nguoiSD: truoc.nguoiSD || '', phongBan: truoc.phongBan || '', viTri: truoc.viTri || a.viTri || 'Kho chính' };
      dbDeleteMany_('tl', [id]);
      dbUpdate_('ts', pt);
      nhatKy_('Huỷ thanh lý', id, r.ma);
      return duLieu_();
    });
  });
}
 function khoaTaoTaiSan_(fn){return fn();}
 function xoaAnhCu_(){} // File storage uses the existing QLNS kho, never Google Drive mutations.
 function dbDelete_(table,key){const rowsForTable=rows[table];const i=rowsForTable.findIndex(r=>(table==='ts'?r.ma:r.id)===key);if(i>=0)rowsForTable.splice(i,1);}
function saveAsset(p, laMoi) {
  var __g = authGate_('saveAsset', arguments); if (__g) return __g;
  // Giữ API/quyền thêm tài sản cũ; lô dùng lại kiểm tra nhập Excel nhưng không cập nhật/bỏ qua mã trùng.
  if (laMoi && p && Object.prototype.hasOwnProperty.call(p, 'loTaiSan')) {
    return importAssets(p.loTaiSan, { chiThemMoi: true, anhLo: p.anhLo || '' });
  }
  return api_(function () {
    return khoaTaoTaiSan_(function () {
      var ma = batBuoc_(p.ma, 'mã tài sản'), ten = batBuoc_(p.ten, 'tên tài sản');
      if (!/^[A-Za-z0-9._\/-]+$/.test(ma)) throw new Error('Mã tài sản chỉ gồm chữ không dấu, số và - _ . /');
      var cu = dbFind_('ts', ma);
      if (laMoi && cu) throw new Error('Mã ' + ma + ' đã có');
      if (!laMoi && !cu) throw new Error('Không có tài sản ' + ma);
      var ng = Number(p.nguyenGia) || 0, tg = Number(p.thoiGianKH) || 0;
      if (ng < 0) throw new Error('Nguyên giá không được âm');
      if (tg < 0 || tg > 100) throw new Error('Thời gian khấu hao phải từ 0 đến 100 năm');
      var o = { ma: ma, ten: ten, loai: p.loai || '', thuongHieu: p.thuongHieu || '', model: p.model || '', serial: p.serial || '',
        ngayMua: ngayHopLe_(p.ngayMua, 'Ngày mua'), nhaCungCap: p.nhaCungCap || '', nguyenGia: Math.round(ng), thoiGianKH: tg,
        hanBH: ngayHopLe_(p.hanBH, 'Hạn bảo hành', true), ngayBTTiep: ngayHopLe_(p.ngayBTTiep, 'Ngày bảo trì tiếp theo', true),
        anh: p.anh || '', ghiChu: p.ghiChu || '' };
      if (laMoi) {
        o.tinhTrang = TT_().KHO; o.viTri = p.viTri || 'Kho chính'; o.phongBan = ''; o.nguoiSD = ''; o.taoLuc = bayGio_();
        dbAppend_('ts', [o]); nhatKy_('Thêm tài sản', ma, ten);
      } else {
        if (p.viTri !== undefined) o.viTri = p.viTri;
        if (o.anh !== String(cu.anh || '')) xoaAnhCu_(cu.anh); // đổi hoặc bỏ ảnh trong ngăn kéo Sửa: tệp Drive cũ vào thùng rác
        var pt = {}; pt[ma] = o; dbUpdate_('ts', pt); nhatKy_('Sửa tài sản', ma, ten);
      }
      return duLieu_();
    });
  });
}
function deleteAsset(ma) {
  var __g = authGate_('deleteAsset', arguments); if (__g) return __g;
  return api_(function () {
    return khoa_(function () {
      tsCanCo_(ma);
      var co = ['gd', 'bt', 'mt', 'tl', 'kk'].filter(function (t) { return dbRows_(t).some(function (r) { return r.ma === ma; }); });
      if (co.length) throw new Error('Tài sản ' + ma + ' đã có lịch sử (' + co.map(function (t) { return BANG_()[t].sheet; }).join(', ') + '), không xoá được. Nếu không dùng nữa, hãy thanh lý.');
      dbDelete_('ts', ma); nhatKy_('Xoá tài sản', ma, '');
      return duLieu_();
    });
  });
}
 function catalogSave(p){
  if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>1000)throw new Error('Danh sách tài sản không hợp lệ');
  const seen=new Set(),ids=new Set();for(const v of p.rows){if(v.id){if(ids.has(v.id)||!/^[A-Za-z0-9._-]{1,120}$/.test(v.id))throw new Error('Định danh tài sản trùng hoặc không hợp lệ');ids.add(v.id);}if(v.loai!=='vl'||!v.ma||seen.has(v.ma))throw new Error('Loại tài sản hoặc mã trùng không hợp lệ');seen.add(v.ma);
   const cu=dbFind_('ts',v.ma),create=v.create===undefined?!!p.create:!!v.create;
   if(!create&&(!cu||v.id&&T.ds.find(x=>x.ma===v.ma)?.id!==v.id))throw new Error('Không đổi mã/định danh tài sản');
   if(v.gia!=null&&(!Number.isFinite(+v.gia)||+v.gia<0||+v.gia>Number.MAX_SAFE_INTEGER))throw new Error('Nguyên giá không hợp lệ');
   if(v.anhNguon&&!/^(kho:f[A-Za-z0-9._-]{6,100}$|https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(v.anhNguon))throw new Error('Liên kết ảnh phải là HTTP(S) hoặc ảnh hợp lệ');
   const oldPrice=cu?.nguyenGia,oldTerm=cu?.thoiGianKH;
   saveAsset({ma:v.ma,ten:v.ten,loai:v.nhom,thuongHieu:v.thuongHieu,model:v.model,serial:v.serial,ngayMua:v.ngay,nhaCungCap:v.ncc,nguyenGia:v.gia,thoiGianKH:v.khNam,hanBH:v.baoHanh,ngayBTTiep:v.baoTri,viTri:v.viTri,ghiChu:v.ghi,anh:v.anhNguon!==undefined?v.anhNguon:cu?.anh||''},create);
   const a=dbFind_('ts',v.ma);if(!create&&oldPrice===v.gia)a.nguyenGia=oldPrice;if(!create&&oldTerm===v.khNam)a.thoiGianKH=oldTerm;
   a._qlns={id:v.id,anh:v.anh,ttGhi:v.ttGhi,pct:v.pct,create};
  }return {count:p.rows.length};
 }
 function catalogDelete(p){const x=T.ds.find(x=>x.ma===p.ma);if(!x)throw new Error('Không có tài sản');if(x.giu||x.ls?.length||T.pg.some(d=>(d.ds||[]).some(r=>r.id===x.id||r.ma===x.ma)))throw new Error('Tài sản đã có lịch sử, không được xóa');deleteAsset(p.ma);return {};}
 function saveTemplates(p){
  const value=p.templates;if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>49000)throw new Error('Mẫu biên bản không hợp lệ hoặc quá 49.000 ký tự');
  const m=structuredClone(value),meta=renderAssetDocument(unit,'templateMeta',null);for(const [kind,t] of Object.entries(m)){if(kind==='chung')continue;if(!t||typeof t!=='object'||Array.isArray(t))throw new Error('Cấu hình mẫu '+kind+' không hợp lệ');if(t.cot!==undefined&&(!Array.isArray(t.cot)||t.cot.length<2||new Set(t.cot).size!==t.cot.length||t.cot.some(k=>!(meta.columns[kind]||[]).some(c=>c[0]===k))))throw new Error('Mẫu '+kind+' cần ít nhất hai cột hợp lệ, không trùng');}m['Cấp phát']||={};m['Cấp phát'].kyHieu='BBBG';m['Cấp phát'].tieuDe='BIÊN BẢN BÀN GIAO TÀI SẢN';m['Kiểm kê']||={};m['Kiểm kê'].kyHieu='BBKK';
  T.ksbTemplates=m;for(const k of ['baoTruocBH','baoTruocBT']){const n=p.config?.[k];if(n!==undefined){if(!Number.isFinite(n)||n<0||n>365)throw new Error('Ngưỡng nhắc hạn từ 0 đến 365 ngày');(T.ksbConfig||={})[k]=n;}}
  nhatKy_('Sửa mẫu biên bản KSB','','');return {};
 }
 function saveCatalogs(p){
  const input=p.catalogs;if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Danh mục không hợp lệ');
  const out={};for(const k of ['loai','viTri','nhaCungCap','hinhThucTL','loaiBT','ketQuaBT']){if(!Array.isArray(input[k]))throw new Error('Danh mục '+k+' phải là danh sách');out[k]=[...new Set(input[k].map(x=>String(x).trim()).filter(Boolean))];}
  T.ksbCatalogs=out;nhatKy_('Sửa danh mục tài sản','','');return {};
 }
 function renameCatalog(p){const columns={loai:[['ts','loai']],viTri:[['ts','viTri'],['gd','viTri'],['kk','viTriSo'],['kk','viTriTT']],nhaCungCap:[['ts','nhaCungCap']],hinhThucTL:[['tl','hinhThuc']],loaiBT:[['bt','loai']],ketQuaBT:[['bt','ketQua']]},k=p.kind,old=String(p.old||'').trim(),name=String(p.name||'').trim();if(!columns[k]||!old||!name||old===name)throw new Error('Chọn danh mục, tên cũ và tên mới khác nhau');if(k==='ketQuaBT'&&(old==='Hoàn thành'||name==='Hoàn thành'))throw new Error('Không đổi tên kết quả Hoàn thành vì dùng để tính trạng thái');const c=getAssetCatalogs(unit);c[k]=[...new Set(c[k].map(v=>v===old?name:v))];T.ksbCatalogs=c;if(k==='loai')T.nhom=[...new Set((T.nhom||[]).map(v=>v===old?name:v))];let count=0;for(const [table,col] of columns[k])for(const r of dbRows_(table))if(String(r[col]||'').trim()===old){r[col]=name;count++;}nhatKy_('Đổi tên danh mục tài sản',old+' > '+name,count+' dòng; không sửa danh mục nhân sự QLNS');return {count};}
 function attachDocument(p) {
  if(!['gd','bt','tl','kk'].includes(p.table)||!['fileBB','banKy'].includes(p.field)||!/^f[A-Za-z0-9._-]{6,100}$/.test(p.file||''))throw new Error('Tham chiếu tài liệu không hợp lệ');
  const found=dbRows_(p.table).filter(r=>(p.table==='kk'?r.dot:r.bienBan||r.id)===p.key);if(!found.length)throw new Error('Không tìm thấy biên bản để đính kèm');
  for(const r of found){const a=r.documents||=[];a.push({field:p.field,file:p.file,at:now,actor});r[p.field]=p.file;}
  nhatKy_('Lưu tài liệu biên bản',p.key,p.field);return {};
 }
 function detachDocument(p){
  if(!['gd','bt','tl','kk'].includes(p.table)||!['fileBB','banKy'].includes(p.field))throw new Error('Tham chiếu không hợp lệ');
  const found=dbRows_(p.table).filter(r=>(p.table==='kk'?r.dot:r.bienBan||r.id)===p.key);if(!found.length)throw new Error('Không tìm thấy biên bản');
  for(const r of found){if(r[p.field]!==p.file)throw new Error('Tài liệu vừa thay đổi; tải lại trước khi gỡ');const docs=r.documents||=[];for(const d of docs)if(d.field===p.field&&d.file===p.file){d.removedAt=now;d.removedBy=actor;}const prior=docs.filter(d=>d.field===p.field&&d.file!==p.file&&!d.removedAt).at(-1);r[p.field]=prior?.file||'';}
  nhatKy_('Gỡ tham chiếu tài liệu',p.key,p.field+' · giữ tệp và lịch sử');return {};
 }

 // GAS import rules are kept verbatim below; the batch writer commits the cloned unit atomically in D1.
 function NHAP_SUA_TS_(){return ['ten','loai','thuongHieu','model','serial','ngayMua','nhaCungCap','nguyenGia','thoiGianKH','hanBH','viTri','ngayBTTiep','anh','ghiChu'];}
 function coGiaTri_(x){return x!==undefined&&x!==null&&String(x).trim()!=='';}
 function themDanhMuc_(them){const c=getAssetCatalogs(unit);for(const k of Object.keys(c))if(k!=='phongBan')c[k]=[...new Set(c[k].concat(them[k]||[]))];T.ksbCatalogs=c;}
 function ghiLoTaiSanMoi_(list,image){if(image&&!/^kho:f[A-Za-z0-9._-]{6,100}$/.test(image)&&(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>8000000))throw new Error('Ảnh không hợp lệ hoặc quá lớn; chưa lưu lô.');if(image)for(const a of list)a.anh=image;dbAppend_('ts',list);return {moi:list.length,daXacMinh:list.filter(a=>dbFind_('ts',a.ma)===a).length,ma:list.map(a=>a.ma)};}
 function sourceImportAssets(p){if(!Array.isArray(p.rows))throw new Error('Danh sách nhập không hợp lệ');const departments=new Set((unit.data?.PB||[]).map(x=>x['Tên phòng ban']).concat(nv.map(x=>x.phongBan)).filter(Boolean));for(const r of p.rows){if(r.phongBan&&!departments.has(r.phongBan))throw new Error('Phòng ban '+r.phongBan+' chưa có trong QLNS');if(r.anh&&!/^(kho:f[A-Za-z0-9._-]{6,100}$|https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(r.anh))throw new Error('Ảnh không hợp lệ');}return importAssets(p.rows,p.opt);}
function importAssets(rows, opt) {
  var __g = authGate_('importAssets', arguments); if (__g) return __g;
  return api_(function () {
    return khoaTaoTaiSan_(function () {
      opt = opt || {};
      var T = TT_(), ton = {}, nv = {}, gap = {}, loi = [], moi = [], sua = {}, boQua = 0, tao = bayGio_(), dm = { loai: [], phongBan: [], viTri: [], nhaCungCap: [] };
      dbRows_('ts').forEach(function (a) { ton[a.ma] = a; });
      dbRows_('nv').forEach(function (n) { nv[n.ma] = n; });
      if (!rows || !rows.length) throw new Error('Không có dòng nào để nhập');
      if (opt.chiThemMoi && (!Array.isArray(rows) || rows.length < 2 || rows.length > 50)) throw new Error('Mỗi lần thêm lô từ 2 đến 50 tài sản.');
      if (rows.length > 5000) throw new Error('Mỗi lần nhập tối đa 5.000 tài sản');
      rows.forEach(function (r) {
        var dong = 'Dòng ' + (r.dong || '?') + ': ';
        try {
          var ma = String(r.ma || '').trim(), ten = String(r.ten || '').trim();
          if (!ten) throw 'thiếu tên tài sản';
          if (!ma) throw 'thiếu mã tài sản';
          if (!/^[A-Za-z0-9._\/-]+$/.test(ma)) throw 'mã "' + ma + '" chỉ được gồm chữ không dấu, số và - _ . /';
          if (gap[ma]) throw 'mã ' + ma + ' bị trùng trong file';
          gap[ma] = 1;
          if (opt.chiThemMoi) {
            var so = ma.match(/^(.*?)(\d{5,})$/);
            if (!so || Number(so[2]) < 1 || Number(so[2]) > 99999) throw 'mã tự sinh phải có ít nhất 5 chữ số, trong giới hạn 99999';
            if (ton[ma]) throw 'mã ' + ma + ' đã tồn tại. Tải lại dữ liệu và kiểm tra lô mới';
            ngayHopLe_(r.ngayMua, 'Ngày mua');
            if (!isFinite(Number(r.nguyenGia)) || !isFinite(Number(r.thoiGianKH))) throw 'nguyên giá/khấu hao không hợp lệ';
          }
          var o = { ma: ma, ten: ten };
          ['loai', 'thuongHieu', 'model', 'serial', 'nhaCungCap', 'viTri', 'anh', 'ghiChu', 'phongBan'].forEach(function (k) { o[k] = String(r[k] || '').trim(); });
          ['ngayMua', 'hanBH', 'ngayBTTiep'].forEach(function (k) {
            var x = r[k]; if (x === undefined || x === null || String(x).trim() === '') { o[k] = ''; return; }
            o[k] = ngayChuoi_(x); if (!o[k]) throw 'ngày "' + x + '" không đọc được';
          });
          o.nguyenGia = Math.round(Number(r.nguyenGia) || 0); if (o.nguyenGia < 0) throw 'nguyên giá âm';
          o.thoiGianKH = Number(r.thoiGianKH) || 0; if (o.thoiGianKH < 0 || o.thoiGianKH > 100) throw 'thời gian khấu hao phải từ 0 đến 100 năm';
          if (o.hanBH && o.ngayMua && o.hanBH < o.ngayMua) throw 'hạn bảo hành trước ngày mua';
          var nguoi = String(r.nguoiSD || '').trim();
          if (opt.chiThemMoi) { nguoi = ''; o.phongBan = ''; }
          if (nguoi && !nv[nguoi]) throw 'không có nhân viên mã ' + nguoi;
          var tt = String(r.tinhTrang || '').trim();
          if (opt.chiThemMoi) tt = T.KHO;
          if (tt && TT_LIST_().indexOf(tt) < 0) throw 'tình trạng "' + tt + '" không hợp lệ';
          if (tt === T.TL) throw 'tài sản đã thanh lý không nhập được, nhập rồi dùng chức năng Thanh lý';
          if (tt === T.MUON) throw 'tình trạng Đang cho mượn không nhập được, nhập là Trong kho rồi ghi Cho mượn';
          if (!tt) tt = nguoi || o.phongBan ? T.DUNG : T.KHO;
          if (tt === T.KHO) { nguoi = ''; o.phongBan = ''; }
          if (nguoi && !o.phongBan) o.phongBan = nv[nguoi].phongBan || '';
          if (!o.viTri) o.viTri = tt === T.KHO ? 'Kho chính' : (nguoi && nv[nguoi].viTriLamViec) || '';
          ['loai', 'phongBan', 'viTri', 'nhaCungCap'].forEach(function (k) { if (o[k]) dm[k].push(o[k]); });
          if (ton[ma]) {
            if (opt.trung !== 'cap-nhat') { boQua++; return; }
            // chỉ ghi đè ô file CÓ giá trị; ô trống trong file giữ nguyên dữ liệu cũ
            var p = {};
            NHAP_SUA_TS_().forEach(function (k) { if (coGiaTri_(r[k])) p[k] = o[k]; });
            if (ton[ma].tinhTrang !== T.KHO) delete p.viTri; // vị trí tài sản đang dùng đi theo cấp phát
            sua[ma] = p;
            return;
          }
          o.tinhTrang = tt; o.nguoiSD = nguoi; o.taoLuc = tao;
          moi.push(o);
        } catch (e) { loi.push(dong + (e && e.message ? e.message : e)); }
      });
      if (loi.length) throw new Error(loi.length + ' dòng lỗi, chưa nhập gì. ' + loi.slice(0, 6).join('; ') + (loi.length > 6 ? '; ...' : ''));
      if (opt.chiThemMoi) {
        var tongGia = moi.reduce(function (s, r) { return s + r.nguyenGia; }, 0);
        if (!Number.isSafeInteger(tongGia)) throw new Error('Tổng nguyên giá vượt giới hạn số chính xác; chưa lưu lô.');
        var kq = ghiLoTaiSanMoi_(moi, opt.anhLo);
        nhatKy_('Thêm lô tài sản', kq.ma.join(', '), kq.moi + ' tài sản; đã đọc lại xác minh đủ');
        var dl;
        try { dl = duLieu_(); }
        catch (e) { throw new Error('Đã xác minh lưu đủ ' + kq.moi + '/' + kq.moi + ' tài sản nhưng chưa tải lại được dữ liệu. Không lưu lại; tải lại ứng dụng để đối chiếu.'); }
        dl.loTaiSan = kq; return dl;
      }
      if (moi.length) dbAppend_('ts', moi);
      if (Object.keys(sua).length) dbUpdate_('ts', sua);
      if (opt.themDanhMuc) themDanhMuc_(dm);
      nhatKy_('Nhập tài sản', '', moi.length + ' mới, ' + Object.keys(sua).length + ' cập nhật, ' + boQua + ' bỏ qua');
      var d = duLieu_(); d.ketQua = { moi: moi.length, capNhat: Object.keys(sua).length, boQua: boQua }; return d;
    });
  });
}

 function saveSourceSettings(p){
  saveTemplates({templates:T.ksbTemplates||getAssetTemplates(unit),config:{baoTruocBH:+p.baoTruocBH,baoTruocBT:+p.baoTruocBT}});
  saveMailConfig({config:{...(T.ksbMail||{}),...p,gioGui:+p.gioGui}});
  T.ksbConfig={...(T.ksbConfig||{}),nhacBanKy:!!p.nhacBanKy,tuLuuPdf:!!p.tuLuuPdf};return {};
 }
 const allowed = {sourceImportAssets,saveSourceSettings,queueTestMail,renameCatalog,queueDailyMail,saveMailConfig,detachDocument,saveCatalogs,saveTemplates,catalogSave,catalogDelete,updateMove,undoMove,updateMaint,deleteMaint,updateLoan,deleteLoan,updateDisposal,undoDisposal,deleteAudit,attachDocument,recordMove,saveMaint,loanOut,loanReturn,dispose,createAudit,setAuditResults,applyAudit,setStatus};
 if(!Object.hasOwn(allowed,action)) throw new Error('Thao tác tài sản không hợp lệ');

 // Do not let importing a legacy source status count as a completed QLNS handover.
 const reconciledBefore={};
 if(['recordMove','loanOut','dispose'].includes(action))for(const ma of payload.ds||[]){
  const x=T.ds.find(x=>x.ma===ma);if(!x)continue;const decision=assetActionEligibility(unit,x,action,payload.loai);
  if(!decision.allowed)throw new Error(ma+' · '+decision.reason);
  if(decision.requiresReconciliation){
   if(!Array.isArray(payload.reconcileCodes)||!payload.reconcileCodes.includes(ma))throw new Error(ma+' chưa ghi nhận người sử dụng; cần đối chiếu hiện trạng và xác nhận ngay trong biểu mẫu trước khi giao dịch');
   const a=dbFind_('ts',ma);reconciledBefore[ma]=chupTruoc_(a);if(action!=='dispose')a.tinhTrang='Trong kho';
   nhatKy_('Đối chiếu trước giao dịch',ma,'Nguồn QLTS: '+(x.qltsImport?.status||'Chưa rõ')+'; xác nhận không có người giữ/giao nhận chưa hoàn tất; '+actor);
  }
  if(action==='recordMove'&&payload.loai!=='Cấp phát'&&payload.nguoiGiao&&payload.nguoiGiao!==x.giu)throw new Error(ma+' người đang giữ vừa thay đổi; tải lại trước khi giao dịch');
 }
 if(action==='recordMove'&&payload.phongBan){const departments=new Set((unit.data?.PB||[]).map(r=>r['Tên phòng ban']).concat(nv.map(n=>n.phongBan)).filter(Boolean));if(!departments.has(payload.phongBan))throw new Error('Phòng ban nhận không có trong danh mục QLNS của đơn vị');}
 if(action==='dispose') for(const ma of payload.ds||[]){const x=dbFind_('ts',ma);if(x&&(x.nguoiSD||x.phongBan||x.tinhTrang==='Đang sửa chữa'||ledger.mt.some(r=>r.ma===ma&&!r.ngayTra)))throw new Error(ma+' còn giao dịch hoặc người sử dụng; kết thúc/thu hồi trước khi thanh lý');}
 const before=Object.fromEntries(Object.entries(ledger).map(([k,v])=>[k,v.length]));
 const twoArg=['loanReturn','updateMove','updateMaint','updateLoan','updateDisposal'];
 const oneId=['undoMove','deleteMaint','deleteLoan','undoDisposal','deleteAudit'];
 const result = action==='setStatus'?setStatus(payload.ma,payload.tt,payload.ghiChu):twoArg.includes(action)?allowed[action](payload.id||payload.key,payload):oneId.includes(action)?allowed[action](payload.id||payload.key||payload.dot):allowed[action](payload);

 for(const k of ['gd','mt','tl'])for(const r of ledger[k].slice(before[k]))if(reconciledBefore[r.ma]){if(k!=='mt')r.truoc=reconciledBefore[r.ma];r.sourceReconciliation={sourceStatus:T.ds.find(x=>x.ma===r.ma)?.qltsImport?.status||'',actor,at:now};}
 if(action==='recordMove'&&payload.guiEmail){result.queuedEmail=(ledger.mail||[]).length-(before.mail||0);result.daGuiEmail=0;}
 if(action==='catalogDelete')T.ds=T.ds.filter(x=>x.loai==='dt'||assets.some(a=>a.ma===x.ma));
 for(const a of assets){let x=T.ds.find(x=>x.ma===a.ma);if(!x){x={id:a._qlns?.id||'ts-'+crypto.randomUUID(),ma:a.ma,ten:a.ten,loai:'vl',legalOwner:'',giu:'',giuTu:'',phongBan:'',ls:[],anh:[],qlnsCreatedAt:now};T.ds.push(x);}if(action==='catalogSave'&&a._qlns||action==='sourceImportAssets'){a._qlns||={};Object.assign(x,{ten:a.ten,nhom:a.loai,thuongHieu:a.thuongHieu||'',model:a.model||'',serial:a.serial||'',ngay:a.ngayMua||'',ncc:a.nhaCungCap||'',gia:a.nguyenGia,khNam:a.thoiGianKH,baoHanh:a.hanBH||'',ghi:a.ghiChu||'',ttGhi:a._qlns.ttGhi||'',anhNguon:a.anh||''});if(Array.isArray(a._qlns.anh))x.anh=a._qlns.anh;if(a._qlns.pct!==undefined)x.pct=a._qlns.pct;if(a.loai&&!(T.nhom||=[]).includes(a.loai))T.nhom.push(a.loai);}
 if(action==='renameCatalog'){if(payload.kind==='loai')x.nhom=a.loai;if(payload.kind==='nhaCungCap')x.ncc=a.nhaCungCap||'';}
 const old=JSON.stringify(asset(x));if(old===JSON.stringify(a))continue;
  x.ksbStatus=a.tinhTrang;if(a.tinhTrang==='Chờ đối chiếu')delete x.ksbStatus;x.giu=a.nguoiSD||'';x.phongBan=a.phongBan||'';x.viTri=a.viTri||'';x.baoTri=a.ngayBTTiep||'';
  x.tt=({'Trong kho':'Sử dụng tốt','Đang sử dụng':'Sử dụng tốt','Hỏng':'Hỏng cần sửa','Thất lạc':'Mất','Đã thanh lý':'Thanh lý'})[a.tinhTrang]||a.tinhTrang;
  if(!x.giu)x.giuTu=''; else if(action==='recordMove'||action==='loanOut')x.giuTu=payload.ngay||payload.ngayMuon;
 }
 for(const k of ['gd','bt','mt','tl','kk']) for(const r of ledger[k].slice(before[k])){const x=T.ds.find(x=>x.ma===r.ma);if(!x)continue;(x.ls||=[]).push({loai:k==='gd'?(r.loai==='Thu hồi'?'thu':r.loai==='Cấp phát'?'giao':'luan'):k,ngay:r.ngay||r.ngayMuon||r.ngayKiem,ma:r.nguoiNhan||r.nguoiMuon||r.nguoiGiao||'',ten:(nv.find(n=>n.ma===(r.nguoiNhan||r.nguoiMuon||r.nguoiGiao))||{}).hoTen||'',so:r.bienBan||r.id,ghi:r.noiDung||r.ghiChu||'',nguoi:actor});}
 if(action==='loanReturn'){const r=ledger.mt.find(r=>r.id===payload.id),x=T.ds.find(x=>x.ma===r.ma);(x.ls||=[]).push({loai:'tra',ngay:payload.ngayTra,ma:r.nguoiMuon,so:r.id,nguoi:actor});}
 if(action==='setStatus'){const x=T.ds.find(x=>x.ma===payload.ma);(x.ls||=[]).push({loai:'sua',ngay:homNay_(),ghi:'Đối chiếu tình trạng: '+payload.tt,nguoi:actor});}
 // Project new physical handovers into the existing QLNS employee-profile index.
 const previousProfileDocs=T.pg.filter(p=>p.ksbLedger);
 T.pg=T.pg.filter(p=>!p.ksbLedger);
 const groups={};for(const r of ledger.gd){const g=groups[r.bienBan]||=[];g.push(r);}
 for(const [so,list] of Object.entries(groups)){const r=list[0],ma=r.loai==='Thu hồi'?r.nguoiGiao:r.nguoiNhan,person=nv.find(n=>n.ma===ma)||{};
  T.pg.push({ksbLedger:true,so,loai:r.loai==='Thu hồi'?'thu':r.loai==='Luân chuyển'?'luan':'giao',ngay:r.ngay,ma:ma||'',ten:person.hoTen||r.phongBan||'',pb:r.phongBan||'',cd:person.chucVu||'',ghi:r.ghiChu||'',nguoi:(previousProfileDocs.find(p=>p.so===so)||{}).nguoi||r._actor||actor,ds:list.map(row=>{const x=T.ds.find(x=>x.ma===row.ma)||{};return {id:x.id,ma:row.ma,ten:x.ten||row.ma,loai:x.loai,nhom:x.nhom,ghi:x.ghi||'',gia:x.gia,tt:row.tinhTrangGiao||'',ht:row.tinhTrangGiao||'',so};})});
 }
 snapshotAssetDocuments(unit,actor,now,['updateMove','updateMaint','updateDisposal','setAuditResults','applyAudit'].includes(action)?{action,payload}:null);
 T.v=(T.v||0)+1;unit.ver=(unit.ver||0)+1;
 return {unit,result};
}

// Print layout and template defaults copied from customized QLTS 2/index.html.
export function renderAssetDocument(unit, kind, key, options = {}) {
 if(!options.fresh&&kind!=='templates'&&kind!=='preview'){const saved=unit.ts?.ksbDocuments?.[kind+'|'+key];if(saved?.html)return saved.html;}

 const T=unit.ts||{},ledger=T.ksb||{};
 const assets=(T.ds||[]).map(x=>({ma:x.ma,ten:x.ten,loai:x.nhom,serial:x.serial,model:x.model,thuongHieu:x.thuongHieu,ngayMua:x.ngay,nguyenGia:x.gia,thoiGianKH:x.khNam,nguoiSD:x.giu,phongBan:x.phongBan,viTri:x.viTri,tinhTrang:x.ksbStatus||x.tt}));
 const nv=(unit.data?.NV||[]).map(x=>({ma:x['Mã NV'],hoTen:x['Họ và tên'],phongBan:x['Phòng ban'],chucVu:x['Chức danh công việc']||x['Chức vụ']}));
 const by=rows=>Object.fromEntries(rows.map(x=>[x.ma,x]));
 const S={d:{gd:ledger.gd||[],bt:ledger.bt||[],tl:ledger.tl||[],kk:ledger.kk||[],ts:assets,caiDat:{tenCongTy:unit.name,diaChi:unit.info?.diaChi||'',mauBB:JSON.stringify(T.ksbTemplates||{})}},ix:{ts:by(assets),nv:by(nv)}};
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ngay=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'';
 const hn=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const tien=x=>new Intl.NumberFormat('vi-VN').format(Number(x)||0),uniq=a=>[...new Set(a.filter(Boolean))],tong=(a,f)=>a.reduce((n,x)=>n+(+f(x)||0),0),demTheo=(a,f)=>a.reduce((o,x)=>(o[f(x)]=(o[f(x)]||0)+1,o),{}),conQL=x=>x.tinhTrang!=='Đã thanh lý',nvTen=ma=>(S.ix.nv[ma]||{}).hoTen||ma;
 function khauHao(a,den){const n=+a.nguyenGia||0,t=+a.thoiGianKH||0;let months=0;if(a.ngayMua&&t){const x=a.ngayMua.split('-').map(Number),y=den.split('-').map(Number);months=Math.max(0,Math.min(t*12,(y[0]-x[0])*12+y[1]-x[1]-(y[2]<x[2]?1:0)));}return {gtcl:Math.max(0,n-(t?n/(t*12)*months:0))};}
var LOAI_GD = ['Cấp phát', 'Thu hồi', 'Luân chuyển'];
var LOAI_BB = ['Cấp phát', 'Thu hồi', 'Luân chuyển', 'Bảo trì', 'Thanh lý', 'Kiểm kê', 'Nhân viên'];
var TEN_LOAI_BB = { 'Nhân viên': 'Tài sản đang giữ' };
function laGD(k) { return LOAI_GD.indexOf(k) >= 0; }
var COT_GD = [['stt', 'STT'], ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['loai', 'Loại'], ['model', 'Thương hiệu, model'], ['serial', 'Số serial'],
  ['tinhTrang', 'Tình trạng'], ['nguyenGia', 'Nguyên giá'], ['gtcl', 'Giá trị còn lại'], ['ghiChu', 'Ghi chú']];
var COT_BB = {
  'Cấp phát': COT_GD, 'Thu hồi': COT_GD, 'Luân chuyển': COT_GD,
  'Bảo trì': [['stt', 'STT'], ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['serial', 'Số serial'], ['loaiBT', 'Loại bảo trì'], ['noiDung', 'Nội dung'],
    ['ketQua', 'Kết quả'], ['chiPhi', 'Chi phí'], ['ngayTiep', 'Lần tiếp theo'], ['ghiChu', 'Ghi chú']],
  'Thanh lý': [['stt', 'STT'], ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['ngayMua', 'Ngày mua'], ['nguyenGia', 'Nguyên giá'], ['khLuyKe', 'Đã khấu hao'],
    ['gtcl', 'Giá trị còn lại'], ['hinhThuc', 'Hình thức'], ['giaTriThuHoi', 'Thu hồi'], ['laiLo', 'Lãi / lỗ'], ['ghiChu', 'Ghi chú']],
  'Kiểm kê': [['stt', 'STT'], ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['viTriSo', 'Vị trí theo sổ'], ['nguoiSo', 'Người sử dụng'], ['ketQua', 'Kết quả'],
    ['viTriTT', 'Vị trí thực tế'], ['ghiChu', 'Ghi chú']],
  'Nhân viên': [['stt', 'STT'], ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['serial', 'Số serial'], ['ngayNhan', 'Ngày nhận'], ['tinhTrang', 'Tình trạng'],
    ['gtcl', 'Giá trị còn lại'], ['ghiChu', 'Ghi chú']]
};
var COT_TIEN = ['nguyenGia', 'gtcl', 'chiPhi', 'khLuyKe', 'giaTriThuHoi', 'laiLo'], COT_NGAY = ['ngayMua', 'ngayTiep', 'ngayNhan'];
var CHO_CHUNG = [['ngayChu', 'ngày 13 tháng 10 năm 2026'], ['ngay', '13/10/2026'], ['congTy', 'tên công ty'], ['diaChi', 'địa chỉ'], ['soBB', 'số biên bản'], ['soLuong', 'số tài sản']];
var CHO_CHEN = {
  gd: [['benGiao', 'người giao'], ['benNhan', 'người nhận'], ['phongBan', 'phòng ban nhận'], ['viTri', 'vị trí'], ['lyDo', 'lý do']],
  'Bảo trì': [['donVi', 'đơn vị thực hiện'], ['loaiBT', 'loại bảo trì'], ['tongChiPhi', 'tổng chi phí'], ['ngayTiep', 'lần bảo trì tiếp theo'], ['nguoiSD', 'người sử dụng']],
  'Thanh lý': [['soQD', 'số quyết định'], ['hinhThuc', 'hình thức'], ['lyDo', 'lý do'], ['tongConLai', 'tổng giá trị còn lại'], ['tongThuHoi', 'tổng thu hồi'], ['laiLo', 'lãi / lỗ'], ['nguoiDuyet', 'người duyệt']],
  'Kiểm kê': [['dot', 'mã đợt'], ['nguoiKiem', 'người kiểm'], ['phamVi', 'phạm vi'], ['coMat', 'số có mặt'], ['thieu', 'số thiếu'], ['hong', 'số hỏng'], ['saiViTri', 'số sai vị trí'], ['chuaKiem', 'số chưa kiểm']],
  'Nhân viên': [['nhanVien', 'tên nhân viên'], ['chucVu', 'chức vụ'], ['phongBan', 'bộ phận'], ['tongGiaTri', 'tổng giá trị còn lại']]
};
function choChen(k) { return CHO_CHUNG.concat(CHO_CHEN[laGD(k) ? 'gd' : k] || []); }
var KET_2BAN = 'Biên bản được lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.';
var MAU_BB_MAC_DINH = {
  chung: { quocHieu: true, logo: '', font: 'Times New Roman', coChu: '13', noiLap: '' },
  'Cấp phát': { tieuDe: 'BIÊN BẢN BÀN GIAO TÀI SẢN', kyHieu: 'BBBG', nhanGiao: 'BÊN GIAO', nhanNhan: 'BÊN NHẬN',
    moDau: 'Hôm nay, {ngayChu}, tại {congTy}, chúng tôi gồm:', truocBang: 'Hai bên cùng tiến hành bàn giao {soLuong} tài sản dưới đây:',
    cot: ['stt', 'ma', 'ten', 'serial', 'tinhTrang', 'ghiChu'],
    dieuKhoan: '1. Bên nhận đã kiểm tra, xác nhận tài sản đúng chủng loại, số lượng và tình trạng như bảng trên.\n2. Bên nhận có trách nhiệm sử dụng, bảo quản tài sản đúng mục đích công việc; không tự ý cho mượn, tháo lắp hoặc mang ra khỏi công ty khi chưa được phép.\n3. Tài sản hư hỏng, mất mát do lỗi chủ quan, bên nhận chịu trách nhiệm bồi thường theo quy định của công ty.\n4. Khi nghỉ việc hoặc chuyển công tác, bên nhận có trách nhiệm bàn giao lại đầy đủ tài sản.',
    ketThuc: KET_2BAN, ky: { k1: true, k2: true, k3: false }, nhanK1: 'BÊN GIAO', nhanK2: 'BÊN NHẬN', nhanK3: 'NGƯỜI DUYỆT' },
  'Thu hồi': { tieuDe: 'BIÊN BẢN THU HỒI TÀI SẢN', kyHieu: 'BBTH', nhanGiao: 'BÊN TRẢ LẠI', nhanNhan: 'BÊN NHẬN LẠI',
    moDau: 'Hôm nay, {ngayChu}, tại {congTy}, chúng tôi gồm:', truocBang: 'Hai bên cùng xác nhận việc thu hồi {soLuong} tài sản dưới đây về kho:',
    cot: ['stt', 'ma', 'ten', 'serial', 'tinhTrang', 'ghiChu'],
    dieuKhoan: '1. Lý do thu hồi: {lyDo}.\n2. Tình trạng tài sản khi thu hồi được ghi trong bảng trên; hư hỏng, thiếu phụ kiện (nếu có) được ghi ở cột Ghi chú.\n3. Kể từ thời điểm ký biên bản, bên trả lại không còn trách nhiệm quản lý các tài sản đã bàn giao.',
    ketThuc: KET_2BAN, ky: { k1: true, k2: true, k3: false }, nhanK1: 'BÊN TRẢ LẠI', nhanK2: 'BÊN NHẬN LẠI', nhanK3: 'NGƯỜI DUYỆT' },
  'Luân chuyển': { tieuDe: 'BIÊN BẢN LUÂN CHUYỂN TÀI SẢN', kyHieu: 'BBLC', nhanGiao: 'BÊN GIAO', nhanNhan: 'BÊN NHẬN',
    moDau: 'Hôm nay, {ngayChu}, tại {congTy}, chúng tôi gồm:', truocBang: 'Hai bên cùng tiến hành luân chuyển {soLuong} tài sản dưới đây:',
    cot: ['stt', 'ma', 'ten', 'serial', 'tinhTrang', 'ghiChu'],
    dieuKhoan: '1. Lý do luân chuyển: {lyDo}.\n2. Bên nhận đã kiểm tra và tiếp nhận tài sản đúng tình trạng như bảng trên, chịu trách nhiệm quản lý, sử dụng từ thời điểm ký biên bản.',
    ketThuc: KET_2BAN, ky: { k1: true, k2: true, k3: true }, nhanK1: 'BÊN GIAO', nhanK2: 'BÊN NHẬN', nhanK3: 'NGƯỜI DUYỆT' },
  'Bảo trì': { tieuDe: 'BIÊN BẢN BẢO TRÌ, SỬA CHỮA TÀI SẢN', kyHieu: 'BBBT',
    moDau: 'Hôm nay, {ngayChu}, tại {congTy}, tiến hành bảo trì, sửa chữa {soLuong} tài sản. Đơn vị thực hiện: {donVi}.', truocBang: 'Nội dung và kết quả như sau:',
    cot: ['stt', 'ma', 'ten', 'noiDung', 'ketQua', 'chiPhi', 'ghiChu'],
    dieuKhoan: 'Tổng chi phí: {tongChiPhi} đồng.\nLần bảo trì tiếp theo: {ngayTiep}.\nHai bên đã kiểm tra, xác nhận tình trạng tài sản sau bảo trì đúng như kết quả ghi trên.',
    ketThuc: KET_2BAN, ky: { k1: true, k2: true, k3: false }, nhanK1: 'ĐƠN VỊ THỰC HIỆN', nhanK2: 'BỘ PHẬN SỬ DỤNG', nhanK3: 'NGƯỜI DUYỆT' },
  'Thanh lý': { tieuDe: 'BIÊN BẢN THANH LÝ TÀI SẢN', kyHieu: 'BBTL',
    moDau: 'Căn cứ quyết định số {soQD}, hôm nay, {ngayChu}, tại {congTy}, tiến hành thanh lý {soLuong} tài sản theo hình thức {hinhThuc}.', truocBang: 'Danh sách tài sản thanh lý:',
    cot: ['stt', 'ma', 'ten', 'ngayMua', 'nguyenGia', 'khLuyKe', 'gtcl', 'giaTriThuHoi'],
    dieuKhoan: 'Lý do thanh lý: {lyDo}.\nTổng giá trị còn lại: {tongConLai} đồng. Tổng thu hồi: {tongThuHoi} đồng. Chênh lệch: {laiLo} đồng.\nTài sản được ghi giảm khỏi sổ theo dõi kể từ ngày ký biên bản.',
    ketThuc: '', ky: { k1: true, k2: true, k3: true }, nhanK1: 'NGƯỜI LẬP', nhanK2: 'KẾ TOÁN', nhanK3: 'THỦ TRƯỞNG ĐƠN VỊ' },
  'Kiểm kê': { tieuDe: 'BIÊN BẢN KIỂM KÊ TÀI SẢN', kyHieu: 'BBKK',
    moDau: 'Hôm nay, {ngayChu}, tại {congTy}, tiến hành kiểm kê tài sản đợt {dot}, phạm vi: {phamVi}. Người kiểm kê: {nguoiKiem}.',
    truocBang: 'Kết quả kiểm kê {soLuong} tài sản: có mặt {coMat}, thiếu {thieu}, hỏng {hong}, sai vị trí {saiViTri}, chưa kiểm {chuaKiem}.',
    cot: ['stt', 'ma', 'ten', 'viTriSo', 'ketQua', 'viTriTT', 'ghiChu'], chiChenhLech: false,
    dieuKhoan: 'Các tài sản thiếu, hỏng, sai vị trí đã được ghi nhận để xử lý theo quy định của công ty.',
    ketThuc: '', ky: { k1: true, k2: true, k3: false }, nhanK1: 'NGƯỜI KIỂM KÊ', nhanK2: 'THỦ KHO', nhanK3: 'NGƯỜI DUYỆT' },
  'Nhân viên': { tieuDe: 'BIÊN BẢN XÁC NHẬN TÀI SẢN ĐANG GIỮ',
    moDau: 'Hôm nay, {ngayChu}, tại {congTy}, xác nhận nhân viên dưới đây đang giữ {soLuong} tài sản của công ty:', truocBang: 'Danh sách tài sản (tổng giá trị còn lại {tongGiaTri} đồng):',
    cot: ['stt', 'ma', 'ten', 'serial', 'ngayNhan', 'tinhTrang', 'ghiChu'],
    dieuKhoan: '1. Người giữ tài sản xác nhận danh sách trên là đúng và đủ.\n2. Khi nghỉ việc hoặc chuyển công tác, người giữ tài sản có trách nhiệm bàn giao lại đầy đủ cho công ty.',
    ketThuc: '', ky: { k1: true, k2: true, k3: false }, nhanK1: 'NGƯỜI GIỮ TÀI SẢN', nhanK2: 'BỘ PHẬN QUẢN LÝ TÀI SẢN', nhanK3: 'NGƯỜI DUYỆT' }
};
function layMauBB() {
  var m = JSON.parse(JSON.stringify(MAU_BB_MAC_DINH)), luu = {};
  try { luu = JSON.parse(S.d.caiDat.mauBB || '{}') || {}; } catch (e) {}
  Object.keys(m).forEach(function (k) {
    var L = luu[k]; if (!L || typeof L !== 'object') return;
    if (L.ky && 'giao' in L.ky) {
      L.ky = { k1: L.ky.giao, k2: L.ky.nhan, k3: L.ky.duyet };
      if (!L.nhanK1) { L.nhanK1 = L.nhanGiao || m[k].nhanK1; L.nhanK2 = L.nhanNhan || m[k].nhanK2; L.nhanK3 = L.nhanDuyet || m[k].nhanK3; }
      delete L.nhanDuyet;
    }
    Object.keys(L).forEach(function (f) { m[k][f] = L[f]; });
  });
  // Giữ quy ước cố định ngay cả khi cấu hình cũ trong Sheet còn BBCP.
  m['Cấp phát'].kyHieu = 'BBBG';
  m['Cấp phát'].tieuDe = 'BIÊN BẢN BÀN GIAO TÀI SẢN';
  m['Kiểm kê'].kyHieu = 'BBKK';
  return m;
}
function nvCo(ma) { return ma ? S.ix.nv[ma] || null : null; }
function theoSo(t, key) {
  var rows = S.d[t].filter(function (r) { return r.bienBan && r.bienBan === key; });
  return rows.length ? rows : S.d[t].filter(function (r) { return r.id === key; });
}
function bbGD(key) {
  var rows = theoSo('gd', key); if (!rows.length) return null;
  var r0 = rows[0], g = nvCo(r0.nguoiGiao), n = nvCo(r0.nguoiNhan), dy = nvCo(r0.nguoiDuyet);
  var kieu = laGD(String(r0.loai || '').trim()) ? String(r0.loai).trim() : 'Cấp phát'; // loại gõ tay sai trong sheet: in như cấp phát
  return { kieu: kieu, so: r0.bienBan || r0.id, key: r0.bienBan || r0.id, ngay: r0.ngay, fileBB: r0.fileBB, banKy: banKyCua(rows), rows: rows,
    gt: { benGiao: g ? g.hoTen : '', benNhan: n ? n.hoTen : (r0.phongBan || ''), phongBan: r0.phongBan || '', viTri: r0.viTri || '', lyDo: r0.lyDo || '' },
    ben: [{ nhan: 'nhanGiao', nguoi: g }, { nhan: 'nhanNhan', nguoi: n, pb: r0.phongBan }],
    dong: kieu !== 'Thu hồi' && r0.viTri ? 'Vị trí đặt tài sản: ' + r0.viTri : '',
    kyTen: [g ? g.hoTen : '', n ? n.hoTen : '', dy ? dy.hoTen : ''],
    ts: rows.map(function (r) {
      var a = S.ix.ts[r.ma] || {};
      return { ma: r.ma, ten: a.ten || r.ma, loai: a.loai || '', serial: a.serial || '', model: [a.thuongHieu, a.model].filter(Boolean).join(' '),
        tinhTrang: r.tinhTrangGiao || '', nguyenGia: a.nguyenGia, gtcl: a.ngayMua ? Math.round(khauHao(a, r.ngay).gtcl) : '', ghiChu: r.ghiChu || '' };
    }) };
}
function bbBT(key) {
  var rows = theoSo('bt', key); if (!rows.length) return null;
  var r0 = rows[0], nguoi = uniq(rows.map(function (r) { return (S.ix.ts[r.ma] || {}).nguoiSD; })), sd = nguoi.length === 1 ? nvCo(nguoi[0]) : null;
  var tiep = rows.map(function (r) { return r.ngayTiep || ''; }).filter(Boolean).sort().pop() || '';
  return { kieu: 'Bảo trì', so: r0.bienBan || r0.id, key: r0.bienBan || r0.id, ngay: r0.ngay, fileBB: r0.fileBB, banKy: banKyCua(rows), rows: rows,
    gt: { donVi: r0.donVi || '', loaiBT: r0.loai || '', tongChiPhi: tien(tong(rows, function (r) { return r.chiPhi; })), ngayTiep: tiep ? ngay(tiep) : '', nguoiSD: sd ? sd.hoTen : '' },
    kyTen: [r0.donVi || '', sd ? sd.hoTen : '', ''],
    ts: rows.map(function (r) {
      var a = S.ix.ts[r.ma] || {};
      return { ma: r.ma, ten: a.ten || r.ma, serial: a.serial || '', loaiBT: r.loai || '', noiDung: r.noiDung || '', ketQua: r.ketQua || '', chiPhi: r.chiPhi, ngayTiep: r.ngayTiep, ghiChu: r.ghiChu || '' };
    }) };
}
function bbTL(key) {
  var rows = theoSo('tl', key); if (!rows.length) return null;
  var r0 = rows[0], dy = nvCo(r0.nguoiDuyet), g = tong(rows, function (r) { return r.gtcl; }), th = tong(rows, function (r) { return r.giaTriThuHoi; });
  return { kieu: 'Thanh lý', so: r0.bienBan || r0.id, key: r0.bienBan || r0.id, ngay: r0.ngay, fileBB: r0.fileBB, banKy: banKyCua(rows), rows: rows,
    gt: { soQD: r0.soQD || '', hinhThuc: String(r0.hinhThuc || '').toLowerCase(), lyDo: r0.lyDo || '', tongConLai: tien(g), tongThuHoi: tien(th),
      laiLo: (th - g > 0 ? '+' : '') + tien(th - g), nguoiDuyet: dy ? dy.hoTen : '' },
    kyTen: ['', '', dy ? dy.hoTen : ''],
    ts: rows.map(function (r) {
      var a = S.ix.ts[r.ma] || {};
      return { ma: r.ma, ten: a.ten || r.ma, ngayMua: a.ngayMua, nguyenGia: a.nguyenGia, khLuyKe: (Number(a.nguyenGia) || 0) - (Number(r.gtcl) || 0), gtcl: r.gtcl,
        hinhThuc: r.hinhThuc || '', giaTriThuHoi: r.giaTriThuHoi, laiLo: r.laiLo, ghiChu: r.ghiChu || '' };
    }) };
}
function bbKK(dot, mau) {
  var rows = S.d.kk.filter(function (r) { return r.dot === dot; }); if (!rows.length) return null;
  var r0 = rows[0], nk = nvCo(r0.nguoiKiem), dem = demTheo(rows, function (r) { return r.ketQua || ''; });
  var M = (mau || layMauBB())['Kiểm kê'], hien = M.chiChenhLech ? rows.filter(function (r) { return r.ketQua !== 'Có mặt'; }) : rows;
  var pv = uniq(rows.map(function (r) { return r.viTriSo; })), pb = uniq(rows.map(function (r) { return (S.ix.ts[r.ma] || {}).phongBan; }));
  var tatCa = rows.length >= S.d.ts.filter(conQL).length;
  return { kieu: 'Kiểm kê', so: r0.bienBan || dot, key: dot, ngay: r0.ngayKiem, fileBB: rows.map(function (r) { return r.fileBB; }).filter(Boolean)[0] || '', banKy: banKyCua(rows), soLuong: rows.length,
    gt: { dot: dot, nguoiKiem: nk ? nk.hoTen : '', phamVi: tatCa ? 'toàn bộ tài sản' : pv.length === 1 ? pv[0] : pb.length === 1 ? pb[0] : rows.length + ' tài sản được chọn',
      coMat: String(dem['Có mặt'] || 0), thieu: String(dem['Thiếu'] || 0), hong: String(dem['Hỏng'] || 0), saiViTri: String(dem['Sai vị trí'] || 0), chuaKiem: String(dem[''] || 0) },
    kyTen: [nk ? nk.hoTen : '', '', ''],
    ts: hien.map(function (r) {
      var a = S.ix.ts[r.ma] || {};
      return { ma: r.ma, ten: a.ten || r.ma, viTriSo: r.viTriSo || '', nguoiSo: r.nguoiSo ? nvTen(r.nguoiSo) : '', ketQua: r.ketQua || 'Chưa kiểm', viTriTT: r.viTriTT || '', ghiChu: r.ghiChu || '' };
    }) };
}
function diaDanhBB(C, cd) {
  if (String(C.noiLap || '').trim()) return String(C.noiLap).trim();
  var p = String(cd.diaChi || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  return p.length ? p[p.length - 1] : '';
}
function htmlBB(bb, mau, pdf) {
  var C = mau.chung, M = mau[bb.kieu] || mau['Cấp phát'], cd = S.d.caiDat, p = String(bb.ngay || hn()).split('-');
  var gt = { ngayChu: 'ngày ' + p[2] + ' tháng ' + p[1] + ' năm ' + p[0], ngay: ngay(bb.ngay), congTy: cd.tenCongTy || '', diaChi: cd.diaChi || '',
    soBB: bb.so || '', soLuong: String(bb.soLuong || bb.ts.length) };
  Object.keys(bb.gt || {}).forEach(function (k) { gt[k] = bb.gt[k]; });
  // Bố cục riêng khi có logo, không quốc hiệu; chỉ đảo số chuẩn để trình bày, không sửa bb.so.
  var dauLogo = !!C.logo && !C.quocHieu, soIn = bb.so || '';
  if (dauLogo) {
    var soChuan = String(soIn).match(/^(BBBG|BBTH|BBLC|BBBT|BBTL|BBKK)\/(\d{4})\/(\d{3,})$/);
    if (soChuan) soIn = soChuan[3] + '/' + soChuan[2] + '/' + soChuan[1];
  }
  // thông tin trống thì để dòng chấm cho viết tay
  function thay(t) { return esc(t || '').replace(/\{(\w+)\}/g, function (x, k) { return k in gt ? (gt[k] === '' ? '..........' : esc(gt[k])) : x; }).replace(/\n/g, '<br>'); }
  function ben(b) {
    var n = b.nguoi;
    return '<p class="ben"><b>' + esc(M[b.nhan] || '') + ':</b> ' + (n ? 'Ông/Bà <b>' + esc(n.hoTen) + '</b>' : b.pb ? 'Đại diện ' + esc(b.pb) : '..............................') +
      '<br><span class="thut">Chức vụ: ' + (n && n.chucVu ? esc(n.chucVu) : '....................') + '</span><span class="thut">Bộ phận: ' +
      (n && n.phongBan ? esc(n.phongBan) : b.pb ? esc(b.pb) : '....................') + '</span></p>';
  }
  var dsCot = (COT_BB[bb.kieu] || COT_GD).filter(function (c) { return (M.cot || []).indexOf(c[0]) >= 0; });
  var bang = '<table class="ds"><thead><tr>' + dsCot.map(function (c) { return '<th' + (c[0] === 'stt' ? ' class="hep"' : '') + '>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
    (bb.ts.length ? bb.ts.map(function (t, i) {
      return '<tr>' + dsCot.map(function (c) {
        var v = c[0] === 'stt' ? i + 1 : t[c[0]], cls = '';
        if (v === undefined || v === null) v = '';
        if (c[0] === 'ten' && laGD(bb.kieu)) cls = 'ten-ts';
        else if (c[0] === 'stt') cls = 'giua';
        else if (COT_TIEN.indexOf(c[0]) >= 0) { cls = 'phai'; v = v === '' ? '' : (c[0] === 'laiLo' && v > 0 ? '+' : '') + tien(v); }
        else if (COT_NGAY.indexOf(c[0]) >= 0) { cls = 'nw'; v = ngay(v); }
        else if (c[0] === 'ma' || c[0] === 'serial' || c[0] === 'ketQua') cls = 'nw';
        return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + dsCot.length + '" class="giua">Không có tài sản</td></tr>') + '</tbody></table>';
  var ky = [];
  [1, 2, 3].forEach(function (i) { if (M.ky && M.ky['k' + i]) ky.push([M['nhanK' + i] || '', (bb.kyTen || [])[i - 1] || '']); });
  var font = C.font === 'Arial' || (C.font === 'Manrope' && pdf) ? 'Arial, Helvetica, sans-serif' : C.font === 'Manrope' ? "'Manrope', Arial, sans-serif" : "'Times New Roman', Times, serif";
  return '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>' + esc((M.tieuDe || '') + ' ' + (bb.so || '')) + '</title>' +
    (C.font === 'Manrope' && !pdf ? '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">' : '') +
    '<style>@page{size:A4;margin:15mm 15mm 16mm 20mm}' +
    'body{margin:0;font-family:' + font + ';font-size:' + (Number(C.coChu) || 13) + 'pt;line-height:1.45;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    (pdf ? '' : '*{box-sizing:border-box}@media screen{html{background:#E7E7EE}body{padding:24px 0}.trang{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:15mm 15mm 16mm 20mm;box-shadow:0 4px 24px rgba(20,20,40,.14)}}@media print{body{zoom:1!important}}') +
    'table.dau,table.ky{width:100%;border-collapse:collapse}table.dau td,table.ky td{border:0;padding:0;vertical-align:top;text-align:center}' +
    'td.cty{width:46%;font-weight:bold;text-transform:uppercase;font-size:.88em}table.lg{border-collapse:collapse;margin:0 auto}td.lg-a{width:1%;vertical-align:middle!important;padding-right:10px!important}td.lg-a img{max-height:54px;max-width:96px;display:block}td.lg-c{vertical-align:middle!important}.so{font-weight:normal;text-transform:none;margin-top:4px}.dc{font-weight:normal;text-transform:none;font-size:.92em;margin-top:2px}' +
    'td.qh{font-weight:bold;font-size:.88em}.dl{font-size:1.08em;text-decoration:underline}' +
    '.ngay-lap{text-align:right;font-style:italic;margin-top:10px}' +
    (dauLogo ? '.dau-logo{margin-bottom:12px}.dau-logo img{display:block;max-width:140px;max-height:72px;width:auto;height:auto}table.dau-thong-tin{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 18px}table.dau-thong-tin td{padding:0;vertical-align:top}table.dau-thong-tin .so-in{width:40%;padding-right:12px;text-align:left;overflow-wrap:break-word}table.dau-thong-tin .ngay-in{text-align:right;font-style:italic;overflow-wrap:break-word}' : '') +
    'h1{text-align:center;font-size:1.22em;margin:18px 0 12px;text-transform:uppercase}' +
    'p{margin:6px 0}p.ben{margin:6px 0 2px}.thut{display:inline-block;margin-left:22px;min-width:220px}' +
    'table.ds{width:100%;border-collapse:collapse;margin:8px 0 10px;font-size:.92em}table.ds th,table.ds td{border:1px solid #000;padding:4px 6px;vertical-align:top}' +
    (laGD(bb.kieu) ? 'table.ds td.ten-ts{width:35%;white-space:normal;overflow-wrap:anywhere;word-wrap:break-word;word-break:break-word}' : '') +
    'table.ds th{text-align:center;font-weight:bold;background:#F2F2F2}table.ds thead{display:table-header-group}table.ds tr{page-break-inside:avoid}' +
    '.hep{width:34px}.giua{text-align:center}.phai{text-align:right;white-space:nowrap}.nw{white-space:nowrap}' +
    'table.ky{margin-top:20px;page-break-inside:avoid}table.ky b{display:block}table.ky i{display:block;font-size:.85em}table.ky .ten{padding-top:72px;font-weight:bold}' +
    '</style></head><body><div class="trang">' +
    (dauLogo ? '<div class="dau-logo"><img src="' + esc(C.logo) + '" alt=""></div>' +
      '<table class="dau-thong-tin"><tr><td class="so-in">' + (soIn ? 'Số: ' + esc(soIn) : '') + '</td><td class="ngay-in">' +
      (diaDanhBB(C, cd) ? esc(diaDanhBB(C, cd)) + ', ' : '') + gt.ngayChu + '</td></tr></table>' :
    '<table class="dau"><tr><td class="cty">' + (C.logo ? '<table class="lg"><tr><td class="lg-a"><img src="' + esc(C.logo) + '" alt=""></td><td class="lg-c">' : '') + // logo nằm bên trái tên công ty, không chiếm thêm dòng
    esc(cd.tenCongTy || '').replace(/(DỰNG BÌNH DƯƠNG)/gi, '<u>$1</u>') + (bb.so ? '<div class="so">Số: ' + esc(bb.so) + '</div>' : '') + (C.logo ? '</td></tr></table>' : '') + '</td>' +
    (C.quocHieu ? '<td class="qh">CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM<br><span class="dl">Độc lập - Tự do - Hạnh phúc</span></td>' : '<td></td>') + '</tr></table>' +
    '<div class="ngay-lap">' + (diaDanhBB(C, cd) ? esc(diaDanhBB(C, cd)) + ', ' : '') + gt.ngayChu + '</div>') +
    '<h1>' + thay(M.tieuDe) + '</h1>' +
    (M.moDau ? '<p>' + thay(M.moDau) + '</p>' : '') +
    (bb.ben || []).map(ben).join('') + (bb.dong ? '<p>' + esc(bb.dong) + '</p>' : '') +
    (M.truocBang ? '<p>' + thay(M.truocBang) + '</p>' : '') + bang +
    (M.dieuKhoan ? '<p>' + thay(M.dieuKhoan) + '</p>' : '') + (M.ketThuc ? '<p>' + thay(M.ketThuc) + '</p>' : '') +
    (ky.length ? '<table class="ky"><tr>' + ky.map(function (k) {
      return '<td style="width:' + Math.floor(100 / ky.length) + '%"><b>' + esc(k[0]) + '</b><i>(Ký, ghi rõ họ tên)</i><div class="ten">' + esc(k[1]) + '</div></td>';
    }).join('') + '</tr></table>' : '') +
    '</div></body></html>';
}
function banKyCua(rows) { return rows.map(function (r) { return r.banKy; }).filter(Boolean)[0] || ''; }
function bbGia(kieu, mau) {
  var M = (mau || layMauBB())[kieu] || {}, h = hn(), nam = h.slice(0, 4), so = (M.kyHieu || 'BB') + '/' + nam + '/001';
  var A = { hoTen: 'Nguyễn Văn An', chucVu: 'Nhân viên kinh doanh', phongBan: 'Phòng Kinh doanh' },
    B = { hoTen: 'Trần Thị Bình', chucVu: 'Nhân viên hành chính', phongBan: 'Phòng Hành chính' },
    C = { hoTen: 'Lê Minh Châu', chucVu: 'Giám đốc', phongBan: 'Ban Giám đốc' };
  var ds = [{ ma: 'TS-IT-001', ten: 'Laptop Dell Latitude 5540', loai: 'Thiết bị IT', serial: 'SN2024001', model: 'Dell Latitude 5540', nguyenGia: 25000000, gtcl: 18750000 },
    { ma: 'TS-IT-002', ten: 'Màn hình LG 27 inch', loai: 'Thiết bị IT', serial: 'SN2024002', model: 'LG 27UL500', nguyenGia: 6500000, gtcl: 4875000 },
    { ma: 'TS-VP-003', ten: 'Ghế xoay văn phòng', loai: 'Nội thất', serial: '', model: 'Hòa Phát SG550', nguyenGia: 2400000, gtcl: 1800000 }];
  var muaLuc = congThang(h, -9), tongCL = function (x) { return tong(x, function (a) { return a.gtcl; }); }, bb = { kieu: kieu, so: so, key: so, ngay: h, fileBB: '', gia: true };
  if (laGD(kieu)) {
    var th = kieu === 'Thu hồi', g = th ? A : B, n = th ? B : A, x = ds.slice(0, 2);
    bb.gt = { benGiao: g.hoTen, benNhan: n.hoTen, phongBan: n.phongBan, viTri: th ? 'Kho chính' : 'Trụ sở chính - Tầng 3', lyDo: th ? 'Nhân viên nghỉ việc' : 'Nhân viên mới' };
    bb.ben = [{ nhan: 'nhanGiao', nguoi: g }, { nhan: 'nhanNhan', nguoi: n, pb: n.phongBan }];
    bb.dong = th ? '' : 'Vị trí đặt tài sản: Trụ sở chính - Tầng 3';
    bb.kyTen = [g.hoTen, n.hoTen, C.hoTen];
    bb.ts = x.map(function (a) { return { ma: a.ma, ten: a.ten, loai: a.loai, serial: a.serial, model: a.model, tinhTrang: 'Tốt, đủ phụ kiện', nguyenGia: a.nguyenGia, gtcl: a.gtcl, ghiChu: '' }; });
  } else if (kieu === 'Bảo trì') {
    var tiep = congThang(h, 6);
    bb.gt = { donVi: 'Công ty Tin học ABC', loaiBT: 'Định kỳ', tongChiPhi: tien(700000), ngayTiep: ngay(tiep), nguoiSD: A.hoTen };
    bb.kyTen = ['Công ty Tin học ABC', A.hoTen, ''];
    bb.ts = ds.slice(0, 2).map(function (a) { return { ma: a.ma, ten: a.ten, serial: a.serial, loaiBT: 'Định kỳ', noiDung: 'Vệ sinh, kiểm tra tổng quát', ketQua: 'Hoàn thành', chiPhi: 350000, ngayTiep: tiep, ghiChu: '' }; });
  } else if (kieu === 'Thanh lý') {
    var x2 = ds.slice(1), thu = [3000000, 900000], cl = tongCL(x2), tth = thu[0] + thu[1];
    bb.gt = { soQD: '15/QĐ-' + nam, hinhThuc: 'bán lại', lyDo: 'Hư hỏng, sửa không hiệu quả', tongConLai: tien(cl), tongThuHoi: tien(tth), laiLo: (tth - cl > 0 ? '+' : '') + tien(tth - cl), nguoiDuyet: C.hoTen };
    bb.kyTen = ['', '', C.hoTen];
    bb.ts = x2.map(function (a, i) { return { ma: a.ma, ten: a.ten, ngayMua: muaLuc, nguyenGia: a.nguyenGia, khLuyKe: a.nguyenGia - a.gtcl, gtcl: a.gtcl, hinhThuc: 'Bán lại', giaTriThuHoi: thu[i], laiLo: thu[i] - a.gtcl, ghiChu: '' }; });
  } else if (kieu === 'Kiểm kê') {
    var kq = [['Có mặt', '', ''], ['Hỏng', '', 'Màn hình sọc'], ['Sai vị trí', 'Phòng họp lớn', '']];
    bb.key = 'KK-' + h.replace(/-/g, ''); bb.so = 'BBKK/' + nam + '/001'; bb.soLuong = ds.length;
    bb.gt = { dot: bb.key, nguoiKiem: B.hoTen, phamVi: 'Phòng Kinh doanh', coMat: '1', thieu: '0', hong: '1', saiViTri: '1', chuaKiem: '0' };
    bb.kyTen = [B.hoTen, '', ''];
    bb.ts = ds.map(function (a, i) { return { ma: a.ma, ten: a.ten, viTriSo: 'Trụ sở chính - Tầng 3', nguoiSo: A.hoTen, ketQua: kq[i][0], viTriTT: kq[i][1], ghiChu: kq[i][2] }; })
      .filter(function (r) { return !M.chiChenhLech || r.ketQua !== 'Có mặt'; });
  } else {
    bb.so = '';
    bb.gt = { nhanVien: A.hoTen, chucVu: A.chucVu, phongBan: A.phongBan, tongGiaTri: tien(tongCL(ds)) };
    bb.ben = [{ nhan: 'nhanK1', nguoi: A }]; bb.kyTen = [A.hoTen, '', ''];
    bb.ts = ds.map(function (a) { return { ma: a.ma, ten: a.ten, serial: a.serial, ngayNhan: muaLuc, tinhTrang: 'Đang sử dụng', gtcl: a.gtcl, ghiChu: '' }; });
  }
  return bb;
}

 function congThang(s, n) {
  var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  var cuoi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(p[2], cuoi));
  return d.toISOString().slice(0, 10);
}
 S.giu={};assets.forEach(function(a){if(a.nguoiSD&&a.tinhTrang!=='Đã thanh lý'){a.gtcl=khauHao(a,hn()).gtcl;(S.giu[a.nguoiSD]||=[]).push(a);}});
 function nhanTu(ma,person){return (T.ds||[]).find(x=>x.ma===ma&&x.giu===person)?.giuTu||'';}
function bbNV(ma) {
  var n = S.ix.nv[ma]; if (!n) return null;
  var g = (S.giu[ma] || []).slice().sort(function (a, b) { return a.ma < b.ma ? -1 : 1; });
  return { kieu: 'Nhân viên', so: '', key: ma, ngay: hn(), fileBB: '',
    gt: { nhanVien: n.hoTen, chucVu: n.chucVu || '', phongBan: n.phongBan || '', tongGiaTri: tien(tong(g, function (a) { return a.gtcl; })) },
    ben: [{ nhan: 'nhanK1', nguoi: n }], kyTen: [n.hoTen, '', ''],
    ts: g.map(function (a) { return { ma: a.ma, ten: a.ten, serial: a.serial || '', ngayNhan: nhanTu(a.ma, ma) || '', tinhTrang: a.tinhTrang, gtcl: a.gtcl, ghiChu: '' }; }) };
}

 if(kind==='templateMeta')return {columns:COT_BB,placeholders:CHO_CHUNG.concat(CHO_CHEN[laGD(key)?'gd':key]||[])};
 if(kind==='templates')return layMauBB();
 const bb=kind==='preview'?bbGia(key,layMauBB()):kind==='gd'?bbGD(key):kind==='bt'?bbBT(key):kind==='tl'?bbTL(key):kind==='kk'?bbKK(key):kind==='nv'?bbNV(key):null;if(!bb)throw new Error('Không tìm thấy biên bản');return htmlBB(bb,layMauBB(),false);
}

// Read-only reports use the original QLTS monthly straight-line depreciation.
export function assetReportData(unit, tab, date, filters = {}) {
 const T=unit.ts||{},L=T.ksb||{},homNay_=()=>date;
function soThang_(tu, den) {
  if (!tu || !den) return 0;
  var a = tu.split('-').map(Number), b = den.split('-').map(Number);
  var t = (b[0] - a[0]) * 12 + (b[1] - a[1]) - (b[2] < a[2] ? 1 : 0);
  return Math.max(0, t);
}
function khauHao_(ts, denNgay) {
  var ng = Number(ts.nguyenGia) || 0, tg = Number(ts.thoiGianKH) || 0, den = denNgay || homNay_();
  if (!ng || !tg || !ts.ngayMua) return { khNam: tg ? ng / tg : 0, khLuyKe: 0, gtcl: ng, thang: 0, tongThang: tg * 12, het: false };
  var tong = tg * 12, th = Math.min(soThang_(ts.ngayMua, den), tong), lk = ng / tong * th;
  return { khNam: ng / tg, khLuyKe: lk, gtcl: Math.max(ng - lk, 0), thang: th, tongThang: tong, het: th >= tong };
}
 const full=(T.ds||[]).filter(x=>x.loai!=='dt');
 const rows=full.filter(x=>!filters.q||[x.ma,x.ten,x.serial].join(' ').toLocaleLowerCase('vi').includes(filters.q.toLocaleLowerCase('vi'))).filter(x=>!filters.nhom||x.nhom===filters.nhom).filter(x=>!filters.phongBan||x.phongBan===filters.phongBan).filter(x=>!filters.viTri||x.viTri===filters.viTri).map(x=>{
  const tl=(L.tl||[]).filter(r=>r.ma===x.ma).sort((a,b)=>a.ngay.localeCompare(b.ngay))[0],den=tl&&tl.ngay<date?tl.ngay:date,kh=khauHao_({nguyenGia:x.gia,thoiGianKH:x.khNam,ngayMua:x.ngay},den);
  return {...x,...kh,khNam:Math.round(kh.khNam),khLuyKe:Math.round(kh.khLuyKe),gtcl:Math.round(kh.gtcl),ngayTL:tl?.ngay||'',unknown:x.gia==null};
 });
 const managed=rows.filter(x=>x.tt!=='Thanh lý');
 if(tab==='maintenance'){const yr=filters.nam||date.slice(0,4),bs=(L.bt||[]).filter(r=>r.ngay.slice(0,4)===yr&&rows.some(x=>x.ma===r.ma));const aggregate=k=>{const map={};for(const r of bs){const id=r[k]||'Chưa cập nhật',v=map[id]||=( {key:id,count:0,cost:0});v.count++;v.cost+=+r.chiPhi||0;}return Object.values(map);};return {tables:[{name:'Theo tháng',headers:['Tháng','Số lần','Chi phí'],rows:Array.from({length:12},(_,i)=>{const k=yr+'-'+String(i+1).padStart(2,'0'),a=bs.filter(r=>r.ngay.slice(0,7)===k);return [k,a.length,a.reduce((n,r)=>n+(+r.chiPhi||0),0)];})},...['ma','loai','donVi'].map(k=>({name:({ma:'Theo tài sản',loai:'Theo loại',donVi:'Theo đơn vị'})[k],headers:[({ma:'Mã tài sản',loai:'Loại bảo trì',donVi:'Đơn vị thực hiện'})[k],'Số lần','Chi phí'],rows:aggregate(k).map(r=>[r.key,r.count,r.cost])}))]};}
 if(tab==='department'||tab==='type'){const key=tab==='department'?'phongBan':'nhom',m={};for(const x of managed){const k=x[key]||'Chưa phân bổ',g=m[k]||={count:0,price:0,depreciated:0,remaining:0,unknown:0,inUse:0,needsAction:0};g.count++;if(x.giu||x.phongBan)g.inUse++;if(['Hỏng cần sửa','Hỏng không dùng được','Mất','Đang sửa chữa','Chờ thanh lý'].includes(x.tt))g.needsAction++;g.price+=+x.gia||0;g.depreciated+=x.khLuyKe;g.remaining+=x.gtcl;if(x.unknown)g.unknown++;}return {tables:[{name:tab==='department'?'Theo phòng ban':'Theo loại',headers:[tab==='department'?'Phòng ban':'Nhóm','Số tài sản','Nguyên giá','Đã khấu hao','Giá trị còn lại','Đang sử dụng / mượn','Cần xử lý','Thiếu nguyên giá'],rows:Object.entries(m).map(([k,g])=>[k,g.count,g.price,g.depreciated,g.remaining,g.inUse,g.needsAction,g.unknown])}]};}
 if(tab==='warranty')return {tables:[{name:'Bảo hành',headers:['Mã tài sản','Tên tài sản','Nhóm','Hạn bảo hành','Số ngày còn lại','Nhà cung cấp'],rows:managed.filter(x=>x.baoHanh).filter(x=>{const days=Math.round((Date.parse(x.baoHanh)-Date.parse(date))/864e5);return !filters.bh||(filters.bh==='expired'?days<0:days>=0&&days<=Number(T.ksbConfig?.baoTruocBH??30));}).map(x=>[x.ma,x.ten,x.nhom,x.baoHanh,Math.round((Date.parse(x.baoHanh)-Date.parse(date))/864e5),x.ncc||''])}]};
 const khState=x=>x.ngayTL?'tl':!x.khNam||!x.ngay||!x.gia?'thieu':x.het?'het':'dang';
 const schedule=Array.from({length:6},(_,i)=>Number(date.slice(0,4))-1+i).map(year=>[year,full.reduce((sum,x)=>{const disposal=(L.tl||[]).filter(r=>r.ma===x.ma).sort((a,b)=>a.ngay.localeCompare(b.ngay))[0];function accrued(d){if(disposal&&disposal.ngay<d)d=disposal.ngay;if(!x.gia||!x.khNam||!x.ngay||d<x.ngay)return 0;return (+x.gia)/(x.khNam*12)*Math.min(soThang_(x.ngay,d),x.khNam*12);}return sum+accrued(year+'-12-31')-accrued((year-1)+'-12-31');},0)]);
 return {tables:[{name:'Khấu hao',headers:['Mã tài sản','Tên tài sản','Nhóm','Ngày mua','Nguyên giá','Khấu hao năm','Đã khấu hao','Giá trị còn lại','Tình trạng'],rows:rows.filter(x=>!filters.kh||khState(x)===filters.kh).map(x=>[x.ma,x.ten,x.nhom,x.ngay,x.gia??'',x.unknown?'':x.khNam,x.unknown?'':x.khLuyKe,x.unknown?'':x.gtcl,x.ngayTL?'Đã thanh lý':!x.khNam||!x.ngay||!x.gia?'Thiếu thông tin':x.het?'Đã khấu hao hết':'Đang khấu hao'])},{name:'Lịch khấu hao theo năm',headers:['Năm','Khấu hao phải trích'],rows:schedule}]};
}

export function getAssetTemplates(unit){return renderAssetDocument(unit,'templates',null);}

export function getAssetCatalogs(unit){
 const defaults={loai:['Thiết bị IT','Nội thất','Thiết bị VP','Thiết bị điện','Phương tiện','Máy móc SX','Phần mềm','Khác'],viTri:['Kho chính'],nhaCungCap:[],hinhThucTL:['Bán lại','Cho tặng','Hủy bỏ','Trả nhà cung cấp'],loaiBT:['Định kỳ','Sửa chữa','Nâng cấp','Đột xuất'],ketQuaBT:['Hoàn thành','Đang xử lý','Chờ vật tư']},T=unit.ts||{},saved=T.ksbCatalogs||{};
 for(const k of Object.keys(defaults)){defaults[k]=[...new Set((saved[k]||defaults[k]).concat((T.ds||[]).filter(x=>x.loai!=='dt').map(x=>k==='loai'?x.nhom:k==='viTri'?x.viTri:k==='nhaCungCap'?x.ncc:'')).filter(Boolean))];}return defaults;
}

// Issued documents retain their exact HTML. An explicit correction creates a new
// revision and keeps the prior content; changing templates or asset names does not.
function snapshotAssetDocuments(unit, actor, at, correction=null){
 const T=unit.ts;if(!T?.ksb)return;const docs=T.ksbDocuments||={},L=T.ksb;
 for(const kind of ['gd','bt','tl','kk']){const groups=new Map();for(const row of L[kind]||[]){const key=kind==='kk'?row.dot:row.bienBan||row.id;if(key&&!groups.has(key))groups.set(key,row);}
 for(const [key,row] of groups){const id=kind+'|'+key,prior=docs[id];let refresh=false;
 if(correction){const {action,payload:p}=correction;
 refresh=action==='updateMove'&&kind==='gd'&&(p.id===key||(L.gd||[]).some(r=>r.id===p.id&&r.bienBan===key))
 ||action==='updateMaint'&&kind==='bt'&&row.id===p.id||action==='updateDisposal'&&kind==='tl'&&row.id===p.id
 ||action==='setAuditResults'&&kind==='kk'&&p.some(v=>(L.kk||[]).some(r=>r.dot===key&&r.id===v.id))
 ||action==='applyAudit'&&kind==='kk'&&p===key;}
 if(prior&&!refresh)continue;
 const view=structuredClone(unit);if(prior?.templates)view.ts.ksbTemplates=structuredClone(prior.templates);
 const html=renderAssetDocument(view,kind,key,{fresh:true});if(prior?.html===html)continue;
 docs[id]={html,templates:prior?.templates||getAssetTemplates(unit),at,actor,versions:prior?[...(prior.versions||[]),{html:prior.html,at:prior.at,actor:prior.actor}]:[]};
 }}
}

export function assetReminders(unit, date){
 const T=unit.ts||{},cfg=T.ksbConfig||{},by=Object.fromEntries((T.ds||[]).map(x=>[x.ma,x])),people=Object.fromEntries((unit.data?.NV||[]).map(n=>[n['Mã NV'],n['Họ và tên']])),out=[];
 const append=(type,x,day,person='')=>out.push({type,ma:x.ma,ten:x.ten,date:day,person:people[person]||person});
 for(const r of T.ksb?.mt||[])if(!r.ngayTra&&r.hanTra&&r.hanTra<date&&by[r.ma])append('Mượn quá hạn chưa trả',by[r.ma],r.hanTra,r.nguoiMuon);
 for(const x of T.ds||[]){if(x.loai==='dt'||['Thanh lý','Mất'].includes(x.tt))continue;
 const days=d=>Math.round((Date.parse(d)-Date.parse(date))/86400000);
 if(x.baoTri){const d=days(x.baoTri);if(d<0)append('Quá hạn bảo trì',x,x.baoTri,x.giu);else if(d<=(cfg.baoTruocBT??7))append('Sắp bảo trì',x,x.baoTri,x.giu);}
 if(x.baoHanh){const d=days(x.baoHanh);if(d>=0&&d<=(cfg.baoTruocBH??30))append('Sắp hết bảo hành',x,x.baoHanh,x.giu);}
 }return out;
}

export function assetLedgerExport(unit, kind, records){
function BANG_() {
  return {
    ts: { sheet: 'Tài sản', key: 'ma', mau: '#EFEEFE', cols: [
      ['ma', 'Mã tài sản'], ['ten', 'Tên tài sản'], ['loai', 'Loại tài sản'], ['thuongHieu', 'Thương hiệu'], ['model', 'Model'],
      ['serial', 'Số serial'], ['ngayMua', 'Ngày mua', 'date'], ['nhaCungCap', 'Nhà cung cấp'], ['nguyenGia', 'Nguyên giá', 'num'],
      ['thoiGianKH', 'Thời gian khấu hao (năm)', 'num'], ['hanBH', 'Hạn bảo hành', 'date'], ['tinhTrang', 'Tình trạng'],
      ['nguoiSD', 'Người sử dụng (mã NV)'], ['phongBan', 'Phòng ban'], ['viTri', 'Vị trí'], ['ngayBTTiep', 'Ngày bảo trì tiếp theo', 'date'],
      ['anh', 'Ảnh (link)'], ['ghiChu', 'Ghi chú'], ['taoLuc', 'Tạo lúc']] },
    gd: { sheet: 'Cấp phát - Thu hồi', key: 'id', pre: 'GD', mau: '#E8F0FE', cols: [
      ['id', 'Mã phiếu'], ['ngay', 'Ngày', 'date'], ['ma', 'Mã tài sản'], ['loai', 'Loại giao dịch'], ['nguoiGiao', 'Người giao (mã NV)'],
      ['nguoiNhan', 'Người nhận (mã NV)'], ['phongBan', 'Phòng ban nhận'], ['viTri', 'Vị trí'], ['lyDo', 'Lý do'],
      ['tinhTrangGiao', 'Tình trạng khi giao'], ['nguoiDuyet', 'Người duyệt (mã NV)'], ['ghiChu', 'Ghi chú'], ['bienBan', 'Biên bản'], ['taoLuc', 'Tạo lúc'], ['fileBB', 'File biên bản'], ['truoc', 'Trước khi ghi (tự động)'], ['banKy', 'Bản đã ký']] },
    bt: { sheet: 'Bảo trì', key: 'id', pre: 'BT', mau: '#E6F4EA', cols: [
      ['id', 'Mã phiếu'], ['ngay', 'Ngày bảo trì', 'date'], ['ma', 'Mã tài sản'], ['loai', 'Loại bảo trì'], ['noiDung', 'Nội dung'],
      ['donVi', 'Đơn vị thực hiện'], ['chiPhi', 'Chi phí', 'num'], ['ketQua', 'Kết quả'], ['ngayTiep', 'Ngày bảo trì tiếp theo', 'date'],
      ['ghiChu', 'Ghi chú'], ['bienBan', 'Biên bản'], ['taoLuc', 'Tạo lúc'], ['fileBB', 'File biên bản'], ['truoc', 'Trước khi ghi (tự động)'], ['banKy', 'Bản đã ký']] },
    mt: { sheet: 'Mượn - trả', key: 'id', pre: 'MT', mau: '#FEF7E0', cols: [
      ['id', 'Mã phiếu'], ['ma', 'Mã tài sản'], ['nguoiMuon', 'Người mượn (mã NV)'], ['ngayMuon', 'Ngày mượn', 'date'], ['hanTra', 'Hạn trả', 'date'],
      ['ngayTra', 'Ngày trả', 'date'], ['tinhTrangTra', 'Tình trạng khi trả'], ['ghiChu', 'Ghi chú'], ['taoLuc', 'Tạo lúc']] },
    tl: { sheet: 'Thanh lý', key: 'id', pre: 'TL', mau: '#FCE8E6', cols: [
      ['id', 'Mã phiếu'], ['ngay', 'Ngày thanh lý', 'date'], ['ma', 'Mã tài sản'], ['lyDo', 'Lý do'], ['hinhThuc', 'Hình thức'],
      ['giaTriThuHoi', 'Giá trị thu hồi', 'num'], ['gtcl', 'Giá trị còn lại lúc thanh lý', 'num'], ['laiLo', 'Lãi / lỗ', 'num'],
      ['nguoiDuyet', 'Người duyệt (mã NV)'], ['soQD', 'Số quyết định'], ['ghiChu', 'Ghi chú'], ['bienBan', 'Biên bản'], ['taoLuc', 'Tạo lúc'],
      ['fileBB', 'File biên bản'], ['truoc', 'Trước khi ghi (tự động)'], ['banKy', 'Bản đã ký']] },
    kk: { sheet: 'Kiểm kê', key: 'id', pre: 'KKD', mau: '#F3E8FD', cols: [
      ['id', 'Mã dòng'], ['dot', 'Mã đợt'], ['bienBan', 'Số biên bản'], ['ngayKiem', 'Ngày kiểm', 'date'], ['ma', 'Mã tài sản'], ['viTriSo', 'Vị trí theo sổ'],
      ['nguoiSo', 'Người sử dụng theo sổ (mã NV)'], ['ketQua', 'Kết quả'], ['viTriTT', 'Vị trí thực tế'], ['nguoiKiem', 'Người kiểm (mã NV)'],
      ['ghiChu', 'Ghi chú'], ['daApDung', 'Ngày áp dụng', 'date'], ['taoLuc', 'Tạo lúc'], ['fileBB', 'File biên bản'], ['banKy', 'Bản đã ký']] },
    nv: { sheet: 'Nhân viên', key: 'ma', mau: '#E8F0FE', cols: [
      ['ma', 'Mã NV'], ['hoTen', 'Họ tên'], ['phongBan', 'Phòng ban'], ['chucVu', 'Chức vụ'], ['email', 'Email'], ['sdt', 'Số điện thoại'],
      ['viTriLamViec', 'Nơi làm việc'], ['trangThai', 'Trạng thái'], ['quanLyKho', 'Quản lý kho', 'bool']] },
    nk: { sheet: 'Nhật ký', key: '', mau: '#F1F3F4', cols: [
      ['luc', 'Thời gian'], ['thaoTac', 'Thao tác'], ['doiTuong', 'Đối tượng'], ['chiTiet', 'Chi tiết'], ['nguoi', 'Người thực hiện']] }
  };
}

// Danh mục: mỗi cột của sheet "Danh mục" là một danh sách
 const definition=BANG_()[kind];if(!definition||!['gd','mt','bt','tl','kk'].includes(kind))throw new Error('Loại dữ liệu không hợp lệ');
 const columns=definition.cols.filter(c=>c[0]!=='truoc'),assets=Object.fromEntries((unit.ts?.ds||[]).map(x=>[x.ma,x])),people=Object.fromEntries((unit.data?.NV||[]).map(n=>[n['Mã NV'],n['Họ và tên']]));
 const headers=[];for(const c of columns){headers.push(c[1]);if(c[0]==='ma')headers.push('Tên tài sản');if(c[0].startsWith('nguoi'))headers.push('Họ tên '+c[1]);}
 const rows=(records||unit.ts?.ksb?.[kind]||[]).map(r=>{const row=[];for(const c of columns){row.push(r[c[0]]??'');if(c[0]==='ma')row.push(assets[r.ma]?.ten||r.ma);if(c[0].startsWith('nguoi'))row.push(people[r[c[0]]]||'');}return row;});return {headers,rows};
}
