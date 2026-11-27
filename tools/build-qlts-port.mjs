// Build the KSB-maintained source verbatim, replacing only the GAS/auth/bootstrap seams.
import fs from 'node:fs';
import crypto from 'node:crypto';
const sourcePath=process.argv[2];if(!sourcePath)throw new Error('Pass the approved QLTS index.html path');
let source=fs.readFileSync(sourcePath,'utf8');const sha=crypto.createHash('sha256').update(source).digest('hex');
source=source.replace(/<script\b[^>]*src=["'][^"']*local\.adguard\.org[^>]*>[\s\S]*?<\/script>/g,'');
const permissions=source.slice(source.indexOf('/* ---- quyền ---- */'),source.indexOf('/* ---- màn hình đăng nhập ----'));
if(!permissions.includes('function apQuyen()'))throw new Error('Source permission seam changed');
source=source.replace(/<script>\s*\/\*[^]*?\*\/[\s\S]*?<\/script>/g,m=>m.includes('var TK_KHOA')?'<script>'+permissions+'\nfunction oTaiKhoan(){return "";} function dongTK(){}\n</script>':m);
// The auth block may start with another comment in a later KSB source revision.
source=source.replace(/<script>([\s\S]*?)<\/script>/g,(m,body)=>body.includes('var TK_KHOA')?'<script>'+permissions+'\nfunction oTaiKhoan(){return "";} function dongTK(){}\n</script>':m);
const boot=source.lastIndexOf('<script>');if(!source.slice(boot).includes('function batDau(loc)'))throw new Error('Source bootstrap seam changed');
const dashStart=source.indexOf("VIEW['tong-quan'] = {"),dashEnd=source.indexOf('    // Việc cần xử lý',dashStart);
const dash=source.slice(source.indexOf('    var d = S.d',dashStart),dashEnd).replace(/var h = ph\([\s\S]*?\);\n/,"var h = '';\n");
if(!dash.includes('stat({'))throw new Error('Dashboard seam changed');
const kpi='function portSourceOverview(){'+dash+'return h;}\n';
let listStart=source.indexOf("VIEW['tai-san'] = {"),listEnd=source.indexOf("ACT.xuatTS",listStart);
let list=source.slice(listStart,listEnd);list=list.replace(/      \{ t: 'Nguyên giá'[^\n]*\n/g,'').replace(/      \{ t: 'Còn lại'[^\n]*\n/g,'');
source=source.slice(0,listStart)+list+source.slice(listEnd);
// Imported assets without confirmed custody must not be reported as warehouse stock.
source=source.replaceAll('Trong kho, chưa giao','Chưa gán người sử dụng');
source=source.replaceAll('Thêm loại, phòng ban, vị trí, nhà cung cấp mới vào Danh mục','Thêm loại, vị trí, nhà cung cấp mới vào Danh mục').replaceAll('Phòng ban nhận tài sản, phòng ban của nhân viên','Dùng danh mục Phòng ban QLNS; chỉnh sửa tại QLNS').replaceAll('Để trống: gửi cho nhân viên được đánh dấu Quản lý kho (có email).','Nhập email nhận nhắc hạn; sử dụng nhân sự QLNS, không tạo danh mục quản lý kho riêng.');
source=source.replace("'<span class=\"mo\">Trong kho</span>'","'<span class=\"mo\">' + esc(a.tinhTrang==='Trong kho'?'Trong kho':'Chưa gán người sử dụng') + '</span>'");
source=source.replaceAll('<table class="bang">','<table class="bang" data-ksb-model-page>');
source=source.replaceAll('[10,25,50,100]','[10,20,30,50,100]').replaceAll('size: 25','size: 20');
source=source.slice(0,source.lastIndexOf('<script>'))+'<script>'+kpi+fs.readFileSync(new URL('../src/qlts-port-client.js',import.meta.url),'utf8')+'</script>\n</body></html>';
// GAS bridge is replaced as a whole. No legacy token, login, user/role editor or Sheets data is copied.
const start=source.indexOf('function api(fn) {'),end=source.indexOf('/* Thao tác ngoài ngăn kéo',start);
if(start<0||end<0)throw new Error('Source API seam changed');
source=source.slice(0,start)+'function api(fn){return portAPI(fn,Array.prototype.slice.call(arguments,1));}\n'+source.slice(end);
source=source.replaceAll('google.script.history.push(null, {}, h)','history.pushState(null, "", "#"+h)').replaceAll('google.script.history.replace(null, {}, \'tai-san\')','history.replaceState(null, "", "#tai-san")');
source=source.replaceAll('trong Drive','trong kho QLNS').replaceAll('vào Drive','vào kho QLNS').replaceAll('thùng rác Google Drive (khôi phục được trong 30 ngày)','lịch sử gỡ tệp của kho QLNS (giữ nguyên tệp gốc)');
source=source.replaceAll('Lưu biên bản vào Google Drive','Lưu biên bản vào kho QLNS').replaceAll('PDF lưu trong thư mục "Quản lý tài sản" ở Drive của chủ file, link ghi vào sổ','PDF lưu trong kho tài liệu QLNS theo đơn vị và biên bản').replaceAll('Người khác muốn mở link PDF thì chia sẻ thư mục cho họ.','Quyền truy cập tài liệu theo tài khoản và đơn vị QLNS.').replaceAll('Toàn bộ dữ liệu nằm trong file Google Sheets của bạn','Dữ liệu lưu tại D1 của QLNS-KSB').replaceAll("nut('Mở file dữ liệu Google Sheets', 'moSheet', { i: 'file' })","''").replaceAll('Mở thư mục Drive','Mở kho tài liệu QLNS');
source=source.replaceAll('Dịch vụ tạo ảnh QR (miễn phí, bên ngoài)','Tạo mã QR bằng dịch vụ hiện có của QLNS').replaceAll('Nếu ảnh QR không hiện, thay bằng https://quickchart.io/qr?size=300&text=','Sử dụng mã QR của QLNS-KSB; giữ đúng đơn vị và mã tài sản.');
source=source.replaceAll("'drive:'","'kho:'").replaceAll('Ảnh lưu vào thư mục \"Ảnh tài sản\" trên Google Drive của chủ file','Ảnh lưu trong kho tài liệu tài sản QLNS').replaceAll('Ảnh trong Drive chuyển vào thùng rác.','Gỡ ảnh khỏi hồ sơ; tệp gốc được giữ trong kho QLNS.');
// Source sticky cells can paint outside the scroll box over its following sibling.
source=source.replace('</head>','<style>.ksb-hscroll{position:relative;z-index:7}</style></head>');
source='<!-- QLTS KSB source SHA256 '+sha+'; generated by tools/build-qlts-port.mjs -->\n'+source;
fs.writeFileSync(new URL('../src/qlts-port.html',import.meta.url),source);
fs.writeFileSync(new URL('../src/qlts-port-source.json',import.meta.url),JSON.stringify({sha256:sha,source:'QLTS 2/index.html',adapter:'qlts-port-client.js'},null,2)+'\n');
