import * as path from 'path';
import { logger } from '../logger.js';
import { findOptimalExport, resolveExportsEntry } from './exports-resolver.js';
import { getPkgFolder } from '../io/package-json-repository.js';
import type {
  PackageInfo,
  PartialPackageJson,
  PackageJsonRepository,
} from '../../domain/utils/package-json.contract.js';

interface ResolveContext {
  packageName: string;
  version: string;
  esm: boolean;
  mainPkgPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainPkgJson: any;
  relSecondaryPath: string;
  secondaryPkgPath: string;
  secondaryPkgJson: PartialPackageJson | null;
  repo: PackageJsonRepository;
}

type Strategy = (ctx: ResolveContext) => PackageInfo | null;

const base = (ctx: ResolveContext, entryPoint: string, esm: boolean): PackageInfo => ({
  entryPoint,
  packageName: ctx.packageName,
  version: ctx.version,
  esm,
});

const STRATEGIES: Strategy[] = [
  ctx => {
    const entry = resolveExportsEntry(ctx.mainPkgJson?.exports, ctx.relSecondaryPath);
    if (!entry) return null;
    return findOptimalExport(entry, base(ctx, ctx.mainPkgPath, ctx.esm)) ?? null;
  },
  ctx =>
    ctx.mainPkgJson['module'] && ctx.relSecondaryPath === '.'
      ? base(ctx, path.join(ctx.mainPkgPath, ctx.mainPkgJson['module']), true)
      : null,
  ctx =>
    ctx.secondaryPkgJson?.module
      ? base(ctx, path.join(ctx.secondaryPkgPath, ctx.secondaryPkgJson.module), true)
      : null,
  ctx => {
    const cand = path.join(ctx.secondaryPkgPath, 'index.mjs');
    return ctx.repo.exists(cand) ? base(ctx, cand, true) : null;
  },
  ctx =>
    ctx.secondaryPkgJson?.main
      ? base(ctx, path.join(ctx.secondaryPkgPath, ctx.secondaryPkgJson.main), ctx.esm)
      : null,
  ctx => {
    const cand = path.join(ctx.secondaryPkgPath, 'index.js');
    return ctx.repo.exists(cand) ? base(ctx, cand, ctx.esm) : null;
  },
  ctx => {
    const cand = ctx.secondaryPkgPath + '.js';
    return ctx.repo.exists(cand) ? base(ctx, cand, ctx.esm) : null;
  },
  ctx => {
    const cand = ctx.secondaryPkgPath + '.mjs';
    return ctx.repo.exists(cand) ? base(ctx, cand, ctx.esm) : null;
  },
];

export function resolvePackageInfo(
  repo: PackageJsonRepository,
  packageName: string,
  directory: string
): PackageInfo | null {
  const mainPkgName = getPkgFolder(packageName);
  if (!mainPkgName) throw new Error(`Could not resolve "${packageName}" in "${directory}`);

  const mainPkgJsonPath = repo.findDepPackageJson(packageName, directory);
  if (!mainPkgJsonPath) return null;

  const mainPkgPath = path.dirname(mainPkgJsonPath);
  const mainPkgJson = repo.readJson(mainPkgJsonPath);

  const version = mainPkgJson['version'] as string;
  const esm = mainPkgJson['type'] === 'module';

  if (!version) {
    logger.warn('No version found for ' + packageName);
    return null;
  }

  const pathToSecondary = path.relative(mainPkgName, packageName);
  const relSecondaryPath = !pathToSecondary ? '.' : './' + pathToSecondary.replace(/\\/g, '/');

  const secondaryPkgPath = path.join(mainPkgPath, relSecondaryPath);
  const secondaryPkgJsonPath = path.join(secondaryPkgPath, 'package.json');
  const secondaryPkgJson: PartialPackageJson | null = repo.exists(secondaryPkgJsonPath)
    ? repo.readJson(secondaryPkgJsonPath)
    : null;

  const ctx: ResolveContext = {
    packageName,
    version,
    esm,
    mainPkgPath,
    mainPkgJson,
    relSecondaryPath,
    secondaryPkgPath,
    secondaryPkgJson,
    repo,
  };

  for (const strategy of STRATEGIES) {
    const result = strategy(ctx);
    if (result) return result;
  }

  logger.warn('No entry point found for ' + packageName);
  logger.warn(
    "If you don't need this package, skip it in your federation.config.js or consider moving it into depDependencies in your package.json"
  );
  return null;
}
