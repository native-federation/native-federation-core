export type ExportCondition =
  | 'import'
  | 'require'
  | 'node'
  | 'cjs'
  | 'esm'
  | 'default'
  | 'types'
  | 'browser'
  | (string & {});

export type ExportEntry =
  | string
  | undefined
  | { [key in ExportCondition]?: ExportEntry }
  | ExportEntry[];

/**
 * Classify a package.json `exports` condition key as ESM (`true`), CJS (`false`),
 * or ambiguous (`undefined`).
 */
export const isESMExport = (e: string): boolean | undefined => {
  if (e === 'import' || e === 'module-sync') return true;
  // Common ESM conventions
  if (e === 'module' || e === 'esm' || /^es20\d{2}$/.test(e)) return true;

  if (e === 'require') return false;
  // Common CJS conventions
  if (e === 'cjs' || e === 'commonjs') return false;

  // Ambiguous
  return undefined;
};
