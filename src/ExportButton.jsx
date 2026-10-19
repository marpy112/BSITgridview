import { useEffect, useState } from 'react';
import { downloadPdf } from './export.js';

export default function ExportButton({ filename, headers, rows, label = 'Export PDF', description = 'data', metadata = [] }) {
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  async function exportData() {
    setExporting(true);
    try {
      await downloadPdf(filename, headers, rows, { title: description.charAt(0).toUpperCase() + description.slice(1), metadata });
      setMessage(`PDF exported: ${rows.length} ${rows.length === 1 ? 'record' : 'records'}.`);
    } catch {
      setMessage('Export could not start. Please try again.');
    } finally { setExporting(false); }
  }

  return <span className="data-export">
    <button type="button" className="secondary-button data-export-button" onClick={exportData} disabled={!rows.length || exporting} aria-busy={exporting} aria-label={`Export ${description} as PDF`} title={rows.length ? 'Download currently displayed records as PDF' : 'No records to export'}><span aria-hidden="true">↓</span>{exporting ? 'Preparing PDF…' : label}</button>
    <span className="export-feedback" role="status">{message}</span>
  </span>;
}
