/**
 * Tabular export helpers.
 *
 * ⚠️ CSV, not a real .xlsx. Generating genuine Excel workbooks needs SheetJS,
 * which is well over 100 KB gzipped — the entire app is currently 126 KB
 * against a 170 KB budget (§13.5, task P6-16), so one download button would
 * eat most of the remaining headroom. Excel opens CSV natively, and the
 * clipboard path below pastes straight into a sheet as columns, so the
 * dependency buys nothing a user would notice.
 */

/** Values are stringified, quoted only when they need to be. */
function cell(value: unknown, sep: string): string {
  const s = value === null || value === undefined ? '' : String(value);
  // A field containing the separator, a quote or a newline must be quoted, and
  // embedded quotes doubled. Player display names are free text, so this is
  // not theoretical.
  if (s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toDelimited(headers: string[], rows: unknown[][], sep: ',' | '\t' = ','): string {
  return [headers, ...rows].map((r) => r.map((v) => cell(v, sep)).join(sep)).join('\r\n');
}

/**
 * Saves a CSV file.
 *
 * ⚠️ The BOM is load-bearing. Without it Excel on Windows reads the file as
 * the local codepage and turns every accented name into mojibake — and this
 * product is full of them (Fenerbahçe, Bodø/Glimt, Barça). Notepad and Sheets
 * are fine either way; Excel is not.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the navigation to have started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copies text to the clipboard, falling back for non-secure contexts.
 *
 * `navigator.clipboard` is undefined outside HTTPS and localhost, which is
 * exactly where someone testing from a phone on the LAN would be.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A filename-safe slug plus today's date, so downloads do not collide. */
export function exportFilename(parts: string[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${stamp}`;
}
