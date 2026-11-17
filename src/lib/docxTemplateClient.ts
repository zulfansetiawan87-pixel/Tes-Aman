import { Packer } from 'docx';
import { buildQuizImportTemplateDoc } from './docxTemplateBuilder.ts';

export async function downloadQuizImportTemplateDocx(): Promise<void> {
  const doc = buildQuizImportTemplateDoc();
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Template_Impor_Soal_SecureQuiz.docx';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
