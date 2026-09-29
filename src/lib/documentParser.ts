import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'csv']);

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `# Sheet: ${name}\n${csv}`;
  }).join('\n\n');
}

export async function extractText(buffer: Buffer, extension: string): Promise<string> {
  switch (extension) {
    case 'pdf':
      return extractPdf(buffer);
    case 'docx':
      return extractDocx(buffer);
    case 'xlsx':
    case 'xls':
      return extractSpreadsheet(buffer);
    case 'csv':
      return buffer.toString('utf-8');
    default:
      throw new Error(`Unsupported file type: .${extension}`);
  }
}
