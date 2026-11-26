// One approved catalog, one management unit. No employee or transaction import.
export const ASSET_TARGET = 'unit:umwlvah146e7w';
export const APPROVED_ASSETS_HASH = 'd95e11c307ceaaf8727437e3ce290768d4fcca4414c43abf618f464505d06e14';
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function stop(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function base64(bytes) {
  let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}
export async function encodeUnit(unit) {
  const bytes = new TextEncoder().encode(JSON.stringify(unit));
  return base64(new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()));
}
export async function decodeUnit(text, compressed) {
  if (compressed) {
    const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
    text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return JSON.parse(text);
}
export async function catalogSnapshot(db) {
  // A read batch gives metadata and parts from one consistent transaction.
  const [meta, parts] = await db.batch([
    db.prepare("SELECT * FROM qt_kv WHERE k LIKE 'unit:%' ORDER BY k"),
    db.prepare("SELECT k,i,v FROM qt_part WHERE k LIKE 'unit:%' ORDER BY k,i")
  ]);
  if (meta.results.length > 40) stop('Cần rà soát phạm vi đơn vị trước khi nhập.');
  const entries = [];
  for (const row of meta.results) {
    const chunks = parts.results.filter(p => p.k === row.k);
    if (chunks.length !== row.n || chunks.some((p, i) => p.i !== i)) stop('Dữ liệu công ty thiếu phần; dừng nhập.');
    const text = chunks.map(p => p.v).join('');
    entries.push({ meta: row, text, unit: await decodeUnit(text, row.z) });
  }
  if (parts.results.some(p => !entries.some(e => e.meta.k === p.k))) stop('Phần dữ liệu không có metadata.');
  const token = await digest(entries.map(e => ({ meta: e.meta, text: e.text })));
  return { entries, token };
}
export async function writeAtomic(db, snapshot, unit, actor, targetKey = ASSET_TARGET, metadata = undefined) {
  const old = snapshot.entries.find(e => e.meta.k === targetKey), version = old.meta.ver + 1;
  const text = await encodeUnit(unit), chunks = text.match(/.{1,400000}/g), nonce = crypto.randomUUID();
  const writer = String(actor || 'Quản trị viên').slice(0, 100) + ' · QLTS ' + nonce;
  const sameVersions = snapshot.entries.map(() => '(k=? AND ver=?)').join(' OR ');
  // Guard every unit, including the set of keys, so a concurrent import into
  // another company cannot invalidate the global duplicate check.
  const update = db.prepare(`UPDATE qt_kv SET ver=?,at=?,nguoi=?,n=?,z=1,size=?,meta=COALESCE(?,meta) WHERE k=? AND ver=?
    AND (SELECT COUNT(*) FROM qt_kv WHERE k LIKE 'unit:%')=?
    AND (SELECT COUNT(*) FROM qt_kv WHERE ${sameVersions})=?`).bind(
    version, Date.now(), writer, chunks.length, text.length, metadata === undefined ? null : metadata, targetKey, old.meta.ver,
    snapshot.entries.length, ...snapshot.entries.flatMap(e => [e.meta.k, e.meta.ver]), snapshot.entries.length);
  const guard = 'EXISTS(SELECT 1 FROM qt_kv WHERE k=? AND ver=? AND nguoi=?)';
  const statements = [update, db.prepare('DELETE FROM qt_part WHERE k=? AND ' + guard).bind(targetKey, targetKey, version, writer)];
  chunks.forEach((chunk, i) => statements.push(db.prepare('INSERT INTO qt_part(k,i,v) SELECT ?,?,? WHERE ' + guard).bind(targetKey, i, chunk, targetKey, version, writer)));
  // Never split this into several batches: all parts and metadata are atomic.
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) stop('Dữ liệu vừa thay đổi; đọc lại và lập preview mới. Không force.');
  return version;
}
function rowForHash(row) { const x = structuredClone(row); delete x.qltsImport.recordHash; return x; }
function validateTarget(body, user) {
  if (!user?.sys) stop('Chỉ quản trị hệ thống được chuẩn bị hoặc áp danh mục QLTS.', 403);
  if (body.target !== ASSET_TARGET) stop('Chỉ áp danh mục vào đơn vị quản lý KSB đã được duyệt.', 400);
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(body.batchId || '')) stop('Thiếu mã đợt nhập hợp lệ.', 400);
}
export async function assetCatalogAPI(db, user, body) {
  validateTarget(body, user);
  const action = body.action || 'preview';
  if (!['preview', 'apply', 'preview-undo', 'undo'].includes(action)) stop('Thao tác không hợp lệ.', 400);
  const snapshot = await catalogSnapshot(db), target = snapshot.entries.find(e => e.meta.k === ASSET_TARGET);
  if (!target || target.unit.id !== ASSET_TARGET.slice(5)) stop('Không tìm thấy đúng đơn vị KSB.');
  const unit = structuredClone(target.unit), T = unit.ts || { v: 0, ds: [], pg: [], nhom: [], so: { giao: 0, thu: 0 } };
  T.ds ||= []; T.pg ||= [];
  const undo = action.endsWith('undo'); let added = [], removed = [], skipped = [], conflicts = [];
  if (!undo) {
    if (!Array.isArray(body.assets) || body.assets.length !== 82 || await digest(body.assets) !== APPROVED_ASSETS_HASH)
      stop('Gói 82 tài sản khác bản đã nghiệm thu; cần đối chiếu và duyệt lại.', 400);
    const codes = new Set(), ids = new Set();
    for (const approved of body.assets) {
      if (codes.has(approved.ma) || ids.has(approved.id)) stop('Trùng mã hoặc ID trong gói nhập.');
      codes.add(approved.ma); ids.add(approved.id);
      const found = snapshot.entries.flatMap(e => (e.unit.ts?.ds || []).filter(x => x.ma === approved.ma || x.id === approved.id).map(x => ({ key: e.meta.k, x })));
      if (found.length) {
        if (found.length !== 1 || found[0].key !== ASSET_TARGET || found[0].x.ma !== approved.ma || found[0].x.id !== approved.id || !found[0].x.qltsImport?.batchId)
          conflicts.push({ code: approved.ma, units: found.map(x => x.key) });
        else skipped.push(approved.ma);
        continue;
      }
      const x = structuredClone(approved);
      // Management storage is confirmed, legal ownership remains unknown.
      x.legalOwner = ''; x.phongBan = ''; x.giu = ''; x.giuTu = '';
      Object.assign(x.qltsImport, { managementUnit: ASSET_TARGET, batchId: body.batchId, ownershipConfirmed: false });
      x.qltsImport.recordHash = await digest(x);
      added.push(x);
    }
    if (T.ds.some(x => x.qltsImport?.batchId === body.batchId) && added.length) stop('Mã đợt nhập đã dùng; không bổ sung vào đợt cũ.');
  } else {
    removed = T.ds.filter(x => x.qltsImport?.batchId === body.batchId);
    for (const x of removed) {
      if (!x.qltsImport.recordHash || await digest(rowForHash(x)) !== x.qltsImport.recordHash || x.giu || x.ls?.length)
        stop('Tài sản ' + x.ma + ' đã thay đổi; không tự hoàn tác.');
      if (T.pg.some(p => (p.ds || []).some(r => r.id === x.id || r.ma === x.ma))) stop('Tài sản ' + x.ma + ' đã có phiếu; không tự hoàn tác.');
    }
  }
  const planId = await digest({ target: ASSET_TARGET, snapshot: snapshot.token, batchId: body.batchId, undo, added, removed, skipped, conflicts });
  const summary = { ok: true, target: ASSET_TARGET, batchId: body.batchId, planId, snapshotToken: snapshot.token, version: target.meta.ver,
    add: added.length, remove: removed.length, existing: skipped.length, conflicts, sourceStates: { 'Đang sử dụng': 56, 'Trong kho': 26 }, legalOwner: '', assigned: 0, newVouchers: 0 };
  if (action.startsWith('preview')) return { ...summary, written: false };
  if (body.confirm !== (undo ? 'UNDO_APPROVED_ASSET_BATCH' : 'APPLY_APPROVED_82_ASSETS') || body.planId !== planId)
    stop('Cần xác nhận đúng preview mới nhất trước khi ghi.');
  if (conflicts.length) stop('Có mã tài sản đã tồn tại cần đối chiếu; không ghi đè.');
  if (!added.length && !removed.length) return { ...summary, written: false };
  if (undo) { const ids = new Set(removed.map(x => x.id)); T.ds = T.ds.filter(x => !ids.has(x.id)); }
  else T.ds.push(...added);
  T.v = (T.v || 0) + 1; unit.ts = T; unit.ver = (unit.ver || 0) + 1;
  // Every other field is copied from this current database snapshot, never DEV.
  const version = await writeAtomic(db, snapshot, unit, user.ten);
  return { ...summary, version, written: true };
}
