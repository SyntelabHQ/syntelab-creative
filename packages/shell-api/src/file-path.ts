/** The name of a file, without the folders it is in. Takes `/` and `\` both. */
export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The folder a file is in; empty when the path has none. */
export function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'), 0));
}

/** The ending of a file's name without the dot, in small letters; empty when it has none. */
export function fileEnding(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
