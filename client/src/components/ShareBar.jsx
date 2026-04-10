import { useState } from 'react';
import { copyToClipboard, getShareableURL } from '../utils/export';

/**
 * Reusable bar with share link + optional CSV export button.
 * onExportCSV: callback that triggers the CSV download.
 */
export default function ShareBar({ onExportCSV, exportLabel = 'Export CSV' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    const ok = await copyToClipboard(getShareableURL());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="btn-secondary text-xs flex items-center gap-1.5"
        onClick={handleCopyLink}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
          <path d="M5.5 8.5L8.5 5.5M5.8 6.2L4.2 7.8a2 2 0 002.8 2.8l1.6-1.6M8.2 7.8l1.6-1.6a2 2 0 00-2.8-2.8L5.4 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        {copied ? 'Copied!' : 'Share link'}
      </button>
      {onExportCSV && (
        <button
          className="btn-secondary text-xs flex items-center gap-1.5"
          onClick={onExportCSV}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
            <path d="M7 2v7M4 6.5L7 9.5l3-3M3 11.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {exportLabel}
        </button>
      )}
    </div>
  );
}
