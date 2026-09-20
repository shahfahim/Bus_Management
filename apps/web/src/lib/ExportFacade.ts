/* eslint-disable */
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

// Using jspdf-autotable plugin for advanced table generation

export interface ExportColumn {
  key: string;
  label: string;
}

// --- FACADE PATTERN ---
// The ExportFacade hides the complexity of two different libraries (PapaParse for CSV, jsPDF for PDF).
// It exposes a simple, unified interface for downloading reports in different formats.
export class ExportFacade {
  
  /**
   * Generates and downloads a CSV file.
   */
  public static exportToCSV(data: any[], columns: ExportColumn[], filename: string): void {
    if (!data.length) return;

    // Map data to match the column labels
    const formattedData = data.map(row => {
      const formattedRow: Record<string, string> = {};
      columns.forEach(col => {
        formattedRow[col.label] = this.resolveValue(row, col.key);
      });
      return formattedRow;
    });

    // Use PapaParse for robust CSV escaping and formatting
    const csv = Papa.unparse(formattedData);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    this.triggerDownload(url, filename.endsWith('.csv') ? filename : `${filename}.csv`);
  }

  /**
   * Generates and downloads a formatted PDF report with a table.
   */
  public static exportToPDF(data: any[], columns: ExportColumn[], filename: string, title: string): void {
    if (!data.length) return;

    const doc = new jsPDF();
    const headers = columns.map(col => col.label);
    const rows = data.map(row => columns.map(col => this.resolveValue(row, col.key)));

    // Add title
    doc.setFontSize(18);
    doc.text(title, 14, 22);
    
    // Add timestamp
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    // Generate table using jspdf-autotable plugin
    (doc as any).autoTable({
      head: [headers],
      body: rows,
      startY: 40,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }, // Deep Indigo
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  }

  // Helper to trigger the browser download
  private static triggerDownload(url: string, filename: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  // Helper to extract nested object values safely (e.g., 'route.name')
  private static resolveValue(record: any, path: string): string {
    const keys = path.split('|')[0].split('.'); // Handle paths like 'publicCode|reference'
    let value = record;
    for (const key of keys) {
      if (value === undefined || value === null) break;
      value = value[key];
    }
    
    // Fallback if the first path failed and there's an alternative (e.g., publicCode|reference)
    if ((value === undefined || value === null) && path.includes('|')) {
      const altKeys = path.split('|')[1].split('.');
      value = record;
      for (const key of altKeys) {
        if (value === undefined || value === null) break;
        value = value[key];
      }
    }

    if (value === undefined || value === null) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
