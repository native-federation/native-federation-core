import { SCRIPT_EXTENSION } from '../domain/core/chunk.js';

export function isScript(fileName: string): boolean {
  return SCRIPT_EXTENSION.test(fileName);
}
