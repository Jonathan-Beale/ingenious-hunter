// csv.js — small RFC-4180-ish CSV parser (handles quotes, escaped quotes, commas + newlines in
// quoted fields, CRLF). Returns { headers, rows } where each row is an object keyed by header.
// Pure, no deps.

export function parseCSV(text) {
  const s = String(text || '').replace(/^﻿/, ''); // strip BOM
  const records = [];
  let field = '', record = [], inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field); field = '';
    } else if (c === '\n') {
      record.push(field); records.push(record); field = ''; record = [];
    } else if (c === '\r') {
      // handle CRLF and lone CR
      record.push(field); records.push(record); field = ''; record = [];
      if (s[i + 1] === '\n') i++;
    } else field += c;
  }
  // flush trailing field/record if any content
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length === 1 && rec[0].trim() === '') continue; // skip blank lines
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = (rec[c] ?? '').trim();
    rows.push(obj);
  }
  return { headers, rows };
}
