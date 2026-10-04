export function safePath(path) {
  if (!/^(config|state|sources\/(imports|web)|reports)\/[a-zA-Z0-9_./-]+\.md$/.test(path) || path.split('/').includes('..')) throw new Error('Archive accepts Markdown in HonkyTonk directories only');
  return path;
}
