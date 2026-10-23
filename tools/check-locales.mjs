#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseIcu } from '@formatjs/icu-messageformat-parser';

const root = path.resolve(import.meta.dirname, '..');
const excluded = new Set(['en']);
const args = process.argv.slice(2);
const languageArg = args.find((arg) => arg.startsWith('--language='))?.slice('--language='.length);
const fileArg = args.find((arg) => arg.startsWith('--file='))?.slice('--file='.length).replaceAll('\\', '/');
const completedOnly = args.includes('--completed');
const globalMode = args.includes('--global');
const jsonMode = args.includes('--json');
const partialMode = args.includes('--partial');
const showUnchanged = args.includes('--unchanged');
const markComplete = args.includes('--mark-complete');

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const duplicates = duplicateKeys(text);
  let value;
  try { value = JSON.parse(text); }
  catch (error) { return { value: undefined, errors: [`Invalid JSON: ${error.message}`] }; }
  return { value, errors: duplicates.map(({ key, at }) => `Duplicate key ${JSON.stringify(key)} at ${at}`) };
}

// Walk raw JSON before JSON.parse, which otherwise silently keeps the last duplicate member.
function duplicateKeys(text) {
  const found = [];
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') break;
    }
    return JSON.parse(text.slice(start, i));
  }
  function value(at) {
    ws();
    if (text[i] === '{') {
      i++; ws(); const keys = new Set();
      if (text[i] === '}') { i++; return; }
      while (i < text.length) {
        ws(); const keyAt = i; const key = string();
        if (keys.has(key)) found.push({ key, at: at || `character ${keyAt + 1}` });
        keys.add(key); ws(); i++; value(`${at}/${key}`); ws();
        if (text[i] === '}') { i++; return; }
        i++; ws();
      }
    } else if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      let index = 0;
      while (i < text.length) { value(`${at}[${index++}]`); ws(); if (text[i] === ']') { i++; return; } i++; }
    } else if (text[i] === '"') string();
    else { while (i < text.length && !/[\s,}\]]/.test(text[i])) i++; }
  }
  try { value(''); } catch { /* JSON.parse below reports malformed input. */ }
  return found;
}

function flattenManual(manual) {
  const rows = [];
  function visit(value, at = '') {
    if (typeof value === 'string') { rows.push([at, 'string']); return; }
    if (Array.isArray(value)) {
      rows.push([at, 'array']);
      value.forEach((item, index) => visit(item, `${at}[${index}]`));
    } else if (value && typeof value === 'object') {
      rows.push([at, 'object']);
      for (const [key, child] of Object.entries(value)) {
        if (key === 'id') rows.push([`${at}/${key}`, `id:${child}`]);
        else if (key === 'title') rows.push([`${at}/${key}`, 'string']);
        else visit(child, `${at}/${key}`);
      }
    } else rows.push([at, typeof value]);
  }
  visit(manual);
  return rows;
}

function manualPrefixMatches(source, target, at = []) {
  if (Array.isArray(source) && Array.isArray(target)) {
    const partialList = (at.length === 1 && at[0] === 'chapters')
      || (at.length === 3 && at[0] === 'chapters' && at[2] === 'topics');
    if (partialList ? target.length > source.length : target.length !== source.length) return false;
    return target.every((item, index) => manualPrefixMatches(source[index], item, [...at, String(index)]));
  }
  if (source && target && typeof source === 'object' && typeof target === 'object'
      && !Array.isArray(source) && !Array.isArray(target)) {
    const sourceKeys = Object.keys(source).sort(), targetKeys = Object.keys(target).sort();
    if (JSON.stringify(sourceKeys) !== JSON.stringify(targetKeys)) return false;
    return sourceKeys.every((key) => manualPrefixMatches(source[key], target[key], [...at, key]));
  }
  if (typeof source !== typeof target) return false;
  if (at.at(-1) === 'id' || typeof source !== 'string') return source === target;
  return true;
}

function icuArguments(ast, into = new Map()) {
  const kinds = { 1: 'argument', 2: 'number', 3: 'date', 4: 'time', 5: 'select', 6: 'plural' };
  for (const node of ast) {
    if (node.value && kinds[node.type]) {
      const kind = kinds[node.type];
      if (into.has(node.value) && into.get(node.value) !== kind) into.set(node.value, 'conflict');
      else into.set(node.value, kind);
    }
    if (node.options) for (const option of Object.values(node.options)) icuArguments(option.value, into);
    if (node.children) icuArguments(node.children, into);
  }
  return into;
}

export function validateLanguage(language) {
  const errors = [], warnings = [], files = [];
  const registry = readJson(path.join(root, 'locales/languages.json')).value;
  const appIds = fs.readdirSync(path.join(root, 'apps'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const catalogPairs = [
    ['locales/en/common.json', `locales/${language}/common.json`],
    ['locales/en/shell.json', `locales/${language}/shell.json`],
    ...appIds.map((app) => [`apps/${app}/locales/en.json`, `apps/${app}/locales/${language}.json`]),
  ];

  const chosenCatalogPairs = fileArg ? catalogPairs.filter(([, target]) => target === fileArg) : catalogPairs;
  for (const [sourceRel, targetRel] of chosenCatalogPairs) {
    const sourcePath = path.join(root, sourceRel), targetPath = path.join(root, targetRel);
    if (!fs.existsSync(sourcePath)) continue;
    const sourceResult = readJson(sourcePath);
    if (sourceResult.errors.length) errors.push(...sourceResult.errors.map((message) => `${sourceRel}: ${message}`));
    const source = sourceResult.value;
    if (!source || !Object.keys(source).length) continue;
    if (!fs.existsSync(targetPath)) { if (!partialMode) errors.push(`${targetRel}: missing translation file`); continue; }
    files.push(targetRel);
    const result = readJson(targetPath);
    errors.push(...result.errors.map((message) => `${targetRel}: ${message}`));
    if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) { errors.push(`${targetRel}: expected a JSON object`); continue; }
    const target = result.value;
    if (!partialMode) for (const key of Object.keys(source)) if (!(key in target)) errors.push(`${targetRel}: missing key ${key}`);
    for (const key of Object.keys(target)) if (!(key in source)) errors.push(`${targetRel}: extra key ${key}`);
    for (const [key, translated] of Object.entries(target)) {
      if (!(key in source)) continue;
      const original = source[key];
      if (typeof original !== 'string' || typeof translated !== 'string') { errors.push(`${targetRel}: ${key} must be a string`); continue; }
      if (!translated.trim() && original.trim()) errors.push(`${targetRel}: ${key} is empty`);
      if (showUnchanged && translated === original && original.trim()) warnings.push(`${targetRel}: ${key} is unchanged from English`);
      if (!original.trim() && !translated.trim()) continue;
      errors.push(...compareIcuMessages(original, translated, language).map((message) => `${targetRel}: ${key} ${message}`));
    }
  }

  if (!fileArg || fileArg.startsWith('apps/') && fileArg.includes('/help/')) for (const app of appIds) {
    const sourceRel = `apps/${app}/help/en.json`, targetRel = `apps/${app}/help/${language}.json`;
    if (fileArg && targetRel !== fileArg) continue;
    if (!fs.existsSync(path.join(root, sourceRel))) continue;
    const source = readJson(path.join(root, sourceRel));
    if (!source.value || !Object.keys(source.value).length) continue;
    if (!fs.existsSync(path.join(root, targetRel))) { if (!partialMode) errors.push(`${targetRel}: missing manual`); continue; }
    files.push(targetRel);
    const target = readJson(path.join(root, targetRel));
    errors.push(...target.errors.map((message) => `${targetRel}: ${message}`));
    errors.push(...emptyManualStrings(target.value).map((at) => `${targetRel}: empty manual text at ${at}`));
    const manualMatches = partialMode
      ? manualPrefixMatches(source.value, target.value)
      : JSON.stringify(flattenManual(source.value)) === JSON.stringify(flattenManual(target.value));
    if (!manualMatches) errors.push(`${targetRel}: manual structure, order, IDs, titles, or block types differ from English`);
  }
  const shellSource = path.join(root, 'help/shell/en.json'), shellTarget = path.join(root, `help/shell/${language}.json`);
  if ((!fileArg || fileArg === `help/shell/${language}.json`) && fs.existsSync(shellSource) && Object.keys(readJson(shellSource).value ?? {}).length) {
    if (!fs.existsSync(shellTarget)) { if (!partialMode) errors.push(`help/shell/${language}.json: missing manual`); }
    else {
      files.push(`help/shell/${language}.json`);
      const source = readJson(shellSource), target = readJson(shellTarget);
      errors.push(...target.errors.map((message) => `help/shell/${language}.json: ${message}`));
      errors.push(...emptyManualStrings(target.value).map((at) => `help/shell/${language}.json: empty manual text at ${at}`));
      const manualMatches = partialMode
        ? manualPrefixMatches(source.value, target.value)
        : JSON.stringify(flattenManual(source.value)) === JSON.stringify(flattenManual(target.value));
      if (!manualMatches) errors.push(`help/shell/${language}.json: manual structure, order, IDs, titles, or block types differ from English`);
    }
  }

  if (!fileArg || fileArg.startsWith('apps/') && fileArg.endsWith('/app.json')) for (const app of appIds) {
    const rel = `apps/${app}/app.json`;
    if (fileArg && rel !== fileArg) continue;
    if (!fs.existsSync(path.join(root, rel))) continue;
    files.push(rel);
    const parsed = readJson(path.join(root, rel));
    errors.push(...parsed.errors.map((message) => `${rel}: ${message}`));
    const descriptions = parsed.value?.description;
    if (descriptions && typeof descriptions.en === 'string' && !(language in descriptions)) errors.push(`${rel}: missing description for ${language}`);
    else if (descriptions && typeof descriptions.en === 'string' && (typeof descriptions[language] !== 'string' || !descriptions[language].trim())) errors.push(`${rel}: empty or invalid description for ${language}`);
    else if (showUnchanged && descriptions && typeof descriptions[language] === 'string' && descriptions[language] === descriptions.en) warnings.push(`${rel}: ${language} description is unchanged from English`);
  }

  if (fileArg && files.length === 0 && !errors.some((error) => error.startsWith(`${fileArg}:`))) errors.push(`${fileArg}: not a localization file for ${language}`);

  return { language, files, errors, warnings, sourceLanguage: registry?.source };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
const registryResult = readJson(path.join(root, 'locales/languages.json'));
if (registryResult.errors.length || !registryResult.value) {
  console.error(registryResult.errors.join('\n') || 'Cannot read locales/languages.json');
  process.exit(2);
}
const languages = registryResult.value.languages.map((item) => item.code).filter((code) => !excluded.has(code));
const progressPath = path.join(root, 'docs/localization/progress.json');
let progress = {};
if (fs.existsSync(progressPath)) {
  try { progress = JSON.parse(fs.readFileSync(progressPath, 'utf8')); }
  catch (error) { console.error(`Invalid progress file: ${error.message}`); process.exit(2); }
}
const selected = languageArg ? [languageArg] : (globalMode || completedOnly ? languages : []);
if (!selected.length) { console.error('Choose --language=<code>, --global, or --completed'); process.exit(2); }
if (markComplete && (!languageArg || fileArg || partialMode || completedOnly || globalMode)) {
  console.error('--mark-complete requires one full --language=<code> check.'); process.exit(2);
}
const results = [];
for (const language of selected) {
  if (!languages.includes(language)) { results.push({ language, errors: [`Unknown or excluded language: ${language}`], warnings: [] }); continue; }
  const state = progress.languages?.[language]?.status;
  if (completedOnly && !['translated', 'validated'].includes(state)) {
    results.push({ language, skipped: true, reason: `status is ${state ?? 'pending'}`, errors: [], warnings: [] });
    continue;
  }
  const result = validateLanguage(language);
  results.push(result);
  if (markComplete && !result.errors.length) {
    progress.languages[language] = { status: 'translated' };
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');
    writeProgressReport(progress, path.join(root, 'docs/localization/PROGRESS.md'));
  }
}
const failed = results.some((result) => result.errors.length);
if (jsonMode) console.log(JSON.stringify({ results }, null, 2));
else for (const result of results) {
  if (result.skipped) continue;
  console.log(`${result.errors.length ? 'FAIL' : 'PASS'} ${result.language}: ${result.files?.length ?? 0} files, ${result.errors.length} errors, ${result.warnings.length} warnings`);
  for (const message of result.errors) console.log(`  ERROR ${message}`);
  for (const message of result.warnings) console.log(`  WARN  ${message}`);
}
if (!jsonMode) {
  const skipped = results.filter((result) => result.skipped).length;
  if (skipped) console.log(`Skipped ${skipped} pending languages.`);
}
process.exit(failed ? 1 : 0);
}

export { duplicateKeys, icuArguments, manualPrefixMatches };

export function compareIcuMessages(source, translation, language) {
  const errors = [];
  try {
    const sourceAst = parseIcu(source, { ignoreTag: true });
    const translatedAst = parseIcu(translation, { ignoreTag: true });
    const sourceArgs = icuArguments(sourceAst), targetArgs = icuArguments(translatedAst);
    for (const [name, kind] of sourceArgs) if (targetArgs.get(name) !== kind) errors.push(`ICU argument {${name}} expected ${kind}, got ${targetArgs.get(name) ?? 'missing'}`);
    for (const [name] of targetArgs) if (!sourceArgs.has(name)) errors.push(`extra ICU argument {${name}}`);
    const inspect = (nodes) => {
      for (const node of nodes) {
        if ((node.type === 5 || node.type === 6) && !node.options.other) errors.push(`ICU ${node.type === 5 ? 'select' : 'plural'} is missing other`);
        if (node.type === 6) {
          const pluralType = node.pluralType === 'ordinal' ? 'ordinal' : 'cardinal';
          const categories = new Set(new Intl.PluralRules(language, { type: pluralType }).resolvedOptions().pluralCategories);
          for (const category of Object.keys(node.options)) if (category !== 'other' && !category.startsWith('=') && !categories.has(category)) errors.push(`ICU ${pluralType} category ${category} is not used by ${language}`);
        }
        if (node.options) for (const option of Object.values(node.options)) inspect(option.value);
        if (node.children) inspect(node.children);
      }
    };
    inspect(translatedAst);
  } catch (error) { errors.push(`invalid ICU message: ${error.message}`); }
  return errors;
}

export function emptyManualStrings(value, at = '') {
  if (typeof value === 'string') return value.trim() ? [] : [at];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => emptyManualStrings(child, at + '/' + key));
}

export function writeProgressReport(progress, output) {
  const rows = Object.entries(progress.languages).map(([code, value]) =>
    '| ' + code + ' | ' + value.status + ' | ' + (value.next ?? '—').replaceAll('|', '/') + ' |');
  fs.writeFileSync(output, '# Localization progress\n\nGenerated from progress.json. Translated means structurally complete; native-speaker and visual review remain separate.\n\n| Language | Status | Next step |\n|---|---|---|\n' + rows.join('\n') + '\n');
}
