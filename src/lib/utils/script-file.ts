export const SCRIPT_EXTENSION = /\.(m|c)?js$/;

export function isScript(fileName: string): boolean {
  return SCRIPT_EXTENSION.test(fileName);
}
