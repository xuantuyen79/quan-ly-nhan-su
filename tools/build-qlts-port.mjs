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
source=source.replaceAll('Đang ở kho','Chưa ghi nhận vị trí').replace("+ ' PDF vào kho QLNS');","+ (S.d.pdfReady?' PDF':'') + ' vào kho QLNS');").replaceAll('Chưa lưu được PDF vào kho QLNS:','Chưa lưu được chứng từ vào kho QLNS:');
source=source.replaceAll('Thêm loại, phòng ban, vị trí, nhà cung cấp mới vào Danh mục','Thêm loại, vị trí, nhà cung cấp mới vào Danh mục').replaceAll('Phòng ban nhận tài sản, phòng ban của nhân viên','Dùng danh mục Phòng ban QLNS; chỉnh sửa tại QLNS').replaceAll('Để trống: gửi cho nhân viên được đánh dấu Quản lý kho (có email).','Nhập email nhận nhắc hạn; sử dụng nhân sự QLNS, không tạo danh mục quản lý kho riêng.');
source=source.replace("'<span class=\"mo\">Trong kho</span>'","'<span class=\"mo\">' + esc(a.tinhTrang==='Trong kho'?'Trong kho':'Chưa gán người sử dụng') + '</span>'");
// Approved initial handover uses actual QLNS custody, without relabelling imported assets as stock.
source=source.replace("var chinh = T === 'Trong kho' ?", "var chinh = DUOC['Cấp phát'](a) ?");
source=source.replace("if (T === 'Trong kho') { d('Cấp phát cho nhân viên', 'capPhat', 'out'); d('Cho mượn', 'choMuon', 'clock'); }", "if (DUOC['Cấp phát'](a)) d('Cấp phát cho nhân viên', 'capPhat', 'out'); if (T === 'Trong kho') d('Cho mượn', 'choMuon', 'clock');");
source=source.replace("loai === 'Cấp phát' ? ' trong kho'", "loai === 'Cấp phát' ? ' có thể bàn giao'").replaceAll('Giao tài sản trong kho cho nhân viên hoặc phòng ban','Giao tài sản đủ điều kiện cho nhân viên hoặc phòng ban');
source=source.replaceAll('<table class="bang">','<table class="bang" data-ksb-model-page>');
source=source.replaceAll('[10,25,50,100]','[10,20,30,50,100]').replaceAll('size: 25','size: 20');
source=source.slice(0,source.lastIndexOf('<script>'))+'<script>'+kpi+fs.readFileSync(new URL('../src/qlts-port-client.js',import.meta.url),'utf8')+'</script>\n</body></html>';
// GAS bridge is replaced as a whole. No legacy token, login, user/role editor or Sheets data is copied.
const start=source.indexOf('function api(fn) {'),end=source.indexOf('/* Thao tác ngoài ngăn kéo',start);
if(start<0||end<0)throw new Error('Source API seam changed');
source=source.slice(0,start)+'function api(fn){return portAPI(fn,Array.prototype.slice.call(arguments,1));}\n'+source.slice(end);
source=source.replaceAll('google.script.history.push(null, {}, h)','history.pushState(null, "", "#"+h)').replaceAll('google.script.history.replace(null, {}, \'tai-san\')','history.replaceState(null, "", "#tai-san")');
source=source.replaceAll('Mở PDF đã lưu trong Drive','Mở chứng từ đã lưu trong Drive');
source=source.replaceAll('trong Drive','trong kho QLNS').replaceAll('vào Drive','vào kho QLNS').replaceAll('thùng rác Google Drive (khôi phục được trong 30 ngày)','lịch sử gỡ tệp của kho QLNS (giữ nguyên tệp gốc)');
source=source.replaceAll('Lưu biên bản vào Google Drive','Lưu biên bản vào kho QLNS').replaceAll('PDF lưu trong thư mục "Quản lý tài sản" ở Drive của chủ file, link ghi vào sổ','PDF lưu trong kho tài liệu QLNS theo đơn vị và biên bản').replaceAll('Người khác muốn mở link PDF thì chia sẻ thư mục cho họ.','Quyền truy cập tài liệu theo tài khoản và đơn vị QLNS.').replaceAll('Toàn bộ dữ liệu nằm trong file Google Sheets của bạn','Dữ liệu lưu tại D1 của QLNS-KSB').replaceAll("nut('Mở file dữ liệu Google Sheets', 'moSheet', { i: 'file' })","''").replaceAll('Mở thư mục Drive','Mở kho tài liệu QLNS');
source=source.replaceAll('Dịch vụ tạo ảnh QR (miễn phí, bên ngoài)','Tạo mã QR bằng dịch vụ hiện có của QLNS').replaceAll('Nếu ảnh QR không hiện, thay bằng https://quickchart.io/qr?size=300&text=','Sử dụng mã QR của QLNS-KSB; giữ đúng đơn vị và mã tài sản.');
source=source.replaceAll("'drive:'","'kho:'").replaceAll('Ảnh lưu vào thư mục \"Ảnh tài sản\" trên Google Drive của chủ file','Ảnh lưu trong kho tài liệu tài sản QLNS').replaceAll('Ảnh trong Drive chuyển vào thùng rác.','Gỡ ảnh khỏi hồ sơ; tệp gốc được giữ trong kho QLNS.');
source=source.replace("+ ' PDF vào kho QLNS');", "+ (S.d.pdfReady?' PDF':'') + ' vào kho QLNS');").replaceAll('Chưa lưu được PDF vào kho QLNS:','Chưa lưu được chứng từ vào kho QLNS:');
source=source.replace("'Đang ở ' + esc(a.viTri || 'kho')", "(a.viTri ? 'Đang ở ' + esc(a.viTri) : T==='Trong kho'||a.nguonQLTS==='Trong kho'?'Đang ở kho':'Chưa ghi nhận vị trí')");
// KSB common heading and new identifier presentation; issued HTML is served unchanged.
source=source.replace('chung: { quocHieu: true,','chung: { quocHieu: false,').replace("  m['Kiểm kê'].kyHieu = 'BBKK';", "  m['Kiểm kê'].kyHieu = 'BBKK';\n  m.chung.quocHieu = false;");
const headingStart=source.indexOf('  var dauLogo = !!C.logo'),headingEnd=source.indexOf('  // thông tin trống',headingStart);
if(headingStart<0||headingEnd<0)throw new Error('Document heading seam changed');
source=source.slice(0,headingStart)+"  var dauLogo = true, soIn = bb.so || '';\n"+source.slice(headingEnd);
source=source.replace('.dau-logo{margin-bottom:12px}', '.dau-logo{display:flex;align-items:center;gap:16px;margin-bottom:12px}');
source=source.replace("'<div class=\"dau-logo\"><img src=\"' + esc(C.logo) + '\" alt=\"\"></div>'", "'<div class=\"dau-logo\">' + (C.logo ? '<img src=\"' + esc(C.logo) + '\" alt=\"\">' : '') + '</div>'");
source=source.replace("so = (M.kyHieu || 'BB') + '/' + nam + '/001'", "so = '001/' + nam + '/' + (M.kyHieu || 'BB')").replace("bb.so = 'BBKK/' + nam + '/001'", "bb.so = '001/' + nam + '/BBKK'");
source=source.split('\n').map(line=>line.includes('data-mau="chung.quocHieu"')?"      form = '' +":line).join('\n');
source=source.replace("esc((L.kyHieu || 'BB') + '/' + hn().slice(0, 4) + '/001')", "esc('001/' + hn().slice(0, 4) + '/' + (L.kyHieu || 'BB'))");
source=source.replace("(cur === 'Cấp phát' ? 'BBBG' : 'BBKK') + '/' + hn().slice(0, 4) + '/001'", "'001/' + hn().slice(0, 4) + '/' + (cur === 'Cấp phát' ? 'BBBG' : 'BBKK')");
// Source sticky cells can paint outside the scroll box over its following sibling.
source=source.replace('</head>','<style>.ksb-hscroll{position:relative;z-index:7}/* QLNS owns the single navigation rail; keep source IDs for its existing render hooks. */.app>.sb,.sb-nen,.tb .tb-menu{display:none!important}.app,.main{width:100%;max-width:100%;min-width:0}.pg{min-width:0;max-width:100%;box-sizing:border-box}</style></head>');
const pgRule='.pg{min-width:0;max-width:100%;box-sizing:border-box}';
if(!source.includes(pgRule)) throw new Error('QLTS CSS .pg changed');
source=source.replace(pgRule,'.pg{min-width:0;max-width:100%;box-sizing:border-box;padding-left:0;padding-right:0}');
// Reuse the actual QLNS font assets; keep catalog UI styling separate from document HTML.
const hrm=fs.readFileSync(new URL('../src/phan-mem.html',import.meta.url),'utf8');
const fonts=(hrm.match(/@font-face\s*\{[^}]*\}/g)||[]).filter(rule=>/font-family:\s*['"]Lexend['"]/.test(rule)).join('\n');
if(!fonts)throw new Error('QLNS Lexend font assets missing');
const catalogTheme=fs.readFileSync(new URL('../src/qlts-catalog-theme.css',import.meta.url),'utf8');
source=source.replace('</head>','<style id="qlns-catalog-theme">'+fonts+'\n'+catalogTheme+'</style></head>');
source='<!-- QLTS KSB source SHA256 '+sha+'; generated by tools/build-qlts-port.mjs -->\n'+source;
fs.writeFileSync(new URL('../src/qlts-port.html',import.meta.url),source);
fs.writeFileSync(new URL('../src/qlts-port-source.json',import.meta.url),JSON.stringify({sha256:sha,source:'QLTS 2/index.html',adapter:'qlts-port-client.js'},null,2)+'\n');
