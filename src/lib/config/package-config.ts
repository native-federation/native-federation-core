import { stableStringify } from '../utils/format-list.js';
import { logger } from '../utils/logger.js';

// see docs/architecture/shared-packages.md
const PACKAGE_CONFIG_FIELDS = [
  'requiredVersion',
  'singleton',
  'strictVersion',
  'version',
  'build',
  'pool',
  'chunks',
  'shareScope',
  'preload',
] as const;

type PackageConfigField = (typeof PACKAGE_CONFIG_FIELDS)[number];
type PackageFields = Partial<Record<PackageConfigField, unknown>>;

export interface IgnoredPackageConfig {
  packageName: string;
  source: string;
  fields: PackageConfigField[];
}

// The entry each package takes its config from: its main entry, else the first one listed.
export function packageSources(
  names: Iterable<string>,
  packageOf: (name: string) => string
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const name of names) {
    const packageName = packageOf(name);
    if (!sources.has(packageName) || name === packageName) sources.set(packageName, name);
  }
  return sources;
}

function withPackageFields<T extends PackageFields>(own: T, source: T): T {
  const result: PackageFields = { ...own };
  for (const field of PACKAGE_CONFIG_FIELDS) {
    if (source[field] === undefined) delete result[field];
    else result[field] = source[field];
  }
  return result as T;
}

// A field the entry leaves unset is inherited, not ignored. share() stamps a version on an 'auto'
// entry that shareAll() leaves unset; core derived it, so it is no config to ignore.
function ignoredPackageFields(own: PackageFields, source: PackageFields): PackageConfigField[] {
  return PACKAGE_CONFIG_FIELDS.filter(
    field =>
      own[field] !== undefined &&
      !(field === 'version' && source.version === undefined) &&
      stableStringify(own[field]) !== stableStringify(source[field])
  );
}

export function alignToPackages<T extends PackageFields>(
  configs: Record<string, T>,
  packageOf: (name: string) => string
): { configs: Record<string, T>; ignored: IgnoredPackageConfig[] } {
  const sources = packageSources(Object.keys(configs), packageOf);
  const ignored = new Map<string, Set<PackageConfigField>>();

  const aligned = Object.fromEntries(
    Object.entries(configs).map(([name, own]) => {
      const packageName = packageOf(name);
      const sourceName = sources.get(packageName)!;
      if (sourceName === name) return [name, own];
      const source = configs[sourceName]!;

      const fields = ignoredPackageFields(own, source);
      if (fields.length > 0) {
        const seen = ignored.get(packageName) ?? new Set();
        fields.forEach(field => seen.add(field));
        ignored.set(packageName, seen);
      }
      return [name, withPackageFields(own, source)];
    })
  );

  return {
    configs: aligned,
    ignored: [...ignored].map(([packageName, fields]) => ({
      packageName,
      source: sources.get(packageName)!,
      fields: PACKAGE_CONFIG_FIELDS.filter(field => fields.has(field)),
    })),
  };
}

export function warnIgnoredPackageConfig(ignored: IgnoredPackageConfig[]): void {
  for (const { packageName, source, fields } of ignored) {
    const from = source === packageName ? 'its main entry' : `its first entry point, '${source}'`;
    logger.warn(
      `Entry points of shared package '${packageName}' set different ${fields.join(', ')}. A ` +
        `package is shared with one config, taken from ${from}; the other entry points' values ` +
        `are ignored. Set them once, on '${source}'.`
    );
  }
}
