import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const widgets = new Set(['questions', 'gallery', 'weather']);
const extensions = new Set(['.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.json']);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// Delete only the fixed build directory inside this checkout.
if (relative(root, output) !== 'dist' || !output.startsWith(root + sep)) throw Error('Invalid build destination');
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw Error('Build destination cannot be a symlink');
console.log('Building widget assets in ' + output);
rmSync(output, { recursive: true, force: true });
let copied = 0;
for (const path of tracked) {
  const parts = path.split('/');
  if (!widgets.has(parts[0]) || parts.includes('tests') || !extensions.has(extname(path).toLowerCase())) continue;
  const from = resolve(root, path);
  if (!lstatSync(from).isFile() || lstatSync(from).isSymbolicLink()) throw Error('Unsupported asset: ' + path);
  const to = resolve(output, 'widgets', path);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  copied++;
}
for (const widget of widgets) {
  const index = resolve(output, 'widgets', widget, 'index.html');
  if (!existsSync(index) || !readFileSync(index, 'utf8').includes('<html')) throw Error('Missing widget entry: ' + widget);
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
console.log('Release commit: ' + commit);
writeFileSync(resolve(output, '_headers'), `/widgets/*\n  X-Widgets-Deployment: independent\n  X-Widgets-Commit: ${commit}\n`);
console.log(`Built ${copied} browser assets. SQL, tests, docs and untracked files are excluded.`);
