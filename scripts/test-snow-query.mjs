/**
 * Dump all ServiceNow fields for a specific ASO customer.
 *
 * Usage:
 *   SERVICENOW_AUTH_TOKEN=<base64-user:pass> node scripts/test-snow-query.mjs
 *   SERVICENOW_AUTH_TOKEN=<token> node scripts/test-snow-query.mjs "ASO - Acme Corp"
 *
 * The customer name argument is optional. If omitted, the first active ASO
 * record (alphabetically) is used.
 *
 * The AUTH_TOKEN can be either:
 *   - A raw base64 "user:password" string  →  "Basic " is prepended automatically
 *   - A full "Basic <base64>" string        →  used as-is
 */

const AUTH_TOKEN = process.env.SERVICENOW_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('ERROR: Set SERVICENOW_AUTH_TOKEN env var first.');
  console.error('  export SERVICENOW_AUTH_TOKEN="Basic $(echo -n user:pass | base64)"');
  process.exit(1);
}

const AUTH_HEADER = AUTH_TOKEN.startsWith('Basic ') ? AUTH_TOKEN : `Basic ${AUTH_TOKEN}`;
const BASE_URL = 'https://adobems.service-now.com/api/now/table/core_company';

// Optional: customer name from CLI arg (e.g. "ASO - Acme Corp")
const customerArg = process.argv[2]?.trim() || null;

/** Unwrap a ServiceNow field to a plain string. */
const val = (f) => {
  if (f === null || f === undefined) return '';
  if (typeof f === 'object') return f.display_value ?? f.value ?? JSON.stringify(f);
  return String(f);
};

// Build query — exact name match if provided, otherwise first active ASO record
const query = customerArg
  ? `name=${customerArg}^u_active=true`
  : 'nameSTARTSWITHASO -^u_active=true';

const params = new URLSearchParams({
  sysparm_query: query,
  sysparm_limit: '1',
  sysparm_display_value: 'true',
  sysparm_orderby: 'name',
  // No sysparm_fields — return every field on the record
});

console.log('\n' + '═'.repeat(72));
console.log('ServiceNow core_company — full field dump');
if (customerArg) console.log(`Customer: ${customerArg}`);
else console.log('Customer: first active ASO record (alphabetical)');
console.log('═'.repeat(72));

const res = await fetch(`${BASE_URL}?${params}`, {
  headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
});

if (!res.ok) {
  console.error(`\nHTTP ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const record = data.result?.[0];

if (!record) {
  const hint = customerArg
    ? `\nNo record found for "${customerArg}".\nCheck the exact name (including "ASO - " prefix) in ServiceNow.`
    : '\nNo active ASO records returned.';
  console.error(hint);
  process.exit(1);
}

console.log(`\nRecord name: ${val(record.name)}`);
console.log(`sys_id:      ${val(record.sys_id)}\n`);

// ── All fields, sorted ────────────────────────────────────────────────────────
const allEntries = Object.entries(record)
  .map(([k, v]) => [k, val(v)])
  .sort(([a], [b]) => a.localeCompare(b));

const nonEmpty = allEntries.filter(([, v]) => v !== '' && v !== 'false');
const empty    = allEntries.filter(([, v]) => v === '' || v === 'false');

const maxKey = Math.max(...allEntries.map(([k]) => k.length), 20);

console.log('── Fields with values (' + nonEmpty.length + ') ' + '─'.repeat(40));
for (const [k, v] of nonEmpty) {
  // Highlight custom ASO fields (u_ prefix) in a way that's easy to grep
  const prefix = k.startsWith('u_') ? '* ' : '  ';
  console.log(`${prefix}${k.padEnd(maxKey)}  ${v}`);
}

console.log('\n── Empty / false fields (' + empty.length + ') ' + '─'.repeat(37));
for (const [k] of empty) {
  const prefix = k.startsWith('u_') ? '* ' : '  ';
  console.log(`${prefix}${k}`);
}

console.log(`\nTotal fields: ${allEntries.length}  |  With values: ${nonEmpty.length}  |  Empty: ${empty.length}`);
console.log('(* = custom u_ field — most likely ASO-specific data)\n');
