/** A key is re-exportable only if it is a syntactically valid identifier name. */
export const isIdentifierName = (name: string): boolean =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);

/**
 * Decides whether a `require()`d CommonJS value needs a synthetic named-export
 * wrapper, and which names to re-export. UMD/CJS packages (e.g. dayjs) assign
 * named exports dynamically, invisible to static lexers; enumerating the value
 * recovers them. ES-module namespaces and `__esModule` interop objects are
 * skipped — a bundler already exposes those statically.
 */
export const planCjsWrap = (mod: unknown): { wrap: boolean; keys: string[] } => {
  if (mod === null || (typeof mod !== 'object' && typeof mod !== 'function')) {
    return { wrap: false, keys: [] };
  }
  if ((mod as Record<PropertyKey, unknown>)[Symbol.toStringTag] === 'Module') {
    return { wrap: false, keys: [] };
  }
  if ((mod as Record<string, unknown>)['__esModule']) {
    return { wrap: false, keys: [] };
  }

  const keys = Object.keys(mod as object).filter(
    key => key !== 'default' && key !== '__esModule' && isIdentifierName(key)
  );

  return { wrap: keys.length > 0, keys };
};

/**
 * Synthetic ESM entry re-exporting the CommonJS default plus each discovered name.
 * The `export { local as key }` clause lets reserved-word keys (`class`, `default`)
 * pass without escaping.
 */
export const buildSyntheticCjsEntry = (importPath: string, keys: string[]): string => {
  const spec = JSON.stringify(importPath);
  const lines = [`import _nfDefault from ${spec};`, `export default _nfDefault;`];

  if (keys.length > 0) {
    keys.forEach((key, i) => lines.push(`const _nf${i} = _nfDefault[${JSON.stringify(key)}];`));
    lines.push(`export { ${keys.map((key, i) => `_nf${i} as ${key}`).join(', ')} };`);
  }

  return lines.join('\n') + '\n';
};

/** True when a `require()` failure just means the file was ESM after all. */
export const isEsmInteropError = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ERR_REQUIRE_ESM' || code === 'ERR_REQUIRE_ASYNC_MODULE') return true;
  return (
    err instanceof SyntaxError &&
    /Unexpected token 'export'|Cannot use import statement|export|import statement/.test(err.message)
  );
};
