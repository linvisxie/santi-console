import fs from 'node:fs';
import path from 'node:path';

const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', '.workbench', '_archive', '.uploads', '__pycache__']);
export function resolveFile(root, relative = '') {
  const base = fs.realpathSync(root);
  const target = fs.realpathSync(path.resolve(base, relative));
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件不在当前项目内');
  return target;
}
export function listFiles(root, relative = '') {
  const dir = resolveFile(root, relative);
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !ignored.has(e.name)).map((e) => {
    const file = path.join(dir, e.name); const stat = fs.statSync(file);
    return { name: e.name, path: path.relative(fs.realpathSync(root), file), directory: stat.isDirectory(), link: e.isSymbolicLink(), size: stat.size };
  }).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
export function readFile(root, relative) {
  const file = resolveFile(root, relative); const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('请选择文件');
  const ext = path.extname(file).toLowerCase();
  const mime = ({ '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf' })[ext];
  if (mime) return { path: file, relative, size: stat.size, mime, binary: true };
  if (stat.size > 2 << 20) return { path: file, relative, size: stat.size, binary: false, tooLarge: true };
  const content = fs.readFileSync(file);
  if (content.includes(0)) return { path: file, relative, size: stat.size, binary: true, mime: 'application/octet-stream' };
  return { path: file, relative, size: stat.size, content: content.toString('utf8'), binary: false };
}
