import type { ResolvedMatcherOptions } from '../interfaces/matcher-options.interface';
import type { Pattern } from '../parsers/pattern';

export interface TransformTextResult {
  readonly normalized: string;
  readonly offsetMap: readonly number[] | null;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?()[\]{}^$|\\/]/g, '\\$&');
}

export function transformPattern(
  raw: Pattern,
  opts: ResolvedMatcherOptions,
): string {
  let s: string = raw;
  if (!opts.caseSensitive) s = s.toLowerCase();
  if (opts.normalizeUnicode) s = s.normalize('NFD').replace(/\p{M}+/gu, '');
  if (opts.normalizeWhitespace) s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function transformText(
  text: string,
  opts: ResolvedMatcherOptions,
): TransformTextResult {
  const needsCase = !opts.caseSensitive;
  const needsUnicode = opts.normalizeUnicode;
  const needsWhitespace = opts.normalizeWhitespace;

  if (!needsCase && !needsUnicode && !needsWhitespace) {
    return { normalized: text, offsetMap: null };
  }

  const outChars: string[] = [];
  const outMap: number[] = [];
  let prevWasSpace = false;
  let i = 0;

  while (i < text.length) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const charLen = codePoint >= 0x10000 ? 2 : 1;
    let fragment = String.fromCodePoint(codePoint);

    if (needsCase) fragment = fragment.toLowerCase();
    if (needsUnicode) {
      fragment = fragment.normalize('NFD').replace(/\p{M}+/gu, '');
    }

    if (
      needsWhitespace &&
      fragment.length > 0 &&
      /^\s+$/u.test(fragment)
    ) {
      if (!prevWasSpace) {
        outChars.push(' ');
        outMap.push(i);
        prevWasSpace = true;
      }
    } else if (fragment.length > 0) {
      prevWasSpace = false;
      for (const ch of fragment.split('')) {
        outChars.push(ch);
        outMap.push(i);
      }
    }

    i += charLen;
  }

  outMap.push(text.length);
  return { normalized: outChars.join(''), offsetMap: outMap };
}
