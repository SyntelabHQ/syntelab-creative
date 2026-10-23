#!/usr/bin/env node
// Translates the missing texts of one language with a model running in LM Studio
// (its local server, OpenAI-compatible). What is already translated is kept; the
// script can be stopped with Ctrl+C and started again: it goes on where it was.
//
//   node tools\translate-local.mjs --language=uk
//   node tools\translate-local.mjs --all     every language not done yet, one after another
//
// Options:
//   --url=http://localhost:1234/v1   address of LM Studio's server
//   --model=<id>                     model to use (default: the one loaded)
//   --only=<path>                    one file only, e.g. apps/units/locales/uk.json
//   --parallel=4                     requests sent at once (LM Studio: Max Concurrent Predictions)
//
// Every translation is checked before it is kept: the {placeholders} and the
// plural forms must be those of the English text. A text that fails twice is
// left out (the program shows English there) and listed at the end.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { compareIcuMessages, validateLanguage } from './check-locales.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const language = args.language;
const url = String(args.url ?? 'http://localhost:1234/v1').replace(/\/+$/, '');
const only = typeof args.only === 'string' ? args.only.replaceAll('\\', '/') : null;
/** Source characters per request: the answer must fit in the model's context too. */
const BUDGET = 1800;
const MAX_ITEMS = 40;
const PARALLEL = Math.max(1, Number.parseInt(args.parallel ?? '4', 10) || 1);

// Every language not done yet, in the order of the plan; each one that passes the check is marked done.
if (args.all) {
  const progress = readJson('docs/localization/progress.json');
  const pending = progress.order.filter((code) => !['translated', 'validated'].includes(progress.languages[code]?.status));
  const passOn = process.argv.slice(2).filter((arg) => arg !== '--all');
  const left = [];
  for (const [index, code] of pending.entries()) {
    console.log(`\n===== ${index + 1}/${pending.length}: ${code} =====`);
    const run = spawnSync(process.execPath, [import.meta.filename, `--language=${code}`, ...passOn], { stdio: 'inherit' });
    // LM Studio stopped answering: no use going on to the next ones.
    if (run.status !== 0) {
      console.error(`Stopped at ${code}. Start the same command again to go on.`);
      process.exit(1);
    }
    const mark = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-locales.mjs'), `--language=${code}`, '--mark-complete'], { stdio: 'ignore' });
    if (mark.status !== 0) left.push(code);
  }
  console.log(left.length ? `\nDone. Not complete yet (start again for them): ${left.join(', ')}` : '\nDone: every language is complete.');
  process.exit(0);
}

if (!language || language === 'en') {
  console.error('Choose a language: node tools/translate-local.mjs --language=uk');
  process.exit(2);
}
const registry = readJson('locales/languages.json');
const entry = registry.languages.find((item) => item.code === language);
if (!entry) {
  console.error(`Unknown language: ${language} (see locales/languages.json)`);
  process.exit(2);
}

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

// ---------- The model ----------

const glossaryRel = `docs/localization/glossaries/${language}.json`;
const glossary = exists(glossaryRel) ? readJson(glossaryRel) : null;
const appNames = fs.readdirSync(path.join(root, 'apps'))
  .filter((app) => exists(`apps/${app}/app.json`))
  .map((app) => readJson(`apps/${app}/app.json`).name?.en)
  .filter(Boolean);

const instructions = [
  `You translate the interface and the manual of a desktop program, Syntelab Creative, from English into ${entry.english} (${entry.native}).`,
  'You get a JSON object. Answer with a JSON object with exactly the same keys, each value translated. Nothing else: no comments, no code fences.',
  'Rules:',
  '- Keep every {placeholder} exactly as it is, e.g. {count}, {name}. Never translate the word inside the braces.',
  `- ICU plurals and selects: keep the structure {count, plural, ...} and the keywords plural, select, other, =0, #. Translate only the text inside. Use the plural categories ${entry.english} needs (${pluralCategories()}), and always keep "other".`,
  '- Keep keyboard shortcuts (Ctrl+S, Shift, F1), file extensions (.pdf, .docx), units symbols, URLs and code as they are.',
  `- Never translate these names: Syntelab Creative, ${appNames.join(', ')}, PDF, OCR, PAdES, LTV.`,
  '- Short labels (buttons, menu entries) stay short. Use the usual words of software in this language, the way Windows and well-known programs say them.',
  '- Address the user the way well-known programs do in this language (polite or familiar), and the same way everywhere.',
  '- Keep the punctuation of the language (quotation marks, spaces before signs where the language uses them).',
  glossary ? `Glossary, always use these words:\n${Object.entries(glossary).map(([en, tr]) => `  ${en} = ${tr}`).join('\n')}` : '',
].filter(Boolean).join('\n');

function pluralCategories() {
  try {
    return new Intl.PluralRules(language).resolvedOptions().pluralCategories.join(', ');
  } catch {
    return 'one, other';
  }
}

let model = typeof args.model === 'string' ? args.model : null;
async function chosenModel() {
  if (model) return model;
  const response = await fetch(`${url}/models`).catch(() => null);
  if (!response?.ok) throw new Error(`LM Studio does not answer at ${url}. Start its server (Developer → Start server) and load the model.`);
  const list = (await response.json()).data ?? [];
  const loaded = list.find((item) => !/embed/i.test(item.id));
  if (!loaded) throw new Error('No model is loaded in LM Studio.');
  model = loaded.id;
  return model;
}

/** Tokens an answer may take: the texts several times over (other scripts take more tokens than English), with their ids. */
function answerLimit(texts) {
  const characters = Object.entries(texts).reduce((sum, [id, text]) => sum + id.length + text.length, 0);
  return 512 + Math.ceil(characters * 1.5);
}

async function serverAnswers() {
  const response = await fetch(`${url}/models`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return Boolean(response?.ok);
}

let structured = true;
/** Sends a group of texts; returns what came back (may be incomplete or wrong: checked by the caller). */
async function translate(texts, note = '') {
  const keys = Object.keys(texts);
  const body = {
    model: await chosenModel(),
    temperature: 0.2,
    // Room for a long translation of every text, not more: a model that starts repeating itself stops here.
    max_tokens: answerLimit(texts),
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: (note ? `${note}\n\n` : '') + JSON.stringify(texts, null, 1) },
    ],
  };
  if (structured) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'translation',
        strict: true,
        schema: { type: 'object', properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])), required: keys, additionalProperties: false },
      },
    };
  }
  let response;
  try {
    response = await fetch(`${url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (error) {
    // No answer in time (the model went on and on): LM Studio itself still answers, so this group is left for the next run.
    if (await serverAnswers()) return {};
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text();
    // Some models or versions do not take a schema (LM Studio answers 400 or 500): then the answer is asked for in words only.
    // Several requests may be refused at once: each goes again, the message is said once.
    if (body.response_format) {
      if (structured) console.log(`\nLM Studio refused the answer format (${response.status}); going on without it.`);
      structured = false;
      return translate(texts, note);
    }
    throw new Error(`LM Studio answered ${response.status}: ${detail.slice(0, 300)}`);
  }
  const choice = (await response.json()).choices?.[0];
  // Cut at the limit: the model was repeating itself, the answer is not whole.
  if (choice?.finish_reason === 'length') return {};
  const content = choice?.message?.content ?? '';
  const json = content.replace(/^[\s\S]*?(\{)/, '$1').replace(/\}[^}]*$/, '}');
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** The {…} of a text, in order of their names: the manual's are written as they are, not ICU. */
function braces(text) {
  return (text.match(/\{[^{}]*\}/g) ?? []).sort().join(' ');
}

/** Problems of one translation; empty when it can be kept. */
function problems(source, translated, icu) {
  if (typeof translated !== 'string' || !translated.trim()) return ['empty'];
  if (icu) return compareIcuMessages(source, translated, language);
  return braces(source) === braces(translated) ? [] : [`the {…} must stay as they are: ${braces(source)}`];
}

const failed = [];
let done = 0;

/**
 * Translates a map of id → English text, a group at a time. `keep` is called after
 * each group with what was translated, so the work is saved as it goes.
 */
async function translateAll(sources, keep, label, icu = true) {
  const ids = Object.keys(sources);
  const groups = [];
  for (let index = 0; index < ids.length;) {
    const group = {};
    let size = 0;
    while (index < ids.length && Object.keys(group).length < MAX_ITEMS && (size === 0 || size + sources[ids[index]].length <= BUDGET)) {
      group[ids[index]] = sources[ids[index]];
      size += sources[ids[index]].length;
      index += 1;
    }
    groups.push(group);
  }
  let next = 0;
  let finished = 0;
  // PARALLEL groups on their way at once; each is kept as soon as it is back.
  const worker = async () => {
    while (next < groups.length) await translateGroup(groups[next++]);
  };
  const translateGroup = async (group) => {
    const answer = await translate(group);
    const good = {};
    for (const [id, source] of Object.entries(group)) {
      let translated = answer[id];
      let found = problems(source, translated, icu);
      // Once more, alone, with what was wrong.
      if (found.length) {
        const again = await translate({ [id]: source }, `Your last translation of this text was wrong: ${found.join('; ')}. Translate it again, keeping the placeholders and the ICU structure exactly.`);
        translated = again[id];
        found = problems(source, translated, icu);
      }
      if (found.length) failed.push(`${label}: ${id} (${found.join('; ')})`);
      else good[id] = translated;
    }
    keep(good);
    done += Object.keys(good).length;
    finished += Object.keys(group).length;
    process.stdout.write(`\r${label}: ${finished}/${ids.length}   `);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, groups.length) }, worker));
  if (ids.length) process.stdout.write('\n');
}

// ---------- Flat files of texts ----------

async function flatFile(sourceRel, targetRel) {
  if (only && only !== targetRel) return;
  if (!exists(sourceRel)) return;
  const source = readJson(sourceRel);
  const target = exists(targetRel) ? readJson(targetRel) : {};
  const missing = Object.fromEntries(Object.entries(source).filter(([key, text]) => !(key in target) && typeof text === 'string'));
  // An empty English text stays empty: there is nothing to translate.
  const empty = Object.fromEntries(Object.entries(missing).filter(([, text]) => !text.trim()).map(([key]) => [key, '']));
  for (const key of Object.keys(empty)) delete missing[key];
  if (!Object.keys(missing).length && !Object.keys(empty).length) return;
  const keep = (good) => {
    Object.assign(target, good);
    // In the order of the English file; anything else stays, after it.
    const ordered = {};
    for (const key of Object.keys(source)) if (key in target) ordered[key] = target[key];
    for (const key of Object.keys(target)) if (!(key in ordered)) ordered[key] = target[key];
    writeJson(targetRel, ordered);
  };
  if (Object.keys(empty).length) keep(empty);
  await translateAll(missing, keep, targetRel);
}

// ---------- Manuals (chapters of topics) ----------

/** Every text of a manual with where it is; ids stay as they are. */
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
function withTexts(value, texts, at = '') {
  if (typeof value === 'string') return texts[at] ?? value;
  if (Array.isArray(value)) return value.map((item, index) => withTexts(item, texts, `${at}/${index}`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'id' ? child : withTexts(child, texts, `${at}/${key}`)]));
  }
  return value;
}

async function manual(sourceRel, targetRel) {
  if (only && only !== targetRel) return;
  if (!exists(sourceRel) || exists(targetRel)) return;
  const source = readJson(sourceRel);
  const texts = manualTexts(source);
  // Kept apart until the whole manual is translated: a manual is written once, whole.
  const cacheRel = `node_modules/.translate-cache/${language}/${targetRel.replaceAll('/', '__')}`;
  const cache = exists(cacheRel) ? readJson(cacheRel) : {};
  const missing = Object.fromEntries(Object.entries(texts).filter(([at, text]) => cache[at]?.en !== text));
  await translateAll(missing, (good) => {
    for (const [at, translated] of Object.entries(good)) cache[at] = { en: texts[at], text: translated };
    writeJson(cacheRel, cache);
  }, targetRel, false);
  const translated = Object.fromEntries(Object.entries(cache).filter(([at, item]) => texts[at] === item.en).map(([at, item]) => [at, item.text]));
  if (Object.keys(texts).every((at) => at in translated)) writeJson(targetRel, withTexts(source, translated));
  else failed.push(`${targetRel}: not written yet, some of its texts failed (run again)`);
}

// ---------- Descriptions of the apps ----------

async function descriptions() {
  const apps = fs.readdirSync(path.join(root, 'apps')).filter((app) => exists(`apps/${app}/app.json`));
  const missing = {};
  for (const app of apps) {
    const rel = `apps/${app}/app.json`;
    if (only && only !== rel) continue;
    const description = readJson(rel).description;
    if (description?.en && !description[language]) missing[app] = description.en;
  }
  await translateAll(missing, (good) => {
    for (const [app, text] of Object.entries(good)) {
      const rel = `apps/${app}/app.json`;
      const value = readJson(rel);
      value.description[language] = text;
      writeJson(rel, value);
    }
  }, 'apps/*/app.json');
}

// ---------- The run ----------

try {
  console.log(`${entry.english} (${language}) with ${await chosenModel()}`);
  const apps = fs.readdirSync(path.join(root, 'apps'));
  await flatFile('locales/en/common.json', `locales/${language}/common.json`);
  await flatFile('locales/en/shell.json', `locales/${language}/shell.json`);
  for (const app of apps) await flatFile(`apps/${app}/locales/en.json`, `apps/${app}/locales/${language}.json`);
  await descriptions();
  await manual('help/shell/en.json', `help/shell/${language}.json`);
  for (const app of apps) await manual(`apps/${app}/help/en.json`, `apps/${app}/help/${language}.json`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}

console.log(`\nTranslated now: ${done} texts.`);
if (failed.length) {
  console.log(`Left in English (${failed.length}), the run can be started again for them:`);
  for (const line of failed) console.log(`  ${line}`);
}
const check = validateLanguage(language);
console.log(check.errors.length ? `Check: ${check.errors.length} problems (node tools/check-locales.mjs --language=${language})` : `Check: all files complete. Mark it done with: node tools/check-locales.mjs --language=${language} --mark-complete`);
