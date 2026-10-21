export const CHUNK_PREFIX = '@nf-internal';

export const SCRIPT_EXTENSION = /\.(m|c)?js$/;

export function toChunkImport(fileName: string): string {
  if (fileName.startsWith('./')) {
    fileName = fileName.slice(2);
  }

  const packageName = fileName.replace(SCRIPT_EXTENSION, '');
  return CHUNK_PREFIX + '/' + packageName;
}
