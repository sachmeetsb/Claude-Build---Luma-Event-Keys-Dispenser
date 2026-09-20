// Usage: node scripts/import-csv.js path/to/guests.csv [--all]
//   --all  import every row regardless of approval_status
import 'dotenv/config';
import fs from 'node:fs';
import { importRosterFromCsv } from '../lib/roster.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/import-csv.js <guests.csv> [--all]');
  process.exit(1);
}
const r = importRosterFromCsv(fs.readFileSync(file, 'utf8'), { onlyApproved: !process.argv.includes('--all') });
console.log(`imported ${r.count} attendees (${r.skipped} skipped) -> roster source=${r.source}`);
