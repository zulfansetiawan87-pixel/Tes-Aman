import { Packer } from 'docx';
import { buildQuizImportTemplateDoc } from '../lib/docxTemplateBuilder.ts';

export async function generateQuizImportTemplateDocx(): Promise<Buffer> {
  const doc = buildQuizImportTemplateDoc();
  return await Packer.toBuffer(doc);
}
