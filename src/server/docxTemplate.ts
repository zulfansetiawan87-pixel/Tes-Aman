import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

export async function generateQuizImportTemplateDocx(): Promise<Buffer> {
  const lines = [
    { heading: true, text: 'TEMPLATE IMPOR SOAL — SECURE QUIZ (MULTIMODAL & 5 TIPE SOAL)' },
    {
      text: 'Petunjuk Singkat: Setiap soal diawali tag [QUESTION] dan diakhiri atau dipisahkan oleh tag [QUESTION] berikutnya. Jangan ubah nama tag dalam kurung siku ([...]). Anda dapat menempelkan teks bacaan Bahasa Inggris pada [STIMULUS_TEXT] serta URL gambar/audio pada [STIMULUS_IMAGE] atau [STIMULUS_AUDIO].',
    },
    { text: '' },
    { heading: true, text: 'CONTOH 1: PILIHAN GANDA (MCQ) + MULTIMODAL TEXT & IMAGE' },
    { text: '[QUESTION]' },
    { text: '[TYPE] mcq' },
    { text: '[POINTS] 10' },
    { text: '[STIMULUS_TEXT] NOTICE: Library Courtyard & Eco Garden — The Reading Room is open from 08:00 to 17:00. Visitors entering the Quiet Zone must silence all mobile phones. Eco Garden workshops take place every Saturday at 11:00 AM.' },
    { text: '[STIMULUS_IMAGE] /src/assets/images/english_multimodal_park_1794813404090.jpg' },
    { text: '[STIMULUS_CAPTION] Public Library & Gardens notice board' },
    { text: '[PROMPT] Based on the notice board and announcement text, what must visitors do before entering the Quiet Zone?' },
    { text: '[OPTIONS]' },
    { text: 'A. Register for the Saturday Eco Garden workshop' },
    { text: 'B. Silence all mobile phones before entering' },
    { text: 'C. Leave bicycles inside the Reading Room' },
    { text: 'D. Arrive before 08:00 AM only' },
    { text: '[KEY] B' },
    { text: '' },
    { heading: true, text: 'CONTOH 2: PILIHAN GANDA KOMPLEKS (COMPLEX_MCQ)' },
    { text: '[QUESTION]' },
    { text: '[TYPE] complex_mcq' },
    { text: '[POINTS] 15' },
    { text: '[STIMULUS_TEXT] Read the short procedural note: To submit your digital English portfolio, upload a PDF file under 10 MB, verify your student ID, and keep a local backup copy until your teacher confirms receipt.' },
    { text: '[PROMPT] Which TWO actions are required according to the procedural note? (Select all correct answers)' },
    { text: '[OPTIONS]' },
    { text: 'A. Upload the portfolio in PDF format under 10 MB' },
    { text: 'B. Print three hard copies for the school office' },
    { text: 'C. Verify your student ID during submission' },
    { text: 'D. Delete your local file immediately after uploading' },
    { text: '[KEY] A, C' },
    { text: '' },
    { heading: true, text: 'CONTOH 3: MENGELOMPOKKAN (GROUPING)' },
    { text: '[QUESTION]' },
    { text: '[TYPE] grouping' },
    { text: '[POINTS] 20' },
    { text: '[PROMPT] Group the following English expressions into their appropriate communicative functions.' },
    { text: '[CATEGORIES] Asking for Opinion | Expressing Agreement | Polite Disagreement' },
    { text: '[ITEMS]' },
    { text: '1. What is your perspective on hybrid learning? => Asking for Opinion' },
    { text: '2. I completely share your viewpoint on that matter. => Expressing Agreement' },
    { text: '3. I see your point, however the schedule seems tight. => Polite Disagreement' },
    { text: '4. Could you share your thoughts on this article? => Asking for Opinion' },
    { text: '' },
    { heading: true, text: 'CONTOH 4: URAIAN SINGKAT (SHORT_ESSAY)' },
    { text: '[QUESTION]' },
    { text: '[TYPE] short_essay' },
    { text: '[POINTS] 15' },
    { text: '[STIMULUS_TEXT] Complete the sentence with the appropriate passive verb form: "The annual English debate competition ____ (organize) by the Student Council next month."' },
    { text: '[PROMPT] Write the exact two-word future passive verb phrase to complete the blank.' },
    { text: '[KEY] will be organized | will be organised' },
    { text: '' },
    { heading: true, text: 'CONTOH 5: URAIAN PANJANG (LONG_ESSAY)' },
    { text: '[QUESTION]' },
    { text: '[TYPE] long_essay' },
    { text: '[POINTS] 40' },
    { text: '[STIMULUS_TEXT] Multimodal Prompt: Compare the advantages of digital audio-visual reading resources with traditional printed textbooks for vocational high school English learners.' },
    { text: '[PROMPT] Write a well-structured 2-paragraph analytical response in English (100-150 words) stating your main claim, two supporting reasons, and a concluding recommendation.' },
    { text: '[RUBRIC] Skor penuh (40) bila memuat: (1) klaim utama jelas, (2) dua alasan pendukung koheren dengan kosakata akademik tepat, (3) kesimpulan logis, dan (4) tata bahasa akurat.' },
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: lines.map((item) => {
          if (item.heading) {
            return new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 120 },
              alignment: AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: item.text,
                  bold: true,
                  color: '0F2544',
                }),
              ],
            });
          }
          return new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: item.text, size: 22 })],
          });
        }),
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
