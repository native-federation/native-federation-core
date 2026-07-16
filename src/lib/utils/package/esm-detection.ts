/**
 * Classify a package.json `exports` condition key as ESM (`true`), CJS (`false`),
 * or ambiguous (`undefined`).
 */
export const isESMExport = (e: string): boolean | undefined => {
  if (e === 'import' || e === 'module-sync') return true;
  if (e === 'module' || e === 'esm' || /^es20\d{2}$/.test(e)) return true;

  if (e === 'require') return false;
  if (e === 'cjs' || e === 'commonjs') return false;

  return undefined;
};

export type ModuleFormat = 'esm' | 'cjs' | 'unknown';

/** Node's format rule keyed on extension alone; `.js` stays ambiguous. */
export const classifyByExtension = (entryPoint: string): ModuleFormat => {
  if (entryPoint.endsWith('.mjs')) return 'esm';
  if (entryPoint.endsWith('.cjs')) return 'cjs';
  if (entryPoint.endsWith('.js')) return 'unknown';
  return 'esm';
};

/** Does the source contain top-level ESM `import`/`export`? Dynamic `import()` is excluded (legal in CJS). */
export const hasEsmSyntax = (source: string): boolean => {
  const head = source.slice(0, 16_384);
  const exportStmt =
    /(?:^|[;\n}])\s*export\s*(?:\{|\*|default\b|const\b|let\b|var\b|function\b|async\b|class\b)/;
  const importStmt = /(?:^|[;\n}])\s*import\s*(?:[A-Za-z_$]|\{|\*|['"])/;
  return exportStmt.test(head) || importStmt.test(head);
};

export const isCjsCandidate = (input: {
  esm?: boolean;
  entryPoint: string;
  /** Nearest package.json `type` for an ambiguous `.js`. */
  packageType?: 'module' | 'commonjs';
  /** Lazy source for fallback content sniff; only read for an ambiguous `.js`. */
  readSource?: () => string;
}): boolean => {
  if (input.esm === true) return false;

  const fmt = classifyByExtension(input.entryPoint);
  if (fmt === 'esm') return false;
  if (fmt === 'cjs') return true;

  if (input.packageType === 'module') return false;
  if (input.readSource) {
    try {
      if (hasEsmSyntax(input.readSource())) return false;
    } catch {
      // Unreadable: the guarded build-time require() at the call site still backstops a wrong guess.
    }
  }
  return true;
};
