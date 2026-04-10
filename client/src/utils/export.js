/**
 * Convert an array of objects to CSV string.
 * @param {Array<Object>} rows - data rows
 * @param {Array<{key: string, label: string}>} columns - column definitions
 */
export function toCSV(rows, columns) {
  const header = columns.map(c => `"${c.label}"`).join(',');
  const body = rows.map(row =>
    columns.map(c => {
      const val = c.format ? c.format(row) : row[c.key];
      if (val == null) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  ).join('\n');
  return `${header}\n${body}`;
}

/**
 * Trigger a CSV download in the browser.
 */
export function downloadCSV(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard with fallback.
 * Returns true on success.
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

/**
 * Build a shareable URL for the current page.
 */
export function getShareableURL() {
  return window.location.href;
}
