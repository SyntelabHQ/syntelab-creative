#!/usr/bin/env node
// Brings every language up to date after the English texts changed: what was added
// is translated, what was changed is translated again, what was removed goes away.
// The rest stays as it is. Change only the English, then run:
//
//   node tools\translate-update.mjs --url=http://localhost:1235/v1 --model=google/gemma-4-31b-qat
//   node tools\translate-update.mjs --dry-run      only shows what changed
//
// It knows what changed by comparing the English with docs/localization/english-snapshot.json,
// the English the translations were made from. That file is kept up to date by this
// script; commit it together with the translations.
//
// It can be stopped with Ctrl+C and started again: it goes on where it was. The
// translating itself is done by translate-local.mjs (same options: --url, --model, --parallel).
// A new app is taken in the same way: its texts, manual and description are new texts.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateLanguage } from './check-locales.mjs';

const root = path.resolve(import.meta.dirname, '..');
const SNAPSHOT = 'docs/localization/english-snapshot.json';
const dryRun = process.argv.includes('--dry-run');
const passOn = process.argv.slice(2).filter((arg) => arg !== '--dry-run');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, ''));
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}
/** Written beside, then moved in place: a stop in the middle never leaves half a file. */
function writeJson(rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.writing`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.writing`, file);
}

const languages = readJson('locales/languages.json').languages.map((item) => item.code).filter((code) => code !== 'en');
const apps = fs.readdirSync(path.join(root, 'apps')).filter((app) => exists(`apps/${app}/app.json`));

/** Where the English of every kind of text is, and where a language's copy goes. */
const flatFiles = [
  ['locales/en/common.json', (code) => `locales/${code}/common.json`],
  ['locales/en/shell.json', (code) => `locales/${code}/shell.json`],
  ...apps.map((app) => [`apps/${app}/locales/en.json`, (code) => `apps/${app}/locales/${code}.json`]),
].filter(([source]) => exists(source));
const manuals = [
  ['help/shell/en.json', (code) => `help/shell/${code}.json`],
  ...apps.map((app) => [`apps/${app}/help/en.json`, (code) => `apps/${app}/help/${code}.json`]),
].filter(([source]) => exists(source));

/** The English as it is now. */
function englishNow() {
  return {
    files: Object.fromEntries(flatFiles.map(([source]) => [source, readJson(source)])),
    manuals: Object.fromEntries(manuals.map(([source]) => [source, readJson(source)])),
    descriptions: Object.fromEntries(apps.map((app) => [app, readJson(`apps/${app}/app.json`).description?.en]).filter(([, text]) => text)),
  };
}

/** Every text of a manual with where it is; ids are not texts (as in translate-local.mjs). */
function manualTexts(value, at = '', into = {}) {
  if (typeof value === 'string') {
    if (value.trim()) into[at] = value;
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => manualTexts(item, `${at}/${index}`, into));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) if (key !== 'id') manualTexts(child, `${at}/${key}`, into);
  }
  return into;
}

const now = englishNow();
if (!exists(SNAPSHOT)) {
  if (dryRun) {
    console.log(`No ${SNAPSHOT} yet: the next run without --dry-run takes the English as it is now as the starting point.`);
    process.exit(0);
  }
  writeJson(SNAPSHOT, now);
  console.log(`${SNAPSHOT} written: the English as it is now is the starting point. Changes made from here on are found.`);
}
const before = readJson(SNAPSHOT);

// ---------- What changed ----------

const changes = { files: {}, manuals: [], descriptions: [] };
let added = 0;
for (const [source] of flatFiles) {
  const old = before.files[source] ?? {};
  const current = now.files[source];
  const changed = Object.keys(current).filter((key) => key in old && old[key] !== current[key]);
  const removed = Object.keys(old).filter((key) => !(key in current));
  added += Object.keys(current).filter((key) => !(key in old)).length;
  if (changed.length || removed.length) changes.files[source] = { changed, removed };
}
for (const [source] of manuals) {
  // A manual new altogether is missing everywhere: it is simply translated.
  if (before.manuals[source] && JSON.stringify(before.manuals[source]) !== JSON.stringify(now.manuals[source])) changes.manuals.push(source);
}
for (const [app, text] of Object.entries(now.descriptions)) {
  if (before.descriptions[app] && before.descriptions[app] !== text) changes.descriptions.push(app);
}

const changedTexts = Object.values(changes.files).reduce((sum, item) => sum + item.changed.length, 0);
const removedTexts = Object.values(changes.files).reduce((sum, item) => sum + item.removed.length, 0);
console.log(`Since the last update: ${added} new texts, ${changedTexts} changed, ${removedTexts} removed; ${changes.manuals.length} manuals and ${changes.descriptions.length} app descriptions changed.`);
for (const [source, { changed, removed }] of Object.entries(changes.files)) {
  for (const key of changed) console.log(`  changed  ${source}: ${key}`);
  for (const key of removed) console.log(`  removed  ${source}: ${key}`);
}
for (const source of changes.manuals) console.log(`  changed  ${source}`);
for (const app of changes.descriptions) console.log(`  changed  apps/${app}/app.json: description`);

const behind = () => languages.filter((code) => validateLanguage(code).errors.length);
if (dryRun) {
  const waiting = behind();
  if (waiting.length) console.log(`Languages with texts still to translate: ${waiting.join(', ')}`);
  process.exit(0);
}

// ---------- Every language forgets what changed ----------
// Done for all languages before the snapshot moves on: if this is stopped in the middle,
// the next run finds the same changes and does it again.

for (const code of languages) {
  for (const [source, target] of flatFiles) {
    const item = changes.files[source];
    const rel = target(code);
    if (!item || !exists(rel)) continue;
    const value = readJson(rel);
    let touched = false;
    for (const key of [...item.changed, ...item.removed]) {
      if (key in value) {
        delete value[key];
        touched = true;
      }
    }
    if (touched) writeJson(rel, value);
  }
  for (const [source, target] of manuals) {
    const rel = target(code);
    if (!changes.manuals.includes(source) || !exists(rel)) continue;
    // What is translated already is kept for the texts whose English stayed the same,
    // wherever they moved in the manual; translate-local.mjs then does only the rest.
    const oldTexts = manualTexts(before.manuals[source]);
    const translatedTexts = manualTexts(readJson(rel));
    const known = new Map();
    for (const [at, english] of Object.entries(oldTexts)) if (translatedTexts[at]) known.set(english, translatedTexts[at]);
    const cacheRel = `node_modules/.translate-cache/${code}/${rel.replaceAll('/', '__')}`;
    const cache = {};
    for (const [at, english] of Object.entries(manualTexts(now.manuals[source]))) {
      if (known.has(english)) cache[at] = { en: english, text: known.get(english) };
    }
    writeJson(cacheRel, cache);
    fs.rmSync(path.join(root, rel));
  }
}
for (const app of changes.descriptions) {
  const rel = `apps/${app}/app.json`;
  const value = readJson(rel);
  for (const code of languages) delete value.description[code];
  writeJson(rel, value);
}
writeJson(SNAPSHOT, now);

// ---------- Translating what is missing ----------

const waiting = behind();
if (!waiting.length) {
  console.log('Every language is up to date.');
  process.exit(0);
}
console.log(`To translate: ${waiting.length} languages.`);
const left = [];
for (const [index, code] of waiting.entries()) {
  console.log(`\n===== ${index + 1}/${waiting.length}: ${code} =====`);
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'translate-local.mjs'), `--language=${code}`, ...passOn], { stdio: 'inherit' });
  // LM Studio stopped answering: no use going on to the next ones.
  if (run.status !== 0) {
    console.error(`Stopped at ${code}. Start the same command again to go on.`);
    process.exit(1);
  }
  const mark = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-locales.mjs'), `--language=${code}`, '--mark-complete'], { stdio: 'ignore' });
  if (mark.status !== 0) left.push(code);
}
console.log(left.length ? `\nDone. Not complete yet (start again for them): ${left.join(', ')}` : '\nDone: every language is up to date.');
