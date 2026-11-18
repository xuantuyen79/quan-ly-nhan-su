/* Chấm công Wi-Fi – BẢN THỬ NGHIỆM (Quản trị tử tế)
   Cloudflare Worker + D1. Một file máy chủ, giao diện trong app.html.
   - Nhân viên bấm Vào ca / Ra ca: máy chủ so IP của lượt bấm với IP văn phòng (Wi-Fi).
   - Màn hình chung (/tram): mỗi lần mở/làm mới báo IP văn phòng hiện tại + hiện QR động 30 giây (dự phòng).
   - Quản lý (/quan-ly): nhân viên, lượt chấm, IP văn phòng, lượt bị từ chối, cài đặt, tải CSV.
   Giờ chấm lấy theo đồng hồ máy chủ (không tin giờ điện thoại). Hiển thị theo giờ Việt Nam (UTC+7). */
import qrcode from './qrcode.mjs';
import APP_HTML from './app.html';
import { ICON_PNG_B64, ICON_SVG } from './icon.js';
import { DEMO, DEMO_PIN } from './demo-data.js';
import { DEMO_HN } from './demo-hoinhap.js';
import { DEMO_DT } from './demo-daotao.js'; // 12/11 16:30: khóa đào tạo nội bộ mẫu (0.6.1 bản thử)
import { TAY_LATIN, TAY_VI } from './font-tay.js'; // 12/11: phông viết tay cho phần chào mừng hội nhập // 12/11: hành trình hội nhập mẫu (0.6.1 bản thử)
import { OG_QL_B64, OG_NV_B64 } from './og-anh.js'; // 08/11: ảnh chia sẻ Facebook/Zalo cho bản chạy thử
import HRM_HTML from './phan-mem.html'; // 08/11: Phần mềm quản lý nhân sự toàn diện bản xem trước (build/index.html chép sang khi node build.js)

const VER = '1.0.1';  // 13/11/2026 18:30 (bản 0.8.1 phần mềm): một tài khoản chung – tài khoản có quyền quản trị dùng mật khẩu, trang /quan-tri, dữ liệu phần mềm quản trị lưu trên máy chủ, mã cài đặt lần đầu. Trước: '0.4.6';  // 13/11/2026 14:55: nhiều người có quyền duyệt đơn (ai duyệt trước thì đơn chuyển trạng thái, ghi tên người duyệt) + màn Bộ phận của tôi. Trước: '0.4.5';  // 12/11/2026 22:54: ca có yêu cầu có mặt sớm (som, som_ngay) hiện trên app. Trước: '0.4.4';  // 12/11/2026: hành trình hội nhập trên app nhân viên (đi cùng phần mềm 0.6.1)
// trước: VER '0.4.1'  // 07/11/2026: nối Phần mềm quản lý nhân sự toàn diện (đồng bộ nhân viên, lượt chấm, đơn nghỉ, xác nhận công)
/* 07/11/2026 17:42 – CHẾ ĐỘ BẢN THỬ (để mọi người trải nghiệm, góp ý): bật khi chạy ở tên miền chamcong-thu.* hoặc biến môi trường DEMO=1.
   Không cần mật khẩu trang Quản lý và trang Mã QR chấm công; có sẵn tài khoản nhân viên mẫu (PIN chung DEMO_PIN); khóa các thao tác làm hỏng dữ liệu dùng chung;
   API công khai /api/demo/* để Phần mềm quản lý nhân sự toàn diện (bản thử) kéo lượt chấm, đơn nghỉ về dữ liệu mẫu. Mỗi ngày tự dọn dữ liệu cũ. */
const DEMO_SEED = '2026-11-11d'; // 16:12: đơn mẫu chờ duyệt, người bàn giao hợp lý ← // 11/11 15:32: hồ sơ, phiếu lương 3 tháng, quản lý trực tiếp, công Xưởng Đóng gói ← // 11/11: thêm Xưởng Đóng gói SG008–SG013 (khối sản xuất, xếp ca) → // 09/11: thêm DS010 bán thời gian, DS011 cộng tác viên → máy chủ thử nạp lại dữ liệu mẫu
const MAU = 'Dữ liệu mẫu';
// giờ vào/ra tự sinh cho ngày sau ngày chốt dữ liệu mẫu – CÙNG công thức với Phần mềm quản lý nhân sự toàn diện (bcSynRow) để hai bên khớp nhau
function demoHash(str) { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000003; return h; }
function hm2min(t) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; }
function vnHM(t) { const d = new Date(t + 7 * 3600e3); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
function dayT(iso, min) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - VN + min * 6e4; }
function addIso(iso, k) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + k * 864e5); return d.toISOString().slice(0, 10); }
function demoSynDay(e, iso) {
  if (e.sx) return null; // 11/11: khối sản xuất làm theo lịch xếp ca – phần mềm nhân sự tự sinh giờ theo lịch, máy chủ thử không sinh
  const wd = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
  if (!DEMO.ca.thu.includes(wd)) return null;
  if (e.don.some(d => d.trang_thai === 'Đã duyệt' && d.tu <= iso && iso <= d.den)) return null;
  let h = demoHash(e.ma + iso), a = hm2min(DEMO.ca.vao), b = hm2min(DEMO.ca.ra);
  if (e.ld === 'ctv') { if (![1, 3, 5].includes(wd)) return null; a = 480; b = 690; } else if (e.ld === 'pt') { a = 810; b = 1050; } // 09/11: khớp phần mềm – CTV sáng T2/T4/T6, bán thời gian ca chiều
  return { vao: h % 17 === 0 ? a + 6 + h % 20 : a - 4 - h % 22, ra: b + 1 + (h >> 3) % 27 };
}
function demoPunchSt(db, ma, t, loai, ghi) { return db.prepare("INSERT INTO cham (ma, t, loai, cach, ip, wifi, tb, ghi) VALUES (?, ?, ?, 'wifi', '', 1, ?, ?)").bind(ma, t, loai, MAU, ghi); }
const DEMO_LOCKED = (() => { let m = ''; for (const c of DEMO.cty) for (const e of c.ds) for (const x of e.congs) if (!x.du_lieu.tam && x.ym > m) m = x.ym; return m; })();
function isDemo(env, url) { return env.DEMO === '1' || /^chamcong-thu\./i.test(url.hostname); }
/* ----- 0.4.2: lịch xếp ca ----- */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/, MA_RE = /^[A-Z0-9._-]{1,20}$/;
function lichCfg(cfg) { try { return JSON.parse(cfg.lich_cfg || 'null'); } catch (e) { return null; } }
function lichClean(c) { // chỉ giữ trường cần cho trang nhân viên
  const s = (v, n) => String(v == null ? '' : v).slice(0, n), col = v => /^#[0-9a-fA-F]{3,8}$/.test(String(v || '')) ? v : '#64748b';
  const ca = (Array.isArray(c.ca) ? c.ca : []).slice(0, 30).map(x => ({ id: s(x.id, 10), ten: s(x.ten, 60), vao: s(x.vao, 5), ra: s(x.ra, 5), gio: +x.gio || 0, mau: col(x.mau), som: Math.max(0, Math.min(120, Math.round(+x.som || 0))), som_ngay: (Array.isArray(x.som_ngay) ? x.som_ngay : []).map(Number).filter(d => d >= 0 && d <= 6).slice(0, 7) })).filter(x => x.id && !x.id.includes('+'));
  const kh = (Array.isArray(c.kh) ? c.kh : []).slice(0, 30).map(x => ({ k: s(x.k, 6), t: s(x.t, 80), mau: col(x.mau), chinh: x.chinh ? 1 : 0 })).filter(x => x.k);
  const mo = (Array.isArray(c.mo) ? c.mo : []).slice(0, 12).filter(x => ISO_RE.test(x.a) && ISO_RE.test(x.b) && ISO_RE.test(x.han)).map(x => ({ key: s(x.key, 20), ten: s(x.ten, 60), a: x.a, b: x.b, han: x.han }));
  const sx = (Array.isArray(c.sx) ? c.sx : []).slice(0, 2000).map(x => String(x).toUpperCase()).filter(x => MA_RE.test(x));
  return { ky: s(c.ky, 10), mode: c.mode === 'nv' ? 'nv' : 'ql', ca, kh, mo, sx, at: Date.now() };
}
function lichConf(LC, code) { const seg = String(code || '').split('+').map(id => LC.ca.find(x => x.id === id)).filter(Boolean).map(x => { const a = hm2min(x.vao), b0 = hm2min(x.ra); if (a == null || b0 == null) return null; return [a, b0 <= a ? b0 + 1440 : b0, x.id]; }).filter(Boolean).sort((p, q) => p[0] - q[0]);
  for (let i = 1; i < seg.length; i++) if (seg[i][0] < seg[i - 1][1]) return seg[i - 1][2] + ' và ' + seg[i][2] + ' trùng giờ'; return ''; }
function lichCodeOk(LC, code) { if (!code) return true; if (LC.kh.some(x => x.k === code)) return true; const ids = String(code).split('+'); return ids.length <= 4 && ids.every(id => LC.ca.some(x => x.id === id)); }
async function lichPush(db, body, allow) { // body: { cfg, ky: [{key, a, b}], list: [{ma, d: {iso: mã}}] }
  const st = [], LC = body.cfg ? lichClean(body.cfg) : null; let n = 0;
  if (LC) st.push(db.prepare("INSERT INTO cfg (k, v) VALUES ('lich_cfg', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(LC)));
  const ky = (Array.isArray(body.ky) ? body.ky : []).slice(0, 20).filter(k => ISO_RE.test(k.a) && ISO_RE.test(k.b) && k.a <= k.b);
  const list = (Array.isArray(body.list) ? body.list : []).slice(0, 2000);
  for (const x of list) {
    const ma = String(x.ma || '').toUpperCase(); if (!MA_RE.test(ma) || (allow && !allow(ma))) continue; const d = x.d || {};
    for (const k of ky) {
      st.push(db.prepare('DELETE FROM lich WHERE ma = ? AND ngay BETWEEN ? AND ?').bind(ma, k.a, k.b), db.prepare('DELETE FROM dk_ca WHERE ma = ? AND ngay BETWEEN ? AND ?').bind(ma, k.a, k.b));
      Object.keys(d).forEach(iso => { if (!ISO_RE.test(iso) || iso < k.a || iso > k.b) return; const c = String(d[iso] || '').slice(0, 40); if (!c) return; st.push(db.prepare('INSERT INTO lich (ma, ngay, ca, ky) VALUES (?, ?, ?, ?) ON CONFLICT(ma, ngay) DO UPDATE SET ca = excluded.ca, ky = excluded.ky').bind(ma, iso, c, String(k.key || '').slice(0, 20))); n++; });
    }
  }
  for (let i = 0; i < st.length; i += 400) await db.batch(st.slice(i, i + 400));
  return n;
}
async function hoSoPush(db, body, allow) {
  const st = []; let n = 0;
  for (const x of (Array.isArray(body.list) ? body.list : []).slice(0, 2000)) { const ma = String(x.ma || '').toUpperCase(); if (!MA_RE.test(ma) || (allow && !allow(ma))) continue; const js = JSON.stringify(x.d || {}); if (js.length > 900000) continue; st.push(db.prepare('INSERT INTO ho_so (ma, du_lieu, at) VALUES (?, ?, ?) ON CONFLICT(ma) DO UPDATE SET du_lieu = excluded.du_lieu, at = excluded.at').bind(ma, js, Date.now())); n++; }
  for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100)); return n;
}
async function hoSoOf(db, ma) { const r = await db.prepare('SELECT du_lieu, at FROM ho_so WHERE ma = ?').bind(ma).first(); if (!r) return null; try { const d = JSON.parse(r.du_lieu); d.at = r.at; return d; } catch (e) { return null; } }
async function dkList(db, tu, allow) { return (await db.prepare('SELECT ma, ngay, ca, ky, t FROM dk_ca WHERE ngay >= ? ORDER BY ma, ngay').bind(tu).all()).results.filter(x => !allow || allow(x.ma)); }
// 11/11 15:32: mỗi ngày tạo lại vài đơn mẫu đang chờ duyệt để quản lý trực tiếp thử Duyệt / Từ chối trên app (mỗi quản lý 1 đơn của 1 nhân viên dưới quyền)
function demoDonCho(db, today, now) {
  const out = [], done = {}, LO = ['Nghỉ phép năm', 'Nghỉ việc riêng có lương', 'Nghỉ phép năm', 'Nghỉ không lương']; let i = 0;
  // 11/11 16:12 anh: ưu tiên đơn của nhân viên (không phải trưởng bộ phận) để quản lý cấp giữa không vừa là người duyệt vừa có đơn chờ cấp trên; người nhận bàn giao là đồng nghiệp cùng bộ phận (không phải quản lý), không có thì để trống
  const ppl = []; for (const c of DEMO.cty) for (const e of c.ds) if (e.hs && e.hs.ql) ppl.push({ c, e }); ppl.sort((a, b) => (a.e.hs.truong ? 1 : 0) - (b.e.hs.truong ? 1 : 0));
  for (const { c, e } of ppl) { const ql = e.hs.ql; if (done[ql]) continue; done[ql] = 1; const tu = addIso(today, 5 + (i % 6)), den = i % 3 === 0 ? addIso(tu, 1) : tu, bg = c.ds.find(x => x.ma !== e.ma && x.ma !== ql && x.pb === e.pb && !(x.hs && x.hs.truong)) || null;
    out.push(db.prepare("INSERT INTO don (so, ma, loai, tu, den, so_ngay, ly_do, tao, trang_thai, nguoi_duyet, duyet_ma, ban_giao, nguon, cap_nhat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Chờ duyệt', ?, ?, ?, ?, ?)")
      .bind('MAU-' + today.replace(/-/g, '').slice(2) + '-' + e.ma, e.ma, LO[i % 4], tu, den, den === tu ? 1 : 2, ['Việc gia đình', 'Đưa con đi khám', 'Về quê', 'Việc cá nhân'][i % 4], now - (i + 1) * 3600e3, e.hs.ql_ten || '', ql, bg ? bg.ma + '|' + bg.ten : '', MAU, now)); i++; }
  return out;
}
// 12/11 (0.6.1 bản thử): hành trình hội nhập đi kèm hồ sơ (d.hn do phần mềm gửi); bản thử chưa có hồ sơ gửi lên thì dùng mẫu DEMO_HN
async function hnOfMa(db, ma, demo) { const HS = await hoSoOf(db, ma); if (HS && 'hn' in HS) return HS.hn || null; return demo ? DEMO_HN[ma] || null : null; }
// 12/11 16:30 (0.6.1): khóa đào tạo nội bộ của 1 người – phần mềm gửi kèm hồ sơ (HS.dt); bản thử chưa có thì ghép từ mẫu DEMO_DT
async function dtOfMa(db, ma, demo) {
  const HS = await hoSoOf(db, ma); if (HS && 'dt' in HS) return HS.dt || null;
  if (!demo || !DEMO_DT.nv[ma]) return null; const n = DEMO_DT.nv[ma];
  return { v: 1, f: n.f, kh: n.giao.map(g => DEMO_DT.kh[g.id] ? { ...DEMO_DT.kh[g.id], due: g.due, kq: null } : null).filter(Boolean) };
}
// gửi cho app: bỏ đáp án đúng và gợi ý chấm (máy chủ tự chấm trắc nghiệm)
function dtForApp(dt) { if (!dt) return null; return { ...dt, kh: (dt.kh || []).map(k => ({ ...k, tests: (k.tests || []).map(t => ({ ...t, cau: (t.cau || []).map(q => { const { dung, goi_y, ...r } = q; return r; }) })) })) }; }
function dtScore(t, ans) {
  let got = 0, tot = 0, wait = false;
  for (const q of t.cau || []) { const d = +q.diem || 1; tot += d; const a = ans ? ans[q.id] : null;
    if (q.loai === 'tl') { wait = true; continue; }
    const ok = (q.dung || []).slice().sort().join(','), my = (Array.isArray(a) ? a : []).map(Number).sort().join(','); if (ok && my === ok) got += d; }
  return { got: Math.round(got * 100) / 100, tot, pct: tot ? Math.round(got / tot * 1000) / 10 : 100, wait };
}
/* 13/11/2026 14:55 – nhiều người duyệt đơn + màn "Bộ phận của tôi" trên app.
   Người được duyệt đơn của một nhân viên: danh sách hs.duyet do phần mềm quản trị gửi (Phân quyền → Người duyệt đơn);
   chưa thiết lập thì mặc định = quản lý trực tiếp + trưởng bộ phận + Giám đốc (người không có quản lý trực tiếp trong cùng công ty). */
async function hsLite(db, demo) {
  const by = {};
  try {
    for (const r of (await db.prepare("SELECT ma, json_extract(du_lieu,'$.ten') ten, json_extract(du_lieu,'$.cty') cty, json_extract(du_lieu,'$.pb') pb, json_extract(du_lieu,'$.cd') cd, json_extract(du_lieu,'$.ql') ql, json_extract(du_lieu,'$.truong') truong, json_extract(du_lieu,'$.duyet') duyet FROM ho_so WHERE json_valid(du_lieu)").all()).results) {
      let dz = null; try { dz = r.duyet ? JSON.parse(r.duyet) : null; } catch (e) { }
      by[r.ma] = { ten: r.ten || '', cty: r.cty || '', pb: r.pb || '', cd: r.cd || '', ql: r.ql || '', truong: r.truong ? 1 : 0, duyet: Array.isArray(dz) && dz.length ? dz : null };
    }
  } catch (e) { }
  if (demo) for (const c of DEMO.cty) for (const e of c.ds) if (!by[e.ma] && e.hs) by[e.ma] = { ten: e.hs.ten || e.ten, cty: e.hs.cty || c.ten, pb: e.hs.pb || e.pb || '', cd: e.hs.cd || e.cd || '', ql: e.hs.ql || '', truong: e.hs.truong ? 1 : 0, duyet: Array.isArray(e.hs.duyet) && e.hs.duyet.length ? e.hs.duyet : null };
  return by;
}
function nguoiDuyet(by, ma) {
  const h = by[ma]; if (!h) return [];
  let l = [];
  if (h.duyet) l = h.duyet.map(x => String((x && x.ma) || x || ''));
  else {
    if (h.ql) l.push(h.ql);
    const ks = Object.keys(by).filter(k => by[k].cty === h.cty), head = ks.find(k => by[k].truong && by[k].pb === h.pb && k !== ma), gd = ks.find(k => !by[k].ql);
    if (head) l.push(head);
    // 13/11/2026 17:45 anh chốt: Giám đốc chỉ là người duyệt DỰ PHÒNG – chỉ nhận đơn khi nhân sự không có quản lý trực tiếp và cũng không có trưởng bộ phận
    if (!l.filter(x => x && x !== ma && by[x]).length && gd) l.push(gd);
  }
  return [...new Set(l)].filter(x => x && x !== ma && by[x]);
}
function duocDuyet(by, me, d) { return d.ma !== me && (d.duyet_ma === me || nguoiDuyet(by, d.ma).includes(me)); }
async function donChoDuyet(db, by, me) {
  const pend = (await db.prepare("SELECT d.so, d.ma, n.ten, n.pb, d.loai, d.tu, d.den, d.so_ngay, d.ly_do, d.ban_giao, d.tao, d.duyet_ma FROM don d LEFT JOIN nv n ON n.ma = d.ma WHERE d.trang_thai = 'Chờ duyệt' AND d.ma != ? ORDER BY d.tu LIMIT 400").bind(me).all()).results;
  return pend.filter(d => duocDuyet(by, me, d)).slice(0, 40).map(d => { const cung = nguoiDuyet(by, d.ma).filter(x => x !== me).map(x => by[x].ten); const { duyet_ma, ...o } = d; return { ...o, cung }; });
}
/* ===== 16/11/2026 – ĐƠN XIN ĐI MUỘN / VỀ SỚM (góp ý người dùng, anh Tuấn chốt: đơn vị tự bật/tắt và tự đặt quy tắc) =====
   Cấu hình của đơn vị đi kèm hồ sơ mỗi người (ho_so.du_lieu.xm), do Phần mềm quản lý nhân sự toàn diện gửi lên:
     { on: 1, han: 'truoc' | 'ngay' | 'n', n: số ngày được gửi bù sau khi phát sinh, max: số đơn tối đa/tháng (0 = không giới hạn), tinh: 'dung' | 'ghi' }
     tinh 'dung' = đơn được duyệt → tính như chấm vào/ra đúng giờ (không trừ giờ, không tính lượt vi phạm); 'ghi' = vẫn trừ giờ thực tế, chỉ không tính vi phạm.
   Bản thử: mặc định BẬT để người dùng thử. Người duyệt = người duyệt đơn nghỉ (nguoiDuyet). */
const XM_MAC_DINH = { on: 1, han: 'ngay', n: 0, max: 0, tp: 0, tinh: 'dung' }; // tp: hạn 'truoc' – phải xin trước tối thiểu bao nhiêu phút (16/11 11:02 anh)
function xmCfgOf(HS, demo) {
  const x = HS && HS.xm; if (x && typeof x === 'object') return { on: x.on ? 1 : 0, han: ['truoc', 'ngay', 'n'].includes(x.han) ? x.han : 'ngay', n: Math.max(0, Math.min(31, Math.round(+x.n || 0))), max: Math.max(0, Math.min(60, Math.round(+x.max || 0))), tp: Math.max(0, Math.min(10080, Math.round(+x.tp || 0))), tinh: x.tinh === 'ghi' ? 'ghi' : 'dung' };
  return demo ? { ...XM_MAC_DINH } : { on: 0 };
}
function isoDowW(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
function addDaysIso(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// giờ vào – ra của ca ngày đó: lịch xếp ca (khối sản xuất) → ca theo thứ → ca phòng ban
async function caNgay(db, cfg, HS, ma, ngay) {
  const LC = lichCfg(cfg);
  if (LC && (LC.sx || []).includes(ma)) {
    const r = await db.prepare('SELECT ca FROM lich WHERE ma = ? AND ngay = ?').bind(ma, ngay).first(); if (!r || !r.ca || r.ca === 'N') return null;
    const ps = String(r.ca).split('+').map(k => (LC.ca || []).find(c => c.id === k)).filter(Boolean); if (!ps.length || !ps[0].vao) return null;
    return { vao: ps[0].vao, ra: ps[ps.length - 1].ra, som: +ps[0].som || 0 };
  }
  const L = HS && HS.lich, ca = L && L.ca; if (!ca || !ca.vao) return null;
  const dw = isoDowW(ngay); if (Array.isArray(L.tuan) && L.tuan.length && !L.tuan.includes(dw)) return null;
  const ng = ca.ngay && ca.ngay[dw], som = +ca.som && (!Array.isArray(ca.som_ngay) || !ca.som_ngay.length || ca.som_ngay.includes(dw)) ? +ca.som : 0;
  return { vao: ng ? ng.vao : ca.vao, ra: ng ? ng.ra : ca.ra, som };
}
async function xmChoDuyet(db, by, me) {
  const pend = (await db.prepare("SELECT x.so, x.ma, n.ten, n.pb, x.ngay, x.kieu, x.gio, x.phut, x.ly_do, x.tao, x.duyet_ma FROM xin_muon x LEFT JOIN nv n ON n.ma = x.ma WHERE x.trang_thai = 'Chờ duyệt' AND x.ma != ? ORDER BY x.ngay LIMIT 400").bind(me).all()).results;
  return pend.filter(d => duocDuyet(by, me, d)).slice(0, 40).map(d => { const cung = nguoiDuyet(by, d.ma).filter(x => x !== me).map(x => by[x].ten); const { duyet_ma, ...o } = d; return { ...o, xm: 1, loai: d.kieu === 'som' ? 'Xin về sớm' : 'Xin đi muộn', tu: d.ngay, den: d.ngay, cung }; });
}

/* ===== 16/11/2026 – THÔNG BÁO ĐẨY (Web Push, chuẩn RFC 8030 / 8291 / 8292) =====
   Khóa VAPID tự tạo lần đầu, lưu trong cfg (vapid_jwk bí mật – không trả ra ngoài). Nội dung mã hóa aes128gcm theo khóa của từng trình duyệt.
   iPhone: chỉ nhận khi đã "Thêm vào MH chính" và iOS 16.4 trở lên. */
function b64u(buf) { const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(t) { t = String(t || '').replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return b64ToBytes(t); }
function catBytes(...a) { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; }
const TE = new TextEncoder();
async function vapidKeys(db, cfg) {
  if (cfg.vapid_jwk && cfg.vapid_pub) return { jwk: JSON.parse(cfg.vapid_jwk), pub: cfg.vapid_pub };
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  await db.batch([db.prepare("INSERT INTO cfg (k, v) VALUES ('vapid_jwk', ?) ON CONFLICT(k) DO NOTHING").bind(JSON.stringify(jwk)), db.prepare("INSERT INTO cfg (k, v) VALUES ('vapid_pub', ?) ON CONFLICT(k) DO NOTHING").bind(pub)]);
  const r = await db.prepare("SELECT k, v FROM cfg WHERE k IN ('vapid_jwk','vapid_pub')").all(); const m = {}; r.results.forEach(x => { m[x.k] = x.v; }); // hai yêu cầu cùng lúc: lấy bản đã lưu trước
  cfg.vapid_jwk = m.vapid_jwk; cfg.vapid_pub = m.vapid_pub; return { jwk: JSON.parse(m.vapid_jwk), pub: m.vapid_pub };
}
async function hkdf(salt, ikm, info, bits) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bits)); }
async function pushEncrypt(p256dh, auth, text) {
  const ua = unb64u(p256dh), sec = unb64u(auth), uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(sec, ecdh, catBytes(TE.encode('WebPush: info\0'), ua, as), 256), salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, TE.encode('Content-Encoding: aes128gcm\0'), 128), nonce = await hkdf(salt, ikm, TE.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, catBytes(TE.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return catBytes(salt, rs, new Uint8Array([as.length]), as, ct);
}
async function vapidAuth(V, endpoint, sub) {
  const aud = new URL(endpoint).origin, head = b64u(TE.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), body = b64u(TE.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const key = await crypto.subtle.importKey('jwk', V.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, TE.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + V.pub;
}
// gửi tới mọi máy đã bật thông báo của các mã NV; máy hết hạn đăng ký (404/410) tự xóa. Lỗi không làm hỏng thao tác chính.
async function pushTo(db, cfg, origin, mas, msg) {
  try {
    mas = [...new Set((mas || []).filter(Boolean))]; if (!mas.length) return 0;
    const subs = (await db.prepare('SELECT ep, ma, p256dh, auth FROM push_sub WHERE ma IN (' + mas.map(() => '?').join(',') + ')').bind(...mas).all()).results; if (!subs.length) return 0;
    const V = await vapidKeys(db, cfg), text = JSON.stringify(msg); let n = 0;
    await Promise.all(subs.map(async x => {
      try {
        const r = await fetch(x.ep, { method: 'POST', headers: { authorization: await vapidAuth(V, x.ep, origin), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' }, body: await pushEncrypt(x.p256dh, x.auth, text) });
        if (r.status === 404 || r.status === 410) await db.prepare('DELETE FROM push_sub WHERE ep = ?').bind(x.ep).run(); else if (r.ok) n++;
      } catch (e) { }
    }));
    return n;
  } catch (e) { return 0; }
}
function later(req, p) { if (req.ctx && req.ctx.waitUntil) req.ctx.waitUntil(p); else return p; }
/* ===== 16/11/2026 12:21 – KHO THÔNG TIN CHUNG + THÔNG BÁO =====
   Phần mềm quản lý nhân sự toàn diện đẩy lên: danh mục tài liệu theo công ty (vb.du_lieu = { nhom: [...], ds: [...] }), file chia mảnh ≤ 700.000 ký tự base64 (tối đa 10 MB),
   thông báo (tb: tiêu đề, nội dung, ảnh JPEG base64 ≤ 600 KB, popup, đối tượng den = { all } | { pb: [] } | { ma: [] }). Nhân viên: tb_doc = đã đọc / đã xóa (ẩn với riêng mình). */
const VB_PART = 700000, VB_MAX = 10 * 1024 * 1024;
function tbDen(r) { try { return JSON.parse(r.den || '{}') || {}; } catch (e) { return {}; } }
function tbHop(r, me, H) { const d = tbDen(r); if (r.cty && H.cty && r.cty !== H.cty) return false; return d.all ? true : Array.isArray(d.ma) && d.ma.length ? d.ma.includes(me) : Array.isArray(d.pb) && d.pb.length ? d.pb.includes(H.pb || '') : false; }
async function tbNguoiNhan(db, demo, r) { const BY = await hsLite(db, demo); return Object.keys(BY).filter(ma => tbHop(r, ma, BY[ma])); }
// dùng chung cho /api/sync/* (bản công ty) và /api/demo/* (bản thử, chỉ công ty mẫu)
async function vbTbApi(r, db, cfg, body, url, req, now, demo, jc, ctyOk) {
  if (r === 'vb' && req.method === 'POST') {
    const cty = String(body.cty || '').slice(0, 160); if (!ctyOk(cty)) return jc({ ok: false, loi: 'Công ty không hợp lệ' }, 400);
    const js = JSON.stringify({ nhom: (Array.isArray(body.nhom) ? body.nhom : []).slice(0, 60).map(x => String(x).slice(0, 80)), ds: (Array.isArray(body.ds) ? body.ds : []).slice(0, 500) });
    if (js.length > 400000) return jc({ ok: false, loi: 'Danh mục quá lớn' }, 413);
    await db.prepare('INSERT INTO vb (cty, du_lieu, at) VALUES (?, ?, ?) ON CONFLICT(cty) DO UPDATE SET du_lieu = excluded.du_lieu, at = excluded.at').bind(cty, js, now).run(); return jc({ ok: true });
  }
  if (r === 'vb-ids') { const cty = String(url.searchParams.get('cty') || ''); return jc({ ok: true, ids: (await db.prepare('SELECT id FROM vb_file WHERE cty = ? AND n = (SELECT COUNT(*) FROM vb_part p WHERE p.id = vb_file.id)').bind(cty).all()).results.map(x => x.id) }); }
  if (r === 'vb-file' && req.method === 'POST') { // từng mảnh: i = 0..n-1
    const id = String(body.id || '').slice(0, 80), cty = String(body.cty || '').slice(0, 160), i = +body.i, n = +body.n, data = String(body.data || ''), size = +body.size || 0;
    if (!/^[\w.-]{4,80}$/.test(id) || !ctyOk(cty) || !(n >= 1 && n <= 20) || !(i >= 0 && i < n) || !data || data.length > VB_PART + 8) return jc({ ok: false, loi: 'Mảnh file không hợp lệ' }, 400);
    if (size > (demo ? 3 * 1024 * 1024 : VB_MAX)) return jc({ ok: false, loi: 'File quá lớn (tối đa ' + (demo ? '3 MB ở bản thử' : '10 MB') + ')' }, 413);
    const st = [db.prepare('INSERT INTO vb_part (id, i, v) VALUES (?, ?, ?) ON CONFLICT(id, i) DO UPDATE SET v = excluded.v').bind(id, i, data)];
    if (i === 0) st.unshift(db.prepare('DELETE FROM vb_part WHERE id = ? AND i >= ?').bind(id, n), db.prepare('INSERT INTO vb_file (id, cty, ten, loai, size, n, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET cty = excluded.cty, ten = excluded.ten, loai = excluded.loai, size = excluded.size, n = excluded.n, at = excluded.at').bind(id, cty, String(body.ten || 'tai-lieu').slice(0, 200), String(body.loai || 'application/octet-stream').slice(0, 120), size, n, now));
    await db.batch(st); return jc({ ok: true });
  }
  if (r === 'vb-xoa' && req.method === 'POST') { const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 200).map(String); for (const id of ids) { const f = await db.prepare('SELECT cty FROM vb_file WHERE id = ?').bind(id).first(); if (f && ctyOk(f.cty)) await db.batch([db.prepare('DELETE FROM vb_part WHERE id = ?').bind(id), db.prepare('DELETE FROM vb_file WHERE id = ?').bind(id)]); } return jc({ ok: true }); }
  if (r === 'tb' && req.method === 'POST') {
    const cty = String(body.cty || '').slice(0, 160); if (!ctyOk(cty)) return jc({ ok: false, loi: 'Công ty không hợp lệ' }, 400);
    const td = String(body.tieu_de || '').trim().slice(0, 200), nd = String(body.noi_dung || '').trim().slice(0, 6000), anh = String(body.anh || ''); if (!td) return jc({ ok: false, loi: 'Thiếu tiêu đề' }, 400);
    if (anh && (!/^data:image\/(jpeg|png|webp);base64,/.test(anh) || anh.length > 820000)) return jc({ ok: false, loi: 'Ảnh không hợp lệ hoặc quá lớn' }, 413);
    const d = body.den || {}, den = JSON.stringify(d.all ? { all: 1 } : Array.isArray(d.ma) && d.ma.length ? { ma: d.ma.slice(0, 2000).map(String) } : { pb: (Array.isArray(d.pb) ? d.pb : []).slice(0, 200).map(String) });
    const id = /^tb[\w-]{4,40}$/.test(String(body.id || '')) ? String(body.id) : 'tb' + now.toString(36) + randHex(3), row = { id, cty, den };
    const ds = await tbNguoiNhan(db, demo, row);
    await db.prepare('INSERT INTO tb (id, cty, tieu_de, noi_dung, anh, popup, den, loai, ref, nguoi, n, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, cty, td, nd, anh || null, body.popup ? 1 : 0, den, String(body.loai || 'tb').slice(0, 10), String(body.ref || '').slice(0, 80), String(body.nguoi || '').slice(0, 80), ds.length, now).run();
    if (ds.length) later(req, pushTo(db, cfg, url.origin, ds, { t: td, b: nd.replace(/\s+/g, ' ').slice(0, 140), u: '/?tb=' + id, tag: id }));
    return jc({ ok: true, id, n: ds.length });
  }
  if (r === 'tb-luu') { // 17/11: thời gian lưu thông báo + dung lượng dữ liệu (cảnh báo khi gần hạn mức gói miễn phí D1 500 MB)
    if (req.method === 'POST' && !demo) { const m = parseInt(body.thang, 10); if (![0, 6, 12, 24].includes(m)) return jc({ ok: false, loi: 'Thời gian lưu chưa đúng' }, 400); await setCfg(db, { tb_luu_thang: m }); cfg.tb_luu_thang = String(m); }
    return jc(Object.assign({ ok: true, demo: !!demo, thang: tbLuuThang(cfg) }, await dbDungLuong(db)));
  }
  if (r === 'tb-list') { const cty = String(url.searchParams.get('cty') || ''); return jc({ ok: true, list: (await db.prepare("SELECT t.id, t.n, t.at, (SELECT COUNT(*) FROM tb_doc d WHERE d.id = t.id AND d.doc_at IS NOT NULL) AS doc FROM tb t WHERE t.cty = ? ORDER BY t.at DESC LIMIT 300").bind(cty).all()).results }); }
  if (r === 'tb-xoa' && req.method === 'POST') { const id = String(body.id || ''), t = await db.prepare('SELECT cty FROM tb WHERE id = ?').bind(id).first(); if (t && ctyOk(t.cty)) await db.batch([db.prepare('DELETE FROM tb WHERE id = ?').bind(id), db.prepare('DELETE FROM tb_doc WHERE id = ?').bind(id)]); return jc({ ok: true }); }
  return null;
}
// ===== CỔNG TUYỂN DỤNG CỦA CÔNG TY (17/11/2026) – cùng cách làm với máy chủ thử tuyen-dung-thu, khác: link /tuyen-dung/<slug>, không hết hạn, API phần mềm cần đăng nhập =====
const TD_CV_MAX = 5 * 1024 * 1024, TD_PART = 1500000, TD_HITS = new Map();
const tdOkTok = t => /^[a-z0-9]{8,16}$/.test(t || '');
async function tdSha(x) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)); return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join(''); }
async function tdAuth(db, tok, key) { if (!tdOkTok(tok) || !key || key.length < 20) return null; const r = await db.prepare('SELECT * FROM td_cong WHERE tok = ?').bind(tok).first(); if (!r) return null; return r.key_hash === await tdSha(key) ? r : false; }
async function tdDelHs(db, mas) { if (!mas.length) return; const q = mas.map(() => '?').join(','); await db.batch([db.prepare('DELETE FROM td_cv_part WHERE ma IN (' + q + ')').bind(...mas), db.prepare('DELETE FROM td_ho_so WHERE ma IN (' + q + ')').bind(...mas)]); }
function tdTooMany(ip) { const now = Date.now(), a = (TD_HITS.get(ip) || []).filter(t => now - t < 600000); a.push(now); TD_HITS.set(ip, a); if (TD_HITS.size > 5000) TD_HITS.clear(); return a.length > 12; }
const tdJ = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
function tdPage(title, body, st = 200) {
  return new Response('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + htmlEsc(title) + '</title><style>body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;background:#F4EFE5;color:#231E19;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}.b{max-width:560px;background:#fff;border:1px solid #E3D9C6;border-radius:18px;padding:28px;line-height:1.6}h1{font-size:21px;margin:0 0 10px}a{color:#2F7D4F}li{margin:6px 0}</style></head><body><div class="b">' + body + '</div></body></html>', { status: st, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
async function tdTrang(db, url) { // GET /tuyen-dung[/<slug>[/<vị trí>|/ve-chung-toi]]
  const m = /^\/tuyen-dung(?:\/([a-z0-9-]{1,80}))?(?:\/([a-z0-9-]{1,120}))?\/?$/.exec(url.pathname); if (!m) return null;
  if (!m[1]) { const L = (await db.prepare("SELECT slug, ten FROM td_cong WHERE html IS NOT NULL AND html != '' ORDER BY ten").all()).results;
    if (L.length === 1) return Response.redirect(url.origin + '/tuyen-dung/' + L[0].slug, 302);
    return tdPage('Tuyển dụng', L.length ? '<h1>Cơ hội việc làm</h1><ul>' + L.map(r => '<li><a href="/tuyen-dung/' + htmlEsc(r.slug) + '">' + htmlEsc(r.ten || r.slug) + '</a></li>').join('') + '</ul>' : '<h1>Chưa mở cổng tuyển dụng</h1><p>Hiện chưa có vị trí nào đang tuyển. Vui lòng quay lại sau.</p>', L.length ? 200 : 404); }
  const r = await db.prepare('SELECT html, jobs FROM td_cong WHERE slug = ?').bind(m[1]).first();
  if (!r || !r.html) return tdPage('Không tìm thấy', '<h1>Không tìm thấy trang tuyển dụng</h1><p>Link không đúng hoặc công ty đã tạm đóng cổng tuyển dụng.</p><p><a href="/tuyen-dung">Xem các trang tuyển dụng →</a></p>', 404);
  if (m[2] && m[2] !== 've-chung-toi' && JSON.parse(r.jobs || '[]').indexOf(m[2]) < 0) return tdPage('Vị trí đã đóng', '<h1>Vị trí này không còn nhận hồ sơ</h1><p><a href="/tuyen-dung/' + htmlEsc(m[1]) + '">Xem các vị trí đang tuyển →</a></p>', 404);
  return new Response(r.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' } });
}
async function tdNop(db, req) { // ứng viên nộp hồ sơ (multipart, CV ≤ 5 MB chia phần ≤ 1,5 MB vì D1 giới hạn 2 MB mỗi dòng)
  const ip = req.headers.get('CF-Connecting-IP') || '';
  if (tdTooMany(ip)) return tdJ({ ok: false, msg: 'Bạn gửi quá nhiều lần, vui lòng thử lại sau ít phút.' }, 429);
  let f; try { f = await req.formData(); } catch (e) { return tdJ({ ok: false, msg: 'Dữ liệu gửi lên chưa đúng.' }, 400); }
  const tok = String(f.get('tok') || ''), job = String(f.get('job') || '').slice(0, 120);
  if (!tdOkTok(tok)) return tdJ({ ok: false, msg: 'Link cổng không đúng.' }, 400);
  const c = await db.prepare('SELECT jobs FROM td_cong WHERE tok = ?').bind(tok).first(); if (!c) return tdJ({ ok: false, msg: 'Cổng tuyển dụng đã đóng.' }, 410);
  if (job && JSON.parse(c.jobs || '[]').indexOf(job.toLowerCase().replace(/[^a-z0-9-]/g, '')) < 0) return tdJ({ ok: false, msg: 'Vị trí này đã ngừng nhận hồ sơ. Tải lại trang để xem các vị trí đang tuyển.' }, 410);
  const name = String(f.get('name') || '').trim().replace(/\s+/g, ' ').slice(0, 80), phone = String(f.get('phone') || '').replace(/[^\d]/g, ''), email = String(f.get('email') || '').trim().slice(0, 120);
  if (name.split(' ').length < 2 || !/^0\d{9}$/.test(phone) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return tdJ({ ok: false, msg: 'Thông tin chưa đúng – kiểm tra họ tên, số điện thoại, email.' }, 400);
  if (String(f.get('consent')) !== 'true') return tdJ({ ok: false, msg: 'Cần đồng ý xử lý dữ liệu cá nhân để gửi hồ sơ.' }, 400);
  const n = ((await db.prepare('SELECT COUNT(*) AS n FROM td_ho_so WHERE tok = ? AND tao > ?').bind(tok, Date.now() - 864e5).first()) || {}).n || 0; if (n >= 300) return tdJ({ ok: false, msg: 'Cổng đang nhận quá nhiều hồ sơ trong ngày, vui lòng thử lại vào ngày mai.' }, 429);
  const cv = f.get('cv'); if (!cv || typeof cv === 'string' || !cv.size) return tdJ({ ok: false, msg: 'Vui lòng đính kèm CV.' }, 400);
  if (cv.size > TD_CV_MAX || !(/^image\/|application\/pdf/.test(cv.type) || /\.(pdf|jpe?g|png|webp)$/i.test(cv.name))) return tdJ({ ok: false, msg: 'CV cần là PDF hoặc ảnh, tối đa 5 MB.' }, 400);
  const ma = 'HS' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), buf = new Uint8Array(await cv.arrayBuffer()), parts = Math.ceil(buf.length / TD_PART) || 1;
  const d = { job, name, phone, email, exp: String(f.get('exp') || '').slice(0, 1000), src: String(f.get('src') || 'Cổng tuyển dụng').slice(0, 60), consentText: String(f.get('consentText') || '').slice(0, 1200), consentAt: new Date().toISOString() };
  const st = [db.prepare('INSERT INTO td_ho_so (ma, tok, job, du_lieu, cv_ten, cv_loai, cv_size, cv_parts, ip, tao) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(ma, tok, job, JSON.stringify(d), String(cv.name).slice(0, 120), cv.type || 'application/pdf', buf.length, parts, ip, Date.now())];
  for (let i = 0; i < parts; i++) st.push(db.prepare('INSERT INTO td_cv_part (ma, i, data) VALUES (?,?,?)').bind(ma, i, buf.slice(i * TD_PART, (i + 1) * TD_PART).buffer));
  await db.batch(st); return tdJ({ ok: true, code: ma });
}
async function tdCongApi(db, req, url, p) { // phần mềm: đưa trang lên, lấy hồ sơ, tải CV, xóa hồ sơ đã lấy, tắt cổng
  if (req.method === 'POST' && p === '/api/cong') {
    const b = await req.json().catch(() => ({})), tok = String(b.tok || ''), key = String(b.key || '');
    if (!tdOkTok(tok) || key.length < 20) return tdJ({ ok: false, msg: 'Mã cổng không đúng' }, 400);
    const html = String(b.html || ''); if (!html || html.length > 600000) return tdJ({ ok: false, msg: 'Trang cổng trống hoặc quá lớn' }, 400);
    const slug = String(b.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80) || 'cong-ty', jobs = (Array.isArray(b.jobs) ? b.jobs : []).concat(Array.isArray(b.ids) ? b.ids : []).map(x => String(x).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120)).filter(Boolean).slice(0, 160); // slug (link trang) + mã phiếu (ô job khi nộp)
    const cur = await tdAuth(db, tok, key); if (cur === false) return tdJ({ ok: false, msg: 'Mã cổng đã được dùng ở máy khác' }, 403);
    const dup = await db.prepare('SELECT tok FROM td_cong WHERE slug = ? AND tok != ?').bind(slug, tok).first(); if (dup) return tdJ({ ok: false, msg: 'Tên rút gọn trên link (' + slug + ') đang được đơn vị khác dùng trên máy chủ này – đổi ở Cổng tuyển dụng → Sửa thông tin.' }, 409);
    const now = Date.now();
    if (cur) await db.prepare('UPDATE td_cong SET slug=?, ten=?, html=?, jobs=?, cap_nhat=? WHERE tok=?').bind(slug, String(b.ten || '').slice(0, 120), html, JSON.stringify(jobs), now, tok).run();
    else await db.prepare('INSERT INTO td_cong (tok, key_hash, slug, ten, html, jobs, tao, cap_nhat) VALUES (?,?,?,?,?,?,?,?)').bind(tok, await tdSha(key), slug, String(b.ten || '').slice(0, 120), html, JSON.stringify(jobs), now, now).run();
    return tdJ({ ok: true, base: url.origin + '/tuyen-dung/' + slug, het_han: 0 });
  }
  if (req.method === 'GET' && p === '/api/cong/ho-so') {
    const c = await tdAuth(db, url.searchParams.get('tok'), url.searchParams.get('key')); if (!c) return tdJ({ ok: false, msg: 'Chưa có cổng hoặc sai khóa' }, c === null ? 404 : 403);
    const rs = await db.prepare('SELECT ma, job, du_lieu, cv_ten, cv_loai, cv_size, tao FROM td_ho_so WHERE tok = ? ORDER BY tao LIMIT 30').bind(c.tok).all();
    return tdJ({ ok: true, ds: (rs.results || []).map(r => ({ ma: r.ma, job: r.job, d: JSON.parse(r.du_lieu || '{}'), cv: { name: r.cv_ten, type: r.cv_loai, size: r.cv_size }, tao: r.tao })), het_han: 0 });
  }
  if (req.method === 'GET' && p === '/api/cong/cv') {
    const c = await tdAuth(db, url.searchParams.get('tok'), url.searchParams.get('key')); if (!c) return tdJ({ ok: false }, 403);
    const h = await db.prepare('SELECT cv_loai FROM td_ho_so WHERE ma = ? AND tok = ?').bind(url.searchParams.get('ma'), c.tok).first(); if (!h) return tdJ({ ok: false, msg: 'Không còn CV' }, 404);
    const ps = await db.prepare('SELECT data FROM td_cv_part WHERE ma = ? ORDER BY i').bind(url.searchParams.get('ma')).all();
    const bufs = (ps.results || []).map(r => new Uint8Array(r.data)), out = new Uint8Array(bufs.reduce((s, x) => s + x.length, 0)); let o = 0; bufs.forEach(x => { out.set(x, o); o += x.length; });
    return new Response(out, { headers: { 'content-type': h.cv_loai || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
  if (req.method === 'POST' && (p === '/api/cong/da-lay' || p === '/api/cong/tat')) {
    const b = await req.json().catch(() => ({})), c = await tdAuth(db, b.tok, b.key); if (!c) return tdJ({ ok: false }, 403);
    if (p === '/api/cong/da-lay') { const mas = (Array.isArray(b.ma) ? b.ma : []).map(String).slice(0, 50); const own = mas.length ? (await db.prepare('SELECT ma FROM td_ho_so WHERE tok = ? AND ma IN (' + mas.map(() => '?').join(',') + ')').bind(c.tok, ...mas).all()).results.map(r => r.ma) : []; await tdDelHs(db, own); return tdJ({ ok: true, xoa: own.length }); }
    const all = (await db.prepare('SELECT ma FROM td_ho_so WHERE tok = ?').bind(c.tok).all()).results.map(r => r.ma); await tdDelHs(db, all); await db.prepare('DELETE FROM td_cong WHERE tok = ?').bind(c.tok).run(); return tdJ({ ok: true });
  }
  return tdJ({ ok: false, msg: 'Không có API này' }, 404);
}
function tbLuuThang(cfg) { const m = parseInt(cfg.tb_luu_thang, 10); return [0, 6, 12, 24].includes(m) ? m : 12; }
const D1_FREE = 500 * 1024 * 1024; // Cloudflare D1 gói miễn phí: 500 MB / database (developers.cloudflare.com/d1/platform/limits)
async function dbDungLuong(db) {
  let size = 0; try { const m = (await db.prepare('SELECT 1').run()).meta || {}; size = Number(m.size_after) || 0; } catch (e) { }
  const t = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(anh)), 0) + COALESCE(SUM(LENGTH(noi_dung)), 0) AS b FROM tb").first().catch(() => ({ n: 0, b: 0 }));
  return { size, han: D1_FREE, tb_n: t ? t.n : 0, tb_b: t ? t.b : 0, canh_bao: size >= D1_FREE * 0.8 };
}
// 17/11: dọn thông báo quá thời gian lưu (mặc định 12 tháng; 0 = không giới hạn) – chạy 1 lần/ngày trong cron
async function tbDon(db, cfg, now) {
  const today = isoVN(now); if (cfg.tb_don_day === today) return; const m = tbLuuThang(cfg), st = [];
  if (m) { const cut = now - m * 30.44 * 864e5; st.push(db.prepare("UPDATE tb SET anh = NULL WHERE at < ? AND anh IS NOT NULL").bind(cut), db.prepare('DELETE FROM tb WHERE at < ?').bind(cut), db.prepare('DELETE FROM tb_doc WHERE id NOT IN (SELECT id FROM tb)')); }
  { const cut2 = now - 180 * 864e5; st.push(db.prepare('DELETE FROM td_cv_part WHERE ma IN (SELECT ma FROM td_ho_so WHERE tao < ?)').bind(cut2), db.prepare('DELETE FROM td_ho_so WHERE tao < ?').bind(cut2)); } // hồ sơ ứng viên chưa ai lấy về phần mềm sau 180 ngày
  st.push(db.prepare("INSERT INTO cfg (k, v) VALUES ('tb_don_day', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(today));
  await db.batch(st);
}
async function vbFileResp(db, id, tai) {
  const f = await db.prepare('SELECT id, ten, loai, size, n FROM vb_file WHERE id = ?').bind(id).first(); if (!f) return null;
  const ps = (await db.prepare('SELECT i, v FROM vb_part WHERE id = ? ORDER BY i').bind(id).all()).results; if (ps.length !== f.n) return null;
  const bytes = b64ToBytes(ps.map(x => x.v).join('')), safe = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/plain)$/.test(f.loai); // chỉ mở trực tiếp loại an toàn, còn lại tải về
  return new Response(bytes, { headers: { 'content-type': safe ? f.loai : 'application/octet-stream', 'content-disposition': (tai || !safe ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(f.ten), 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" } });
}
/* ===== 16/11/2026 13:21 (góp ý người dùng + anh chốt 13:29): GỬI BÁO CÁO ĐỊNH KỲ =====
   Phần mềm quản trị (Cài đặt hệ thống → Gửi báo cáo định kỳ) đẩy lên: danh sách báo cáo của từng công ty (chỉ tiêu, kỳ số liệu, tần suất, giờ gửi, người nhận đã quy ra mã NV + phạm vi phòng ban)
   + ảnh chụp số liệu từ phần mềm (Việc cần xử lý, danh sách nhân sự có ngày vào/nghỉ, mức cho phép đến muộn/về sớm, người miễn chấm công).
   Máy chủ tự hẹn giờ (cron 15 phút/lần): đến giờ thì tính số liệu chấm công trực tiếp từ lượt chấm + ca + đơn, ghép số liệu ảnh chụp, gửi vào chuông thông báo app (tb, loai 'bc') + thông báo đẩy.
   Người nhận giới hạn phòng ban (Trưởng bộ phận…) nhận bản chỉ có số liệu phòng mình. */
const BC_KY = { hom_nay: 'Hôm nay', hom_qua: 'Hôm qua', '7_ngay': '7 ngày gần nhất', tuan_nay: 'Tuần này', tuan_truoc: 'Tuần trước', thang_nay: 'Tháng này', thang_truoc: 'Tháng trước' };
function bcVn(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
function bcKy(ky, today) {
  const dw = isoDowW(today), mon = addDaysIso(today, -((dw + 6) % 7)), m1 = today.slice(0, 8) + '01';
  const r = ky === 'hom_qua' ? [addDaysIso(today, -1), addDaysIso(today, -1)] : ky === '7_ngay' ? [addDaysIso(today, -6), today] : ky === 'tuan_nay' ? [mon, today] : ky === 'tuan_truoc' ? [addDaysIso(mon, -7), addDaysIso(mon, -1)]
    : ky === 'thang_nay' ? [m1, today] : ky === 'thang_truoc' ? [addDaysIso(m1, -1).slice(0, 8) + '01', addDaysIso(m1, -1)] : [today, today];
  return { tu: r[0], den: r[1], ten: (BC_KY[ky] || 'Hôm nay') + (r[0] === r[1] ? ' ' + bcVn(r[0]) : ' (' + bcVn(r[0]) + ' – ' + bcVn(r[1]) + ')'), mot: r[0] === r[1] };
}
async function bcStaff(db, demo, cty) {
  const BY = await hsLite(db, demo), out = [];
  for (const ma of Object.keys(BY)) { const h = BY[ma]; if (cty && h.cty && h.cty !== cty) continue; out.push({ ma, ten: h.ten || ma, pb: h.pb || '', HS: await hsOf(db, ma, demo) }); }
  return out.sort((a, b) => (a.pb || '').localeCompare(b.pb || '', 'vi') || a.ten.localeCompare(b.ten, 'vi'));
}
// số liệu chấm công theo lượt chấm trên máy chủ (không thay Tổng hợp công – số chính thức vẫn ở phần mềm)
async function bcCham(db, cfg, staff, snap, tu, den, now) {
  const today = isoVN(now), nowMi = (() => { const q = vnParts(now); return +q.h * 60 + +q.mi; })(), tol = Math.max(0, +snap.tol || 0), tolS = Math.max(0, +snap.tols || 0), mien = new Set(snap.mien || []);
  const from = Date.UTC(+tu.slice(0, 4), +tu.slice(5, 7) - 1, +tu.slice(8, 10)) - VN, to = Date.UTC(+den.slice(0, 4), +den.slice(5, 7) - 1, +den.slice(8, 10)) - VN + 864e5;
  const P = {}; (await punchesBetween(db, from, to)).filter(x => !x.huy).forEach(x => { const k = x.ma + '|' + isoVN(x.t); (P[k] = P[k] || []).push(x.t); });
  const mas = staff.map(s => s.ma), don = mas.length ? (await db.prepare("SELECT ma, loai, tu, den, trang_thai FROM don WHERE den >= ? AND tu <= ? AND trang_thai = 'Đã duyệt'").bind(tu, den).all()).results : [];
  const xm = (await db.prepare('SELECT ma, ngay, kieu, trang_thai, phut FROM xin_muon WHERE ngay >= ? AND ngay <= ?').bind(tu, den).all()).results;
  const R = { phai: 0, co: 0, nghi: 0, vang: 0, muon: [], som: [], chua: [], nghiL: [], pb: {} };
  for (const s of staff) {
    if (mien.has(s.ma)) continue; const le = new Set(((s.HS && s.HS.le) || []).map(x => x.d));
    for (let d = tu; d <= den && d <= today; d = addDaysIso(d, 1)) {
      if (le.has(d)) continue; const ca = await caNgay(db, cfg, s.HS, s.ma, d); if (!ca || !ca.vao) continue;
      const g = R.pb[s.pb || '(Chưa có phòng ban)'] = R.pb[s.pb || '(Chưa có phòng ban)'] || { phai: 0, co: 0, nghi: 0, vang: 0, muon: 0, som: 0 };
      const dn = don.find(x => x.ma === s.ma && x.tu <= d && d <= x.den); R.phai++; g.phai++;
      const ps = (P[s.ma + '|' + d] || []).sort((a, b) => a - b);
      if (dn && !ps.length) { R.nghi++; g.nghi++; R.nghiL.push({ ma: s.ma, ten: s.ten, pb: s.pb, ngay: d, loai: dn.loai || 'Nghỉ', tu: dn.tu, den: dn.den }); continue; }
      if (!ps.length) { const vi = hm2min(ca.vao); if (d === today && vi !== null && nowMi < vi + tol) { R.phai--; g.phai--; continue; } R.vang++; g.vang++; R.chua.push({ ma: s.ma, ten: s.ten, pb: s.pb, ngay: d, vao: ca.vao }); continue; }
      R.co++; g.co++;
      const st = kieu => { const x = xm.find(z => z.ma === s.ma && z.ngay === d && z.kieu === kieu); return !x ? 'khong' : x.trang_thai === 'Đã duyệt' ? 'duyet' : x.trang_thai === 'Từ chối' ? 'tuchoi' : 'cho'; };
      const q0 = vnParts(ps[0]), first = +q0.h * 60 + +q0.mi, vi = hm2min(ca.vao), late = vi === null ? 0 : first - vi;
      if (late > tol) { R.muon.push({ ma: s.ma, ten: s.ten, pb: s.pb, ngay: d, gio: q0.h + ':' + q0.mi, phut: late, st: st('muon') }); g.muon++; }
      const ri = hm2min(ca.ra), q1 = vnParts(ps[ps.length - 1]), last = +q1.h * 60 + +q1.mi;
      if (ps.length > 1 && ri !== null && (d < today || nowMi >= ri) && ri - last > tolS) { R.som.push({ ma: s.ma, ten: s.ten, pb: s.pb, ngay: d, gio: q1.h + ':' + q1.mi, phut: ri - last, st: st('som') }); g.som++; }
    }
  }
  return R;
}
const BC_ST = { duyet: 'Được duyệt', tuchoi: 'Không duyệt', khong: 'Không xin phép', cho: 'Chờ duyệt' };
function bcPer(list) { const by = {}; list.forEach(x => { const o = by[x.ma] = by[x.ma] || { ten: x.ten, pb: x.pb, n: 0, p: 0, d: [] }; o.n++; o.p += x.phut; o.d.push(x); }); return Object.values(by).sort((a, b) => b.n - a.n || b.p - a.p); }
async function bcBuild(db, cfg, demo, B, def, pbs, now) {
  const today = isoVN(now), K = bcKy(def.ky, today), snap = B.snap || {}, ct = new Set(def.ct || []);
  let staff = await bcStaff(db, demo, B.cty); if (pbs) staff = staff.filter(s => pbs.includes(s.pb));
  const inS = new Set(staff.map(s => s.ma)), muc = [], tt = [];
  const needCham = ['cc_dilam', 'cc_chua', 'cc_muon', 'cc_som', 'cc_nghi', 'cc_xm'].some(k => ct.has(k)), C = needCham ? await bcCham(db, cfg, staff, snap, K.tu, K.den, now) : null;
  if (ct.has('cc_dilam')) {
    muc.push({ id: 'cc_dilam', t: 'Tình hình đi làm', kpi: K.mot ? [['Phải đi làm', C.phai], ['Đã chấm công', C.co, 'ok'], [K.den === today ? 'Chưa chấm công' : 'Vắng không có đơn', C.vang, C.vang ? 'bad' : ''], ['Nghỉ có đơn', C.nghi]] : [['Lượt phải đi làm', C.phai], ['Có chấm công', C.co, 'ok'], ['Vắng không có đơn', C.vang, C.vang ? 'bad' : ''], ['Nghỉ có đơn', C.nghi]],
      bang: { cot: ['Phòng ban', K.mot ? 'Phải đi làm' : 'Lượt phải làm', 'Có chấm', 'Nghỉ có đơn', K.den === today && K.mot ? 'Chưa chấm' : 'Vắng', 'Đi muộn', 'Về sớm'], dong: Object.keys(C.pb).map(k => { const g = C.pb[k]; return [k, g.phai, g.co, g.nghi, g.vang, g.muon, g.som]; }) } });
    tt.push(K.mot ? C.co + '/' + C.phai + ' đã chấm công' + (C.vang ? ', ' + C.vang + (K.den === today ? ' chưa chấm' : ' vắng') : '') : C.co + '/' + C.phai + ' lượt có chấm công');
  }
  if (ct.has('cc_chua')) { muc.push({ id: 'cc_chua', t: K.den === today && K.mot ? 'Chưa chấm công' : 'Vắng không có đơn', kpi: [['Lượt', C.chua.length, C.chua.length ? 'bad' : 'ok']], bang: { cot: ['Họ và tên', 'Phòng ban', 'Ngày', 'Giờ vào ca'], dong: C.chua.map(x => [x.ten, x.pb, bcVn(x.ngay), x.vao]) }, trong: 'Không có ai.' }); }
  for (const [id, L, ten] of [['cc_muon', C && C.muon, 'Đi muộn'], ['cc_som', C && C.som, 'Về sớm']]) {
    if (!ct.has(id)) continue; const per = bcPer(L);
    muc.push({ id, t: ten, kpi: [['Lượt', L.length, L.length ? 'warn' : 'ok'], ['Tổng phút', L.reduce((a, x) => a + x.phut, 0)], ['Số người', per.length]],
      bang: K.mot ? { cot: ['Họ và tên', 'Phòng ban', 'Giờ chấm', 'Số phút', 'Đơn'], dong: L.map(x => [x.ten, x.pb, x.gio, x.phut, BC_ST[x.st]]) } : { cot: ['Họ và tên', 'Phòng ban', 'Số lượt', 'Tổng phút', 'Không xin phép'], dong: per.map(o => [o.ten, o.pb, o.n, o.p, o.d.filter(x => x.st === 'khong').length]) }, trong: 'Không có lượt nào.' });
    if (L.length) tt.push(L.length + ' lượt ' + ten.toLowerCase());
  }
  if (ct.has('cc_nghi')) { muc.push({ id: 'cc_nghi', t: 'Nghỉ có đơn', kpi: [['Lượt nghỉ', C.nghiL.length]], bang: { cot: ['Họ và tên', 'Phòng ban', 'Loại nghỉ', K.mot ? 'Đơn từ – đến' : 'Ngày'], dong: C.nghiL.map(x => [x.ten, x.pb, x.loai, K.mot ? bcVn(x.tu) + (x.den !== x.tu ? ' – ' + bcVn(x.den) : '') : bcVn(x.ngay)]) }, trong: 'Không ai nghỉ.' }); if (C.nghiL.length) tt.push(C.nghiL.length + ' nghỉ có đơn'); }
  if (ct.has('cc_xm')) { const all = C.muon.concat(C.som), n = all.length || 1, c = k => all.filter(x => x.st === k).length, pc = k => Math.round(c(k) * 1000 / n) / 10 + '%';
    muc.push({ id: 'cc_xm', t: 'Đi muộn, về sớm theo đơn', kpi: [['Được duyệt', pc('duyet'), 'ok'], ['Không duyệt', pc('tuchoi'), 'bad'], ['Không xin phép', pc('khong'), 'warn'], ['Chờ duyệt', pc('cho')]], bang: { cot: ['Phòng ban', 'Tổng lượt', 'Được duyệt', 'Không duyệt', 'Không xin phép', 'Chờ duyệt'], dong: Object.keys(C.pb).map(k => { const z = all.filter(x => (x.pb || '(Chưa có phòng ban)') === k), f = s => z.filter(x => x.st === s).length; return [k, z.length, f('duyet'), f('tuchoi'), f('khong'), f('cho')]; }).filter(r => r[1]) }, trong: 'Không có lượt đi muộn, về sớm.' }); }
  if (ct.has('don_cho')) {
    const d1 = (await db.prepare("SELECT d.ma, d.loai, d.tu, d.den, d.tao FROM don d WHERE d.trang_thai = 'Chờ duyệt' ORDER BY d.tao").all()).results.filter(x => inS.has(x.ma));
    const d2 = (await db.prepare("SELECT ma, kieu, ngay, tao FROM xin_muon WHERE trang_thai = 'Chờ duyệt' ORDER BY tao").all()).results.filter(x => inS.has(x.ma)), nm = {}; staff.forEach(s => { nm[s.ma] = s; });
    const L = d1.map(x => [nm[x.ma].ten, nm[x.ma].pb, x.loai || 'Nghỉ', bcVn(x.tu) + (x.den && x.den !== x.tu ? ' – ' + bcVn(x.den) : ''), x.tao]).concat(d2.map(x => [nm[x.ma].ten, nm[x.ma].pb, x.kieu === 'som' ? 'Xin về sớm' : 'Xin đi muộn', bcVn(x.ngay), x.tao])).sort((a, b) => a[4] - b[4]);
    muc.push({ id: 'don_cho', t: 'Đơn chờ duyệt', kpi: [['Đơn nghỉ', d1.length, d1.length ? 'warn' : 'ok'], ['Đơn đi muộn, về sớm', d2.length, d2.length ? 'warn' : 'ok']], bang: { cot: ['Họ và tên', 'Phòng ban', 'Loại đơn', 'Ngày', 'Gửi lúc'], dong: L.map(r => [r[0], r[1], r[2], r[3], (() => { const q = vnParts(r[4]); return q.d + '/' + q.m + ' ' + q.h + ':' + q.mi; })()]) }, trong: 'Không có đơn chờ duyệt.' });
    if (L.length) tt.push(L.length + ' đơn chờ duyệt');
  }
  if (ct.has('ns_bd')) {
    const nv = (snap.nv || []).filter(x => !pbs || pbs.includes(x.pb)), dang = nv.filter(x => (!x.vao || x.vao <= K.den) && (!x.nghi || x.nghi > K.den)), vao = nv.filter(x => x.vao && x.vao >= K.tu && x.vao <= K.den), nghi = nv.filter(x => x.nghi && x.nghi >= K.tu && x.nghi <= K.den);
    muc.push({ id: 'ns_bd', t: 'Biến động nhân sự', kpi: [['Đang làm việc', dang.length], ['Vào làm mới', vao.length, vao.length ? 'ok' : ''], ['Nghỉ việc', nghi.length, nghi.length ? 'warn' : '']], bang: { cot: ['Họ và tên', 'Phòng ban', 'Biến động', 'Ngày'], dong: vao.map(x => [x.ten, x.pb, 'Vào làm', bcVn(x.vao)]).concat(nghi.map(x => [x.ten, x.pb, 'Nghỉ việc', bcVn(x.nghi)])) }, trong: 'Không có người vào làm hay nghỉ việc trong kỳ.' });
  }
  // 16/11 13:55: chỉ tiêu theo góc nhìn quản trị
  if (ct.has('don_ky')) {
    const L = (await db.prepare('SELECT ma, loai, tu, den, so_ngay, trang_thai FROM don WHERE den >= ? AND tu <= ? ORDER BY tu').bind(K.tu, K.den).all()).results.filter(x => inS.has(x.ma)), nm = {}; staff.forEach(s => { nm[s.ma] = s; });
    const c = t => L.filter(x => x.trang_thai === t).length, ng = L.filter(x => x.trang_thai === 'Đã duyệt').reduce((a, x) => a + (+x.so_ngay || 0), 0), byL = {}; L.forEach(x => { byL[x.loai || 'Nghỉ'] = (byL[x.loai || 'Nghỉ'] || 0) + 1; });
    muc.push({ id: 'don_ky', t: 'Đơn nghỉ trong kỳ', kpi: [['Số đơn', L.length], ['Ngày nghỉ đã duyệt', Math.round(ng * 10) / 10], ['Đã duyệt', c('Đã duyệt'), 'ok'], ['Từ chối', c('Từ chối')], ['Chờ duyệt', c('Chờ duyệt'), c('Chờ duyệt') ? 'warn' : '']].concat(Object.keys(byL).slice(0, 4).map(k => [k, byL[k]])), bang: { cot: ['Họ và tên', 'Phòng ban', 'Loại', 'Từ – đến', 'Số ngày', 'Trạng thái'], dong: L.map(x => [nm[x.ma].ten, nm[x.ma].pb, x.loai || '', bcVn(x.tu) + (x.den !== x.tu ? ' – ' + bcVn(x.den) : ''), x.so_ngay == null ? '' : x.so_ngay, x.trang_thai]) }, trong: 'Không có đơn nghỉ trong kỳ.' });
  }
  const SEC = snap.sec || {}, snapGhi = snap.at ? 'Số liệu tại lần đồng bộ phần mềm gần nhất (' + snap.at + ').' : '';
  for (const id of ['ns_cc', 'lg_quy', 'bh_t', 'td_tq', 'hn_td', 'dt_td', 'ts_tq']) {
    if (!ct.has(id)) continue; const S = SEC[id];
    if (!S) { muc.push({ id, t: id, kpi: [], trong: 'Chưa có số liệu – mở phần mềm quản trị để đồng bộ.' }); continue; }
    if (pbs && S.nhay) continue; // lương, BHXH: chỉ người nhận toàn công ty
    const parts = pbs ? pbs.map(p => S.pb && S.pb[p] ? { ...S.pb[p], t: S.pb[p].t + (pbs.length > 1 ? ' – ' + p : '') } : null).filter(Boolean) : [S['*']];
    parts.forEach(x => muc.push({ id, ...x, ghi: [x.ghi, snapGhi].filter(Boolean).join(' ') }));
  }
  const inPb = x => !pbs || pbs.includes(x.pb);
  if (ct.has('td_uv')) { const L = (snap.uv || []).filter(x => x.at >= K.tu && x.at <= K.den && inPb(x)), bySrc = {}; L.forEach(x => { bySrc[x.src || 'Khác'] = (bySrc[x.src || 'Khác'] || 0) + 1; });
    muc.push({ id: 'td_uv', t: 'Ứng viên mới trong kỳ', kpi: [['Hồ sơ mới', L.length, L.length ? 'ok' : '']].concat(Object.keys(bySrc).sort((a, b) => bySrc[b] - bySrc[a]).slice(0, 4).map(k => [k, bySrc[k]])), bang: { cot: ['Ngày nhận', 'Ứng viên', 'Vị trí', 'Phòng ban', 'Nguồn', 'Trạng thái'], dong: L.map(x => [bcVn(x.at), x.ten, x.vt, x.pb, x.src, x.st]) }, trong: 'Không có hồ sơ mới trong kỳ.', ghi: snapGhi }); if (L.length) tt.push(L.length + ' hồ sơ ứng viên mới'); }
  if (ct.has('td_pv')) { const den7 = addDaysIso(today, 7), L = (snap.pv || []).filter(x => x.ngay >= today && x.ngay <= den7 && inPb(x)).sort((a, b) => (a.ngay + a.gio).localeCompare(b.ngay + b.gio));
    muc.push({ id: 'td_pv', t: 'Lịch phỏng vấn 7 ngày tới', kpi: [['Buổi phỏng vấn', L.length]], bang: { cot: ['Ngày', 'Giờ', 'Ứng viên', 'Vị trí', 'Hình thức', 'Người phỏng vấn'], dong: L.map(x => [bcVn(x.ngay), x.gio, x.ten, x.vt, x.hthuc, x.nguoi]) }, trong: 'Không có lịch phỏng vấn.', ghi: snapGhi }); }
  if (ct.has('ts_pg')) { const L = (snap.pg || []).filter(x => x.ngay >= K.tu && x.ngay <= K.den && inPb(x));
    muc.push({ id: 'ts_pg', t: 'Bàn giao, thu hồi tài sản trong kỳ', kpi: [['Phiếu bàn giao', L.filter(x => x.loai === 'giao').length], ['Phiếu thu hồi', L.filter(x => x.loai === 'thu').length], ['Số tài sản', L.reduce((a, x) => a + (+x.n || 0), 0)]], bang: { cot: ['Ngày', 'Loại phiếu', 'Số phiếu', 'Người nhận / trả', 'Phòng ban', 'Số tài sản'], dong: L.map(x => [bcVn(x.ngay), x.loai === 'giao' ? 'Bàn giao' : 'Thu hồi', x.so, x.ten, x.pb, x.n]) }, trong: 'Không có phiếu trong kỳ.', ghi: snapGhi }); }
  if (ct.has('tb_doc') && !pbs) {
    const from = Date.UTC(+K.tu.slice(0, 4), +K.tu.slice(5, 7) - 1, +K.tu.slice(8, 10)) - VN, to = Date.UTC(+K.den.slice(0, 4), +K.den.slice(5, 7) - 1, +K.den.slice(8, 10)) - VN + 864e5;
    const L = (await db.prepare("SELECT t.id, t.tieu_de, t.loai, t.popup, t.n, t.at, (SELECT COUNT(*) FROM tb_doc d WHERE d.id = t.id AND d.doc_at IS NOT NULL) AS doc FROM tb t WHERE t.cty = ? AND t.loai != 'bc' AND t.at >= ? AND t.at < ? ORDER BY t.at DESC LIMIT 100").bind(B.cty, from, to).all()).results;
    const n = L.reduce((a, x) => a + (x.n || 0), 0), d = L.reduce((a, x) => a + (x.doc || 0), 0);
    muc.push({ id: 'tb_doc', t: 'Thông báo đã gửi trong kỳ', kpi: [['Thông báo', L.length], ['Lượt nhận', n], ['Tỷ lệ đã đọc', n ? Math.round(d * 100 / n) + '%' : '–', n && d / n < 0.7 ? 'warn' : 'ok']], bang: { cot: ['Gửi lúc', 'Tiêu đề', 'Loại', 'Người nhận', 'Đã đọc'], dong: L.map(x => { const q = vnParts(x.at); return [q.d + '/' + q.m + ' ' + q.h + ':' + q.mi, x.tieu_de, x.loai === 'vb' ? 'Tài liệu' : 'Thông báo', x.n || 0, (x.doc || 0) + (x.n ? ' (' + Math.round((x.doc || 0) * 100 / x.n) + '%)' : '')]; }) }, trong: 'Chưa gửi thông báo nào trong kỳ.' });
  }
  const vk = [...ct].filter(k => k.startsWith('vc:')).map(k => k.slice(3));
  if (vk.length) {
    const L = (snap.viec || []).filter(a => vk.includes(a.kind) && (!pbs || !a.dept || pbs.includes(a.dept))), cnt = {}; L.forEach(a => { cnt[a.kind] = (cnt[a.kind] || 0) + 1; });
    muc.push({ id: 'viec', t: 'Nhân sự, tài sản đến hạn', kpi: vk.map(k => [(snap.kinds || {})[k] || k, cnt[k] || 0, cnt[k] ? 'warn' : 'ok']), bang: { cot: ['Loại việc', 'Họ và tên', 'Phòng ban', 'Nội dung'], dong: L.map(a => [(snap.kinds || {})[a.kind] || a.kind, a.name || '', a.dept || '', a.title + (a.detail ? ' – ' + a.detail : '')]) }, trong: 'Không có việc nào đến hạn.', ghi: snap.at ? 'Theo Việc cần xử lý của phần mềm, cập nhật lúc ' + snap.at + '.' : '' });
    if (L.length) tt.push(L.length + ' việc đến hạn');
  }
  return { ten: def.ten, cty: B.cty, ky: K, at: now, pv: pbs ? 'Phòng ban: ' + pbs.join(', ') : 'Toàn công ty', muc, tom: tt.join(', ') || 'Không có gì cần lưu ý.', ghi: C ? 'Số liệu chấm công tính theo lượt chấm trên máy chủ lúc ' + (() => { const q = vnParts(now); return q.h + ':' + q.mi + ' ' + q.d + '/' + q.m; })() + '; số chính thức xem ở Tổng hợp công.' : '' };
}
async function bcSend(db, cfg, demo, origin, B, def, now, ky) {
  const groups = {}; (def.nhan || []).forEach(r => { if (!r || !r.ma) return; const k = r.pbs && r.pbs.length ? r.pbs.slice().sort().join('|') : '*'; (groups[k] = groups[k] || []).push(r.ma); });
  let n = 0; const st = [], pushes = [];
  for (const k of Object.keys(groups)) {
    const mas = [...new Set(groups[k])], R = await bcBuild(db, cfg, demo, B, def, k === '*' ? null : k.split('|'), now), rid = 'bc' + now.toString(36) + randHex(3), tid = 'tb' + now.toString(36) + randHex(4);
    const td = def.ten + ' – ' + R.ky.ten;
    st.push(db.prepare('INSERT INTO bc_nd (id, cty, du_lieu, at) VALUES (?, ?, ?, ?)').bind(rid, B.cty, JSON.stringify(R), now));
    st.push(db.prepare("INSERT INTO tb (id, cty, tieu_de, noi_dung, anh, popup, den, loai, ref, nguoi, n, at) VALUES (?, ?, ?, ?, NULL, 0, ?, 'bc', ?, 'Báo cáo tự động', ?, ?)").bind(tid, B.cty, td, R.tom + (R.pv !== 'Toàn công ty' ? ' (' + R.pv + ')' : ''), JSON.stringify({ ma: mas }), rid, mas.length, now));
    pushes.push(() => pushTo(db, cfg, origin, mas, { t: td, b: R.tom.slice(0, 140), u: '/?tb=' + tid, tag: tid })); n += mas.length;
  }
  st.push(db.prepare('INSERT INTO bc_gui (id, ky, cty, at, n) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id, ky) DO UPDATE SET at = excluded.at, n = excluded.n').bind(def.id, ky, B.cty, now, n));
  for (let i = 0; i < st.length; i += 40) await db.batch(st.slice(i, i + 40));
  for (const f of pushes) await f();
  return n;
}
function bcDue(def, now) {
  if (!def || !def.bat || !def.gio || !(def.nhan || []).length) return null;
  const q = vnParts(now), today = q.y + '-' + q.m + '-' + q.d, dw = isoDowW(today), mi = +q.h * 60 + +q.mi, gi = hm2min(def.gio); if (gi === null || mi < gi || mi - gi > 180) return null;
  if (def.ts === 'tuan') return dw === +def.thu1 ? today : null;
  if (def.ts === 'thang') { const last = addDaysIso(today, 1).slice(8, 10) === '01'; return (+def.ngay === 0 ? last : +q.d === +def.ngay) ? today : null; }
  return (Array.isArray(def.thu) && def.thu.length ? def.thu.includes(dw) : true) ? today : null;
}
async function bcCron(env) {
  const db = env.DB; await ensureSchema(db); const cfg = await getCfg(db), demo = env.DEMO === '1' || cfg.demo_host === '1', now = Date.now(), origin = cfg.origin || '';
  if (!demo) await tbDon(db, cfg, now).catch(e => console.error('tbDon', e));
  for (const r of (await db.prepare('SELECT cty, du_lieu FROM bc').all()).results) {
    let B; try { B = JSON.parse(r.du_lieu); } catch (e) { continue; } B.cty = r.cty;
    for (const def of B.ds || []) { const ky = bcDue(def, now); if (!ky) continue; if (await db.prepare('SELECT 1 FROM bc_gui WHERE id = ? AND ky = ?').bind(def.id, ky).first()) continue;
      try { await bcSend(db, cfg, demo, origin, B, def, now, ky); } catch (e) { console.error('bc', def.id, e); } }
  }
  await db.prepare('DELETE FROM bc_nd WHERE at < ?').bind(now - (demo ? 14 : 180) * 864e5).run();
}
async function bcApi(r, db, cfg, body, url, req, now, demo, jc, ctyOk) {
  if (r === 'bc' && req.method === 'POST') {
    const cty = String(body.cty || '').slice(0, 160); if (!ctyOk(cty)) return jc({ ok: false, loi: 'Công ty không hợp lệ' }, 400);
    const js = JSON.stringify({ ds: (Array.isArray(body.ds) ? body.ds : []).slice(0, 30), snap: body.snap || {} }); if (js.length > 900000) return jc({ ok: false, loi: 'Dữ liệu báo cáo quá lớn' }, 413);
    await db.prepare('INSERT INTO bc (cty, du_lieu, at) VALUES (?, ?, ?) ON CONFLICT(cty) DO UPDATE SET du_lieu = excluded.du_lieu, at = excluded.at').bind(cty, js, now).run();
    if (cfg.origin !== url.origin) await setCfg(db, { origin: url.origin }); // cron không có địa chỉ trang – lưu lại để gửi thông báo đẩy mở đúng app
    return jc({ ok: true });
  }
  if (r === 'bc-xem' && req.method === 'POST') { const cty = String(body.cty || ''); if (!ctyOk(cty)) return jc({ ok: false, loi: 'Công ty không hợp lệ' }, 400); const row = await db.prepare('SELECT du_lieu FROM bc WHERE cty = ?').bind(cty).first(); let B = {}; try { B = JSON.parse(row ? row.du_lieu : '{}'); } catch (e) { } B.cty = cty; if (body.snap) B.snap = body.snap;
    return jc({ ok: true, bc: await bcBuild(db, cfg, demo, B, body.def || {}, Array.isArray(body.pbs) && body.pbs.length ? body.pbs : null, now) }); }
  if (r === 'bc-gui' && req.method === 'POST') { const cty = String(body.cty || ''); if (!ctyOk(cty)) return jc({ ok: false, loi: 'Công ty không hợp lệ' }, 400); const row = await db.prepare('SELECT du_lieu FROM bc WHERE cty = ?').bind(cty).first(); if (!row) return jc({ ok: false, loi: 'Chưa có báo cáo trên máy chủ – lưu lại rồi thử.' }, 404);
    const B = JSON.parse(row.du_lieu); B.cty = cty; const def = (B.ds || []).find(x => x.id === body.id); if (!def) return jc({ ok: false, loi: 'Không tìm thấy báo cáo' }, 404); if (!(def.nhan || []).length) return jc({ ok: false, loi: 'Báo cáo chưa có người nhận' }, 400);
    if (cfg.origin !== url.origin) await setCfg(db, { origin: url.origin });
    return jc({ ok: true, n: await bcSend(db, cfg, demo, url.origin, B, def, now, 'tay-' + now) }); }
  if (r === 'bc-log') { const cty = String(url.searchParams.get('cty') || ''); return jc({ ok: true, list: (await db.prepare('SELECT id, ky, at, n FROM bc_gui WHERE cty = ? ORDER BY at DESC LIMIT 200').bind(cty).all()).results }); }
  return null;
}
async function hsOf(db, ma, demo) { const HS = await hoSoOf(db, ma); if (HS || !demo) return HS; const e = demoFind(ma); return e && e.hs ? { ...e.hs } : null; }
// 11/11 16:12: bản thử – bản scan MẪU (ảnh SVG tự vẽ, ghi rõ dữ liệu hư cấu) cho giấy tờ đã nộp và hợp đồng, để thử nút Xem / Tải; máy chủ thử không lưu file thật
function demoScans(ma, HS) {
  const out = []; (HS.giay_to || []).forEach((g, i) => { if (g.tt === 'Đã nộp') out.push({ id: 'mau-' + ma + '-g' + i, kho: 'hoso', ref: g.ten, ten: g.ten + ' – bản scan mẫu.svg', t: g.ten, d: g.ngay || '' }); });
  (HS.hop_dong || []).forEach((h, i) => out.push({ id: 'mau-' + ma + '-h' + i, kho: 'hd', ref: h.so, ten: 'Hợp đồng ' + String(h.so).replace(/\//g, '-') + ' đã ký – bản scan mẫu.svg', t: h.loai + ' số ' + h.so, d: h.hl ? h.hl.slice(8, 10) + '/' + h.hl.slice(5, 7) + '/' + h.hl.slice(0, 4) : '' }));
  return out;
}
function svgEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function demoScanSvg(f, ten, cty) {
  let lines = ''; for (let k = 0; k < 16; k++) lines += '<rect x="70" y="' + (330 + k * 34) + '" width="' + (460 - (k * 37) % 140) + '" height="9" rx="4" fill="#d9d4c7"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="850" viewBox="0 0 600 850"><rect width="600" height="850" fill="#f7f4ec"/><rect x="24" y="24" width="552" height="802" fill="#fffdf8" stroke="#ddd6c6"/>' +
    '<text x="300" y="80" text-anchor="middle" font-family="Times New Roman,serif" font-size="15" fill="#333">' + svgEsc(cty) + '</text>' +
    '<text x="300" y="150" text-anchor="middle" font-family="Times New Roman,serif" font-size="24" font-weight="bold" fill="#222">' + svgEsc(f.t) + '</text>' +
    '<text x="300" y="190" text-anchor="middle" font-family="Times New Roman,serif" font-size="17" fill="#333">' + svgEsc(ten) + '</text>' +
    (f.d ? '<text x="300" y="220" text-anchor="middle" font-family="Times New Roman,serif" font-size="14" fill="#555">Ngày ' + svgEsc(f.d) + '</text>' : '') + lines +
    '<circle cx="450" cy="760" r="42" fill="none" stroke="#c0392b" stroke-width="3" opacity=".55"/><text x="450" y="765" text-anchor="middle" font-family="Arial" font-size="11" fill="#c0392b" opacity=".7">ĐÃ KÝ</text>' +
    '<g transform="rotate(-28 300 470)"><text x="300" y="470" text-anchor="middle" font-family="Arial" font-size="40" font-weight="bold" fill="#3F6B35" opacity=".13">BẢN SCAN MẪU – HƯ CẤU</text></g></svg>';
}
function demoFind(ma) { for (const c of DEMO.cty) { const e = c.ds.find(x => x.ma === ma); if (e) return { ...e, cty: c.ten }; } return null; }
async function demoPrep(db, cfg, now) {
  const st = [];
  if (cfg.ql_pin && cfg.ten_cty !== DEMO_TEN) { await setCfg(db, { ten_cty: DEMO_TEN }); cfg.ten_cty = DEMO_TEN; } // 13/11 anh: máy chủ thử hiện tên công ty mẫu, không hiện tên công ty thật
  if (!cfg.ql_pin) { const salt = randHex(16); await setCfg(db, { ql_pin: await hashPin(randHex(16), salt), ql_salt: salt, qr_secret: randHex(32), ten_cty: DEMO_TEN, hien_ip: '1', ip_gio: '12', che_do: 'wifi_hoac_qr' }); }
  if (cfg.demo_seed !== DEMO_SEED) {
    for (const c of DEMO.cty) for (const e of c.ds) {
      const salt = randHex(16), h = await hashPin(DEMO_PIN, salt);
      st.push(db.prepare("INSERT INTO nv (ma, ten, pin, salt, active, created, pb, ncc, nguon) VALUES (?, ?, ?, ?, 1, ?, ?, 0, 'mau') ON CONFLICT(ma) DO UPDATE SET ten = excluded.ten, pin = excluded.pin, salt = excluded.salt, active = 1, fail = 0, lock_until = 0, pb = excluded.pb, nguon = 'mau'").bind(e.ma, e.ten, h, salt, now, c.ten + ' · ' + e.pb));
      for (const x of e.congs) { const y = +x.ym.slice(0, 4), m = +x.ym.slice(5, 7), chot = x.du_lieu.tam ? now : Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 3, 9, 30) - VN;
        st.push(db.prepare('INSERT INTO cong (ym, ma, du_lieu, chot, nguoi, xn, xn_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ym, ma) DO UPDATE SET du_lieu = excluded.du_lieu, chot = excluded.chot, xn = excluded.xn, xn_at = excluded.xn_at').bind(x.ym, e.ma, JSON.stringify(x.du_lieu), chot, 'Quản trị viên', x.ym < DEMO_LOCKED ? 1 : 0, x.ym < DEMO_LOCKED ? chot + 864e5 : null)); }
      for (const ph of (e.phieu || [])) st.push(db.prepare("INSERT INTO phieu (ym, ma, du_lieu, chot, nguoi, gui, xem_at, hoi) VALUES (?, ?, ?, ?, ?, ?, ?, '[]') ON CONFLICT(ym, ma) DO UPDATE SET du_lieu = excluded.du_lieu, xem_at = excluded.xem_at, hoi = '[]'").bind(ph.ym, e.ma, JSON.stringify(ph), ph.ym + '-28', 'Kế toán (dữ liệu mẫu)', now, ph.ym < DEMO_LOCKED ? now : null));
      for (const r of e.p) { if (r[1]) st.push(demoPunchSt(db, e.ma, dayT(r[0], hm2min(r[1])), 'vao', MAU)); if (r[2]) st.push(demoPunchSt(db, e.ma, dayT(r[0], hm2min(r[2])), 'ra', MAU)); }
    }
    st.unshift(db.prepare("DELETE FROM cham WHERE tb = ?").bind(MAU));
    st.push(db.prepare("INSERT INTO cfg (k, v) VALUES ('demo_syn', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(DEMO.ref));
    cfg.demo_syn = DEMO.ref; cfg.demo_day = '';
    st.push(db.prepare("INSERT INTO cfg (k, v) VALUES ('demo_seed', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(DEMO_SEED));
  }
  const today = isoVN(now);
  if (cfg.demo_day !== today) { // dọn mỗi ngày: giữ 14 ngày lượt chấm thử (lượt chấm mẫu giữ lại), 3 ngày lượt từ chối; xác nhận công về như mẫu để người sau thử lại
    // lượt chấm mẫu tự sinh cho các ngày đã qua sau ngày chốt dữ liệu mẫu (hôm nay để người thử tự chấm)
    const yest = addIso(today, -1); let d = addIso(cfg.demo_syn || DEMO.ref, 1), n = 0;
    while (d <= yest && n++ < 62) { for (const c of DEMO.cty) for (const e of c.ds) { const x = demoSynDay(e, d); if (x) st.push(demoPunchSt(db, e.ma, dayT(d, x.vao), 'vao', MAU + ' (tự sinh)'), demoPunchSt(db, e.ma, dayT(d, x.ra), 'ra', MAU + ' (tự sinh)')); } d = addIso(d, 1); }
    if (yest > (cfg.demo_syn || '')) st.push(db.prepare("INSERT INTO cfg (k, v) VALUES ('demo_syn', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(yest));
    st.push(db.prepare('DELETE FROM cham WHERE t < ? AND COALESCE(tb, \'\') != ?').bind(now - 14 * 864e5, MAU), db.prepare('DELETE FROM tu_choi WHERE t < ?').bind(now - 3 * 864e5),
      db.prepare("DELETE FROM don WHERE nguon = 'Điện thoại' AND tao < ?").bind(now - 14 * 864e5), db.prepare('DELETE FROM xin_muon WHERE tao < ?').bind(now - 14 * 864e5), db.prepare("DELETE FROM tb WHERE at < ?").bind(now - 14 * 864e5), db.prepare('DELETE FROM bc_nd WHERE at < ?').bind(now - 14 * 864e5), db.prepare('DELETE FROM tb_doc WHERE id NOT IN (SELECT id FROM tb)'), db.prepare("DELETE FROM vb_part WHERE id IN (SELECT id FROM vb_file WHERE at < ? AND id NOT LIKE 'mau%')").bind(now - 7 * 864e5), db.prepare("DELETE FROM vb_file WHERE at < ? AND id NOT LIKE 'mau%'").bind(now - 7 * 864e5), db.prepare('UPDATE cong SET xn = CASE WHEN ym < ? THEN 1 ELSE 0 END, xn_at = CASE WHEN ym < ? THEN chot + 86400000 ELSE NULL END, phan_hoi = NULL').bind(DEMO_LOCKED, DEMO_LOCKED),
      db.prepare("DELETE FROM ip_vp WHERE last < ?").bind(now - 2 * 864e5), db.prepare("DELETE FROM dk_ca WHERE ngay < ?").bind(addIso(today, -14)), db.prepare("DELETE FROM lich WHERE ngay < ?").bind(addIso(today, -70)), db.prepare("DELETE FROM phien WHERE last < ?").bind(now - 7 * 864e5),
      db.prepare("UPDATE nv SET fail = 0, lock_until = 0, active = 1 WHERE nguon = 'mau'"), db.prepare("DELETE FROM don WHERE nguon = ?").bind(MAU), db.prepare("DELETE FROM bao_sai WHERE tao < ?").bind(now - 3 * 864e5),
      db.prepare('DELETE FROM hn_xong WHERE at < ?').bind(now - 3 * 864e5), // 12/11: bản thử – việc hội nhập xác nhận thử giữ 3 ngày
      db.prepare('DELETE FROM dt_kq WHERE at < ?').bind(now - 3 * 864e5), // 12/11 16:30: bản thử – kết quả học thử giữ 3 ngày
      ...demoDonCho(db, today, now),
      db.prepare("INSERT INTO cfg (k, v) VALUES ('demo_day', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(today));
  }
  if (st.length) await db.batch(st);
  return st.length > 0 || !cfg.ql_pin;
}
const DEMO_TEN = 'Công ty TNHH Đốm Sáng'; // 13/11/2026 17:45 anh chốt (trước đó máy chủ thử hiện "một thương hiệu đối tác")
const DEMO_NO = 'Bản thử dùng chung cho mọi người nên không đổi được mục này. Khi triển khai riêng cho công ty, anh/chị đổi được bình thường.';
const VN = 7 * 3600e3;
const QR_STEP = 30e3;          // QR đổi mỗi 30 giây
const QR_GRACE = 5e3;          // mã vừa đổi trong 5 giây vẫn nhận mã ngay trước đó (đang quét đúng lúc đổi)
const PASS_MS = 120e3;         // quét đúng mã → được 2 phút để đăng nhập/bấm chấm (thẻ qua cửa ký số)
const DUP_MS = 120e3;          // bấm trùng cùng loại trong 2 phút → không ghi thêm
const DEF = { che_do: 'wifi_hoac_qr', ip_gio: '72', hien_ip: '1', ten_cty: '' };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cfg (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS nv (ma TEXT PRIMARY KEY, ten TEXT NOT NULL, pin TEXT, salt TEXT, active INTEGER DEFAULT 1, fail INTEGER DEFAULT 0, lock_until INTEGER DEFAULT 0, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS phien (tok TEXT PRIMARY KEY, vai TEXT NOT NULL, ma TEXT, created INTEGER, last INTEGER, tb TEXT)`,
  `CREATE TABLE IF NOT EXISTS ip_vp (ip TEXT PRIMARY KEY, nguon TEXT, first INTEGER, last INTEGER)`,
  `CREATE TABLE IF NOT EXISTS cham (id INTEGER PRIMARY KEY AUTOINCREMENT, ma TEXT NOT NULL, t INTEGER NOT NULL, loai TEXT NOT NULL, cach TEXT NOT NULL, ip TEXT, wifi INTEGER, tb TEXT, ghi TEXT, huy INTEGER DEFAULT 0, nguoi TEXT)`,
  `CREATE INDEX IF NOT EXISTS cham_t ON cham(t)`,
  `CREATE TABLE IF NOT EXISTS tu_choi (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, ma TEXT, ip TEXT, ly_do TEXT, tb TEXT)`,
  /* 0.2: mã máy – mỗi trình duyệt một mã riêng (cookie qtt_may), đăng xuất không mất. Một máy dùng cho ≥ 2 nhân viên → cảnh báo chấm hộ */
  `CREATE TABLE IF NOT EXISTS may_nv (may TEXT NOT NULL, ma TEXT NOT NULL, nhan TEXT, first INTEGER, last INTEGER, so_dn INTEGER DEFAULT 0, so_cham INTEGER DEFAULT 0, PRIMARY KEY (may, ma))`,
  `CREATE TABLE IF NOT EXISTS may_bo_qua (may TEXT PRIMARY KEY, ghi TEXT, t INTEGER)`,
  /* 0.3.1: đơn nghỉ nhân viên gửi trên điện thoại; công tháng đã chốt gửi nhân viên xác nhận */
  `CREATE TABLE IF NOT EXISTS don (so TEXT PRIMARY KEY, ma TEXT NOT NULL, loai TEXT, tu TEXT, den TEXT, so_ngay REAL, ly_do TEXT, tao INTEGER, trang_thai TEXT, nguoi_duyet TEXT, ngay_duyet TEXT, ly_do_tc TEXT, nguon TEXT, cap_nhat INTEGER)`,
  `CREATE INDEX IF NOT EXISTS don_ma ON don(ma)`,
  `CREATE TABLE IF NOT EXISTS cong (ym TEXT NOT NULL, ma TEXT NOT NULL, du_lieu TEXT, chot INTEGER, nguoi TEXT, xn INTEGER DEFAULT 0, xn_at INTEGER, phan_hoi TEXT, PRIMARY KEY (ym, ma))`,
  /* 0.4.1: phiếu lương (bảng kê trả lương – BLLĐ Điều 95.3) gửi từ phần mềm; nhân viên hỏi lại từng dòng (hoi = JSON [{t, dong, nd, tl, tl_at, tl_by}]) */
  `CREATE TABLE IF NOT EXISTS phieu (ym TEXT NOT NULL, ma TEXT NOT NULL, du_lieu TEXT, chot TEXT, nguoi TEXT, gui INTEGER, xem_at INTEGER, hoi TEXT DEFAULT '[]', PRIMARY KEY (ym, ma))`,
  /* 0.4.2 (11/11): lịch xếp ca đã chốt + thông báo (phần mềm gửi lên) và lịch nhân viên tự đăng ký (khối sản xuất, vận hành) */
  `CREATE TABLE IF NOT EXISTS lich (ma TEXT NOT NULL, ngay TEXT NOT NULL, ca TEXT, ky TEXT, PRIMARY KEY (ma, ngay))`,
  `CREATE TABLE IF NOT EXISTS dk_ca (ma TEXT NOT NULL, ngay TEXT NOT NULL, ca TEXT, ky TEXT, t INTEGER, PRIMARY KEY (ma, ngay))`,
  /* 0.4.2 (11/11 14:57): mục "Tôi" – hồ sơ, hành trình, hợp đồng do phần mềm gửi lên; kho file (chỉ máy chủ riêng của đơn vị, ≤ 1,2 MB/file) */
  `CREATE TABLE IF NOT EXISTS ho_so (ma TEXT PRIMARY KEY, du_lieu TEXT, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS kho_file (id TEXT PRIMARY KEY, ma TEXT NOT NULL, kho TEXT, ref TEXT, ten TEXT, loai TEXT, size INTEGER, at INTEGER, data TEXT)`,
  `CREATE INDEX IF NOT EXISTS kho_file_ma ON kho_file (ma)`,
  `CREATE TABLE IF NOT EXISTS anh (ma TEXT PRIMARY KEY, data TEXT, at INTEGER)`, // 11/11 15:32: ảnh đại diện nhân viên tự tải lên
  `CREATE TABLE IF NOT EXISTS bao_sai (ma TEXT, ngay TEXT, noi_dung TEXT, tao INTEGER, PRIMARY KEY (ma, ngay))`, // 11/11 17:54: nhân viên báo sai công từng ngày
  `CREATE TABLE IF NOT EXISTS hn_xong (ma TEXT NOT NULL, sid TEXT NOT NULL, x INTEGER DEFAULT 1, at INTEGER, PRIMARY KEY (ma, sid))`, // 12/11: người mới tự xác nhận việc hội nhập của mình trên app
  `CREATE TABLE IF NOT EXISTS dt_kq (ma TEXT NOT NULL, kh TEXT NOT NULL, du_lieu TEXT, at INTEGER, PRIMARY KEY (ma, kh))`, // 12/11 16:30: tiến độ học, bài làm khóa đào tạo nội bộ trên app
  /* 0.5.1 (13/11/2026): dữ liệu Phần mềm quản lý nhân sự toàn diện lưu trên máy chủ của đơn vị. Mỗi khóa (settings, units = danh sách công ty, unit:<id> = dữ liệu từng công ty, done, ndhist, kho:<id> = file kho) có số phiên bản để không ghi đè lẫn nhau;
     nội dung chia thành nhiều phần ≤ 400.000 ký tự (≤ 1,2 MB – dưới giới hạn kích thước 1 dòng của D1). */
  `CREATE TABLE IF NOT EXISTS qt_kv (k TEXT PRIMARY KEY, ver INTEGER NOT NULL, at INTEGER, nguoi TEXT, n INTEGER, z INTEGER DEFAULT 0, meta TEXT, size INTEGER)`,
  `CREATE TABLE IF NOT EXISTS qt_part (k TEXT NOT NULL, i INTEGER NOT NULL, v TEXT, PRIMARY KEY (k, i))`,
  // 16/11/2026 (góp ý người dùng): đơn xin đi muộn / về sớm – đơn vị bật/tắt ở Phần mềm quản lý nhân sự toàn diện; thông báo đẩy trên điện thoại
  `CREATE TABLE IF NOT EXISTS xin_muon (so TEXT PRIMARY KEY, ma TEXT NOT NULL, ngay TEXT NOT NULL, kieu TEXT NOT NULL, gio TEXT, phut INTEGER, ly_do TEXT, tao INTEGER, trang_thai TEXT, nguoi_duyet TEXT, duyet_ma TEXT, ngay_duyet TEXT, ly_do_tc TEXT, cap_nhat INTEGER)`,
  `CREATE INDEX IF NOT EXISTS xin_muon_ma ON xin_muon(ma, ngay)`,
  `CREATE TABLE IF NOT EXISTS push_sub (ep TEXT PRIMARY KEY, ma TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, at INTEGER, may TEXT)`,
  `CREATE INDEX IF NOT EXISTS push_sub_ma ON push_sub(ma)`,
  // 16/11/2026 12:21 (anh): KHO THÔNG TIN CHUNG TOÀN CÔNG TY (nội quy, quy chế, KPI…) + THÔNG BÁO tới app nhân viên
  `CREATE TABLE IF NOT EXISTS vb (cty TEXT PRIMARY KEY, du_lieu TEXT, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS vb_file (id TEXT PRIMARY KEY, cty TEXT, ten TEXT, loai TEXT, size INTEGER, n INTEGER, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS vb_part (id TEXT NOT NULL, i INTEGER NOT NULL, v TEXT, PRIMARY KEY (id, i))`,
  `CREATE TABLE IF NOT EXISTS tb (id TEXT PRIMARY KEY, cty TEXT, tieu_de TEXT, noi_dung TEXT, anh TEXT, popup INTEGER DEFAULT 0, den TEXT, loai TEXT, ref TEXT, nguoi TEXT, n INTEGER, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS tb_doc (ma TEXT NOT NULL, id TEXT NOT NULL, doc_at INTEGER, xoa INTEGER DEFAULT 0, PRIMARY KEY (ma, id))`,
  // 16/11/2026 13:29: GỬI BÁO CÁO ĐỊNH KỲ – danh sách báo cáo + ảnh chụp số liệu từ phần mềm (bc), nhật ký đã gửi (bc_gui), nội dung từng bản đã gửi (bc_nd)
  `CREATE TABLE IF NOT EXISTS bc (cty TEXT PRIMARY KEY, du_lieu TEXT, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS bc_gui (id TEXT NOT NULL, ky TEXT NOT NULL, cty TEXT, at INTEGER, n INTEGER, PRIMARY KEY (id, ky))`,
  `CREATE TABLE IF NOT EXISTS bc_nd (id TEXT PRIMARY KEY, cty TEXT, du_lieu TEXT, at INTEGER)`,
  // 17/11/2026: CỔNG TUYỂN DỤNG CỦA CÔNG TY (cùng tên miền, /tuyen-dung/<tên rút gọn>) – chuyển từ máy chủ thử recruit.quantritute.com, không tự xóa sau 24 giờ
  `CREATE TABLE IF NOT EXISTS td_cong (tok TEXT PRIMARY KEY, key_hash TEXT NOT NULL, slug TEXT, ten TEXT, html TEXT, jobs TEXT, tao INTEGER, cap_nhat INTEGER)`,
  `CREATE TABLE IF NOT EXISTS td_ho_so (ma TEXT PRIMARY KEY, tok TEXT NOT NULL, job TEXT, du_lieu TEXT, cv_ten TEXT, cv_loai TEXT, cv_size INTEGER, cv_parts INTEGER DEFAULT 0, ip TEXT, tao INTEGER)`,
  `CREATE INDEX IF NOT EXISTS td_ho_so_tok ON td_ho_so (tok, tao)`,
  `CREATE TABLE IF NOT EXISTS td_cv_part (ma TEXT NOT NULL, i INTEGER NOT NULL, data BLOB, PRIMARY KEY (ma, i))`
];
const MIGRATE_V2 = ['ALTER TABLE cham ADD COLUMN may TEXT', 'ALTER TABLE phien ADD COLUMN may TEXT', 'ALTER TABLE tu_choi ADD COLUMN may TEXT'];
const MIGRATE_V3 = ['ALTER TABLE nv ADD COLUMN pb TEXT', 'ALTER TABLE nv ADD COLUMN ncc INTEGER DEFAULT 0', 'ALTER TABLE nv ADD COLUMN nguon TEXT'];
const MIGRATE_V5 = ['ALTER TABLE nv ADD COLUMN login_at INTEGER', 'ALTER TABLE nv ADD COLUMN pin_doi INTEGER']; // 12/11/2026: trang Ứng dụng nhân viên – đăng nhập lần cuối, nhân viên đã tự đổi PIN
const MIGRATE_V4 = ['ALTER TABLE don ADD COLUMN duyet_ma TEXT', 'ALTER TABLE don ADD COLUMN ban_giao TEXT']; // 11/11 15:32: đơn – quản lý trực tiếp duyệt trên app, người nhận bàn giao
const MIGRATE_V6 = ['ALTER TABLE nv ADD COLUMN qt TEXT', 'ALTER TABLE nv ADD COLUMN mk TEXT', 'ALTER TABLE nv ADD COLUMN mk_salt TEXT', 'ALTER TABLE nv ADD COLUMN mk_doi INTEGER']; // 13/11/2026: một tài khoản – quyền quản trị (qt = {r, t, sys}), mật khẩu, bắt đổi mật khẩu lần đầu
const MIGRATE_V7 = ['ALTER TABLE nv ADD COLUMN cty TEXT']; // 17/11/2026: nhiều công ty dùng chung một máy chủ – mỗi nhân viên thuộc công ty nào (trang quản lý lọc theo công ty)
let schemaOk = false;
async function ensureSchema(db) {
  if (schemaOk) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  const v = await db.prepare("SELECT v FROM cfg WHERE k = 'schema_v'").first();
  const sv = v ? Number(v.v) : 0;
  if (sv < 6) {
    for (const sql of (sv < 2 ? MIGRATE_V2 : []).concat(sv < 3 ? MIGRATE_V3 : [], sv < 4 ? MIGRATE_V4 : [], sv < 5 ? MIGRATE_V5 : [], MIGRATE_V6)) { try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
    await db.prepare("INSERT INTO cfg (k, v) VALUES ('schema_v', '6') ON CONFLICT(k) DO UPDATE SET v = '6'").run();
  }
  if ((v ? Number(v.v) : 0) < 7) {
    for (const sql of MIGRATE_V7) { try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
    await db.prepare("INSERT INTO cfg (k, v) VALUES ('schema_v', '7') ON CONFLICT(k) DO UPDATE SET v = '7'").run();
  }
  schemaOk = true;
}

/* ---------- tiện ích ---------- */
const enc = new TextEncoder();
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 1000 }, key, 256);
  return hex(bits);
}
/* 13/11/2026: mật khẩu (tài khoản có quyền quản trị, tài khoản quản trị hệ thống dự phòng) băm PBKDF2-SHA256 40.000 vòng, lưu dạng 'p2$40000$<hex>'.
   Chọn 40.000 vòng để mỗi lần đăng nhập dưới ~6 ms xử lý (gói Workers miễn phí giới hạn 10 ms/lượt). Mã PIN 6 số giữ cách băm cũ (1.000 vòng):
   PIN chỉ có 1 triệu khả năng nên tăng vòng băm không làm an toàn hơn đáng kể – bảo vệ chính là khóa 15 phút sau 5 lần nhập sai. */
const PW_ITER = 40000;
async function hashPw(pw, salt, it = PW_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  return 'p2$' + it + '$' + hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: it }, key, 256));
}
async function checkPw(pw, salt, stored) {
  if (!stored || !salt) return false;
  const m = /^p2\$(\d+)\$/.exec(stored);
  const h = m ? await hashPw(pw, salt, Math.min(100000, +m[1])) : await hashPin(pw, salt);
  return h.length === stored.length && h === stored;
}
function pwBad(pw) { pw = String(pw || ''); if (pw.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.'; if (pw.length > 72) return 'Mật khẩu tối đa 72 ký tự.'; if (!/[A-Za-zÀ-ỹ]/.test(pw) || !/\d/.test(pw)) return 'Mật khẩu cần có cả chữ và số.'; return ''; }
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function b32(bytes) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < bytes.length; i++) s += A[bytes[i] & 31]; return s; }
function json(o, status = 200, headers = {}) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function bad(msg, status = 400) { return json({ ok: false, loi: msg }, status); }
/* 0.3.1: API đồng bộ cho Phần mềm quản lý nhân sự toàn diện (chạy trên trình duyệt của kế toán, khác tên miền) – xác thực bằng Mã kết nối, không dùng cookie */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' };
function jc(o, status = 200) { return json(o, status, CORS); }
function isoVN(t) { const q = vnParts(t); return q.y + '-' + q.m + '-' + q.d; }
function cookies(req) { const o = {}; (req.headers.get('cookie') || '').split(/;\s*/).forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); }); return o; }
function setCookie(name, val, maxAge) { return name + '=' + encodeURIComponent(val) + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Lax'; }
function vnDayStart(t) { return Math.floor((t + VN) / 864e5) * 864e5 - VN; }
function pad(n) { return String(n).padStart(2, '0'); }
function vnParts(t) { const d = new Date(t + VN); return { d: pad(d.getUTCDate()), m: pad(d.getUTCMonth() + 1), y: d.getUTCFullYear(), h: pad(d.getUTCHours()), mi: pad(d.getUTCMinutes()), s: pad(d.getUTCSeconds()) }; }
function shortUA(ua) {
  ua = ua || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'Khác';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Zalo/i.test(ua) ? 'Zalo' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt khác';
  return os + ' · ' + br;
}

/* ---------- IP ---------- */
function clientIP(req, env) {
  if (env.DEV === '1' && req.headers.get('x-test-ip')) return req.headers.get('x-test-ip');
  return req.headers.get('cf-connecting-ip') || '';
}
function expandV6(ip) {
  ip = ip.split('%')[0].toLowerCase();
  if (ip.includes('.')) return null; // IPv4 nhúng – bỏ qua
  const [h, t] = ip.split('::');
  const hp = h ? h.split(':') : [], tp = t !== undefined ? (t ? t.split(':') : []) : null;
  let parts = tp === null ? hp : hp.concat(Array(8 - hp.length - tp.length).fill('0'), tp);
  if (parts.length !== 8) return null;
  return parts.map(p => p.padStart(4, '0'));
}
function ipKind(ip) { return ip.includes(':') ? 'IPv6' : 'IPv4'; }
function sameNet(a, b) {
  if (!a || !b) return false;
  if (ipKind(a) !== ipKind(b)) return false;
  if (ipKind(a) === 'IPv4') return a === b;
  const x = expandV6(a), y = expandV6(b);
  if (!x || !y) return a === b;
  return x.slice(0, 4).join(':') === y.slice(0, 4).join(':'); // cùng dải /64
}
async function officeIPs(db, cfg, now) {
  const hours = Math.max(1, Number(cfg.ip_gio) || 72);
  const { results } = await db.prepare('SELECT ip, nguon, first, last FROM ip_vp ORDER BY last DESC').all();
  return results.map(r => ({ ...r, hieu_luc: r.nguon === 'tay' || r.last > now - hours * 3600e3 }));
}
function matchOffice(ip, list) { return list.some(r => r.hieu_luc && sameNet(ip, r.ip)); }

/* ---------- cấu hình, phiên ---------- */
async function getCfg(db) {
  const { results } = await db.prepare('SELECT k, v FROM cfg').all();
  const o = { ...DEF }; results.forEach(r => { o[r.k] = r.v; }); return o;
}
// Tên miền đăng ký được từ hostname (bỏ www/sub, giữ đuôi 2 cấp kiểu .com.vn). workers.dev, pages.dev, localhost, IP → '' (không tự nhận được)
function regDomain(h) {
  h = String(h || '').toLowerCase();
  if (!h || h === 'localhost' || /^[\d.:]+$/.test(h) || /(^|\.)(workers|pages)\.dev$/.test(h) || !h.includes('.')) return '';
  const p = h.split('.'), two = /^(com|net|org|edu|gov|ac|co|info|biz|name|pro|health|int)$/;
  return p.length >= 3 && two.test(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
async function setCfg(db, obj) {
  await db.batch(Object.entries(obj).map(([k, v]) => db.prepare('INSERT INTO cfg (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v))));
}
const COOKIE = { nv: 'qtt_nv', ql: 'qtt_ql', tram: 'qtt_tram', qt: 'qtt_qt' }; // 13/11: qt = phiên trang quản trị (Phần mềm quản lý nhân sự toàn diện trên máy chủ)
const AGE = { nv: 180 * 864e2, ql: 12 * 3600, tram: 365 * 864e2, qt: 12 * 3600 };
async function newSession(db, vai, ma, req) {
  const tok = randHex(32), now = Date.now();
  await db.prepare('INSERT INTO phien (tok, vai, ma, created, last, tb, may) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await sha256(tok), vai, ma || null, now, now, shortUA(req.headers.get('user-agent')), req.may || null).run();
  return setCookie(COOKIE[vai], tok, AGE[vai]);
}
async function session(db, req, vai) {
  const tok = cookies(req)[COOKIE[vai]];
  if (!tok) return null;
  const row = await db.prepare('SELECT * FROM phien WHERE tok = ? AND vai = ?').bind(await sha256(tok), vai).first();
  if (!row) return null;
  if ((vai === 'ql' || vai === 'qt') && row.created < Date.now() - AGE[vai] * 1000) return null;
  if (row.last < Date.now() - 3600e3) await db.prepare('UPDATE phien SET last = ? WHERE tok = ?').bind(Date.now(), row.tok).run();
  if (vai === 'nv') {
    const nv = await db.prepare('SELECT ma, ten, active, ncc, qt, mk IS NOT NULL AS co_mk, mk_doi FROM nv WHERE ma = ?').bind(row.ma).first();
    if (!nv || !nv.active) return null;
    row.nv = nv;
  }
  return row;
}

/* ---------- QR động ---------- */
async function qrToken(secret, w) { return b32((await hmac(secret, 'qr:' + w)).slice(0, 12)); }
async function verifyQR(secret, t, now) {
  if (!t || !secret) return false;
  const w = Math.floor(now / QR_STEP);
  if (t === await qrToken(secret, w)) return true;
  return now - w * QR_STEP < QR_GRACE && t === await qrToken(secret, w - 1);
}
/* Quét QR hợp lệ (kiểm tra NGAY lúc mở link) → nhận "thẻ qua cửa" ký số, dùng để bấm chấm trong 2 phút. */
async function makePass(secret, now) { return now + '.' + b32(await hmac(secret, 'pass:' + now)); }
async function verifyPass(secret, p, now) {
  const m = /^(\d{13})\.([A-Z2-9]+)$/.exec(String(p || ''));
  if (!m || !secret) return false;
  const t0 = Number(m[1]);
  if (t0 > now + 5e3 || now - t0 > PASS_MS) return false;
  return m[2] === b32(await hmac(secret, 'pass:' + t0));
}
function qrSvg(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); }

/* ---------- dữ liệu chấm ---------- */
async function punchesBetween(db, from, to, ma) {
  const sql = 'SELECT c.id, c.ma, n.ten, c.t, c.loai, c.cach, c.ip, c.wifi, c.tb, c.may, c.ghi, c.huy, c.nguoi FROM cham c LEFT JOIN nv n ON n.ma = c.ma WHERE c.t >= ? AND c.t < ?' + (ma ? ' AND c.ma = ?' : '') + ' ORDER BY c.t';
  const st = ma ? db.prepare(sql).bind(from, to, ma) : db.prepare(sql).bind(from, to);
  return (await st.all()).results;
}
async function logReject(db, ma, ip, lyDo, req) {
  await db.prepare('INSERT INTO tu_choi (t, ma, ip, ly_do, tb, may) VALUES (?, ?, ?, ?, ?, ?)').bind(Date.now(), ma || null, ip, lyDo, shortUA(req.headers.get('user-agent')), req.may || null).run();
}
async function noteDevice(db, req, ma, kind) {
  if (!req.may || !ma) return;
  const now = Date.now(), dn = kind === 'dn' ? 1 : 0, ch = kind === 'cham' ? 1 : 0;
  await db.prepare('INSERT INTO may_nv (may, ma, nhan, first, last, so_dn, so_cham) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(may, ma) DO UPDATE SET last = excluded.last, nhan = excluded.nhan, so_dn = so_dn + excluded.so_dn, so_cham = so_cham + excluded.so_cham')
    .bind(req.may, ma, shortUA(req.headers.get('user-agent')), now, now, dn, ch).run();
}
/* Máy dùng chung: một mã máy gắn với ≥ 2 nhân viên, trừ máy quản lý đã đánh dấu "đã kiểm tra" */
async function sharedDevices(db) {
  const { results } = await db.prepare('SELECT m.may, m.ma, n.ten, m.nhan, m.first, m.last, m.so_dn, m.so_cham, b.ghi AS bo_qua_ghi, b.t AS bo_qua_t FROM may_nv m LEFT JOIN nv n ON n.ma = m.ma LEFT JOIN may_bo_qua b ON b.may = m.may WHERE m.may IN (SELECT may FROM may_nv GROUP BY may HAVING COUNT(*) > 1) ORDER BY m.may, m.first').all();
  const by = {};
  results.forEach(r => { const o = by[r.may] || (by[r.may] = { may: r.may, nhan: r.nhan, last: 0, bo_qua: r.bo_qua_t ? { ghi: r.bo_qua_ghi, t: r.bo_qua_t } : null, nv: [] }); o.nv.push({ ma: r.ma, ten: r.ten || r.ma, first: r.first, last: r.last, so_dn: r.so_dn, so_cham: r.so_cham }); if (r.last > o.last) { o.last = r.last; o.nhan = r.nhan; } });
  return Object.values(by).sort((a, b) => b.last - a.last);
}

/* 13/11/2026: tài khoản có quyền quản trị */
function qtOf(nv) { if (!nv || !nv.qt) return null; try { const o = JSON.parse(nv.qt); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
async function qtUser(db, req) {
  const row = await session(db, req, 'qt'); if (!row) return null;
  if (!row.ma) return { ma: '', ten: 'Quản trị hệ thống', t: 'Quản trị hệ thống (dự phòng)', r: 'qt', sys: 1, du_phong: 1 };
  const nv = await db.prepare('SELECT ma, ten, active, qt, mk, mk_doi FROM nv WHERE ma = ?').bind(row.ma).first(), q = qtOf(nv);
  if (!nv || !nv.active || !nv.mk || !q) return null;
  return { ma: nv.ma, ten: nv.ten, t: q.t || '', r: q.r || '', sys: q.sys ? 1 : 0, doi_mk: nv.mk_doi ? 1 : 0 };
}
// phần phân quyền dùng để so: chỉ quản trị viên được đổi (bỏ các trường thay đổi khi dùng bình thường, như lần đăng nhập gần nhất)
function pqCore(pq) { if (!pq) return null; return { on: !!pq.on, roles: pq.roles || [], users: (pq.users || []).map(u => ({ id: u.id, nv: u.nv || '', user: u.user, role: u.role, dv: u.dv, pb: u.pb, off: !!u.off })) }; }
/* Bản thử: ai trong dữ liệu mẫu có quyền quản trị (để thử mục Quản trị trên app). Mở Phần mềm quản lý nhân sự toàn diện bản thử với vai trò tương ứng (xem thử theo vai trò). */
const DEMO_QT = { DS001: 'gd', SG001: 'gd', DS002: 'kt', DS004: 'ns', SG002: 'ns' }, DEMO_QT_T = { gd: 'Giám đốc', kt: 'Kế toán lương', ns: 'Nhân sự', tbp: 'Trưởng bộ phận' };
function demoQtOf(ma) { const r = DEMO_QT[ma] || (demoFind(ma) && (demoFind(ma).hs || {}).truong ? 'tbp' : ''); return r ? { r, t: DEMO_QT_T[r], sys: 0 } : null; }

/* ---------- API ---------- */
async function api(req, env, url) {
  const db = env.DB; await ensureSchema(db);
  const p = url.pathname, now = Date.now(), ip = clientIP(req, env);
  /* ----- 17/11: CỔNG TUYỂN DỤNG CỦA CÔNG TY – ứng viên nộp (công khai), phần mềm đưa trang lên / lấy hồ sơ (cần đăng nhập Phần mềm quản lý nhân sự toàn diện trên máy chủ này) ----- */
  if (p === '/api/ung-tuyen' || p === '/api/cong' || p.startsWith('/api/cong/')) { // đọc thân yêu cầu riêng (multipart / JSON) nên đặt trước phần đọc body chung
    if (isDemo(env, url)) return json({ ok: false, msg: 'Bản thử dùng cổng thử recruit.quantritute.com.' }, 404);
  if (p === '/api/ung-tuyen' && req.method === 'POST') return tdNop(db, req);
  if (p === '/api/cong' || p.startsWith('/api/cong/')) { const U = await qtUser(db, req); if (!U) return json({ ok: false, msg: 'Phiên đăng nhập đã hết – đăng nhập lại Phần mềm quản lý nhân sự toàn diện.', loi: 'Phiên đăng nhập đã hết.' }, 401); return tdCongApi(db, req, url, p); }
  }
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  let cfg = await getCfg(db);
  const demo = isDemo(env, url);
  if (demo && await demoPrep(db, cfg, now)) cfg = await getCfg(db);
  if (demo && cfg.demo_host !== '1') { await setCfg(db, { demo_host: '1' }); cfg = await getCfg(db); } // 16/11: hẹn giờ gửi báo cáo cần biết đây là máy chủ thử
  const isSetup = !!cfg.ql_pin;
  const sess = vai => demo && (vai === 'ql' || vai === 'tram') ? Promise.resolve({ vai, demo: true }) : session(db, req, vai); // bản thử: không cần mật khẩu quản lý / kích hoạt màn hình chung

  /* ----- BẢN THỬ: API công khai cho Phần mềm quản lý nhân sự toàn diện (bản thử, chạy file trên máy người dùng) ----- */
  if (p.startsWith('/api/demo/')) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!demo) return jc({ ok: false, loi: 'Chỉ có ở bản thử.' }, 404);
    const r = p.slice(10);
    if (r === 'nv') return jc({ ok: true, pin: DEMO_PIN, cty: DEMO.cty.map(c => ({ ten: c.ten, ds: c.ds.map(e => ({ ma: e.ma, ten: e.ten, pb: e.pb, cd: e.cd })) })) });
    if (r === 'cham') {
      const tu = String(url.searchParams.get('tu') || isoVN(now - 13 * 864e5)), den = String(url.searchParams.get('den') || isoVN(now));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tu) || !/^\d{4}-\d{2}-\d{2}$/.test(den)) return jc({ ok: false, loi: 'tu, den dạng YYYY-MM-DD' }, 400);
      const from = Date.UTC(+tu.slice(0, 4), +tu.slice(5, 7) - 1, +tu.slice(8, 10)) - VN, to = Date.UTC(+den.slice(0, 4), +den.slice(5, 7) - 1, +den.slice(8, 10)) - VN + 864e5;
      return jc({ ok: true, now, list: (await punchesBetween(db, from, to)).filter(x => !x.huy).map(x => ({ id: x.id, ma: x.ma, t: x.t, loai: x.loai, cach: x.cach, ghi: x.ghi || '' })) });
    }
    if (r === 'don') return jc({ ok: true, now, list: (await db.prepare("SELECT * FROM don WHERE nguon = 'Điện thoại' AND trang_thai != 'Đã hủy' ORDER BY tao DESC LIMIT 200").all()).results });
    if (r === 'don-cap-nhat' && req.method === 'POST') {
      const list = Array.isArray(body.list) ? body.list.slice(0, 200) : [], st = [];
      for (const x of list) { if (!['Đã duyệt', 'Từ chối', 'Chờ duyệt'].includes(x.trang_thai)) continue; st.push(db.prepare("UPDATE don SET trang_thai = ?, nguoi_duyet = ?, ngay_duyet = ?, ly_do_tc = ?, so_ngay = COALESCE(?, so_ngay), cap_nhat = ? WHERE so = ? AND nguon = 'Điện thoại'").bind(x.trang_thai, String(x.nguoi_duyet || '').slice(0, 80), String(x.ngay_duyet || ''), String(x.ly_do_tc || '').slice(0, 300), x.so_ngay == null ? null : Number(x.so_ngay) || null, now, String(x.so))); }
      if (st.length) await db.batch(st); return jc({ ok: true, n: st.length });
    }
    if (r === 'xin-muon') return jc({ ok: true, list: (await db.prepare('SELECT * FROM xin_muon WHERE trang_thai != \'Đã hủy\' ORDER BY tao DESC LIMIT 300').all()).results.filter(x => demoFind(x.ma)) }); // 16/11
    if (r === 'xm-cap-nhat' && req.method === 'POST') {
      const list = Array.isArray(body.list) ? body.list.slice(0, 1000) : [], st = [], bao = [];
      for (const x of list) {
        if (!['Đã duyệt', 'Từ chối', 'Chờ duyệt'].includes(x.trang_thai)) continue;
        const o = await db.prepare('SELECT ma, ngay, kieu, trang_thai FROM xin_muon WHERE so = ?').bind(String(x.so)).first(); if (!o || !demoFind(o.ma)) continue;
        st.push(db.prepare('UPDATE xin_muon SET trang_thai = ?, nguoi_duyet = ?, ngay_duyet = ?, ly_do_tc = ?, cap_nhat = ? WHERE so = ?').bind(x.trang_thai, String(x.nguoi_duyet || '').slice(0, 80), String(x.ngay_duyet || ''), String(x.ly_do_tc || '').slice(0, 300), now, String(x.so)));
        if (o.trang_thai !== x.trang_thai && x.trang_thai !== 'Chờ duyệt') bao.push({ ma: o.ma, m: { t: 'Đơn xin ' + (o.kieu === 'muon' ? 'đi muộn' : 'về sớm') + ' ' + (x.trang_thai === 'Đã duyệt' ? 'đã được duyệt' : 'bị từ chối'), b: o.ngay.slice(8) + '/' + o.ngay.slice(5, 7) + ' · ' + String(x.nguoi_duyet || '') + (x.ly_do_tc ? ': ' + x.ly_do_tc : ''), u: '/?tab=don', tag: String(x.so) } });
      }
      if (st.length) await db.batch(st);
      if (bao.length) later(req, Promise.all(bao.map(b => pushTo(db, cfg, url.origin, [b.ma], b.m))));
      return jc({ ok: true, n: st.length });
    }
    { const vt = await vbTbApi(r, db, cfg, body, url, req, now, true, jc, c => DEMO.cty.some(x => x.ten === c)); if (vt) return vt; } // 16/11: bản thử – chỉ công ty mẫu
    { const vt = await bcApi(r, db, cfg, body, url, req, now, true, jc, c => DEMO.cty.some(x => x.ten === c)); if (vt) return vt; }
    // 10/11/2026 16:01: bản thử – phần mềm nhân sự (dữ liệu mẫu) gửi phiếu lương lên điện thoại, chỉ nhận mã NV có trong dữ liệu mẫu
    if (r === 'phieu' && req.method === 'POST') {
      const ym = String(body.ym || ''); if (!/^\d{4}-\d{2}$/.test(ym)) return jc({ ok: false, loi: 'ym dạng YYYY-MM' }, 400);
      const list = Array.isArray(body.list) ? body.list.slice(0, 100) : [], st = [];
      for (const x of list) {
        const ma = String(x.ma || '').toUpperCase(); if (!demoFind(ma)) continue; const dl = JSON.stringify(x.du_lieu || {}); if (dl.length > 20000) continue;
        st.push(db.prepare("INSERT INTO phieu (ym, ma, du_lieu, chot, nguoi, gui, xem_at, hoi) VALUES (?, ?, ?, ?, ?, ?, NULL, '[]') ON CONFLICT(ym, ma) DO UPDATE SET du_lieu = excluded.du_lieu, chot = excluded.chot, nguoi = excluded.nguoi, gui = excluded.gui, xem_at = CASE WHEN phieu.du_lieu = excluded.du_lieu THEN phieu.xem_at ELSE NULL END").bind(ym, ma, dl, String(body.chot || '').slice(0, 40), String(body.nguoi || '').slice(0, 80), now));
      }
      if (st.length) await db.batch(st); return jc({ ok: true, n: st.length });
    }
    if (r === 'phieu-hoi') {
      const ym = String(url.searchParams.get('ym') || '');
      return jc({ ok: true, list: (await db.prepare('SELECT ma, xem_at, hoi FROM phieu WHERE ym = ?').bind(ym).all()).results.filter(x => demoFind(x.ma)).map(x => ({ ma: x.ma, xem_at: x.xem_at, hoi: JSON.parse(x.hoi || '[]') })) });
    }
    if (r === 'phieu-tra-loi' && req.method === 'POST') {
      const ym = String(body.ym || ''), ma = String(body.ma || '').toUpperCase(), i = +body.idx, tl = String(body.tra_loi || '').trim().slice(0, 500);
      if (!demoFind(ma)) return jc({ ok: false, loi: 'Không có câu hỏi này.' }, 404);
      const row = await db.prepare('SELECT hoi FROM phieu WHERE ym = ? AND ma = ?').bind(ym, ma).first(); if (!row || !tl) return jc({ ok: false, loi: 'Không có câu hỏi này.' }, 404);
      const a = JSON.parse(row.hoi || '[]'); if (!a[i]) return jc({ ok: false, loi: 'Không có câu hỏi này.' }, 404);
      a[i].tl = tl; a[i].tl_at = now; a[i].tl_by = String(body.nguoi || '').slice(0, 80);
      await db.prepare('UPDATE phieu SET hoi = ? WHERE ym = ? AND ma = ?').bind(JSON.stringify(a), ym, ma).run(); return jc({ ok: true });
    }
    // 11/11: lịch xếp ca – phần mềm nhân sự (dữ liệu mẫu) gửi lịch đã thông báo, kéo lịch nhân viên đăng ký
    if (r === 'lich' && req.method === 'POST') return jc({ ok: true, n: await lichPush(db, body, ma => !!demoFind(ma)) });
    if (r === 'ho-so' && req.method === 'POST') return jc({ ok: true, n: await hoSoPush(db, body, ma => !!demoFind(ma)) });
    if (r === 'dk-ca') return jc({ ok: true, list: await dkList(db, String(url.searchParams.get('tu') || isoVN(now - 7 * 864e5)), ma => !!demoFind(ma)) });
    if (r === 'hn-xong') return jc({ ok: true, list: (await db.prepare('SELECT ma, sid, x, at FROM hn_xong').all()).results.filter(x => demoFind(x.ma)) });
    if (r === 'dt-kq') return jc({ ok: true, list: (await db.prepare('SELECT ma, kh, du_lieu, at FROM dt_kq').all()).results.filter(x => demoFind(x.ma)) }); // 12/11 16:30: kết quả học trên app
    if (r === 'tai-khoan') return jc({ ok: true, now, list: (await db.prepare('SELECT ma, active, pin IS NOT NULL AS co_pin, fail, lock_until, login_at, pin_doi FROM nv').all()).results.filter(x => demoFind(x.ma)) }); // 12/11: trang Ứng dụng nhân viên
    if (r === 'mo-khoa' && req.method === 'POST') { const ma = String(body.ma || '').trim().toUpperCase(); if (demoFind(ma)) await db.prepare('UPDATE nv SET fail = 0, lock_until = 0 WHERE ma = ?').bind(ma).run(); return jc({ ok: true }); } // 12/11: việc hội nhập người mới xác nhận trên app
    if (r === 'bao-sai') return jc({ ok: true, list: (await db.prepare('SELECT ma, ngay, noi_dung, tao FROM bao_sai WHERE ngay >= ? ORDER BY tao DESC LIMIT 500').bind(isoVN(now - 100 * 864e5)).all()).results });
    if (r === 'qr') { const to = { nv: '/', tram: '/tram', ql: '/quan-ly' }[url.searchParams.get('u') || 'nv'] || '/'; return new Response(qrSvg(url.origin + to), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600', ...CORS } }); }
    return jc({ ok: false, loi: 'Không có API này' }, 404);
  }

  /* ----- 0.3.1: ĐỒNG BỘ VỚI PHẦN MỀM QUẢN LÝ NHÂN SỰ (xác thực: Authorization: Bearer <Mã kết nối>) -----
     Máy chủ này là nơi lưu chính lượt chấm, đơn nghỉ gửi từ điện thoại, xác nhận công.
     Phần mềm nhân sự: đẩy danh sách nhân viên + mã PIN, kéo lượt chấm, kéo đơn, trả kết quả duyệt đơn, gửi công tháng đã chốt. */
  if (p.startsWith('/api/sync/')) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    // 13/11/2026: phần mềm mở từ chính máy chủ này (/quan-tri) dùng phiên đăng nhập của người có quyền quản trị thay cho Mã kết nối
    const viaQt = key === 'phien' && !demo && !!(await qtUser(db, req));
    if (!viaQt && (!cfg.sync_key || !key || await sha256(key) !== cfg.sync_key)) return jc({ ok: false, loi: 'Mã kết nối không đúng hoặc chưa tạo. Vào trang Quản lý → Cài đặt → Kết nối Phần mềm quản lý nhân sự toàn diện.' }, 401);
    const r = p.slice(10);
    if (r === 'ping') {
      const n = await db.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN pin IS NOT NULL THEN 1 ELSE 0 END) AS c FROM nv WHERE active = 1').first();
      return jc({ ok: true, ver: VER, ten_cty: cfg.ten_cty, che_do: cfg.che_do, so_nv: n.n || 0, co_pin: n.c || 0, now });
    }
    if (r === 'nhan-vien' && req.method === 'POST') {
      const list = Array.isArray(body.list) ? body.list.slice(0, 2000) : [], out = { them: 0, sua: 0, chua_pin: [] }, st = [];
      for (const x of list) {
        const ma = String(x.ma || '').trim().toUpperCase(), ten = String(x.ten || '').trim().slice(0, 120);
        if (!/^[A-Z0-9._-]{1,20}$/.test(ma) || !ten) continue;
        const old = await db.prepare('SELECT ma, pin FROM nv WHERE ma = ?').bind(ma).first();
        const cty = String(x.cty || '').slice(0, 120);
        if (!old) { st.push(db.prepare("INSERT INTO nv (ma, ten, active, created, pb, ncc, nguon, cty) VALUES (?, ?, ?, ?, ?, ?, 'phan-mem', ?) ON CONFLICT(ma) DO UPDATE SET ten = excluded.ten, active = excluded.active, pb = excluded.pb, ncc = excluded.ncc, nguon = 'phan-mem', cty = excluded.cty").bind(ma, ten, x.active ? 1 : 0, now, String(x.pb || '').slice(0, 120), x.ncc ? 1 : 0, cty)); out.them++; out.chua_pin.push(ma); }
        else { st.push(db.prepare("UPDATE nv SET ten = ?, active = ?, pb = ?, ncc = ?, nguon = 'phan-mem', cty = ? WHERE ma = ?").bind(ten, x.active ? 1 : 0, String(x.pb || '').slice(0, 120), x.ncc ? 1 : 0, cty, ma)); out.sua++; if (!old.pin) out.chua_pin.push(ma); }
        if (!x.active) st.push(db.prepare("DELETE FROM phien WHERE vai = 'nv' AND ma = ?").bind(ma));
      }
      if (st.length) await db.batch(st);
      return jc({ ok: true, ...out });
    }
    // 17/11/2026 (thử nghiệm hadu.vn, góp ý mục 4): ĐỔI MÃ NV – chuyển mọi dữ liệu trên máy chủ từ mã cũ sang mã mới.
    // Mã mới không được trùng mã đang có / đã từng có trên máy chủ. PIN giữ nguyên; phiên đăng nhập cũ bị hủy → nhân viên đăng nhập lại bằng mã mới.
    if (r === 'doi-ma' && req.method === 'POST') {
      const cu = String(body.cu || '').trim().toUpperCase(), moi = String(body.moi || '').trim().toUpperCase(), RX = /^[A-Z0-9._-]{1,20}$/;
      if (!RX.test(cu) || !RX.test(moi) || cu === moi) return jc({ ok: false, loi: 'Mã NV không hợp lệ (chữ, số, dấu . _ -, tối đa 20 ký tự).' }, 400);
      const T = ['nv', 'phien', 'cham', 'tu_choi', 'may_nv', 'don', 'cong', 'phieu', 'lich', 'dk_ca', 'ho_so', 'kho_file', 'anh', 'bao_sai', 'hn_xong', 'dt_kq', 'xin_muon', 'push_sub', 'tb_doc'];
      for (const t of T) { try { const x = await db.prepare('SELECT 1 AS c FROM ' + t + ' WHERE ma = ? LIMIT 1').bind(moi).first(); if (x && t !== 'phien') return jc({ ok: false, loi: 'Mã ' + moi + ' đã có hoặc đã từng có dữ liệu trên máy chủ – chọn mã khác.' }, 409); } catch (e) { } }
      const st = [db.prepare("DELETE FROM phien WHERE vai = 'nv' AND ma = ?").bind(cu)];
      for (const t of T) if (t !== 'phien') st.push(db.prepare('UPDATE ' + t + ' SET ma = ? WHERE ma = ?').bind(moi, cu));
      for (const t of ['don', 'xin_muon']) st.push(db.prepare('UPDATE ' + t + ' SET duyet_ma = ? WHERE duyet_ma = ?').bind(moi, cu));
      st.push(db.prepare('UPDATE phien SET ma = ? WHERE ma = ? AND vai <> ?').bind(moi, cu, 'nv'));
      const sv = []; for (const q of st) sv.push(q); let n = 0;
      for (const q of sv) { try { const x = await q.run(); n += (x.meta && x.meta.changes) || 0; } catch (e) { /* bảng chưa có ở máy chủ cũ thì bỏ qua */ } }
      try { // người nhận thông báo theo danh sách mã
        const L = (await db.prepare("SELECT id, den FROM tb WHERE den LIKE ?").bind('%"' + cu + '"%').all()).results;
        for (const x of L) { const d = tbDen(x); if (Array.isArray(d.ma)) { d.ma = d.ma.map(v => String(v).toUpperCase() === cu ? moi : v); await db.prepare('UPDATE tb SET den = ? WHERE id = ?').bind(JSON.stringify(d), x.id).run(); } }
      } catch (e) { }
      return jc({ ok: true, n });
    }
    if (r === 'pin' && req.method === 'POST') {
      const ma = String(body.ma || '').trim().toUpperCase(), pin = String(body.pin || '');
      if (!/^\d{4,8}$/.test(pin)) return jc({ ok: false, loi: 'Mã PIN 4–8 chữ số.' }, 400);
      const old = await db.prepare('SELECT ma FROM nv WHERE ma = ?').bind(ma).first(), salt = randHex(16), h = await hashPin(pin, salt);
      if (old) await db.prepare('UPDATE nv SET pin = ?, salt = ?, fail = 0, lock_until = 0, active = 1, pin_doi = NULL' + (body.cty ? ', cty = ?' : '') + ' WHERE ma = ?').bind(...(body.cty ? [h, salt, String(body.cty).slice(0, 120), ma] : [h, salt, ma])).run();
      else { const ten = String(body.ten || '').trim().slice(0, 120); if (!ten) return jc({ ok: false, loi: 'Thiếu họ tên.' }, 400); await db.prepare("INSERT INTO nv (ma, ten, pin, salt, active, created, pb, nguon, cty) VALUES (?, ?, ?, ?, 1, ?, ?, 'phan-mem', ?) ON CONFLICT(ma) DO UPDATE SET pin = excluded.pin, salt = excluded.salt, fail = 0, lock_until = 0, active = 1, pin_doi = NULL").bind(ma, ten, h, salt, now, String(body.pb || '').slice(0, 120), String(body.cty || '').slice(0, 120)).run(); } // 17/11: chạy song song với "nhan-vien" (cấp hàng loạt) không còn mất PIN
      await db.prepare("DELETE FROM phien WHERE vai = 'nv' AND ma = ?").bind(ma).run();
      return jc({ ok: true });
    }

    // 12/11/2026: trang Ứng dụng nhân viên của phần mềm – trạng thái tài khoản (đăng nhập lần cuối, đang khóa tạm do nhập sai PIN), mở khóa
    if (r === 'tai-khoan') return jc({ ok: true, now, list: (await db.prepare('SELECT ma, active, pin IS NOT NULL AS co_pin, fail, lock_until, login_at, pin_doi FROM nv').all()).results });
    if (r === 'mo-khoa' && req.method === 'POST') { const ma = String(body.ma || '').trim().toUpperCase(); await db.prepare('UPDATE nv SET fail = 0, lock_until = 0 WHERE ma = ?').bind(ma).run(); return jc({ ok: true }); }
    if (r === 'cham') {
      const tu = String(url.searchParams.get('tu') || ''), den = String(url.searchParams.get('den') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tu) || !/^\d{4}-\d{2}-\d{2}$/.test(den)) return jc({ ok: false, loi: 'tu, den dạng YYYY-MM-DD' }, 400);
      const from = Date.UTC(+tu.slice(0, 4), +tu.slice(5, 7) - 1, +tu.slice(8, 10)) - VN, to = Date.UTC(+den.slice(0, 4), +den.slice(5, 7) - 1, +den.slice(8, 10)) - VN + 864e5;
      const rows = (await punchesBetween(db, from, to)).filter(x => !x.huy).map(x => ({ id: x.id, ma: x.ma, t: x.t, loai: x.loai, cach: x.cach, ghi: x.ghi || '' }));
      return jc({ ok: true, list: rows });
    }
    if (r === 'don') {
      const tu = String(url.searchParams.get('tu') || '2000-01-01');
      return jc({ ok: true, list: (await db.prepare('SELECT * FROM don WHERE den >= ? ORDER BY tao').bind(tu).all()).results });
    }
    { const vt = await vbTbApi(r, db, cfg, body, url, req, now, false, jc, c => !!c); if (vt) return vt; } // 16/11: kho thông tin chung + thông báo
    { const vt = await bcApi(r, db, cfg, body, url, req, now, false, jc, c => !!c); if (vt) return vt; } // 16/11 13:29: gửi báo cáo định kỳ
    if (r === 'xin-muon') return jc({ ok: true, list: (await db.prepare('SELECT * FROM xin_muon WHERE ngay >= ? ORDER BY tao').bind(String(url.searchParams.get('tu') || '2000-01-01')).all()).results }); // 16/11
    if (r === 'xm-cap-nhat' && req.method === 'POST') {
      const list = Array.isArray(body.list) ? body.list.slice(0, 1000) : [], st = [], bao = [];
      for (const x of list) {
        if (!['Đã duyệt', 'Từ chối', 'Chờ duyệt'].includes(x.trang_thai)) continue;
        const o = await db.prepare('SELECT ma, ngay, kieu, trang_thai FROM xin_muon WHERE so = ?').bind(String(x.so)).first(); if (!o) continue;
        st.push(db.prepare('UPDATE xin_muon SET trang_thai = ?, nguoi_duyet = ?, ngay_duyet = ?, ly_do_tc = ?, cap_nhat = ? WHERE so = ?').bind(x.trang_thai, String(x.nguoi_duyet || '').slice(0, 80), String(x.ngay_duyet || ''), String(x.ly_do_tc || '').slice(0, 300), now, String(x.so)));
        if (o.trang_thai !== x.trang_thai && x.trang_thai !== 'Chờ duyệt') bao.push({ ma: o.ma, m: { t: 'Đơn xin ' + (o.kieu === 'muon' ? 'đi muộn' : 'về sớm') + ' ' + (x.trang_thai === 'Đã duyệt' ? 'đã được duyệt' : 'bị từ chối'), b: o.ngay.slice(8) + '/' + o.ngay.slice(5, 7) + ' · ' + String(x.nguoi_duyet || '') + (x.ly_do_tc ? ': ' + x.ly_do_tc : ''), u: '/?tab=don', tag: String(x.so) } });
      }
      if (st.length) await db.batch(st);
      if (bao.length) later(req, Promise.all(bao.map(b => pushTo(db, cfg, url.origin, [b.ma], b.m))));
      return jc({ ok: true, n: st.length });
    }
    if (r === 'don-cap-nhat' && req.method === 'POST') {
      const list = Array.isArray(body.list) ? body.list.slice(0, 1000) : [], st = [];
      for (const x of list) {
        if (!['Đã duyệt', 'Từ chối', 'Chờ duyệt'].includes(x.trang_thai)) continue;
        st.push(db.prepare('UPDATE don SET trang_thai = ?, nguoi_duyet = ?, ngay_duyet = ?, ly_do_tc = ?, so_ngay = COALESCE(?, so_ngay), cap_nhat = ? WHERE so = ?').bind(x.trang_thai, String(x.nguoi_duyet || '').slice(0, 80), String(x.ngay_duyet || ''), String(x.ly_do_tc || '').slice(0, 300), x.so_ngay == null ? null : Number(x.so_ngay), now, String(x.so)));
      }
      if (st.length) await db.batch(st);
      return jc({ ok: true, n: st.length });
    }
    if (r === 'cong' && req.method === 'POST') {
      const ym = String(body.ym || ''); if (!/^\d{4}-\d{2}$/.test(ym)) return jc({ ok: false, loi: 'ym dạng YYYY-MM' }, 400);
      const list = Array.isArray(body.list) ? body.list.slice(0, 2000) : [], st = [];
      for (const x of list) {
        const ma = String(x.ma || '').toUpperCase(), dl = JSON.stringify(x.du_lieu || {}).slice(0, 20000);
        const old = await db.prepare('SELECT du_lieu FROM cong WHERE ym = ? AND ma = ?').bind(ym, ma).first();
        if (old && old.du_lieu === dl) continue; // không đổi → giữ xác nhận cũ
        st.push(db.prepare('INSERT INTO cong (ym, ma, du_lieu, chot, nguoi, xn, xn_at, phan_hoi) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL) ON CONFLICT(ym, ma) DO UPDATE SET du_lieu = excluded.du_lieu, chot = excluded.chot, nguoi = excluded.nguoi, xn = 0, xn_at = NULL, phan_hoi = NULL').bind(ym, ma, dl, now, String(body.nguoi || '').slice(0, 80)));
      }
      if (st.length) await db.batch(st);
      return jc({ ok: true, n: st.length });
    }
    if (r === 'phieu' && req.method === 'POST') {
      const ym = String(body.ym || ''); if (!/^\d{4}-\d{2}$/.test(ym)) return jc({ ok: false, loi: 'ym dạng YYYY-MM' }, 400);
      const list = Array.isArray(body.list) ? body.list.slice(0, 2000) : [], st = [];
      for (const x of list) {
        const ma = String(x.ma || '').toUpperCase(); if (!/^[A-Z0-9._-]{1,20}$/.test(ma)) continue;
        st.push(db.prepare("INSERT INTO phieu (ym, ma, du_lieu, chot, nguoi, gui, xem_at, hoi) VALUES (?, ?, ?, ?, ?, ?, NULL, '[]') ON CONFLICT(ym, ma) DO UPDATE SET du_lieu = excluded.du_lieu, chot = excluded.chot, nguoi = excluded.nguoi, gui = excluded.gui, xem_at = CASE WHEN phieu.du_lieu = excluded.du_lieu THEN phieu.xem_at ELSE NULL END").bind(ym, ma, JSON.stringify(x.du_lieu || {}).slice(0, 30000), String(body.chot || '').slice(0, 40), String(body.nguoi || '').slice(0, 80), now));
      }
      if (st.length) await db.batch(st);
      return jc({ ok: true, n: st.length });
    }
    if (r === 'phieu-hoi') {
      const ym = String(url.searchParams.get('ym') || '');
      return jc({ ok: true, list: (await db.prepare('SELECT ma, xem_at, hoi FROM phieu WHERE ym = ?').bind(ym).all()).results.map(x => ({ ma: x.ma, xem_at: x.xem_at, hoi: JSON.parse(x.hoi || '[]') })) });
    }
    if (r === 'phieu-tra-loi' && req.method === 'POST') {
      const ym = String(body.ym || ''), ma = String(body.ma || '').toUpperCase(), i = +body.idx, tl = String(body.tra_loi || '').trim().slice(0, 500);
      const row = await db.prepare('SELECT hoi FROM phieu WHERE ym = ? AND ma = ?').bind(ym, ma).first(); if (!row || !tl) return jc({ ok: false, loi: 'Không có câu hỏi này.' }, 404);
      const a = JSON.parse(row.hoi || '[]'); if (!a[i]) return jc({ ok: false, loi: 'Không có câu hỏi này.' }, 404);
      a[i].tl = tl; a[i].tl_at = now; a[i].tl_by = String(body.nguoi || '').slice(0, 80);
      await db.prepare('UPDATE phieu SET hoi = ? WHERE ym = ? AND ma = ?').bind(JSON.stringify(a), ym, ma).run();
      return jc({ ok: true });
    }
    if (r === 'lich' && req.method === 'POST') return jc({ ok: true, n: await lichPush(db, body, null) });
    if (r === 'ho-so' && req.method === 'POST') return jc({ ok: true, n: await hoSoPush(db, body, null) });
    if (r === 'hn-xong') return jc({ ok: true, list: (await db.prepare('SELECT ma, sid, x, at FROM hn_xong').all()).results }); // 12/11: việc hội nhập người mới xác nhận trên app
    if (r === 'dt-kq') return jc({ ok: true, list: (await db.prepare('SELECT ma, kh, du_lieu, at FROM dt_kq').all()).results }); // 12/11 16:30: kết quả học trên app
    if (r === 'kho-ids') return jc({ ok: true, ids: (await db.prepare('SELECT id FROM kho_file').all()).results.map(x => x.id) });
    if (r === 'kho-xoa' && req.method === 'POST') { const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 500).map(String); for (let i = 0; i < ids.length; i += 50) await db.batch(ids.slice(i, i + 50).map(id => db.prepare('DELETE FROM kho_file WHERE id = ?').bind(id))); return jc({ ok: true, n: ids.length }); }
    if (r === 'kho-file' && req.method === 'POST') {
      const id = String(body.id || '').slice(0, 80), ma = String(body.ma || '').toUpperCase(), data = String(body.data || ''); if (!id || !MA_RE.test(ma) || !data) return jc({ ok: false, loi: 'Thiếu dữ liệu file' }, 400);
      if (data.length > 1700000) return jc({ ok: false, loi: 'File quá lớn (tối đa 1,2 MB)' }, 413);
      await db.prepare('INSERT INTO kho_file (id, ma, kho, ref, ten, loai, size, at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, ten = excluded.ten, ref = excluded.ref, at = excluded.at').bind(id, ma, String(body.kho || '').slice(0, 10), String(body.ref || '').slice(0, 120), String(body.ten || 'file').slice(0, 160), String(body.loai || '').slice(0, 80), Math.round(data.length * 3 / 4), Date.now(), data).run();
      return jc({ ok: true });
    }
    if (r === 'dk-ca') return jc({ ok: true, list: await dkList(db, String(url.searchParams.get('tu') || isoVN(now - 7 * 864e5)), null) });
    if (r === 'bao-sai') return jc({ ok: true, list: (await db.prepare('SELECT ma, ngay, noi_dung, tao FROM bao_sai WHERE ngay >= ? ORDER BY tao DESC LIMIT 2000').bind(isoVN(now - 100 * 864e5)).all()).results });
    if (r === 'cong-xac-nhan') {
      const ym = String(url.searchParams.get('ym') || '');
      return jc({ ok: true, list: (await db.prepare('SELECT ma, xn, xn_at, phan_hoi, chot FROM cong WHERE ym = ?').bind(ym).all()).results });
    }
    return jc({ ok: false, loi: 'Không có API này' }, 404);
  }


  /* ===== 13/11/2026 – MỘT TÀI KHOẢN + TRANG QUẢN TRỊ TRÊN MÁY CHỦ =====
     - Tài khoản = Mã nhân viên. Người được cấp quyền quản trị (cột qt) đăng nhập bằng MẬT KHẨU (≥ 8 ký tự, có chữ và số) ở cả app và trang quản trị.
     - Tài khoản quản trị hệ thống dự phòng: tên đăng nhập "quantri", mật khẩu lưu ở cfg.ql_pin (gộp với mã PIN quản lý cũ của trang /quan-ly).
     - Dữ liệu Phần mềm quản lý nhân sự toàn diện: bảng qt_kv + qt_part, mỗi khóa có số phiên bản – ghi khi phiên bản trên máy chủ đã khác → trả 409 để phần mềm hỏi người dùng.
     - GIỚI HẠN (đã báo anh): máy chủ chỉ kiểm tra "có quyền quản trị hay không" và "có phải quản trị viên không" (sửa phân quyền). Quyền theo từng module, công ty, phòng ban vẫn chặn ở giao diện như 0.7.1. */
  if (p.startsWith('/api/qt/')) {
    const r = p.slice(8);
    if (demo && r !== 'toi') return bad('Bản thử không lưu dữ liệu phần mềm quản trị trên máy chủ chung. Phần mềm bản thử chạy với dữ liệu mẫu trên trình duyệt của anh/chị.', 403);
    if (r === 'dang-nhap' && req.method === 'POST') {
      const ma = String(body.ma || '').trim().toUpperCase(), mk = String(body.mk || '');
      if (ma === 'QUANTRI') {
        if (!isSetup) return bad('Máy chủ chưa cài đặt lần đầu. Mở trang /quan-ly để cài đặt.', 409);
        const lock = Number(cfg.ql_lock || 0); if (lock > now) return bad('Nhập sai nhiều lần. Thử lại sau ' + Math.ceil((lock - now) / 60e3) + ' phút.', 429);
        if (!await checkPw(mk, cfg.ql_salt, cfg.ql_pin)) { const f = Number(cfg.ql_fail || 0) + 1; await setCfg(db, f >= 5 ? { ql_fail: 0, ql_lock: now + 15 * 60e3 } : { ql_fail: f }); return bad('Tên đăng nhập hoặc mật khẩu chưa đúng.', 401); }
        await setCfg(db, { ql_fail: 0, ql_lock: 0 });
        return json({ ok: true }, 200, { 'set-cookie': await newSession(db, 'qt', null, req) });
      }
      const nv = await db.prepare('SELECT * FROM nv WHERE ma = ?').bind(ma).first();
      if (!nv || !nv.active || !nv.mk || !qtOf(nv)) return bad('Tên đăng nhập hoặc mật khẩu chưa đúng, hoặc tài khoản chưa được cấp quyền vào trang quản trị.', 401);
      if (nv.lock_until > now) return bad('Nhập sai nhiều lần. Thử lại sau ' + Math.ceil((nv.lock_until - now) / 60e3) + ' phút hoặc nhờ quản trị viên mở khóa.', 429);
      if (!await checkPw(mk, nv.mk_salt, nv.mk)) { const f = nv.fail + 1; await db.prepare('UPDATE nv SET fail = ?, lock_until = ? WHERE ma = ?').bind(f >= 5 ? 0 : f, f >= 5 ? now + 15 * 60e3 : 0, ma).run(); return bad('Tên đăng nhập hoặc mật khẩu chưa đúng, hoặc tài khoản chưa được cấp quyền vào trang quản trị.', 401); }
      await db.prepare('UPDATE nv SET fail = 0, lock_until = 0, login_at = ? WHERE ma = ?').bind(now, ma).run();
      return json({ ok: true }, 200, { 'set-cookie': await newSession(db, 'qt', ma, req) });
    }
    if (r === 'mo' && req.method === 'POST') { // bấm "Quản trị" trên app: dùng phiên app hiện tại, không phải gõ lại mật khẩu
      const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
      if (!qtOf(s.nv) || !s.nv.co_mk) return bad('Tài khoản này chưa được cấp quyền vào trang quản trị.', 403);
      if (s.nv.mk_doi) return bad('Đổi mật khẩu được cấp trước khi vào trang quản trị (mục Bạn → Đổi mật khẩu).', 403);
      return json({ ok: true, url: '/quan-tri' }, 200, { 'set-cookie': await newSession(db, 'qt', s.nv.ma, req) });
    }
    const U = await qtUser(db, req);
    if (r === 'toi') return U ? json({ ok: true, me: U, ten_cty: cfg.ten_cty, ver: VER, now }) : bad('Chưa đăng nhập.', 401);
    if (r === 'dang-xuat' && req.method === 'POST') { const tok = cookies(req)[COOKIE.qt]; if (tok) await db.prepare('DELETE FROM phien WHERE tok = ?').bind(await sha256(tok)).run(); return json({ ok: true }, 200, { 'set-cookie': setCookie(COOKIE.qt, '', 0) }); }
    if (!U) return bad('Phiên đăng nhập trang quản trị đã hết. Đăng nhập lại.', 401);
    if (r === 'doi-mk' && req.method === 'POST') {
      const cu = String(body.cu || ''), moi = String(body.moi || ''), e = pwBad(moi); if (e) return bad(e);
      if (!U.ma) { if (!await checkPw(cu, cfg.ql_salt, cfg.ql_pin)) return bad('Mật khẩu hiện tại chưa đúng.'); const salt = randHex(16); await setCfg(db, { ql_pin: await hashPw(moi, salt), ql_salt: salt }); return json({ ok: true }); }
      const nv = await db.prepare('SELECT mk, mk_salt FROM nv WHERE ma = ?').bind(U.ma).first(); if (!nv || !await checkPw(cu, nv.mk_salt, nv.mk)) return bad('Mật khẩu hiện tại chưa đúng.');
      if (await checkPw(moi, nv.mk_salt, nv.mk)) return bad('Mật khẩu mới cần khác mật khẩu đang dùng.');
      const salt = randHex(16); await db.prepare('UPDATE nv SET mk = ?, mk_salt = ?, mk_doi = NULL WHERE ma = ?').bind(await hashPw(moi, salt), salt, U.ma).run(); return json({ ok: true });
    }
    // 17/11/2026 21:09 anh duyệt: TẢI FILE TỪ ĐƯỜNG LINK GOOGLE DRIVE / GOOGLE SHEETS (file phải bật "Bất kỳ ai có đường liên kết") – máy chủ tải hộ vì trình duyệt bị chặn tải trực tiếp
    if (r === 'tai-link' && req.method === 'POST') {
      let u0; try { u0 = new URL(String(body.url || '').trim()); } catch (e) { return bad('Đường link chưa đúng.'); }
      const host = u0.hostname.toLowerCase(); if (u0.protocol !== 'https:' || !/^(drive|docs)\.google\.com$/.test(host)) return bad('Chỉ nhận link Google Drive hoặc Google Sheets (drive.google.com, docs.google.com).');
      const id = (u0.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/) || [])[1] || u0.searchParams.get('id') || ''; if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return bad('Không tìm thấy mã file trong link – mở file trên Google Drive, bấm Chia sẻ → Sao chép đường liên kết rồi dán lại.');
      if (/\/drive\/folders\//.test(u0.pathname)) return bad('Đây là link thư mục. Phần mềm tải từng file – dán link của file; cả thư mục thì dùng Google Drive cho máy tính.');
      const sheet = host === 'docs.google.com' && /\/spreadsheets\//.test(u0.pathname);
      if (host === 'docs.google.com' && !sheet) return bad('Link Google Docs / Slides không phải bảng tính – chỉ nhận Google Sheets hoặc file Excel, CSV, PDF trên Drive.');
      const src = sheet ? 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx' : 'https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t';
      let rs; try { rs = await fetch(src, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (phan-mem-nhan-su)' } }); } catch (e) { return bad('Không kết nối được Google Drive. Thử lại sau ít phút.', 502); }
      const ct = rs.headers.get('content-type') || '';
      if (!rs.ok || /text\/html/i.test(ct)) return bad('Google không cho tải file này. Kiểm tra: file đã bật chia sẻ "Bất kỳ ai có đường liên kết" chưa; file còn tồn tại; file không quá lớn.', 400);
      const len = +(rs.headers.get('content-length') || 0); if (len > 15 * 1048576) return bad('File lớn hơn 15 MB – tải về máy rồi chọn file.');
      const buf = await rs.arrayBuffer(); if (buf.byteLength > 15 * 1048576) return bad('File lớn hơn 15 MB – tải về máy rồi chọn file.');
      const cdp = rs.headers.get('content-disposition') || ''; let name = '';
      const m1 = /filename\*=UTF-8''([^;]+)/i.exec(cdp), m2 = /filename="([^"]+)"/i.exec(cdp);
      try { name = m1 ? decodeURIComponent(m1[1]) : m2 ? m2[1] : ''; } catch (e) { name = m2 ? m2[1] : ''; }
      if (!name) name = (sheet ? 'Google-Sheets-' : 'Google-Drive-') + id.slice(0, 8) + (sheet ? '.xlsx' : '');
      return new Response(buf, { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-ten-file': encodeURIComponent(name.replace(/[\r\n"]/g, '').slice(0, 180)), 'cache-control': 'no-store' } });
    }
    // 17/11/2026 đợt 2 (anh duyệt): GỬI EMAIL TỰ ĐỘNG QUA RESEND – khóa API lưu trong cfg (chỉ Quản trị hệ thống thiết lập, trả về dạng che), gửi từ máy chủ, không lộ khóa ra trình duyệt
    if (r === 'email-cfg') {
      // 17/11: email gửi đi phải thuộc tên miền của đơn vị. Tự nhận từ địa chỉ máy chủ; chạy trên workers.dev thì quản trị nhập tay (mail_domain)
      const autoDom = regDomain(new URL(req.url).hostname), dom = autoDom || String(cfg.mail_domain || '');
      if (req.method === 'POST') {
        if (!U.sys) return bad('Chỉ tài khoản Quản trị hệ thống được thiết lập gửi email.', 403);
        if (body.xoa) { await setCfg(db, { mail_key: '', mail_from: '', mail_name: '', mail_reply: '' }); return json({ ok: true }); }
        const o = {}, k = String(body.key || '').trim();
        if (k) { if (!/^re_[A-Za-z0-9_]{8,}$/.test(k)) return bad('Khóa API Resend chưa đúng – khóa bắt đầu bằng re_ (tạo ở resend.com → API Keys).'); o.mail_key = k; }
        if (!k && !cfg.mail_key) return bad('Chưa nhập khóa API Resend.');
        const from = String(body.from || '').trim().toLowerCase(); if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(from)) return bad('Email gửi đi chưa đúng (VD: tuyendung@tencongty.vn).');
        const rep = String(body.reply || '').trim().toLowerCase(); if (rep && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(rep)) return bad('Email nhận phản hồi chưa đúng.');
        let d = autoDom; if (!d) { d = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''); if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || /(^|\.)(workers|pages)\.dev$/.test(d)) return bad('Nhập tên miền riêng của đơn vị (VD: tencongty.vn).'); o.mail_domain = d; }
        const fd = from.split('@')[1]; if (fd !== d && !fd.endsWith('.' + d)) return bad('Email gửi đi phải thuộc tên miền của đơn vị (@' + d + '). Email ' + from + ' không thuộc tên miền này.');
        o.mail_from = from; o.mail_name = String(body.name || '').trim().replace(/[<>"\r\n]/g, '').slice(0, 80); o.mail_reply = rep;
        await setCfg(db, o); return json({ ok: true });
      }
      return json({ ok: true, on: !!(cfg.mail_key && cfg.mail_from), key: cfg.mail_key ? 're_…' + String(cfg.mail_key).slice(-4) : '', from: cfg.mail_from || '', name: cfg.mail_name || '', reply: cfg.mail_reply || '', dom: dom, autoDom: !!autoDom, admin: !!U.sys });
    }
    if (r === 'email-gui' && req.method === 'POST') {
      if (!cfg.mail_key || !cfg.mail_from) return bad('Chưa thiết lập gửi email tự động. Vào Cài đặt → Gửi email tự động.');
      const to = String(body.to || '').trim(); if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(to)) return bad('Email người nhận chưa đúng.');
      const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 250), text = String(body.text || '').slice(0, 50000);
      if (!subject || !text.trim()) return bad('Thiếu tiêu đề hoặc nội dung thư.');
      const h = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const msg = { from: cfg.mail_name ? cfg.mail_name + ' <' + cfg.mail_from + '>' : cfg.mail_from, to: [to], subject, text, html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2a1c;white-space:pre-wrap">' + h(text) + '</div>' };
      if (cfg.mail_reply) msg.reply_to = cfg.mail_reply;
      let rs, j = {};
      try { rs = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.mail_key, 'content-type': 'application/json' }, body: JSON.stringify(msg) }); j = await rs.json().catch(() => ({})); }
      catch (e) { return bad('Không kết nối được Resend. Thử lại sau ít phút.', 502); }
      if (!rs.ok) return bad('Resend chưa gửi được: ' + String(j.message || j.name || ('mã ' + rs.status)).slice(0, 300), 502);
      return json({ ok: true, id: j.id || '' });
    }
    if (r === 'du-lieu') return json({ ok: true, now, list: (await db.prepare('SELECT k, ver, at, nguoi, z, meta, size FROM qt_kv ORDER BY k').all()).results.map(x => ({ ...x, meta: x.meta ? JSON.parse(x.meta) : null })) });
    if (r === 'kv' && req.method === 'GET') {
      const k = String(url.searchParams.get('k') || ''); const row = await db.prepare('SELECT k, ver, at, nguoi, n, z FROM qt_kv WHERE k = ?').bind(k).first(); if (!row) return bad('Chưa có dữ liệu này trên máy chủ.', 404);
      const parts = (await db.prepare('SELECT v FROM qt_part WHERE k = ? ORDER BY i').bind(k).all()).results.map(x => x.v);
      return json({ ok: true, k, ver: row.ver, at: row.at, nguoi: row.nguoi, z: row.z, v: parts.join('') });
    }
    if (r === 'kv' && req.method === 'POST') {
      const k = String(body.k || ''); if (!/^(settings|units|done|ndhist|(kho|unit):[A-Za-z0-9._-]{1,80})$/.test(k)) return bad('Khóa dữ liệu không hợp lệ.');
      const v = String(body.v == null ? '' : body.v), z = body.z ? 1 : 0; if (v.length > 60e6) return bad('Dữ liệu quá lớn (tối đa khoảng 60 MB một phần).', 413);
      const old = await db.prepare('SELECT ver, at, nguoi FROM qt_kv WHERE k = ?').bind(k).first(), base = body.base == null ? 0 : +body.base;
      if (old && !body.force && old.ver !== base) return json({ ok: false, xung_dot: true, ver: old.ver, at: old.at, nguoi: old.nguoi, loi: 'Dữ liệu trên máy chủ vừa được ' + (old.nguoi || 'người khác') + ' cập nhật.' }, 409);
      if (!old && !body.force && base > 0) return json({ ok: false, xung_dot: true, ver: 0, loi: 'Dữ liệu này vừa bị xóa trên máy chủ.' }, 409);
      if (k === 'settings' && !U.sys && !z) { // chỉ quản trị viên được đổi phân quyền
        let a = null, b = null; try { b = JSON.parse(v).pq || null; } catch (e) { return bad('Dữ liệu cài đặt không đọc được.'); }
        if (old) { const op = (await db.prepare('SELECT v FROM qt_part WHERE k = ? ORDER BY i').bind(k).all()).results.map(x => x.v).join(''); try { a = JSON.parse(op).pq || null; } catch (e) { } }
        if (JSON.stringify(pqCore(a)) !== JSON.stringify(pqCore(b))) return bad('Chỉ quản trị viên mới sửa được phân quyền tài khoản.', 403);
      } else if (k === 'settings' && !U.sys && z) return bad('Dữ liệu cài đặt phải gửi dạng chưa nén.');
      const ver = (old ? old.ver : 0) + 1, CH = 400000, st = [db.prepare('DELETE FROM qt_part WHERE k = ?').bind(k)]; let n = 0;
      for (let i = 0; i < v.length || i === 0; i += CH) { st.push(db.prepare('INSERT INTO qt_part (k, i, v) VALUES (?, ?, ?)').bind(k, n++, v.slice(i, i + CH))); if (!v.length) break; }
      const meta = body.meta ? JSON.stringify(body.meta).slice(0, 4000) : null;
      st.push(db.prepare('INSERT INTO qt_kv (k, ver, at, nguoi, n, z, meta, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET ver = excluded.ver, at = excluded.at, nguoi = excluded.nguoi, n = excluded.n, z = excluded.z, meta = excluded.meta, size = excluded.size').bind(k, ver, now, U.ten, n, z, meta, v.length));
      for (let i = 0; i < st.length; i += 4) await db.batch(st.slice(i, i + 4));
      if (k === 'settings' && !z) { try { const br = JSON.parse(v).brand || {}, lg = String(br.logo || ''); await setCfg(db, { br_ten: String(br.name || '').slice(0, 40), br_logo: /^data:image\/(png|webp|jpeg|svg\+xml);base64,/.test(lg) && lg.length < 250000 ? lg : '' }); } catch (e) { } } // 16/11/2026: thương hiệu riêng → app nhân viên, trang đăng nhập
      return json({ ok: true, ver, at: now, nguoi: U.ten });
    }
    if (r === 'kv-xoa' && req.method === 'POST') { const k = String(body.k || ''); if (!/^(kho|unit):[A-Za-z0-9._-]{1,80}$/.test(k)) return bad('Chỉ xóa được file kho hoặc dữ liệu một công ty.'); await db.batch([db.prepare('DELETE FROM qt_part WHERE k = ?').bind(k), db.prepare('DELETE FROM qt_kv WHERE k = ?').bind(k)]); return json({ ok: true }); }
    // ----- tài khoản: chỉ quản trị viên -----
    if (r === 'tai-khoan' && req.method === 'GET') return json({ ok: true, now, list: (await db.prepare('SELECT ma, ten, active, qt, mk IS NOT NULL AS co_mk, mk_doi, login_at, lock_until FROM nv WHERE qt IS NOT NULL').all()).results.map(x => ({ ...x, qt: qtOf(x) })) });
    if (r === 'tai-khoan' && req.method === 'POST') {
      if (!U.sys) return bad('Chỉ quản trị viên mới cấp được quyền và mật khẩu.', 403);
      const ma = String(body.ma || '').trim().toUpperCase(); if (!MA_RE.test(ma)) return bad('Mã nhân viên không hợp lệ.');
      if (U.ma === ma && body.qt && !body.qt.sys) return bad('Không tự bỏ quyền quản trị viên của tài khoản đang dùng.');
      let nv = await db.prepare('SELECT ma FROM nv WHERE ma = ?').bind(ma).first();
      if (!nv) { const ten = String(body.ten || '').trim().slice(0, 120); if (!ten) return bad('Nhân viên này chưa có trên máy chủ. Bấm Đồng bộ ở Chấm công Wi‑Fi trước.'); await db.prepare("INSERT INTO nv (ma, ten, active, created, pb, nguon) VALUES (?, ?, 1, ?, ?, 'phan-mem')").bind(ma, ten, now, String(body.pb || '').slice(0, 120)).run(); }
      const q = body.qt ? JSON.stringify({ r: String(body.qt.r || '').slice(0, 30), t: String(body.qt.t || '').slice(0, 60), sys: body.qt.sys ? 1 : 0 }) : null;
      const st = [db.prepare('UPDATE nv SET qt = ? WHERE ma = ?').bind(q, ma)];
      if (body.mk) { const e = pwBad(body.mk); if (e) return bad(e); const salt = randHex(16); st.push(db.prepare('UPDATE nv SET mk = ?, mk_salt = ?, mk_doi = ?, fail = 0, lock_until = 0 WHERE ma = ?').bind(await hashPw(body.mk, salt), salt, U.ma === ma ? null : 1, ma)); }
      if (!q) st.push(db.prepare('UPDATE nv SET mk = NULL, mk_salt = NULL, mk_doi = NULL WHERE ma = ?').bind(ma)); // bỏ quyền quản trị → về đăng nhập bằng mã PIN
      if (body.off !== undefined) st.push(db.prepare('UPDATE nv SET active = ? WHERE ma = ?').bind(body.off ? 0 : 1, ma));
      if (body.mk || !q || body.off) st.push(db.prepare("DELETE FROM phien WHERE ma = ? AND vai IN ('nv','qt')").bind(ma));
      await db.batch(st);
      return json({ ok: true });
    }
    return bad('Không có API này', 404);
  }

  /* ----- 16/11/2026: thông báo đẩy ----- */
  if (p === '/api/push/khoa') return json({ ok: true, key: (await vapidKeys(db, cfg)).pub });
  if (p === '/api/push/dang-ky' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const sb = body.sub || {}, ep = String(sb.endpoint || ''), k = sb.keys || {};
    if (!/^https:\/\/[^\s]{10,900}$/.test(ep) || !/^[A-Za-z0-9_-]{80,100}$/.test(String(k.p256dh || '')) || !/^[A-Za-z0-9_-]{16,30}$/.test(String(k.auth || ''))) return bad('Thông tin đăng ký thông báo không hợp lệ.');
    await db.prepare('INSERT INTO push_sub (ep, ma, p256dh, auth, at, may) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ep) DO UPDATE SET ma = excluded.ma, p256dh = excluded.p256dh, auth = excluded.auth, at = excluded.at, may = excluded.may').bind(ep, s.nv.ma, k.p256dh, k.auth, now, req.may || null).run();
    if (body.thu) { const n = await pushTo(db, cfg, url.origin, [s.nv.ma], { t: 'Đã bật thông báo', b: 'Bạn sẽ nhận thông báo khi có đơn cần duyệt hoặc đơn của bạn có kết quả.', u: '/?tab=don', tag: 'thu' }); return json({ ok: true, gui: n }); }
    return json({ ok: true });
  }
  if (p === '/api/push/huy' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    await db.prepare('DELETE FROM push_sub WHERE ep = ? AND ma = ?').bind(String(body.endpoint || ''), s.nv.ma).run(); return json({ ok: true });
  }
  /* ----- 16/11/2026: đơn xin đi muộn / về sớm ----- */
  if (p === '/api/xin-muon' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    if (body.huy) { const r = await db.prepare("UPDATE xin_muon SET trang_thai = 'Đã hủy', cap_nhat = ? WHERE so = ? AND ma = ? AND trang_thai = 'Chờ duyệt'").bind(now, String(body.huy), s.nv.ma).run(); return r.meta.changes ? json({ ok: true }) : bad('Chỉ hủy được đơn đang chờ duyệt.'); }
    const HS = await hsOf(db, s.nv.ma, demo), X = xmCfgOf(HS, demo); if (!X.on) return bad('Công ty chưa dùng đơn xin đi muộn, về sớm.');
    const kieu = body.kieu === 'som' ? 'som' : body.kieu === 'muon' ? 'muon' : null, ngay = String(body.ngay || ''), gio = String(body.gio || ''), ly = String(body.ly_do || '').trim().slice(0, 300);
    if (!kieu) return bad('Chọn đi muộn hay về sớm.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return bad('Chọn ngày.');
    if (!/^\d{2}:\d{2}$/.test(gio) || hm2min(gio) === null || hm2min(gio) >= 1440) return bad(kieu === 'muon' ? 'Nhập giờ dự kiến đến (dạng 08:45).' : 'Nhập giờ dự kiến về (dạng 16:30).');
    if (!ly) return bad('Ghi lý do để người duyệt nắm.');
    const today = isoVN(now), nowM = hm2min(vnHM(now));
    if (ngay > addDaysIso(today, 60)) return bad('Chỉ gửi trước tối đa 60 ngày.');
    const ca = await caNgay(db, cfg, HS, s.nv.ma, ngay);
    if (!ca && HS && HS.lich) return bad('Ngày ' + ngay.slice(8) + '/' + ngay.slice(5, 7) + ' không có ca làm của bạn.');
    let phut = null;
    if (ca) { const vao = hm2min(ca.vao) - (ca.som || 0), ra = hm2min(ca.ra), g = hm2min(gio), ra2 = ra <= hm2min(ca.vao) ? ra + 1440 : ra;
      if (kieu === 'muon') { if (g <= vao) return bad('Giờ dự kiến đến phải sau ' + (ca.som ? 'giờ phải có mặt ' : 'giờ vào ca ') + String(Math.floor(vao / 60)).padStart(2, '0') + ':' + String(vao % 60).padStart(2, '0') + '.'); phut = g - vao; }
      else { const g2 = g < hm2min(ca.vao) && ra2 > 1440 ? g + 1440 : g; if (g2 >= ra2) return bad('Giờ dự kiến về phải trước giờ ra ca ' + ca.ra + '.'); phut = ra2 - g2; } }
    // hạn gửi theo quy định của đơn vị
    const moc = kieu === 'muon' ? (ca ? hm2min(ca.vao) - (ca.som || 0) : hm2min(gio)) : hm2min(gio);
    if (X.han === 'truoc') { // 16/11 11:02 anh: xin trước tối thiểu X.tp phút (so với giờ vào ca / giờ xin về)
      const mocT = Date.UTC(+ngay.slice(0, 4), +ngay.slice(5, 7) - 1, +ngay.slice(8, 10)) - VN + moc * 60e3, tp = X.tp || 0;
      if (now > mocT - tp * 60e3) { const t = tp ? (tp % 60 ? (tp >= 60 ? Math.floor(tp / 60) + ' giờ ' : '') + (tp % 60) + ' phút' : (tp / 60) + ' giờ') : ''; return bad('Công ty quy định gửi đơn trước khi ' + (kieu === 'muon' ? 'vào ca' : 'về') + (tp ? ' tối thiểu ' + t : '') + '. Đã quá hạn để xin cho ngày này.'); } }
    if (X.han === 'ngay' && ngay < today) return bad('Công ty quy định gửi đơn chậm nhất trong ngày phát sinh.');
    if (X.han === 'n' && ngay < addDaysIso(today, -X.n)) return bad('Công ty cho gửi bù chậm nhất ' + X.n + ' ngày sau ngày phát sinh.');
    const trung = await db.prepare("SELECT so FROM xin_muon WHERE ma = ? AND ngay = ? AND kieu = ? AND trang_thai IN ('Chờ duyệt','Đã duyệt')").bind(s.nv.ma, ngay, kieu).first();
    if (trung) return bad('Đã có đơn ' + trung.so + ' cho ngày này.');
    if (X.max) { const c = await db.prepare("SELECT COUNT(*) AS n FROM xin_muon WHERE ma = ? AND substr(ngay, 1, 7) = ? AND trang_thai IN ('Chờ duyệt','Đã duyệt')").bind(s.nv.ma, ngay.slice(0, 7)).first(); if ((c.n || 0) >= X.max) return bad('Công ty cho gửi tối đa ' + X.max + ' đơn đi muộn, về sớm mỗi tháng. Tháng ' + (+ngay.slice(5, 7)) + ' bạn đã gửi đủ.'); }
    const so = 'XM-' + today.replace(/-/g, '').slice(2) + '-' + randHex(2).toUpperCase(), BYd = await hsLite(db, demo), NDD = nguoiDuyet(BYd, s.nv.ma);
    await db.prepare("INSERT INTO xin_muon (so, ma, ngay, kieu, gio, phut, ly_do, tao, trang_thai, nguoi_duyet, duyet_ma, cap_nhat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Chờ duyệt', ?, ?, ?)").bind(so, s.nv.ma, ngay, kieu, gio, phut, ly, now, NDD.map(x => BYd[x].ten).join(', ') || (HS && HS.ql_ten) || '', NDD[0] || (HS && HS.ql) || null, now).run();
    later(req, pushTo(db, cfg, url.origin, NDD.length ? NDD : [HS && HS.ql], { t: s.nv.ten + ' xin ' + (kieu === 'muon' ? 'đi muộn' : 'về sớm'), b: ngay.slice(8) + '/' + ngay.slice(5, 7) + ' · ' + (kieu === 'muon' ? 'đến ' : 'về ') + gio + (phut ? ' (' + phut + ' phút)' : '') + ' · ' + ly, u: '/?tab=don', tag: so }));
    return json({ ok: true, so, phut });
  }
  /* ----- 16/11/2026: thông tin chung + thông báo cho nhân viên ----- */
  if (p === '/api/vb-file') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const id = String(url.searchParams.get('id') || ''), f = await db.prepare('SELECT cty FROM vb_file WHERE id = ?').bind(id).first(), HS = await hsOf(db, s.nv.ma, demo), cty = (HS && HS.cty) || cfg.ten_cty;
    if (!f || (f.cty && cty && f.cty !== cty && !demo)) return bad('Không tìm thấy tài liệu.', 404);
    return (await vbFileResp(db, id, url.searchParams.get('tai') === '1')) || bad('Tài liệu đang được tải lên, thử lại sau.', 404);
  }
  if (p === '/api/tb-anh') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết.', 401);
    const t = await db.prepare('SELECT anh FROM tb WHERE id = ?').bind(String(url.searchParams.get('id') || '')).first(); if (!t || !t.anh) return bad('Không có ảnh', 404);
    const m = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(t.anh); return new Response(b64ToBytes(m[2]), { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
  }
  if (p === '/api/bc') { // 16/11: nội dung báo cáo định kỳ – chỉ người nhận
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const id = String(url.searchParams.get('id') || ''), t = await db.prepare("SELECT den FROM tb WHERE ref = ? AND loai = 'bc'").bind(id).first();
    let ok = false; try { ok = !!t && (JSON.parse(t.den || '{}').ma || []).includes(s.nv.ma); } catch (e) { }
    const r = ok ? await db.prepare('SELECT du_lieu FROM bc_nd WHERE id = ?').bind(id).first() : null; if (!r) return bad('Không tìm thấy báo cáo (có thể đã quá hạn lưu).', 404);
    return json({ ok: true, bc: JSON.parse(r.du_lieu) });
  }
  if (p === '/api/tb-luu') { // 17/11: Lưu trữ thông báo nội bộ – mọi thông báo gửi từ "Gửi thông báo nội bộ" tới người này, kể cả đã xóa khỏi danh sách; tìm theo từ khóa
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const ma = s.nv.ma, BY = await hsLite(db, demo), H = BY[ma] || { cty: '', pb: s.nv.pb || '' };
    const fold = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
    const q = fold(url.searchParams.get('q')).trim(), w = q ? q.split(/\s+/) : [], trang = Math.max(0, parseInt(url.searchParams.get('trang'), 10) || 0), N = 30;
    const doc = {}; (await db.prepare('SELECT id, doc_at FROM tb_doc WHERE ma = ?').bind(ma).all()).results.forEach(r => { doc[r.id] = r.doc_at; });
    const L = (await db.prepare("SELECT id, cty, tieu_de, noi_dung, anh IS NOT NULL AS co_anh, den, nguoi, at FROM tb WHERE loai = 'tb' ORDER BY at DESC LIMIT 3000").all()).results
      .filter(r => tbHop(r, ma, H) && (!w.length || (x => w.every(k => x.includes(k)))(fold(r.tieu_de + ' ' + r.noi_dung + ' ' + (r.nguoi || '')))));
    return json({ ok: true, n: L.length, trang, het: (trang + 1) * N >= L.length, thang: tbLuuThang(cfg), list: L.slice(trang * N, trang * N + N).map(r => ({ id: r.id, tieu_de: r.tieu_de, noi_dung: r.noi_dung, co_anh: r.co_anh ? 1 : 0, nguoi: r.nguoi, at: r.at, doc_at: doc[r.id] || null })) });
  }
  if (p === '/api/tb' && req.method === 'POST') { // đánh dấu đã đọc / xóa (ẩn với riêng mình)
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const ma = s.nv.ma, BY = await hsLite(db, demo), H = BY[ma] || { cty: '', pb: s.nv.pb || '' };
    const mine = (await db.prepare('SELECT id, cty, den FROM tb ORDER BY at DESC LIMIT 400').all()).results.filter(r => tbHop(r, ma, H)).map(r => r.id);
    const ids = body.tat_ca ? mine : [String(body.id || '')].filter(x => mine.includes(x)), st = [];
    for (const id of ids) {
      if (body.xoa) st.push(db.prepare('INSERT INTO tb_doc (ma, id, doc_at, xoa) VALUES (?, ?, ?, 1) ON CONFLICT(ma, id) DO UPDATE SET xoa = 1, doc_at = COALESCE(tb_doc.doc_at, excluded.doc_at)').bind(ma, id, now));
      else st.push(db.prepare('INSERT INTO tb_doc (ma, id, doc_at, xoa) VALUES (?, ?, ?, 0) ON CONFLICT(ma, id) DO UPDATE SET doc_at = COALESCE(tb_doc.doc_at, excluded.doc_at)').bind(ma, id, now));
    }
    if (body.xoa_da_doc) st.push(db.prepare('UPDATE tb_doc SET xoa = 1 WHERE ma = ? AND doc_at IS NOT NULL').bind(ma));
    for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50)); return json({ ok: true, n: ids.length });
  }
  if (p === '/api/trang-thai') {
    const s = await session(db, req, 'nv');
    const offices = await officeIPs(db, cfg, now);
    const o = { ok: true, ver: VER, demo, setup: isSetup, ten_cty: cfg.ten_cty, che_do: cfg.che_do, ip: cfg.hien_ip === '1' ? ip : null, ip_loai: ipKind(ip), wifi: matchOffice(ip, offices), co_ip_vp: offices.some(r => r.hieu_luc), now };
    if (s) {
      o.me = { ma: s.nv.ma, ten: s.nv.ten };
      { const q = demo ? demoQtOf(s.nv.ma) : (s.nv.co_mk ? qtOf(s.nv) : null); if (q) o.me.qt = { r: q.r, t: q.t }; if (s.nv.co_mk) o.me.mk = 1; if (s.nv.mk_doi) o.me.doi_mk = 1; } // 13/11: một tài khoản – quyền quản trị, mật khẩu
      const d0 = vnDayStart(now), m = vnParts(now);
      const mStart = Date.UTC(m.y, Number(m.m) - 1, 1) - VN;
      o.thang = (await punchesBetween(db, mStart, d0 + 864e5, s.nv.ma)).filter(r => !r.huy).map(r => ({ t: r.t, loai: r.loai, cach: r.cach }));
      o.me.ncc = !!s.nv.ncc; o.ket_noi = !!cfg.sync_key;
      o.don = (await db.prepare('SELECT so, loai, tu, den, so_ngay, ly_do, trang_thai, ly_do_tc, nguoi_duyet, ngay_duyet, ban_giao FROM don WHERE ma = ? ORDER BY tu DESC LIMIT 15').bind(s.nv.ma).all()).results;
      o.bao_sai = (await db.prepare('SELECT ngay, noi_dung, tao FROM bao_sai WHERE ma = ? AND ngay >= ?').bind(s.nv.ma, isoVN(now - 100 * 864e5)).all()).results;
      { const BY = await hsLite(db, demo); o.duyet = (await donChoDuyet(db, BY, s.nv.ma)).concat(await xmChoDuyet(db, BY, s.nv.ma)); // 13/11: mọi người có quyền duyệt đều thấy đơn · 16/11: kèm đơn xin đi muộn / về sớm
        o.nguoi_duyet = nguoiDuyet(BY, s.nv.ma).map(x => BY[x].ten);
        const tv = Object.keys(BY).filter(k => nguoiDuyet(BY, k).includes(s.nv.ma)); if (tv.length) o.bp = { n: tv.length }; }
      const av = await db.prepare('SELECT at FROM anh WHERE ma = ?').bind(s.nv.ma).first(); o.me.anh = av ? av.at : 0;
      o.cong = (await db.prepare('SELECT ym, du_lieu, chot, xn, xn_at, phan_hoi FROM cong WHERE ma = ? ORDER BY ym DESC LIMIT ' + (demo ? 6 : 3)).bind(s.nv.ma).all()).results.map(r => ({ ...r, du_lieu: JSON.parse(r.du_lieu || '{}') }));
      const HS = await hsOf(db, s.nv.ma, demo); o.xm_cfg = xmCfgOf(HS, demo); // 16/11: đơn xin đi muộn / về sớm
      if (o.xm_cfg.on) o.xm = (await db.prepare('SELECT so, ngay, kieu, gio, phut, ly_do, tao, trang_thai, nguoi_duyet, ngay_duyet, ly_do_tc FROM xin_muon WHERE ma = ? AND ngay >= ? ORDER BY ngay DESC, tao DESC LIMIT 30').bind(s.nv.ma, isoVN(now - 92 * 864e5)).all()).results;
      if (HS) { HS.hop_dong = (HS.hop_dong || []).map(h => ({ ...h, html: h.html ? 1 : 0 })); o.hs = HS; o.kho = (await db.prepare('SELECT id, kho, ref, ten, loai, size, at FROM kho_file WHERE ma = ? ORDER BY at DESC LIMIT 200').bind(s.nv.ma).all()).results;
        if (demo && !o.kho.length) o.kho = demoScans(s.nv.ma, HS).map(x => ({ id: x.id, kho: x.kho, ref: x.ref, ten: x.ten, loai: 'image/svg+xml', size: 2400, at: now, mau: 1 })); }
      { const dt = await dtOfMa(db, s.nv.ma, demo); if (o.hs) delete o.hs.dt; if (dt && (dt.kh || []).length) { o.dt = dtForApp(dt); o.dt_kq = {}; (await db.prepare('SELECT kh, du_lieu, at FROM dt_kq WHERE ma = ?').bind(s.nv.ma).all()).results.forEach(r => { try { o.dt_kq[r.kh] = JSON.parse(r.du_lieu); } catch (e) { } }); } }
      { const hn = await hnOfMa(db, s.nv.ma, demo); if (o.hs) delete o.hs.hn; if (hn) { o.hn = hn; o.hn_xong = (await db.prepare('SELECT sid, x, at FROM hn_xong WHERE ma = ?').bind(s.nv.ma).all()).results; } }
      const LC = lichCfg(cfg);
      if (LC && (LC.sx || []).includes(s.nv.ma)) { const t0 = isoVN(now), a = isoVN(now - 62 * 864e5).slice(0, 8) + '01', b = isoVN(now + 75 * 864e5); // 12/11 17:55: đủ cho lịch tháng (tháng trước → 2 tháng tới)
        o.lich = { ky: LC.ky, mode: LC.mode, ca: LC.ca, kh: LC.kh, mo: LC.mode === 'nv' ? LC.mo.filter(k => k.han >= t0) : [], hom_nay: t0,
          d: (await db.prepare('SELECT ngay, ca FROM lich WHERE ma = ? AND ngay BETWEEN ? AND ? ORDER BY ngay').bind(s.nv.ma, a, b).all()).results,
          dk: (await db.prepare('SELECT ngay, ca, t FROM dk_ca WHERE ma = ? AND ngay >= ? ORDER BY ngay').bind(s.nv.ma, t0).all()).results }; }
      o.phieu = (await db.prepare('SELECT ym, du_lieu, xem_at, hoi FROM phieu WHERE ma = ? ORDER BY ym DESC LIMIT 60').bind(s.nv.ma).all()).results.map(r => ({ ym: r.ym, xem_at: r.xem_at, du_lieu: JSON.parse(r.du_lieu || '{}'), hoi: JSON.parse(r.hoi || '[]') }));
      { const BY2 = await hsLite(db, demo), H2 = BY2[s.nv.ma] || { cty: (HS && HS.cty) || '', pb: (HS && HS.pb) || s.nv.pb || '' }, ctyV = H2.cty || (HS && HS.cty) || cfg.ten_cty; // 16/11: thông báo + kho thông tin chung
        const doc = {}; (await db.prepare('SELECT id, doc_at, xoa FROM tb_doc WHERE ma = ?').bind(s.nv.ma).all()).results.forEach(r => { doc[r.id] = r; });
        o.tb = (await db.prepare('SELECT id, cty, tieu_de, noi_dung, anh IS NOT NULL AS co_anh, popup, den, loai, ref, nguoi, at FROM tb ORDER BY at DESC LIMIT 300').all()).results.filter(r => tbHop(r, s.nv.ma, H2) && !(doc[r.id] && doc[r.id].xoa)).slice(0, 100).map(r => ({ id: r.id, tieu_de: r.tieu_de, noi_dung: r.noi_dung, co_anh: r.co_anh ? 1 : 0, popup: r.popup, loai: r.loai, ref: r.ref, nguoi: r.nguoi, at: r.at, doc_at: doc[r.id] ? doc[r.id].doc_at : null }));
        const vr = await db.prepare('SELECT du_lieu FROM vb WHERE cty = ?').bind(ctyV).first(); if (vr) { try { const V = JSON.parse(vr.du_lieu); V.ds = (V.ds || []).filter(x => x && x.tt !== 'Dự thảo'); o.vb = V; } catch (e) { } } }
      o.cty = (o.hs && o.hs.cty) || cfg.ten_cty; // 11/11 15:32: tên công ty của chính người đăng nhập (bản thử có 2 công ty mẫu)
      if (demo) { const e = demoFind(s.nv.ma); if (e) { o.cty = e.cty; o.ho_so = { cty: e.cty, pb: e.pb, cd: e.cd, vao: e.vao, tt: e.tt, email: e.email, hd: e.hd, qp: e.qp, bl: e.bl }; o.don = o.don.concat(e.don.map(d => ({ ...d, mau: 1 }))).slice(0, 20);
        // công tạm tính tháng đang mở = ký hiệu trong dữ liệu mẫu + các ngày sau đó tính từ lượt chấm
        const ymNow = isoVN(now).slice(0, 7), tc = o.cong.find(c => c.ym === ymNow && c.du_lieu.tam);
        if (tc) { const dl = tc.du_lieu, ng = dl.ngay = dl.ngay || {}, by = {}, today = isoVN(now);
          o.thang.forEach(r => { const k = isoVN(r.t), x = by[k] = by[k] || {}; x[r.loai] = 1; if (r.loai === 'vao' && !x.tv) x.tv = r.t; if (r.loai === 'ra') x.tr = r.t; });
          Object.keys(by).forEach(k => { if (k <= DEMO.ref) return; const dd = k.slice(8, 10), b = by[k]; if (b.vao && b.ra) { if (ng[dd] !== 'X') { ng[dd] = 'X'; dl.cong = Math.round((dl.cong + 1) * 100) / 100; dl.huong = Math.round((dl.huong + 1) * 100) / 100; } const ct = dl.ct = dl.ct || {}; if (!ct[dd]) { const ti = vnHM(b.tv), to = vnHM(b.tr), h = Math.max(0, Math.min(8, (b.tr - b.tv) / 3600e3 - 1)); ct[dd] = [ti, to, Math.max(0, hm2min(ti) - 480), Math.max(0, 1020 - hm2min(to)), Math.round(h * 100) / 100, 0]; } } else if (k === today) ng[dd] = '…'; else ng[dd] = '?'; });
          tc.chot = now; } } }
    }
    return json(o);
  }

  if (p === '/api/cai-dat-lan-dau' && req.method === 'POST') {
    if (isSetup) return bad('Đã cài đặt rồi.', 409);
    // 13/11/2026 (rà soát mục 4): phải có MÃ CÀI ĐẶT do người triển khai đặt (biến bí mật MA_CAI_DAT trên Cloudflare) – người lạ mở trang trước cũng không chiếm được quyền quản trị
    const mcd = String(env.MA_CAI_DAT || '');
    if (!mcd) return bad('Máy chủ chưa có mã cài đặt. Vào Cloudflare → Workers & Pages → chọn Worker này → Settings → Variables and Secrets → Add: loại Secret, tên MA_CAI_DAT, giá trị là một mã tự đặt từ 8 ký tự → Deploy (hoặc chạy lệnh: npx wrangler secret put MA_CAI_DAT), rồi mở lại trang này.', 409);
    const gm = String(body.ma_cai_dat || ''); if (gm.length !== mcd.length || await sha256(gm) !== await sha256(mcd)) { await logReject(db, null, ip, 'Cài đặt lần đầu: sai mã cài đặt', req); return bad('Mã cài đặt chưa đúng.', 403); }
    const pin = String(body.pin || ''), ten = String(body.ten_cty || '').trim().slice(0, 120);
    { const e = pwBad(pin); if (e) return bad(e); }
    if (!ten) return bad('Nhập tên đơn vị.');
    const salt = randHex(16);
    await setCfg(db, { ql_pin: await hashPw(pin, salt), ql_salt: salt, qr_secret: randHex(32), ten_cty: ten });
    return json({ ok: true }, 200, { 'set-cookie': await newSession(db, 'ql', null, req) });
  }

  if (p === '/api/dang-nhap' && req.method === 'POST') {
    const ma = String(body.ma || '').trim().toUpperCase(), pin = String(body.pin || '');
    const nv = await db.prepare('SELECT * FROM nv WHERE ma = ?').bind(ma).first();
    if (!nv || !nv.active || !(nv.pin || nv.mk)) return bad('Sai mã nhân viên hoặc mã PIN, mật khẩu.', 401);
    if (nv.lock_until > now) return bad('Nhập sai nhiều lần. Thử lại sau ' + Math.ceil((nv.lock_until - now) / 60e3) + ' phút hoặc nhờ kế toán mở khóa.', 429);
    // 13/11: tài khoản có quyền quản trị đăng nhập bằng mật khẩu (không dùng mã PIN nữa)
    if (nv.mk ? !await checkPw(pin, nv.mk_salt, nv.mk) : await hashPin(pin, nv.salt) !== nv.pin) {
      if (demo) return bad('Sai mã PIN. Bản thử: mã PIN của mọi tài khoản mẫu là ' + DEMO_PIN + '.', 401);
      const f = nv.fail + 1;
      await db.prepare('UPDATE nv SET fail = ?, lock_until = ? WHERE ma = ?').bind(f >= 5 ? 0 : f, f >= 5 ? now + 15 * 60e3 : 0, ma).run();
      return bad(nv.mk ? 'Sai mã nhân viên hoặc mật khẩu. Tài khoản có quyền quản trị đăng nhập bằng mật khẩu, không dùng mã PIN.' : 'Sai mã nhân viên hoặc mã PIN.', 401);
    }
    await db.prepare('UPDATE nv SET fail = 0, lock_until = 0, login_at = ? WHERE ma = ?').bind(now, ma).run();
    await noteDevice(db, req, ma, 'dn');
    return json({ ok: true }, 200, { 'set-cookie': await newSession(db, 'nv', ma, req) });
  }

  if (p === '/api/dang-nhap-ql' && req.method === 'POST') {
    if (demo) return json({ ok: true });
    if (!isSetup) return bad('Chưa cài đặt.', 409);
    const lock = Number(cfg.ql_lock || 0);
    if (lock > now) return bad('Nhập sai nhiều lần. Thử lại sau ' + Math.ceil((lock - now) / 60e3) + ' phút.', 429);
    if (!await checkPw(String(body.pin || ''), cfg.ql_salt, cfg.ql_pin)) {
      const f = Number(cfg.ql_fail || 0) + 1;
      await setCfg(db, f >= 5 ? { ql_fail: 0, ql_lock: now + 15 * 60e3 } : { ql_fail: f });
      return bad('Mật khẩu quản trị hệ thống chưa đúng.', 401);
    }
    await setCfg(db, { ql_fail: 0, ql_lock: 0 });
    return json({ ok: true }, 200, { 'set-cookie': await newSession(db, 'ql', null, req) });
  }

  if (p === '/api/dang-xuat' && req.method === 'POST') {
    const vai = ['nv', 'ql', 'tram'].includes(body.vai) ? body.vai : 'nv';
    const tok = cookies(req)[COOKIE[vai]];
    if (tok) await db.prepare('DELETE FROM phien WHERE tok = ?').bind(await sha256(tok)).run();
    return json({ ok: true }, 200, { 'set-cookie': setCookie(COOKIE[vai], '', 0) });
  }

  if (p === '/api/qr' && req.method === 'POST') {
    if (await verifyQR(cfg.qr_secret, String(body.t || ''), now)) return json({ ok: true, pass: await makePass(cfg.qr_secret, now), het: now + PASS_MS });
    const s = await session(db, req, 'nv');
    await logReject(db, s ? s.nv.ma : null, ip, 'Quét mã QR đã đổi (quá 30 giây)', req);
    return json({ ok: false, loi: 'Mã QR này đã đổi. Hãy quét mã đang hiện ở trang Mã QR chấm công (mã đổi mỗi 30 giây).' }, 403);
  }

  if (p === '/api/cham' && req.method === 'POST') {
    const s = await session(db, req, 'nv');
    if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const loai = body.loai === 'ra' ? 'ra' : 'vao';
    const offices = await officeIPs(db, cfg, now);
    const wifi = matchOffice(ip, offices);
    const hasQR = !!(body.pass || body.t), qrOk = hasQR && (body.pass ? await verifyPass(cfg.qr_secret, body.pass, now) : await verifyQR(cfg.qr_secret, String(body.t), now));
    let ok, lyDo = '';
    if (cfg.che_do === 'chi_wifi') ok = wifi;
    else if (cfg.che_do === 'chi_qr') ok = qrOk;
    else ok = wifi || qrOk;
    if (!ok) {
      if (hasQR && !qrOk) lyDo = 'Lượt quét QR không còn hiệu lực (quá 2 phút hoặc mã không đúng). Hãy quét lại mã đang hiện ở trang Mã QR chấm công.';
      else if (cfg.che_do === 'chi_qr') lyDo = 'Đơn vị đang dùng chế độ chỉ chấm bằng QR. Hãy quét mã ở trang Mã QR chấm công.';
      else if (!offices.some(r => r.hieu_luc)) lyDo = 'Chưa có IP văn phòng. Hãy mở trang Mã QR chấm công (hoặc nhờ kế toán thêm IP văn phòng) rồi thử lại.';
      else lyDo = 'Không nhận ra mạng Wi-Fi văn phòng (' + ipKind(ip) + '). Hãy bắt Wi-Fi văn phòng' + (cfg.che_do === 'chi_wifi' ? '' : ' hoặc quét Mã QR chấm công đặt ở văn phòng') + '.';
      await logReject(db, s.nv.ma, ip, (hasQR ? (qrOk ? 'QR hợp lệ' : 'QR quá 2 phút') : 'Không có QR') + ' · ' + (wifi ? 'IP khớp' : 'IP không khớp') + ' · chế độ ' + cfg.che_do, req);
      return json({ ok: false, loi: lyDo, ip: cfg.hien_ip === '1' ? ip : null }, 403);
    }
    const last = await db.prepare('SELECT t, loai FROM cham WHERE ma = ? AND huy = 0 AND t <= ? ORDER BY t DESC LIMIT 1').bind(s.nv.ma, now).first();
    if (last && last.loai === loai && now - last.t < DUP_MS) return json({ ok: true, trung: true, t: last.t, loai, cach: qrOk ? 'qr' : 'wifi' });
    const cach = wifi ? 'wifi' : 'qr';
    await db.prepare('INSERT INTO cham (ma, t, loai, cach, ip, wifi, tb, may) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(s.nv.ma, now, loai, cach, ip, wifi ? 1 : 0, shortUA(req.headers.get('user-agent')), req.may || null).run();
    await noteDevice(db, req, s.nv.ma, 'cham');
    return json({ ok: true, t: now, loai, cach });
  }

  /* ----- 0.3.1: nhân viên gửi / hủy đơn nghỉ, xác nhận công tháng ----- */
  if (p === '/api/don' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    if (body.huy) { const r = await db.prepare("UPDATE don SET trang_thai = 'Đã hủy', cap_nhat = ? WHERE so = ? AND ma = ? AND trang_thai = 'Chờ duyệt'").bind(now, String(body.huy), s.nv.ma).run(); return r.meta.changes ? json({ ok: true }) : bad('Chỉ hủy được đơn đang chờ duyệt.'); }
    const LOAI = ['Nghỉ phép năm', 'Nghỉ việc riêng có lương', 'Nghỉ ốm', 'Nghỉ thai sản', 'Nghỉ không lương'];
    const loai = LOAI.includes(body.loai) ? body.loai : null, tu = String(body.tu || ''), den = String(body.den || body.tu || ''), ly = String(body.ly_do || '').trim().slice(0, 300);
    if (!loai) return bad('Chọn loại nghỉ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tu) || !/^\d{4}-\d{2}-\d{2}$/.test(den) || den < tu) return bad('Chọn ngày nghỉ (đến ngày không trước từ ngày).');
    if (den > isoVN(now + 366 * 864e5) || tu < isoVN(now - 62 * 864e5)) return bad('Ngày nghỉ chỉ trong khoảng 2 tháng trước đến 1 năm tới.');
    const trung = await db.prepare("SELECT so FROM don WHERE ma = ? AND trang_thai IN ('Chờ duyệt','Đã duyệt') AND tu <= ? AND den >= ?").bind(s.nv.ma, den, tu).first();
    if (trung) return bad('Đã có đơn ' + trung.so + ' trùng ngày.');
    const so = 'DT-' + isoVN(now).replace(/-/g, '').slice(2) + '-' + randHex(2).toUpperCase(), HS = await hsOf(db, s.nv.ma, demo);
    { const DH = HS && HS.dh && HS.dh[loai]; // 16/11 11:04 anh: thời hạn gửi đơn nghỉ theo từng loại (Thiết lập chấm công → Đơn xin)
      if (DH && (DH.k === 'truoc' || DH.k === 'bu')) { const ca = await caNgay(db, cfg, HS, s.nv.ma, tu), st0 = Date.UTC(+tu.slice(0, 4), +tu.slice(5, 7) - 1, +tu.slice(8, 10)) - VN + (ca ? hm2min(ca.vao) : 480) * 60e3, m = Math.max(0, +DH.m || 0), tt = m % 1440 ? (m >= 1440 ? Math.floor(m / 1440) + ' ngày ' : '') + (m % 1440 % 60 ? Math.round(m % 1440 / 6) / 10 + ' giờ' : (m % 1440) / 60 + ' giờ') : m / 1440 + ' ngày';
        if (DH.k === 'truoc' && now > st0 - m * 60e3) return bad('Công ty quy định đơn ' + loai.toLowerCase() + ' phải gửi trước tối thiểu ' + tt + ' (tính đến giờ vào ca ngày bắt đầu nghỉ). Nghỉ đột xuất: báo quản lý trực tiếp để kế toán nhập đơn.');
        if (DH.k === 'bu' && now > st0 + m * 60e3) return bad('Công ty cho gửi bù đơn ' + loai.toLowerCase() + ' muộn nhất ' + tt + ' sau khi bắt đầu nghỉ. Đơn này đã quá hạn – báo quản lý trực tiếp để kế toán nhập đơn.'); } }
    let bg = ''; const bgm = String(body.ban_giao || '').trim().toUpperCase(); if (bgm) { if (bgm === s.nv.ma) return bad('Người nhận bàn giao phải là người khác.'); const x = await db.prepare('SELECT ma, ten FROM nv WHERE ma = ? AND active = 1').bind(bgm).first(); if (!x) return bad('Không tìm thấy người nhận bàn giao.'); bg = x.ma + '|' + x.ten; }
    const BYd = await hsLite(db, demo), NDD = nguoiDuyet(BYd, s.nv.ma); // 13/11: ghi tên những người được duyệt lúc đơn còn chờ; duyệt xong ghi đè bằng tên người đã duyệt
    await db.prepare("INSERT INTO don (so, ma, loai, tu, den, ly_do, tao, trang_thai, nguoi_duyet, duyet_ma, ban_giao, nguon, cap_nhat) VALUES (?, ?, ?, ?, ?, ?, ?, 'Chờ duyệt', ?, ?, ?, 'Điện thoại', ?)").bind(so, s.nv.ma, loai, tu, den, ly, now, NDD.length ? NDD.map(x => BYd[x].ten).join(', ') : (HS && HS.ql_ten) || '', NDD[0] || (HS && HS.ql) || null, bg, now).run();
    later(req, pushTo(db, cfg, url.origin, NDD.length ? NDD : [HS && HS.ql], { t: s.nv.ten + ' gửi đơn ' + loai.toLowerCase(), b: tu.slice(8) + '/' + tu.slice(5, 7) + (den !== tu ? ' – ' + den.slice(8) + '/' + den.slice(5, 7) : '') + (ly ? ' · ' + ly : ''), u: '/?tab=don', tag: so })); // 16/11: thông báo đẩy
    return json({ ok: true, so });
  }
  /* ----- 11/11 15:32: quản lý trực tiếp duyệt đơn trên app · sơ đồ tổ chức · ảnh đại diện · đổi mã PIN ----- */
  if (p === '/api/bao-sai-ngay' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const ngay = String(body.ngay || ''), nd = String(body.noi_dung || '').trim().slice(0, 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay) || ngay > isoVN(now) || ngay < isoVN(now - 100 * 864e5)) return bad('Ngày không hợp lệ.'); if (!nd) return bad('Ghi rõ sai thế nào để kế toán kiểm tra.');
    if (body.xoa) { await db.prepare('DELETE FROM bao_sai WHERE ma = ? AND ngay = ?').bind(s.nv.ma, ngay).run(); return json({ ok: true }); }
    await db.prepare('INSERT INTO bao_sai (ma, ngay, noi_dung, tao) VALUES (?, ?, ?, ?) ON CONFLICT(ma, ngay) DO UPDATE SET noi_dung = excluded.noi_dung, tao = excluded.tao').bind(s.nv.ma, ngay, nd, now).run();
    return json({ ok: true });
  }
  // 12/11: người mới tự xác nhận "đã làm xong" việc của chính mình trong hành trình hội nhập (bước có người phụ trách = Người mới)
  if (p === '/api/hoi-nhap' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const hn = await hnOfMa(db, s.nv.ma, demo), sid = String(body.sid || '').slice(0, 20), step = hn && (hn.steps || []).find(x => x.id === sid && x.moi === 'own');
    if (!step) return bad('Việc này không phải việc bạn tự xác nhận trong hành trình hội nhập.'); if (hn.xong) return bad('Hành trình hội nhập của bạn đã hoàn tất.');
    await db.prepare('INSERT INTO hn_xong (ma, sid, x, at) VALUES (?, ?, ?, ?) ON CONFLICT(ma, sid) DO UPDATE SET x = excluded.x, at = excluded.at').bind(s.nv.ma, sid, body.xong ? 1 : 0, now).run();
    return json({ ok: true, list: (await db.prepare('SELECT sid, x, at FROM hn_xong WHERE ma = ?').bind(s.nv.ma).all()).results });
  }
  // 12/11 16:30: nhân viên học trên app – đánh dấu xong bài, nộp bài kiểm tra (máy chủ chấm trắc nghiệm), xác nhận cuối khóa
  if (p === '/api/hoc' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const dt = await dtOfMa(db, s.nv.ma, demo), k = dt && (dt.kh || []).find(x => x.id === String(body.kh || ''));
    if (!k) return bad('Khóa học này không có trong danh sách của bạn.');
    const row = await db.prepare('SELECT du_lieu FROM dt_kq WHERE ma = ? AND kh = ?').bind(s.nv.ma, k.id).first();
    let d = {}; try { d = row ? JSON.parse(row.du_lieu) : {}; } catch (e) { d = {}; }
    d.bai = d.bai || []; d.tests = d.tests || {}; if (!d.bd) d.bd = isoVN(now);
    const loai = String(body.loai || ''), id = String(body.id || '').slice(0, 40); let res = null, dap = null;
    if (loai === 'bai') { const ok = (k.ch || []).some(c => (c.bai || []).some(b => b.id === id)); if (!ok) return bad('Không tìm thấy bài học.'); if (!d.bai.includes(id)) d.bai.push(id); }
    else if (loai === 'kt') {
      const t = (k.tests || []).find(x => x.id === id); if (!t) return bad('Không tìm thấy bài kiểm tra.');
      const cd = k.cd || {}, old = d.tests[id], lanMax = +cd.lan || 0;
      if (old && lanMax && old.lan >= lanMax) return bad('Bạn đã làm đủ ' + lanMax + ' lần cho bài kiểm tra này.');
      const ans = {}; for (const q of t.cau || []) { const a = (body.ans || {})[q.id]; ans[q.id] = q.loai === 'tl' ? String(a || '').slice(0, 3000) : (Array.isArray(a) ? a.map(Number).filter(x => x >= 0 && x < (q.pa || []).length) : []); }
      res = dtScore(t, ans);
      const keep = old && cd.lay !== 'cuoi' && !res.wait && !old.wait && old.pct > res.pct;
      d.tests[id] = keep ? { ...old, lan: old.lan + 1 } : { ans, pct: res.pct, wait: res.wait ? 1 : 0, lan: (old ? old.lan : 0) + 1, at: isoVN(now) };
      if (cd.dapan !== false) { dap = {}; for (const q of t.cau || []) if (q.loai !== 'tl') dap[q.id] = q.dung || []; }
    } else if (loai === 'xn') { d.xn = body.bo ? '' : isoVN(now); }
    else return bad('Thao tác không hợp lệ.');
    await db.prepare('INSERT INTO dt_kq (ma, kh, du_lieu, at) VALUES (?, ?, ?, ?) ON CONFLICT(ma, kh) DO UPDATE SET du_lieu = excluded.du_lieu, at = excluded.at').bind(s.nv.ma, k.id, JSON.stringify(d), now).run();
    return json({ ok: true, kq: d, res, dap });
  }
  if (p === '/api/duyet-don' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const so = String(body.so || ''), ok = !!body.dong_y, ly = String(body.ly_do || '').trim().slice(0, 300); if (!ok && !ly) return bad('Ghi lý do từ chối để nhân viên biết.');
    if (so.startsWith('XM-')) { // 16/11: đơn xin đi muộn / về sớm – cùng người duyệt với đơn nghỉ
      const x0 = await db.prepare('SELECT so, ma, ngay, kieu, duyet_ma, trang_thai, nguoi_duyet FROM xin_muon WHERE so = ?').bind(so).first();
      if (!x0) return bad('Không tìm thấy đơn này.');
      if (x0.trang_thai !== 'Chờ duyệt') return bad('Đơn này đã được ' + (x0.nguoi_duyet || 'người khác') + ' xử lý: ' + String(x0.trang_thai).toLowerCase() + '.');
      if (!duocDuyet(await hsLite(db, demo), s.nv.ma, x0)) return bad('Đơn này không thuộc quyền duyệt của anh/chị.');
      const r = await db.prepare("UPDATE xin_muon SET trang_thai = ?, nguoi_duyet = ?, ngay_duyet = ?, ly_do_tc = ?, cap_nhat = ? WHERE so = ? AND trang_thai = 'Chờ duyệt'").bind(ok ? 'Đã duyệt' : 'Từ chối', s.nv.ten, isoVN(now), ok ? null : ly, now, so).run();
      if (!r.meta.changes) return bad('Đơn này vừa được người khác xử lý.');
      later(req, pushTo(db, cfg, url.origin, [x0.ma], { t: 'Đơn xin ' + (x0.kieu === 'muon' ? 'đi muộn' : 'về sớm') + ' ' + (ok ? 'đã được duyệt' : 'bị từ chối'), b: x0.ngay.slice(8) + '/' + x0.ngay.slice(5, 7) + ' · ' + s.nv.ten + (ok ? '' : ': ' + ly), u: '/?tab=don', tag: so }));
      return json({ ok: true, nguoi: s.nv.ten });
    }
    const d0 = await db.prepare('SELECT so, ma, duyet_ma, trang_thai, nguoi_duyet, loai, tu FROM don WHERE so = ?').bind(so).first();
    if (!d0) return bad('Không tìm thấy đơn này.');
    if (d0.trang_thai !== 'Chờ duyệt') return bad('Đơn này đã được ' + (d0.nguoi_duyet || 'người khác') + ' xử lý: ' + String(d0.trang_thai).toLowerCase() + '.');
    if (!duocDuyet(await hsLite(db, demo), s.nv.ma, d0)) return bad('Đơn này không thuộc quyền duyệt của anh/chị.');
    // nhiều người cùng có quyền: ai bấm trước thì đơn chuyển trạng thái và ghi tên người đó; người bấm sau nhận thông báo đã xử lý
    const r = await db.prepare("UPDATE don SET trang_thai = ?, nguoi_duyet = ?, ngay_duyet = ?, ly_do_tc = ?, cap_nhat = ? WHERE so = ? AND trang_thai = 'Chờ duyệt'").bind(ok ? 'Đã duyệt' : 'Từ chối', s.nv.ten, isoVN(now), ok ? null : ly, now, so).run();
    if (r.meta.changes) later(req, pushTo(db, cfg, url.origin, [d0.ma], { t: 'Đơn ' + String(d0.loai || 'nghỉ').toLowerCase() + ' ' + (ok ? 'đã được duyệt' : 'bị từ chối'), b: String(d0.tu || '').slice(8) + '/' + String(d0.tu || '').slice(5, 7) + ' · ' + s.nv.ten + (ok ? '' : ': ' + ly), u: '/?tab=don', tag: so }));
    return r.meta.changes ? json({ ok: true, nguoi: s.nv.ten }) : bad('Đơn này vừa được người khác xử lý.');
  }
  if (p === '/api/bo-phan') { // 13/11: Bộ phận của tôi – những người mình có quyền duyệt đơn: hôm nay ai đi làm / nghỉ / chưa chấm, đơn, bảng công tháng (chỉ xem)
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const BY = await hsLite(db, demo), me = s.nv.ma, act = {}; (await db.prepare('SELECT ma FROM nv WHERE active = 1').all()).results.forEach(x => { act[x.ma] = 1; });
    const tv = Object.keys(BY).filter(k => act[k] && nguoiDuyet(BY, k).includes(me)).sort((a, b) => (BY[a].pb || '').localeCompare(BY[b].pb || '', 'vi') || (BY[b].truong - BY[a].truong) || BY[a].ten.localeCompare(BY[b].ten, 'vi')).slice(0, 80);
    if (!tv.length) return json({ ok: true, ds: [], don_cho: [], don_xong: [], cong: null });
    const ph = tv.map(() => '?').join(','), today = isoVN(now), d0 = vnDayStart(now), pun = {}, nghi = {}, av = {};
    (await db.prepare(`SELECT ma, t, loai FROM cham WHERE (huy IS NULL OR huy = 0) AND t >= ? AND t < ? AND ma IN (${ph}) ORDER BY t`).bind(d0, d0 + 864e5, ...tv).all()).results.forEach(r => { const x = pun[r.ma] = pun[r.ma] || {}; if (r.loai === 'vao' && !x.vao) x.vao = vnHM(r.t); if (r.loai === 'ra') x.ra = vnHM(r.t); });
    (await db.prepare(`SELECT ma, loai FROM don WHERE trang_thai = 'Đã duyệt' AND tu <= ? AND den >= ? AND ma IN (${ph})`).bind(today, today, ...tv).all()).results.forEach(r => { nghi[r.ma] = r.loai; });
    if (demo) tv.forEach(ma => { const e = demoFind(ma); if (e && !pun[ma] && !nghi[ma]) { const sy = demoSynDay(e, today), hm = v => String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); if (sy && now >= dayT(today, sy.vao)) pun[ma] = { vao: hm(sy.vao), ra: now >= dayT(today, sy.ra) ? hm(sy.ra) : '' }; } }); // bản thử: giờ vào/ra mẫu của hôm nay theo đúng công thức dữ liệu mẫu
    if (demo) tv.forEach(ma => { const e = demoFind(ma); if (e && !nghi[ma]) { const d = (e.don || []).find(x => x.trang_thai === 'Đã duyệt' && x.tu <= today && today <= x.den); if (d) nghi[ma] = d.loai; } });
    (await db.prepare(`SELECT ma, at FROM anh WHERE ma IN (${ph})`).bind(...tv).all()).results.forEach(x => { av[x.ma] = x.at; });
    const cho = await donChoDuyet(db, BY, me), choMa = {}; cho.forEach(d => { choMa[d.ma] = 1; });
    const xong = (await db.prepare(`SELECT d.so, d.ma, n.ten, d.loai, d.tu, d.den, d.so_ngay, d.trang_thai, d.nguoi_duyet, d.ngay_duyet, d.ly_do_tc FROM don d LEFT JOIN nv n ON n.ma = d.ma WHERE d.trang_thai IN ('Đã duyệt','Từ chối') AND d.ngay_duyet >= ? AND d.ma IN (${ph}) ORDER BY d.cap_nhat DESC LIMIT 15`).bind(isoVN(now - 30 * 864e5), ...tv).all()).results;
    const yms = (await db.prepare(`SELECT DISTINCT ym FROM cong WHERE ma IN (${ph}) ORDER BY ym DESC LIMIT 6`).bind(...tv).all()).results.map(x => x.ym), ymq = String(url.searchParams.get('ym') || ''), ym = yms.includes(ymq) ? ymq : yms[0] || '';
    let cong = null;
    if (ym) { const rows = {}; (await db.prepare(`SELECT ma, du_lieu, chot, xn FROM cong WHERE ym = ? AND ma IN (${ph})`).bind(ym, ...tv).all()).results.forEach(r => { let d = {}; try { d = JSON.parse(r.du_lieu || '{}'); } catch (e) { } rows[r.ma] = { cong: d.cong, huong: d.huong, tam: d.tam ? 1 : 0, ngay: d.ngay || {}, ct: d.ct || {}, xn: r.xn }; }); // 13/11 16:14: ct = chi tiết từng ngày [vào, ra, muộn, sớm, giờ công, tăng ca] để bấm vào ô ngày
      cong = { ym, thang: yms, ds: tv.filter(ma => rows[ma]).map(ma => ({ ma, ten: BY[ma].ten, ...rows[ma] })) }; }
    return json({ ok: true, hom_nay: today, ds: tv.map(ma => ({ ma, ten: BY[ma].ten, pb: BY[ma].pb, cd: BY[ma].cd, truong: BY[ma].truong, anh: av[ma] || 0, vao: (pun[ma] || {}).vao || '', ra: (pun[ma] || {}).ra || '', nghi: nghi[ma] || '', cho: choMa[ma] ? 1 : 0 })), don_cho: cho, don_xong: xong, cong });
  }
  if (p === '/api/to-chuc') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const me = await hsOf(db, s.nv.ma, demo), cty = me && me.cty, by = {};
    for (const r of (await db.prepare('SELECT ma, du_lieu FROM ho_so').all()).results) { try { const d = JSON.parse(r.du_lieu); by[r.ma] = d; } catch (e) { } }
    if (demo) for (const c of DEMO.cty) for (const e of c.ds) if (!by[e.ma] && e.hs) by[e.ma] = e.hs;
    const act = {}; (await db.prepare('SELECT ma FROM nv WHERE active = 1').all()).results.forEach(x => { act[x.ma] = 1; });
    const av = {}; (await db.prepare('SELECT ma, at FROM anh').all()).results.forEach(x => { av[x.ma] = x.at; });
    const list = Object.keys(by).filter(ma => act[ma] && (!cty || by[ma].cty === cty)).map(ma => { const d = by[ma]; return { ma, ten: d.ten, pb: d.pb, cd: d.cd, cv: d.cv || '', ql: d.ql || '', truong: d.truong ? 1 : 0, anh: av[ma] || 0 }; });
    return json({ ok: true, cty: cty || cfg.ten_cty, list });
  }
  if (p === '/api/anh') {
    const s = await session(db, req, 'nv'); if (!s) return new Response('Phiên đăng nhập đã hết', { status: 401 });
    const r = await db.prepare('SELECT data FROM anh WHERE ma = ?').bind(String(url.searchParams.get('ma') || '').toUpperCase()).first(); if (!r) return new Response('', { status: 404 });
    return new Response(Uint8Array.from(atob(r.data), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
  }
  if (p === '/api/anh-dai-dien' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    if (demo) return bad(DEMO_NO);
    if (body.xoa) { await db.prepare('DELETE FROM anh WHERE ma = ?').bind(s.nv.ma).run(); return json({ ok: true }); }
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || '')); if (!m || m[1].length > 160000) return bad('Ảnh không hợp lệ hoặc quá lớn.');
    await db.prepare('INSERT INTO anh (ma, data, at) VALUES (?, ?, ?) ON CONFLICT(ma) DO UPDATE SET data = excluded.data, at = excluded.at').bind(s.nv.ma, m[1], now).run(); return json({ ok: true, at: now });
  }
  if (p === '/api/doi-pin' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    if (demo) return bad('Bản thử dùng chung mã PIN 123456 cho mọi người nên không đổi được. Khi triển khai riêng cho công ty, nhân viên tự đổi mã PIN ở đây.');
    if (s.nv.co_mk) { // 13/11: tài khoản có quyền quản trị – đổi mật khẩu (dùng chung cho app và trang quản trị)
      const cu = String(body.cu || ''), moi = String(body.moi || ''), e = pwBad(moi); if (e) return bad(e);
      const x = await db.prepare('SELECT mk, mk_salt FROM nv WHERE ma = ?').bind(s.nv.ma).first(); if (!x || !await checkPw(cu, x.mk_salt, x.mk)) return bad('Mật khẩu hiện tại chưa đúng.');
      if (await checkPw(moi, x.mk_salt, x.mk)) return bad('Mật khẩu mới cần khác mật khẩu đang dùng.');
      const salt = randHex(16); await db.prepare('UPDATE nv SET mk = ?, mk_salt = ?, mk_doi = NULL WHERE ma = ?').bind(await hashPw(moi, salt), salt, s.nv.ma).run(); return json({ ok: true });
    }
    const cu = String(body.cu || ''), moi = String(body.moi || ''); if (!/^\d{4,8}$/.test(moi)) return bad('Mã PIN mới 4–8 chữ số.');
    const nv = await db.prepare('SELECT pin, salt FROM nv WHERE ma = ?').bind(s.nv.ma).first(); if (!nv || await hashPin(cu, nv.salt) !== nv.pin) return bad('Mã PIN hiện tại chưa đúng.');
    const salt = randHex(16); await db.prepare('UPDATE nv SET pin = ?, salt = ?, pin_doi = ? WHERE ma = ?').bind(await hashPin(moi, salt), salt, now, s.nv.ma).run(); return json({ ok: true });
  }
  /* ----- 0.4.2: nhân viên xem hợp đồng, file kho của chính mình ----- */
  if (p === '/api/hop-dong') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const HS = await hsOf(db, s.nv.ma, demo), i = +url.searchParams.get('i'), h = HS && (HS.hop_dong || [])[i]; if (!h || !h.html) return bad('Chưa có nội dung hợp đồng này trên máy chủ.');
    return json({ ok: true, so: h.so, loai: h.loai, html: h.html });
  }
  if (p === '/api/kho-file') {
    const s = await session(db, req, 'nv'); if (!s) return new Response('Phiên đăng nhập đã hết', { status: 401 });
    const fid = String(url.searchParams.get('id') || ''), dl = url.searchParams.get('dl') === '1';
    if (demo && fid.startsWith('mau-' + s.nv.ma + '-')) { const e = demoFind(s.nv.ma), HS = await hsOf(db, s.nv.ma, demo), x = HS && demoScans(s.nv.ma, HS).find(z => z.id === fid); if (!x) return new Response('Không tìm thấy file', { status: 404 });
      return new Response(demoScanSvg(x, HS.ten || s.nv.ten, e ? e.cty : ''), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'content-disposition': (dl ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(x.ten), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } }); }
    const f = await db.prepare('SELECT ten, loai, data FROM kho_file WHERE id = ? AND ma = ?').bind(fid, s.nv.ma).first(); if (!f) return new Response('Không tìm thấy file', { status: 404 });
    const bin = Uint8Array.from(atob(f.data), c => c.charCodeAt(0)), safe = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(f.loai || '') ? f.loai : 'application/octet-stream';
    return new Response(bin, { headers: { 'content-type': safe, 'content-disposition': (safe === 'application/octet-stream' || dl ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(f.ten || 'file'), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
  }
  /* ----- 0.4.2: nhân viên khối sản xuất đăng ký ca trong kỳ đang mở (trước hạn đăng ký) ----- */
  if (p === '/api/dang-ky-ca' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const LC = lichCfg(cfg), t0 = isoVN(now); if (!LC || LC.mode !== 'nv' || !(LC.sx || []).includes(s.nv.ma)) return bad('Đơn vị chưa mở đăng ký lịch làm cho anh/chị.');
    const d = body.d || {}, st = []; let n = 0;
    for (const iso of Object.keys(d).slice(0, 62)) {
      if (!ISO_RE.test(iso)) continue; const k = LC.mo.find(x => x.a <= iso && iso <= x.b && x.han >= t0); if (!k) return bad('Ngày ' + iso.slice(8) + '/' + iso.slice(5, 7) + ' không thuộc kỳ đang mở đăng ký hoặc đã quá hạn.');
      const code = String(d[iso] || '').slice(0, 40); if (!lichCodeOk(LC, code)) return bad('Ca "' + code + '" không có trong thiết lập của đơn vị.'); const cf = lichConf(LC, code); if (cf) return bad('Ngày ' + iso.slice(8) + '/' + iso.slice(5, 7) + ': ' + cf + ' – bỏ bớt 1 ca.');
      st.push(code ? db.prepare('INSERT INTO dk_ca (ma, ngay, ca, ky, t) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ma, ngay) DO UPDATE SET ca = excluded.ca, ky = excluded.ky, t = excluded.t').bind(s.nv.ma, iso, code, k.key, now) : db.prepare('DELETE FROM dk_ca WHERE ma = ? AND ngay = ?').bind(s.nv.ma, iso)); n++;
    }
    if (st.length) await db.batch(st); return json({ ok: true, n });
  }
  if (p === '/api/phieu-xem' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    await db.prepare('UPDATE phieu SET xem_at = ? WHERE ym = ? AND ma = ? AND xem_at IS NULL').bind(now, String(body.ym || ''), s.nv.ma).run();
    return json({ ok: true });
  }
  if (p === '/api/phieu-hoi' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const ym = String(body.ym || ''), dong = String(body.dong || '').trim().slice(0, 120), nd = String(body.noi_dung || '').trim().slice(0, 300);
    if (!nd) return bad('Ghi rõ thắc mắc để kế toán kiểm tra.');
    const row = await db.prepare('SELECT hoi FROM phieu WHERE ym = ? AND ma = ?').bind(ym, s.nv.ma).first(); if (!row) return bad('Không có phiếu lương tháng này.');
    const a = JSON.parse(row.hoi || '[]'); if (a.length >= 20) return bad('Đã gửi nhiều câu hỏi – liên hệ trực tiếp kế toán.');
    a.push({ t: now, dong, nd });
    await db.prepare('UPDATE phieu SET hoi = ? WHERE ym = ? AND ma = ?').bind(JSON.stringify(a), ym, s.nv.ma).run();
    return json({ ok: true });
  }
  if (p === '/api/xac-nhan-cong' && req.method === 'POST') {
    const s = await session(db, req, 'nv'); if (!s) return bad('Phiên đăng nhập đã hết. Đăng nhập lại.', 401);
    const ym = String(body.ym || ''), dong_y = !!body.dong_y, ph = String(body.phan_hoi || '').trim().slice(0, 500);
    if (!dong_y && !ph) return bad('Ghi rõ ngày nào sai, sai thế nào để kế toán kiểm tra.');
    const r = await db.prepare('UPDATE cong SET xn = ?, xn_at = ?, phan_hoi = ? WHERE ym = ? AND ma = ?').bind(dong_y ? 1 : 2, now, ph, ym, s.nv.ma).run();
    return r.meta.changes ? json({ ok: true }) : bad('Không có công tháng này.');
  }

  /* ----- màn hình chung ----- */
  if (p === '/api/tram/kich-hoat' && req.method === 'POST') {
    if (!await sess('ql')) return bad('Cần đăng nhập quản lý.', 401);
    if (demo) return json({ ok: true });
    return json({ ok: true }, 200, { 'set-cookie': await newSession(db, 'tram', null, req) });
  }
  if (p === '/api/tram') {
    const s = await sess('tram');
    if (!s) return bad('Trang Mã QR chấm công chưa kích hoạt trên thiết bị này.', 401);
    if (ip) {
      const row = await db.prepare('SELECT last FROM ip_vp WHERE ip = ?').bind(ip).first();
      if (!row) await db.prepare("INSERT INTO ip_vp (ip, nguon, first, last) VALUES (?, 'tram', ?, ?)").bind(ip, now, now).run();
      else if (now - row.last > 60e3) await db.prepare('UPDATE ip_vp SET last = ? WHERE ip = ?').bind(now, ip).run();
      if (now - Number(cfg.tram_last || 0) > 60e3) await setCfg(db, { tram_last: now, tram_ip: ip });
    }
    const w = Math.floor(now / QR_STEP);
    const link = url.origin + '/q?t=' + await qrToken(cfg.qr_secret, w);
    const d0 = vnDayStart(now);
    const list = (await punchesBetween(db, d0, d0 + 864e5)).filter(r => !r.huy);
    const byNv = {};
    list.forEach(r => { const o = byNv[r.ma] || (byNv[r.ma] = { ma: r.ma, ten: r.ten || r.ma, luot: [] }); o.luot.push({ t: r.t, loai: r.loai, cach: r.cach }); });
    const vuaCham = list.filter(r => now - r.t < 90e3 && r.t <= now).slice(-3).reverse().map(r => ({ ten: r.ten || r.ma, t: r.t, loai: r.loai, cach: r.cach }));
    const nvCount = (await db.prepare('SELECT COUNT(*) AS n FROM nv WHERE active = 1').first()).n;
    return json({ ok: true, demo, ten_cty: cfg.ten_cty, che_do: cfg.che_do, ip, ip_loai: ipKind(ip), now, het_han: (w + 1) * QR_STEP, qr: cfg.che_do === 'chi_wifi' ? null : qrSvg(link), hom_nay: Object.values(byNv).sort((a, b) => b.luot[b.luot.length - 1].t - a.luot[a.luot.length - 1].t), vua_cham: vuaCham, so_nv: nvCount, ...(env.DEV === '1' ? { _link: link } : {}) });
  }

  /* ----- quản lý ----- */
  if (p.startsWith('/api/ql/')) {
    if (!await sess('ql')) return bad('Cần đăng nhập quản lý.', 401);
    const r = p.slice(8);
    if (demo && (r === 'cfg' || r === 'xoa-du-lieu' || (r === 'nv' && !(body.go_thiet_bi || body.mo_khoa) && req.method === 'POST'))) return bad(DEMO_NO, 403);
    if (r === 'tong-quan') {
      const ngay = String(url.searchParams.get('ngay') || '');
      let d0 = vnDayStart(now);
      const mm = ngay.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (mm) d0 = Date.UTC(+mm[3], +mm[2] - 1, +mm[1]) - VN;
      const [nv, cham, tc, ph] = await Promise.all([
        db.prepare('SELECT ma, ten, active, lock_until, pb, ncc, nguon, cty, (pin IS NOT NULL) AS co_pin FROM nv ORDER BY cty, ma').all(),
        punchesBetween(db, d0, d0 + 864e5),
        db.prepare('SELECT * FROM tu_choi ORDER BY t DESC LIMIT 100').all(),
        db.prepare("SELECT ma, tb, last FROM phien WHERE vai = 'nv'").all()
      ]);
      const tb = {}; ph.results.forEach(x => { (tb[x.ma] = tb[x.ma] || []).push(x.tb + ' (' + fmtShort(x.last) + ')'); });
      const ips = await officeIPs(db, cfg, now);
      const may_chung = await sharedDevices(db);
      const { ql_pin, ql_salt, qr_secret, ql_fail, ql_lock, schema_v, sync_key, vapid_jwk, mail_key, ...pub } = cfg; pub.ket_noi = !!sync_key;
      return json({ ok: true, demo, ngay0: d0, now, ip, ip_loai: ipKind(ip), wifi: matchOffice(ip, ips), cfg: pub, nv: nv.results.map(x => ({ ...x, thiet_bi: tb[x.ma] || [], khoa: x.lock_until > now })), cham, tu_choi: tc.results, ip_vp: ips, may_chung, may_toi: req.may });
    }
    if (r === 'nv' && req.method === 'POST') {
      const ma = String(body.ma || '').trim().toUpperCase(), ten = String(body.ten || '').trim().slice(0, 120);
      if (!/^[A-Z0-9._-]{1,20}$/.test(ma)) return bad('Mã nhân viên chỉ gồm chữ, số, dấu chấm, gạch (tối đa 20 ký tự).');
      const old = await db.prepare('SELECT ma FROM nv WHERE ma = ?').bind(ma).first();
      if (body.pin !== undefined && body.pin !== '' && !/^\d{4,8}$/.test(String(body.pin))) return bad('Mã PIN nhân viên cần 4–8 chữ số.');
      if (!old) {
        if (!ten) return bad('Nhập họ tên.');
        if (!body.pin) return bad('Đặt mã PIN ban đầu cho nhân viên.');
        const salt = randHex(16);
        await db.prepare('INSERT INTO nv (ma, ten, pin, salt, active, created) VALUES (?, ?, ?, ?, 1, ?)').bind(ma, ten, await hashPin(String(body.pin), salt), salt, now).run();
      } else {
        if (ten) await db.prepare('UPDATE nv SET ten = ? WHERE ma = ?').bind(ten, ma).run();
        if (body.pin) { const salt = randHex(16); await db.prepare('UPDATE nv SET pin = ?, salt = ?, fail = 0, lock_until = 0 WHERE ma = ?').bind(await hashPin(String(body.pin), salt), salt, ma).run(); }
        if (body.active !== undefined) await db.prepare('UPDATE nv SET active = ? WHERE ma = ?').bind(body.active ? 1 : 0, ma).run();
        if (body.mo_khoa) await db.prepare('UPDATE nv SET fail = 0, lock_until = 0 WHERE ma = ?').bind(ma).run();
      }
      if (body.go_thiet_bi || body.pin || body.active === false) await db.prepare("DELETE FROM phien WHERE vai = 'nv' AND ma = ?").bind(ma).run();
      return json({ ok: true });
    }
    if (r === 'ip' && req.method === 'POST') {
      if (body.xoa) { await db.prepare('DELETE FROM ip_vp WHERE ip = ?').bind(String(body.xoa)).run(); return json({ ok: true }); }
      const v = String(body.ip || ip).trim();
      if (!/^[0-9a-fA-F:.]{2,45}$/.test(v)) return bad('IP không hợp lệ.');
      await db.prepare("INSERT INTO ip_vp (ip, nguon, first, last) VALUES (?, 'tay', ?, ?) ON CONFLICT(ip) DO UPDATE SET nguon = 'tay', last = excluded.last").bind(v, now, now).run();
      return json({ ok: true });
    }
    if (r === 'cfg' && req.method === 'POST') {
      const o = {};
      if (['wifi_hoac_qr', 'chi_wifi', 'chi_qr'].includes(body.che_do)) o.che_do = body.che_do;
      if (body.ip_gio !== undefined) o.ip_gio = Math.min(24 * 30, Math.max(1, Number(body.ip_gio) || 72));
      if (body.hien_ip !== undefined) o.hien_ip = body.hien_ip ? '1' : '0';
      if (body.ten_cty) o.ten_cty = String(body.ten_cty).trim().slice(0, 120);
      if (body.pin_moi) { // 13/11: mật khẩu tài khoản quản trị hệ thống dự phòng (tên đăng nhập quantri) – dùng cho trang này và trang quản trị
        const e = pwBad(body.pin_moi); if (e) return bad(e);
        const salt = randHex(16); o.ql_pin = await hashPw(String(body.pin_moi), salt); o.ql_salt = salt;
      }
      if (body.doi_qr) o.qr_secret = randHex(32);
      let maKetNoi = null; if (body.tao_ma_ket_noi) { maKetNoi = 'QTT-' + randHex(12).toUpperCase(); o.sync_key = await sha256(maKetNoi); o.sync_at = String(now); }
      if (Object.keys(o).length) await setCfg(db, o);
      if (body.pin_moi) await db.prepare("DELETE FROM phien WHERE vai = 'ql'").run();
      return json({ ok: true, dang_xuat: !!body.pin_moi, ma_ket_noi: maKetNoi });
    }
    if (r === 'cham' && req.method === 'POST') {
      if (body.huy) { await db.prepare('UPDATE cham SET huy = ?, ghi = COALESCE(ghi, \'\') || ? WHERE id = ?').bind(body.khoi_phuc ? 0 : 1, body.khoi_phuc ? '' : ' [Hủy ' + fmtShort(now) + ']', Number(body.huy)).run(); return json({ ok: true }); }
      const ma = String(body.ma || '').toUpperCase(), m1 = String(body.ngay || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/), m2 = String(body.gio || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m1 || !m2) return bad('Ngày dạng dd/mm/yyyy, giờ dạng HH:MM.');
      if (!String(body.ghi || '').trim()) return bad('Ghi lý do chấm bổ sung (vd: quên chấm, có xác nhận của quản lý).');
      if (!await db.prepare('SELECT ma FROM nv WHERE ma = ?').bind(ma).first()) return bad('Không có nhân viên này.');
      const t = Date.UTC(+m1[3], +m1[2] - 1, +m1[1], +m2[1], +m2[2]) - VN;
      await db.prepare("INSERT INTO cham (ma, t, loai, cach, ip, wifi, tb, ghi, nguoi) VALUES (?, ?, ?, 'tay', ?, 0, ?, ?, 'Quản lý')").bind(ma, t, body.loai === 'ra' ? 'ra' : 'vao', ip, shortUA(req.headers.get('user-agent')), String(body.ghi).trim().slice(0, 200)).run();
      return json({ ok: true });
    }
    if (r === 'xuat') {
      const th = String(url.searchParams.get('thang') || '').match(/^(\d{2})\/(\d{4})$/);
      if (!th) return bad('Tháng dạng mm/yyyy.');
      const from = Date.UTC(+th[2], +th[1] - 1, 1) - VN, to = Date.UTC(+th[2], +th[1], 1) - VN;
      const rows = await punchesBetween(db, from, to);
      const esc = v => { v = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const CACH = { wifi: 'Wi-Fi', qr: 'QR', tay: 'Nhập tay' };
      const shared = {}; (await sharedDevices(db)).forEach(d => { if (!d.bo_qua) shared[d.may] = d.nv; });
      const lines = [['Mã NV', 'Họ tên', 'Ngày', 'Giờ', 'Loại', 'Cách chấm', 'IP', 'Thiết bị', 'Mã máy', 'Cảnh báo', 'Ghi chú', 'Trạng thái'].join(',')];
      rows.forEach(x => {
        const q = vnParts(x.t), sh = x.may && shared[x.may] ? shared[x.may].filter(o => o.ma !== x.ma) : [];
        lines.push([x.ma, x.ten || '', q.d + '/' + q.m + '/' + q.y, q.h + ':' + q.mi + ':' + q.s, x.loai === 'ra' ? 'Ra' : 'Vào', CACH[x.cach] || x.cach, x.ip, x.tb, x.may ? x.may.slice(0, 6) : '', sh.length ? 'Máy dùng chung với ' + sh.map(o => o.ma).join(', ') : '', x.ghi, x.huy ? 'Đã hủy' : 'Hợp lệ'].map(esc).join(','));
      });
      return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="Cham_cong_' + th[2] + '_' + th[1] + '.csv"', 'cache-control': 'no-store' } });
    }
    if (r === 'may' && req.method === 'POST') {
      const may = String(body.may || '');
      if (!/^[0-9a-f]{12,32}$/.test(may)) return bad('Mã máy không hợp lệ.');
      if (body.bat_lai) await db.prepare('DELETE FROM may_bo_qua WHERE may = ?').bind(may).run();
      else await db.prepare('INSERT INTO may_bo_qua (may, ghi, t) VALUES (?, ?, ?) ON CONFLICT(may) DO UPDATE SET ghi = excluded.ghi, t = excluded.t').bind(may, String(body.ghi || '').trim().slice(0, 200) || 'Đã kiểm tra', now).run();
      return json({ ok: true });
    }
    if (r === 'xoa-du-lieu' && req.method === 'POST') {
      if (body.xac_nhan !== 'XOA') return bad('Gõ XOA để xác nhận.');
      await db.batch([db.prepare('DELETE FROM cham'), db.prepare('DELETE FROM tu_choi')]);
      return json({ ok: true });
    }
  }
  return bad('Không có địa chỉ này.', 404);
}
function fmtShort(t) { const q = vnParts(t); return q.h + ':' + q.mi + ' ' + q.d + '/' + q.m; }

/* ---------- trang ---------- */
// 16/11/2026: service worker CHỈ để nhận thông báo đẩy – không lưu đệm trang (tránh app cũ)
const SW_JS = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'Chấm công', b: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'Chấm công', { body: d.b || '', icon: '/icon.png', badge: '/icon.png', tag: d.tag || undefined, data: { u: d.u || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const u = new URL((e.notification.data && e.notification.data.u) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => { for (const w of ws) { if (w.url.startsWith(self.location.origin)) return w.focus().then(c => c && c.navigate ? c.navigate(u) : c).catch(() => self.clients.openWindow(u)); } return self.clients.openWindow(u); }));
});`;
async function brCfg(env) { try { await ensureSchema(env.DB); return await getCfg(env.DB); } catch (e) { return {}; } } // 16/11/2026: thương hiệu riêng (br_ten, br_logo) lưu từ Cài đặt → Thương hiệu
function brJs(c) { return JSON.stringify({ name: c.br_ten || '', logo: c.br_logo ? '/logo.' + ((/^data:image\/(png|webp|jpeg|svg\+xml)/.exec(c.br_logo) || [])[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg') : '', cty: c.ten_cty || '' }).replace(/</g, '\\u003c'); }
function htmlEsc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
const MANIFEST = JSON.stringify({ name: 'Chấm công', short_name: 'Chấm công', start_url: '/', scope: '/', display: 'standalone', background_color: '#F4EFE5', theme_color: '#2F7D4F', icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] });
function b64ToBytes(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };

export default {
  async scheduled(ev, env, ctx) { ctx.waitUntil(bcCron(env).catch(e => console.error('bcCron', e))); }, // 16/11: gửi báo cáo định kỳ (cron 15 phút/lần – wrangler.jsonc triggers)
  async fetch(req, env, ctx) {
    const url = new URL(req.url); req.ctx = ctx;
    let may = cookies(req).qtt_may, newMay = false;
    if (!/^[0-9a-f]{16}$/.test(may || '')) { may = randHex(8); newMay = true; }
    req.may = may;
    const withMay = res => { if (newMay) res.headers.append('set-cookie', 'qtt_may=' + may + '; Path=/; Max-Age=' + (2 * 365 * 864e2) + '; HttpOnly; Secure; SameSite=Lax'); return res; };
    try {
      if (url.pathname.startsWith('/api/')) return withMay(await api(req, env, url));
      if (url.pathname === '/sw.js') return new Response(SW_JS, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' } }); // 16/11: thông báo đẩy
      if (url.pathname === '/manifest.webmanifest') { const m = JSON.parse(MANIFEST), c = isDemo(env, url) ? {} : await brCfg(env); const nm = (c.br_ten || c.ten_cty || '').slice(0, 40); if (nm) { m.name = nm; m.short_name = nm.slice(0, 24); } const lg = /^data:image\/(png|webp|jpeg);base64,/.exec(c.br_logo || ''); if (lg) m.icons.unshift({ src: '/logo.' + (lg[1] === 'jpeg' ? 'jpg' : lg[1]), sizes: 'any', type: 'image/' + lg[1] }); return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'max-age=600' } }); }
      if (/^\/logo\.(png|webp|jpg|svg)$/.test(url.pathname)) { const c = await brCfg(env), lg = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(c.br_logo || ''); if (!lg) return new Response('', { status: 404 }); return new Response(b64ToBytes(lg[2]), { headers: { 'content-type': lg[1], 'cache-control': 'max-age=600' } }); }
      if (url.pathname === '/icon.png') return new Response(b64ToBytes(ICON_PNG_B64), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' } });
      if (url.pathname === '/font/tay-latin.woff2' || url.pathname === '/font/tay-vi.woff2') return new Response(b64ToBytes(url.pathname === '/font/tay-vi.woff2' ? TAY_VI : TAY_LATIN), { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=2592000, immutable' } });
      if (url.pathname === '/qr-app.svg') return new Response(qrSvg(url.origin + '/'), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600', 'access-control-allow-origin': '*' } }); // 12/11: mã QR mở app nhân viên (phần mềm hiện ở trang Ứng dụng nhân viên)
      if (url.pathname === '/icon.svg') return new Response(ICON_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' } });
      if (/^\/phan-mem\/?$/.test(url.pathname) && isDemo(env, url)) return new Response(HRM_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
      // 13/11/2026: trang quản trị của đơn vị = Phần mềm quản lý nhân sự toàn diện chạy ngay trên máy chủ này, dữ liệu lưu trên máy chủ (bản thử: chuyển sang /phan-mem dùng dữ liệu mẫu)
      if (/^\/quan-tri\/?$/.test(url.pathname)) {
        if (isDemo(env, url)) return Response.redirect(url.origin + '/phan-mem' + url.search, 302);
        const sv = '<script>window.QTT_SV=' + JSON.stringify({ v: VER, api: '/api/qt/' }) + ';window.QTT_BR=' + brJs(await brCfg(env)) + ';</script>';
        return withMay(new Response(HRM_HTML.replace(/<head([^>]*)>/i, m => m + sv), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC } }));
      }
      if (/^\/og-(ql|nv)\.jpg$/.test(url.pathname) && isDemo(env, url)) return new Response(b64ToBytes(url.pathname === '/og-ql.jpg' ? OG_QL_B64 : OG_NV_B64), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' } });
      if (/^\/tuyen-dung(\/|$)/.test(url.pathname) && !isDemo(env, url)) { await ensureSchema(env.DB); const r = await tdTrang(env.DB, url); if (r) return r; } // 17/11: cổng tuyển dụng của công ty
      const ROUTES = { '/': 'nv', '/q': 'q', '/tram': 'tram', '/quan-ly': 'ql' };
      const route = ROUTES[url.pathname.replace(/\/+$/, '') || '/'];
      if (!route) return new Response('Không có trang này', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      let html = APP_HTML.replace('{{ROUTE}}', route).replace(/{{VER}}/g, VER);
      if (!isDemo(env, url)) { const c = await brCfg(env), nm = (c.br_ten || c.ten_cty || '').slice(0, 40), lg = /^data:image\/(png|webp|jpeg|svg\+xml);base64,/.exec(c.br_logo || ''); if (nm) html = html.replace('<title>Chấm công</title>', '<title>' + htmlEsc(nm) + '</title>').replace('content="Chấm công">', 'content="' + htmlEsc(nm.slice(0, 24)) + '">'); if (lg) { const ext = lg[1] === 'jpeg' ? 'jpg' : lg[1] === 'svg+xml' ? 'svg' : lg[1]; html = html.replace('<link rel="icon" href="/icon.svg" type="image/svg+xml">', '<link rel="icon" href="/logo.' + ext + '">'); } html = html.replace('</head>', '<script>window.QTT_BR=' + brJs(c) + ';</script>\n</head>'); } // 16/11/2026: thương hiệu riêng
      // 08/11: thẻ chia sẻ (tiêu đề + ảnh) khi dán link bản chạy thử lên Facebook/Zalo – chỉ ở bản thử, máy chủ của công ty không có
      if (isDemo(env, url) && (route === 'ql' || route === 'nv')) {
        const og = route === 'ql'
          ? { t: 'Trang quản lý chấm công – bản chạy thử', d: 'Thiết lập mạng Wi‑Fi văn phòng, xem lượt chấm của nhân viên. Dữ liệu mẫu, dùng thử miễn phí – Quản trị tử tế.', i: '/og-ql.jpg', u: '/quan-ly' }
          : { t: 'App cho nhân viên – bản chạy thử', d: 'Chấm công, xem công từng ngày, gửi đơn nghỉ cho quản lý duyệt, xem lương cả năm, hồ sơ của mình – ngay trên điện thoại. Dữ liệu mẫu, dùng thử miễn phí – Quản trị tử tế.', i: '/og-nv.jpg?v=0511', u: '/' };
        const o = url.origin;
        html = html.replace('<title>Chấm công</title>', '<title>' + og.t + '</title>\n<meta name="description" content="' + og.d + '">\n<meta property="og:type" content="website">\n<meta property="og:site_name" content="Quản trị tử tế">\n<meta property="og:title" content="' + og.t + '">\n<meta property="og:description" content="' + og.d + '">\n<meta property="og:url" content="' + o + og.u + '">\n<meta property="og:image" content="' + o + og.i + '?v=0811">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:locale" content="vi_VN">\n<meta name="twitter:card" content="summary_large_image">');
      }
      return withMay(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC } }));
    } catch (e) {
      return json({ ok: false, loi: 'Lỗi máy chủ: ' + (e && e.message || e) }, 500);
    }
  }
};
