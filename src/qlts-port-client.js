/* Integration seams only. All screens, forms and actions above are the KSB GAS source. */
var PORT_ORIGIN=parent.location.origin;
var portWaiting={},portSequence=0;
function portAPI(fn,args){return new Promise(function(resolve,reject){var id=++portSequence;portWaiting[id]={resolve:resolve,reject:reject};parent.postMessage({type:'ksb-qlts-call',id:id,fn:fn,args:args},PORT_ORIGIN);});}
window.addEventListener('message',function(e){if(e.source!==parent||e.origin!==PORT_ORIGIN||e.data.type!=='ksb-qlts-result')return;var p=portWaiting[e.data.id];if(!p)return;delete portWaiting[e.data.id];if(e.data.error)p.reject(new Error(e.data.error));else p.resolve(e.data.data);});
// Shared QLNS users and permissions replace the standalone GAS identity UI.
NAV=NAV.filter(function(g){return g.n!=='Nhân sự';}).map(function(g){return {n:g.n,ds:g.ds.filter(function(x){return x[0]!=='phan-quyen';})};});
['themNV','suaNV','xoaNV','nhapNV'].forEach(function(k){QUYEN_ACT[k]='qlns.employee-editor';});
var sourceLaQT=laQT;laQT=function(){return false;};
function portStart(){veKhung();return api('bootstrap').then(function(d){setData(d);apQuyen();S.route=d.initialAsset?parseH('ts/'+encodeURIComponent(d.initialAsset)):parseH(location.hash||'tai-san');render();}).catch(function(e){$('#pg').textContent=e.message;});}
window.addEventListener('hashchange',function(){if(S.d)go(location.hash,true);});
// Approved integration: the original dashboard KPI and list share a screen.
var portListView=VIEW['tai-san'].ve;
VIEW['tai-san'].ve=function(arg){return portSourceOverview()+portListView.call(this,arg);};
NAV=NAV.filter(function(g){return g.n!=='Tổng quan';});
VIEW['tong-quan']=VIEW['tai-san'];
QUYEN_TRANG['nhat-ky']='baocao';['cdLuu','cdGuiThu'].forEach(function(k){QUYEN_ACT[k]='danhmuc';});QUYEN_TRANG['cai-dat']='danhmuc';
// Original GAS already owns the transaction forms. The shared QLNS store owns documents.
dsBanKy=function(v){try{return JSON.parse(v||'[]');}catch(e){return [];}};
var portFrameBB=veKhungBB;
veKhungBB=function(frame,html){var bb=S.bbDang,kind=bb&&(bb.kieu==='Bảo trì'?'bt':bb.kieu==='Thanh lý'?'tl':bb.kieu==='Kiểm kê'?'kk':'gd'),saved=bb&&S.d.issuedDocuments&&S.d.issuedDocuments[kind+'|'+bb.key];return portFrameBB(frame,saved?.html||html);};

qrLink=function(ma){return S.d.url.replace(/#.*$/,'')+'&asset='+encodeURIComponent(ma)+'#taisan';};
qrAnh=function(link){var u=new URL(link),ma=u.searchParams.get('asset');return PORT_ORIGIN+'/asset-qr.svg?unit='+u.searchParams.get('unit')+'&ma='+encodeURIComponent(ma||'');};
document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#ksb-file="]');if(!a)return;e.preventDefault();var bb=S.bbDang;if(!bb)return;api('docBanKy',bb.kieu,bb.key,a.getAttribute('href').split('=')[1]).then(function(file){var bytes=Uint8Array.from(atob(file.data),function(c){return c.charCodeAt(0);}),frame=$('#bbx .bb-khung');frame.removeAttribute('srcdoc');frame.src=URL.createObjectURL(new Blob([bytes],{type:file.mime}));}).catch(function(er){bao(er.message,true);});},true);
var portSettingsAfter=VIEW['cai-dat'].sau;
VIEW['cai-dat'].sau=function(){if(portSettingsAfter)portSettingsAfter();['tenCongTy','diaChi','qr'].forEach(function(k){var e=$('#cdf [name="'+k+'"]');if(e){e.readOnly=true;e.title='Dùng thông tin công ty QLNS';}});var pdf=$('#cdf [name=tuLuuPdf]');if(pdf&&!S.d.pdfReady){pdf.disabled=true;pdf.title='Chưa cấu hình Browser Run';}};
QUYEN_ACT.cdThuMuc='danhmuc';
ACT.cdThuMuc=function(){api('getDriveFolder').catch(function(e){bao(e.message,true);});};
ACT.cdGuiThu=function(el){var done=dangXuLy(el,'Đang xử lý');api('guiThuNhacHan').then(function(r){bao('Đã xếp hàng '+(r.queuedEmail||0)+' email thử theo cấu hình QLNS');}).catch(function(e){bao(e.message,true);}).then(done);};
// Departments remain a shared QLNS master, including on the original catalog screen.
var portCatalogAfter=VIEW['danh-muc'].sau;
VIEW['danh-muc'].sau=function(){if(portCatalogAfter)portCatalogAfter();$$('[data-k="phongBan"],input[data-dm="phongBan"]').forEach(function(e){e.disabled=true;e.title='Dùng danh mục Phòng ban QLNS';});};
portStart();
