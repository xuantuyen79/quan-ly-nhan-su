// Tạo cơ sở dữ liệu D1 "quan-ly-nhan-su-db" nếu chưa có, rồi điền database_id vào wrangler.jsonc.
// Gọi từ cai-dat.cmd / cap-nhat.cmd:  node cai-dat.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), cfgPath = join(here, 'wrangler.jsonc');
const cfg = readFileSync(cfgPath, 'utf8');
const NAME = (/"database_name":\s*"([^"]+)"/.exec(cfg) || [])[1] || 'quan-ly-nhan-su-db';
const cur = /"database_id":\s*"([0-9a-f-]{36})"/.exec(cfg);
if (cur && cur[1] !== '00000000-0000-0000-0000-000000000000') { console.log('Cơ sở dữ liệu: ' + NAME + ' (' + cur[1] + ') – đã có'); process.exit(0); }
const run = a => execSync('npx wrangler ' + a, { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: true });
function find() { const o = run('d1 list --json'), a = o.indexOf('['), b = o.lastIndexOf(']'); if (a < 0 || b < a) throw new Error(o); return JSON.parse(o.slice(a, b + 1)).find(d => d.name === NAME); }
let db;
try { db = find(); } catch (e) { console.error('[Lỗi] Chưa hỏi được danh sách cơ sở dữ liệu trên Cloudflare. Chạy lại lệnh, hoặc đăng nhập lại: npx wrangler login'); process.exit(1); }
if (!db) { console.log('Tạo cơ sở dữ liệu ' + NAME + ' ...'); run('d1 create ' + NAME); db = find(); }
if (!db) { console.error('[Lỗi] Không tạo được cơ sở dữ liệu ' + NAME); process.exit(1); }
const id = db.uuid || db.database_id || db.id;
writeFileSync(cfgPath, cfg.replace(/("database_id":\s*")[^"]*(")/, '$1' + id + '$2'));
console.log('Cơ sở dữ liệu: ' + NAME + ' (' + id + ')');
