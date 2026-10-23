// Writes the PDF files used for manual and large-file tests.
//
//   node tools/generate-test-pdfs.mjs
//
// Output: tests/fixtures/generated/ (not kept in version control).
//   small.pdf    5 pages: A4, Letter, landscape, a rotated page, a tiny page
//   large.pdf    2500 pages of text (the "2000+ pages" test)
//   images.pdf   40 pages, each with a full-page picture (heavier to draw)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(fileURLToPath(new URL('..', import.meta.url)), 'tests', 'fixtures', 'generated');

/** Collects PDF objects and writes the file with its cross-reference table. */
class PdfWriter {
  #objects = [];

  /** Reserves an object number, so objects can point at each other. */
  reserve() {
    this.#objects.push(null);
    return this.#objects.length;
  }

  set(number, dictionary, stream) {
    this.#objects[number - 1] = { dictionary, stream };
  }

  add(dictionary, stream) {
    const number = this.reserve();
    this.set(number, dictionary, stream);
    return number;
  }

  toBuffer(rootNumber) {
    const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [];
    let length = chunks[0].length;
    const push = (buffer) => {
      chunks.push(buffer);
      length += buffer.length;
    };

    this.#objects.forEach(({ dictionary, stream }, index) => {
      offsets.push(length);
      if (stream) {
        push(Buffer.from(`${index + 1} 0 obj\n<< ${dictionary} /Length ${stream.length} >>\nstream\n`, 'latin1'));
        push(stream);
        push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
      } else {
        push(Buffer.from(`${index + 1} 0 obj\n<< ${dictionary} >>\nendobj\n`, 'latin1'));
      }
    });

    const xrefOffset = length;
    const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    push(
      Buffer.from(
        `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${entries}` +
          `trailer\n<< /Size ${offsets.length + 1} /Root ${rootNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
        'latin1',
      ),
    );
    return Buffer.concat(chunks);
  }
}

const escapeText = (text) => text.replace(/[\\()]/g, (character) => `\\${character}`);

/** Content stream: a title, a big page number and lines of filler text. */
function textContent({ title, number, width, height, lines }) {
  const parts = [
    `BT /F1 20 Tf 56 ${height - 72} Td (${escapeText(title)}) Tj ET`,
    `BT /F1 96 Tf 0.85 0.87 0.9 rg ${width / 2 - 80} ${height / 2} Td (${number}) Tj ET`,
    '0 0 0 rg',
  ];
  for (let line = 0; line < lines; line++) {
    const y = height - 120 - line * 16;
    if (y < 56) break;
    parts.push(
      `BT /F1 10 Tf 56 ${y} Td (${escapeText(`Page ${number}, line ${line + 1}: the quick brown fox jumps over the lazy dog.`)}) Tj ET`,
    );
  }
  return Buffer.from(parts.join('\n'), 'latin1');
}

/**
 * Builds a document. Each page: { width, height, rotate?, content, resources? }.
 * Pages sit in a balanced tree (16 per node), as large real files do.
 */
function buildDocument(writer, pages, fontNumber) {
  const leaves = pages.map((page) => ({ number: writer.reserve(), count: 1, page }));
  let level = leaves;
  const parents = new Map();

  while (level.length > 1 || level[0].page) {
    const next = [];
    for (let start = 0; start < level.length; start += 16) {
      const kids = level.slice(start, start + 16);
      const node = { number: writer.reserve(), count: kids.reduce((sum, kid) => sum + kid.count, 0), kids };
      for (const kid of kids) parents.set(kid.number, node.number);
      next.push(node);
    }
    level = next;
  }
  const root = level[0];

  const writeNode = (node) => {
    const parent = parents.has(node.number) ? `/Parent ${parents.get(node.number)} 0 R ` : '';
    if (node.page) {
      const { width, height, rotate, content, resources } = node.page;
      const contentNumber = writer.add('', content);
      writer.set(
        node.number,
        `/Type /Page ${parent}/MediaBox [0 0 ${width} ${height}] ${rotate ? `/Rotate ${rotate} ` : ''}` +
          `/Resources << /Font << /F1 ${fontNumber} 0 R >> ${resources ?? ''} >> /Contents ${contentNumber} 0 R`,
      );
      return;
    }
    writer.set(
      node.number,
      `/Type /Pages ${parent}/Count ${node.count} /Kids [${node.kids.map((kid) => `${kid.number} 0 R`).join(' ')}]`,
    );
    node.kids.forEach(writeNode);
  };
  writeNode(root);

  return writer.add(`/Type /Catalog /Pages ${root.number} 0 R`);
}

function writePdf(name, makePages) {
  const writer = new PdfWriter();
  const font = writer.add('/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding');
  const catalog = buildDocument(writer, makePages(writer), font);
  const buffer = writer.toBuffer(catalog);
  writeFileSync(join(outDir, name), buffer);
  console.log(`${name}: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
}

/** A grayscale picture with soft diagonal bands and noise, like a rough scan. */
function pictureStream(width, height, seed) {
  const pixels = Buffer.alloc(width * height);
  let state = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const band = 200 + 40 * Math.sin((x + y + seed) / 90);
      pixels[y * width + x] = Math.max(0, Math.min(255, band + (state >>> 28) - 8));
    }
  }
  return deflateSync(pixels);
}

mkdirSync(outDir, { recursive: true });

writePdf('small.pdf', () =>
  [
    { title: 'A4 portrait', width: 595, height: 842 },
    { title: 'US Letter', width: 612, height: 792 },
    { title: 'A4 landscape', width: 842, height: 595 },
    { title: 'A4 rotated 90 degrees', width: 595, height: 842, rotate: 90 },
    { title: 'Small page', width: 300, height: 200 },
  ].map((page, index) => ({ ...page, content: textContent({ ...page, number: index + 1, lines: 30 }) })),
);

writePdf('large.pdf', () =>
  Array.from({ length: 2500 }, (_, index) => {
    const page = { title: `Large test file, page ${index + 1} of 2500`, width: 595, height: 842 };
    return { ...page, content: textContent({ ...page, number: index + 1, lines: 42 }) };
  }),
);

writePdf('images.pdf', (writer) =>
  Array.from({ length: 40 }, (_, index) => {
    const [pixelWidth, pixelHeight] = [1240, 1754];
    const image = writer.add(
      `/Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
        '/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode',
      pictureStream(pixelWidth, pixelHeight, index + 1),
    );
    const content = Buffer.concat([
      Buffer.from('q 595 0 0 842 0 0 cm /Im1 Do Q\n', 'latin1'),
      textContent({ title: `Picture page ${index + 1}`, number: index + 1, width: 595, height: 842, lines: 0 }),
    ]);
    return { width: 595, height: 842, content, resources: `/XObject << /Im1 ${image} 0 R >>` };
  }),
);
