import mammoth from 'mammoth';
import { BadRequestError } from '../lib/errors.js';

// Internal import avoids pdf-parse's debug-mode trap under ESM/tsx.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/**
 * Resume text extraction. Supported: PDF, DOCX, plain text/markdown.
 * Pure function of (buffer, mimeType) — trivially unit-testable.
 */
const MIME_ALIASES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'text',
  'text/markdown': 'text',
  'application/octet-stream': 'unknown',
};

const EXT_ALIASES: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'doc',
  txt: 'text',
  md: 'text',
  markdown: 'text',
};

export function resolveKind(mimeType: string, fileName: string): string {
  const byMime = MIME_ALIASES[mimeType.toLowerCase()];
  if (byMime !== undefined && byMime !== 'unknown') return byMime;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ALIASES[ext] ?? 'unknown';
}

export async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const kind = resolveKind(mimeType, fileName);
  switch (kind) {
    case 'pdf': {
      const result = await pdfParse(buffer);
      return result.text;
    }
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'text':
      return buffer.toString('utf8');
    case 'doc':
      throw new BadRequestError('Legacy .doc is not supported; save as .docx or PDF');
    default:
      throw new BadRequestError(
        `Unsupported file type (${mimeType || 'unknown'}). Allowed: pdf, docx, txt, md`,
      );
  }
}
