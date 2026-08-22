/**
 * Escapes a single CSV cell, guarding against formula injection (CWE-1236):
 * if a cell's content starts with =, +, -, or @, Excel/Google Sheets treats
 * it as a formula when the file is opened. Since patient names, notes, and
 * other free-text fields are fully user-controlled with no character
 * restriction, a malicious value like `=HYPERLINK("http://evil.com","x")`
 * would otherwise execute the moment someone opens an exported report.
 * Prefixing with a single quote forces spreadsheet apps to treat it as
 * literal text instead of evaluating it.
 */
function csvSafeCell(value: string | number): string {
  const s = String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV string and triggers a browser download. Use this instead of
 * hand-rolling CSV export logic — see csvSafeCell for why.
 */
export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csv = [headers, ...rows].map((r) => r.map(csvSafeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Deferred: revoking synchronously can race the browser's download of
  // the same URL on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
