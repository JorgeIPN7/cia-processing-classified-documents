import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Provider } from '@nestjs/common';

export const APP_VERSION = Symbol('APP_VERSION');

interface PackageJson {
  readonly version: string;
}

function isPackageJson(v: unknown): v is PackageJson {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as { version?: unknown };
  return typeof obj.version === 'string';
}

export function readPackageVersion(): string {
  const raw: unknown = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  );
  return isPackageJson(raw) ? raw.version : '0.0.0';
}

export const appVersionProvider: Provider = {
  provide: APP_VERSION,
  useFactory: (): string => readPackageVersion(),
};
