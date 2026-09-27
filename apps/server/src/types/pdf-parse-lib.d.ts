// pdf-parse's index.js has a debug-mode trap (executes when imported without
// a CJS parent, which happens under tsx/ESM). Importing the inner module
// directly avoids it; this declaration gives that path a type.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: unknown;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
