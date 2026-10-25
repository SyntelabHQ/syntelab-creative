#!/usr/bin/env node
// Puts PDFium (pdfium.dll, the PDF engine of Chrome) in third-party/pdfium/, where the installer takes it from.
// PDF Organizer draws its pages on screen with it (sharper text); without it, MuPDF draws them as before.
//
// The library comes from the Python package pypdfium2 on PyPI, which carries the builds of
// github.com/bblanchon/pdfium-binaries. The package is pinned and checked against its SHA-256, so every build
// gets the same file. Runs before `npm run dev` and `npm run build`; does nothing when the right one is there.
//
// Offline: download the wheel below by hand and run `node tools/fetch-pdfium.mjs path/to/the.whl`.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const VERSION = 'pypdfium2 5.14.0 (PDFium 156.0.8076)';
const WHEEL_URL =
  'https://files.pythonhosted.org/packages/00/dc/ca7874924c9cfd701ad53f89529968523790e70473e0b71e834668316148/pypdfium2-5.14.0-py3-none-win_amd64.whl';
const WHEEL_SHA256 = '149fd5c6397b8df8bf7911a93506eff0be874f877afe7ac936cf5d37d21a6a06';
const LIBRARY_ENTRY = 'pypdfium2_raw/pdfium.dll';
const LICENSES_FOLDER = 'pypdfium2-5.14.0.dist-info/licenses/data/windows_x64/BUILD_LICENSES/';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'third-party', 'pdfium');
const library = join(folder, 'pdfium.dll');
const licenses = join(folder, 'licenses');
const versionFile = join(folder, 'version.txt');

if (existsSync(library) && existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === VERSION) {
  process.exit(0);
}

const wheel = process.argv[2] ? readFileSync(process.argv[2]) : await download(WHEEL_URL);
const digest = createHash('sha256').update(wheel).digest('hex');
if (digest !== WHEEL_SHA256) {
  fail(`the downloaded package is not the expected one (SHA-256 ${digest}, expected ${WHEEL_SHA256})`);
}

const entries = zipEntries(wheel);
const dll = entries.get(LIBRARY_ENTRY);
if (!dll) fail(`${LIBRARY_ENTRY} is missing from the package`);
mkdirSync(folder, { recursive: true });
rmSync(licenses, { recursive: true, force: true });
mkdirSync(licenses, { recursive: true });
for (const [name, entry] of entries) {
  if (name.startsWith(LICENSES_FOLDER) && name.length > LICENSES_FOLDER.length) {
    writeFileSync(join(licenses, name.slice(LICENSES_FOLDER.length)), entry());
  }
}
writeFileSync(library, dll());
writeFileSync(versionFile, `${VERSION}\n`);
console.log(`PDFium: ${VERSION} written to third-party/pdfium/`);

async function download(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    fail(`could not download ${url}: ${error.message}`);
  }
  if (!response.ok) fail(`could not download ${url}: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The files of a zip archive (a wheel is one), by name, each read when asked for. */
function zipEntries(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) fail('the package is not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) fail('the package is damaged');
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, () => {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      fail(`${name} is packed in a way this script does not read (${method})`);
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function fail(message) {
  console.error(`PDFium: ${message}`);
  process.exit(1);
}
