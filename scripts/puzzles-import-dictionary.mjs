import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDictionaryOverrides } from './puzzles-dictionary-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/puzzles-import-dictionary.mjs <pinned ESDB checkout> [--build]');
const commit = '1e5b7d3a72f47a71da5d28686c1dd4b397178485';
const cwd = path.resolve(source);
const run = (command, args) => execFileSync(command, args, {
  cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1' },
});
const gitArgs = ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`];
if (run('git', [...gitArgs, 'rev-parse', 'HEAD']).trim() !== commit) throw new Error('Unexpected ESDB source revision.');
run('git', [...gitArgs, 'diff', '--exit-code', 'HEAD', '--']);
if (process.argv.includes('--build')) run('python', ['-X', 'utf8', 'combine.py', 'create-db', 'scowl.db']);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const shared = [
  'A,B,Z', '1', '--regions=US,GB', '--categories=',
  '--wo-poses=abbr,pre,suf,wp,we,x',
  '--wo-pos-classes=person,surname,place,name,demonym,trademark,abbr,upper,name?,upper?,abbr?',
  '--wo-tags=coca-llm',
];
const acceptedArgs = ['-X', 'utf8', '-m', 'libscowl', 'word-list', '60', ...shared];
const generationArgs = ['-X', 'utf8', '-m', 'libscowl', 'word-list', '35', ...shared,
  '--wo-usage-notes=vulgar-1,vulgar-2,vulgar-3,offensive-1,offensive-2,offensive-3'];
const acceptedRaw = run('python', acceptedArgs);
const generationRaw = run('python', generationArgs);
const normalize = (raw) => [...new Set(raw.split(/\r?\n/)
  .filter((word) => /^[a-z]{1,15}$/.test(word) || word === 'I')
  .map((word) => word.toLowerCase()))].sort();
const overridesRaw = await readFile(path.join(root, 'data/dictionary/overrides.json'), 'utf8');
const overrides = JSON.parse(overridesRaw);
const words = applyDictionaryOverrides(normalize(acceptedRaw), overrides);
const accepted = new Set(words);
if (!accepted.has('a') || !accepted.has('i')) throw new Error('Upstream normal a/I entries missing.');
if (words.filter((word) => word.length === 1).join(',') !== 'a,i') throw new Error('Only a and i may remain as playable one-letter words.');
const generation = normalize(generationRaw).filter((word) => accepted.has(word) && word.length >= 4 && word.length <= 10);
const wordsJson = `${JSON.stringify(words)}\n`;
const generationJson = `${JSON.stringify(generation)}\n`;
const dictionarySha256 = sha256(wordsJson);
const version = `esdb60-${commit.slice(0, 8)}-${overrides.revision}-${dictionarySha256.slice(0, 12)}`;
const sourceCopyright = await readFile(path.join(cwd, 'Copyright'), 'utf8');
const copyright = sourceCopyright.replaceAll('\r\n', '\n');
const publicFilename = `words-${version}.json`;
const publicJson = `${JSON.stringify({ version, copyright, words })}\n`;
const manifest = {
  version, source: 'https://github.com/en-wl/wordlist', commit,
  sourceTree: run('git', [...gitArgs, 'rev-parse', 'HEAD^{tree}']).trim(),
  buildCommand: ['python', '-X', 'utf8', 'combine.py', 'create-db', 'scowl.db'],
  acceptedExport: ['python', ...acceptedArgs], generationExport: ['python', ...generationArgs],
  policy: {
    revision: overrides.revision, size: 60, spellings: ['A', 'B', 'Z'], regions: ['US', 'GB'], variantLevel: 1,
    alphabet: 'ASCII a-z', length: [1, 15], case: 'source lowercase only, except ordinary pronoun I',
    properNames: 'exclude upstream proper-name classes and capitalized forms; source metadata is incomplete',
    abbreviations: 'exclude upstream abbreviation POS and classes',
    specialCategories: 'excluded', llmTaggedContributions: 'coca-llm excluded',
    generation: 'ESDB size35, 4-10 letters, tagged vulgar/offensive usage excluded; accepted-word subset',
    singleLetters: ['a', 'i'], additions: overrides.additions, exclusions: overrides.exclusions,
    overridePrecedence: 'Normalize additions, then exclusions; exclusions win.',
  },
  wordCount: words.length, generationWordCount: generation.length,
  sha256: dictionarySha256, generationSha256: sha256(generationJson),
  rawExportSha256: sha256(acceptedRaw), generationRawExportSha256: sha256(generationRaw),
  overridesSha256: sha256(overridesRaw),
  sourceCopyrightSha256: sha256(sourceCopyright), copyrightSha256: sha256(copyright),
  publicFile: `/data/${publicFilename}`, publicSha256: sha256(publicJson),
};
await mkdir(path.join(root, 'data/dictionary'), { recursive: true });
await mkdir(path.join(root, 'public/data'), { recursive: true });
await writeFile(path.join(root, 'data/dictionary/words.json'), wordsJson);
await writeFile(path.join(root, 'data/dictionary/generation.json'), generationJson);
await writeFile(path.join(root, 'data/dictionary/Copyright'), copyright);
await writeFile(path.join(root, 'data/dictionary/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(root, 'public/data', publicFilename), publicJson);
console.log(JSON.stringify({ version, wordCount: words.length, generationWordCount: generation.length, publicFile: manifest.publicFile }));
