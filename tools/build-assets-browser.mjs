// Browser text companion for the same pure business engine used by Workers.
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/ksb-assets-engine.js',import.meta.url),'utf8');
if(/<\/script/i.test(source))throw new Error('Engine contains an inline script terminator; escape it before embedding.');
const footer='\nwindow.KSBAssets={run:runAssetAction,document:renderAssetDocument,reports:assetReportData,templates:getAssetTemplates,catalogs:getAssetCatalogs,reminders:assetReminders,ledgerExport:assetLedgerExport,eligibility:assetActionEligibility};\n';
fs.writeFileSync(new URL('../src/ksb-assets-engine.txt',import.meta.url),source.replaceAll('export function ','function ')+footer);
