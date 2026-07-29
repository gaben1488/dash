/**
 * build-docx.ts — сборка .docx из блоков текста и скачивание в браузере.
 *
 * Выгрузка ЛОКАЛЬНАЯ: документ собирается на странице и сохраняется через
 * Blob, без роута и без записи на сервер. Так работает и офлайн-копия, и
 * публичный read-only стенд, где запись запрещена.
 *
 * Оформление повторяет ручной отчёт: весь текст полужирный, Times New Roman
 * 12 пт, заголовки разделов — тем же начертанием на строку выше. Никаких
 * таблиц: в оригинале их нет.
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ReportBlock } from './text-blocks';

/** Шрифт и кегль ручного отчёта. */
const FONT = 'Times New Roman';
const SIZE_HALF_POINTS = 24; // 12 пт

function toParagraph(block: ReportBlock): Paragraph {
  // Оговорки шапки в оригинале набраны курсивом и без полужирного — это
  // единственное место, где начертание несёт смысл: «читай как примечание».
  const isNote = block.kind === 'note';
  const run = new TextRun({
    text: block.text,
    bold: !isNote,
    italics: isNote,
    font: FONT,
    size: SIZE_HALF_POINTS,
  });
  if (block.kind === 'heading') {
    return new Paragraph({
      children: [run],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
    });
  }
  return new Paragraph({
    children: [run],
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
  });
}

/** Документ из готовых блоков (заголовок документа — первый блок текста). */
export function buildDocument(blocks: ReportBlock[], title: string): Document {
  return new Document({
    title,
    description: 'Сформировано в dash',
    sections: [{
      properties: {},
      children: blocks.map(toParagraph),
    }],
  });
}

/**
 * Сохранить документ на диск читателя. Возвращает промис — вызывающий код
 * может показать состояние «готовится» и honest-ошибку при отказе.
 */
export async function downloadDocx(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Освобождаем ссылку после того, как браузер забрал файл.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Имя файла в стиле ручного отчёта: «Отчёт по закупкам 05.04.2026.docx». */
export function reportFilename(prefix: string, asOfDate: string): string {
  return `${prefix} ${asOfDate}.docx`;
}
