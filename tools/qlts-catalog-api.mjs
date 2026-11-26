// Operator tool; defaults to a read-only preview. No credentials in source.
import fs from 'node:fs';
import {ASSET_TARGET} from '../src/ksb-asset-import.js';
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) throw Error('Invalid option');
  args.set(k, process.argv[i + 1]?.startsWith('--') || !process.argv[i + 1] ? true : process.argv[++i]);
}
if (args.has('--help')) {
  console.log('Options: --url --assets --batch --action preview|apply|preview-undo|undo --plan --allow-write --production-approved --receipt. Authenticate with KSB_ADMIN_COOKIE in the environment; never paste credentials into chat.');
  process.exit(0);
}
const url = new URL(String(args.get('--url') || 'http://127.0.0.1:8793'));
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
if (url.username || url.password || (!local && url.origin !== 'https://qlns.ksb.vn')) throw Error('Only local or approved QLNS Production origins are allowed.');
if (!local && url.protocol !== 'https:') throw Error('HTTPS required.');
const action = String(args.get('--action') || 'preview'), writes = ['apply', 'undo'].includes(action);
if (!['preview', 'apply', 'preview-undo', 'undo'].includes(action)) throw Error('Invalid action.');
if (writes && (!args.has('--allow-write') || (!local && !args.has('--production-approved')))) throw Error('Writes require explicit flags after Product Owner approval.');
if (!args.get('--assets') || !args.get('--batch')) throw Error('Provide approved assets file and batch ID.');
const cookie = process.env.KSB_ADMIN_COOKIE;
if (!cookie) throw Error('Set the admin session cookie privately in KSB_ADMIN_COOKIE; do not send it to chat.');
if (writes && !args.get('--plan')) throw Error('Provide the plan ID from a fresh preview.');
const response = await fetch(new URL('/api/qt/tai-san-qlts', url), {
  method: 'POST', headers: {'content-type':'application/json',origin:url.origin,cookie},
  body: JSON.stringify({target:ASSET_TARGET,assets:JSON.parse(fs.readFileSync(String(args.get('--assets')))),batchId:args.get('--batch'),action,
    planId:args.get('--plan') || '',confirm:writes ? action === 'undo' ? 'UNDO_APPROVED_ASSET_BATCH' : 'APPLY_APPROVED_82_ASSETS' : ''})
});
const result = await response.json();
if (!response.ok || !result.ok) throw Error(result.loi || 'Import API rejected the request.');
if (args.has('--receipt')) fs.writeFileSync(String(args.get('--receipt')), JSON.stringify(result,null,2), {mode:0o600});
console.log(JSON.stringify(result,null,2));
