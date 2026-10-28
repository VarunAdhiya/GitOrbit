import { PDFParse } from 'pdf-parse';
process.once('message', async (bytes) => {
  let parser;
  try {
    parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
    const info = await parser.getInfo();
    if (info.total > 20) {
      process.send?.({ error: 'PDF_PAGE_LIMIT' });
      return;
    }
    const result = await parser.getText();
    if (result.text.length > 60000) {
      process.send?.({ error: 'PDF_TEXT_LIMIT' });
      return;
    }
    process.send?.({ text: result.text });
  } catch {
    process.send?.({ error: 'PDF_INVALID' });
  } finally {
    await parser?.destroy().catch(() => {});
    process.disconnect();
  }
});
