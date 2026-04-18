import type { Brand } from '../../common/brand';

export type RedactionKey = Brand<string, 'RedactionKey'>;

export function createRedactionKey(raw: string): RedactionKey {
  return raw as RedactionKey;
}
