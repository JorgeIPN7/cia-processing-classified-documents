import { Injectable } from '@nestjs/common';

import type { CompiledMatcher } from '../interfaces/compiled-matcher.interface';
import type { Match } from '../interfaces/match.interface';
import type { Matcher } from '../interfaces/matcher.interface';
import {
  resolveMatcherOptions,
  type MatcherOptions,
} from '../interfaces/matcher-options.interface';
import type { Pattern } from '../parsers/pattern';
import { transformPattern, transformText } from './text-transform';

const MATCHER_ID = 'aho-corasick' as const;

class TrieNode {
  readonly children: Map<number, TrieNode>;
  failLink: TrieNode | null;
  readonly outputs: number[];
  readonly depth: number;

  constructor(depth: number) {
    this.children = new Map();
    this.failLink = null;
    this.outputs = [];
    this.depth = depth;
  }
}

interface AhoCorasickCompiledMatcher extends CompiledMatcher {
  readonly __matcherId: typeof MATCHER_ID;
  readonly transformedPatterns: readonly string[];
  readonly root: TrieNode | null;
}

function freezeCompiled(
  c: AhoCorasickCompiledMatcher,
): AhoCorasickCompiledMatcher {
  return Object.freeze(c);
}

const WORD_CHAR = /[A-Za-z0-9_]/;

function isWordCharAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  const ch = text[index];
  if (ch === undefined) return false;
  return WORD_CHAR.test(ch);
}

@Injectable()
export class AhoCorasickMatcher implements Matcher {
  compile(
    patterns: readonly Pattern[],
    options?: MatcherOptions,
  ): CompiledMatcher {
    const resolved = resolveMatcherOptions(options);
    const frozenPatterns: readonly Pattern[] = Object.freeze([...patterns]);
    const transformed = patterns.map((p) => transformPattern(p, resolved));
    const frozenTransformed: readonly string[] = Object.freeze([
      ...transformed,
    ]);

    const hasAnyNonEmpty = transformed.some((t) => t.length > 0);
    if (patterns.length === 0 || !hasAnyNonEmpty) {
      return freezeCompiled({
        patterns: frozenPatterns,
        transformedPatterns: frozenTransformed,
        options: resolved,
        root: null,
        __matcherId: MATCHER_ID,
      });
    }

    const root = new TrieNode(0);

    for (let idx = 0; idx < transformed.length; idx++) {
      const tp = transformed[idx];
      if (tp === undefined || tp.length === 0) continue;
      let node = root;
      for (const ch of tp) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        let child = node.children.get(cp);
        if (child === undefined) {
          child = new TrieNode(node.depth + 1);
          node.children.set(cp, child);
        }
        node = child;
      }
      node.outputs.push(idx);
    }

    root.failLink = root;
    const queue: TrieNode[] = [];
    for (const child of root.children.values()) {
      child.failLink = root;
      queue.push(child);
    }

    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
      for (const [cp, child] of node.children) {
        let f: TrieNode = node.failLink ?? root;
        while (f !== root && !f.children.has(cp)) {
          f = f.failLink ?? root;
        }
        const candidate = f.children.get(cp);
        child.failLink =
          candidate !== undefined && candidate !== child ? candidate : root;
        const failOutputs = child.failLink.outputs;
        if (failOutputs.length > 0) {
          for (const idx of failOutputs) child.outputs.push(idx);
        }
        queue.push(child);
      }
    }

    const visited = new Set<TrieNode>();
    const freezeQueue: TrieNode[] = [root];
    visited.add(root);
    while (freezeQueue.length > 0) {
      const node = freezeQueue.shift();
      if (node === undefined) break;
      Object.freeze(node.outputs);
      Object.freeze(node);
      for (const child of node.children.values()) {
        if (!visited.has(child)) {
          visited.add(child);
          freezeQueue.push(child);
        }
      }
    }

    return freezeCompiled({
      patterns: frozenPatterns,
      transformedPatterns: frozenTransformed,
      options: resolved,
      root,
      __matcherId: MATCHER_ID,
    });
  }

  match(text: string, compiled: CompiledMatcher): readonly Match[] {
    if (compiled.__matcherId !== MATCHER_ID) {
      throw new Error('CompiledMatcher was not produced by AhoCorasickMatcher');
    }
    const c = compiled as AhoCorasickCompiledMatcher;
    if (c.root === null || text.length === 0) return Object.freeze([]);

    const { normalized, offsetMap } = transformText(text, c.options);
    if (normalized.length === 0) return Object.freeze([]);

    const raw: { nStart: number; nEnd: number; patternIdx: number }[] = [];
    let current: TrieNode = c.root;
    let i = 0;

    while (i < normalized.length) {
      const cp = normalized.codePointAt(i);
      if (cp === undefined) break;
      const charLen = cp >= 0x10000 ? 2 : 1;
      const nextI = i + charLen;

      while (current !== c.root && !current.children.has(cp)) {
        current = current.failLink ?? c.root;
      }
      const next = current.children.get(cp);
      if (next !== undefined) {
        current = next;
      }

      if (current.outputs.length > 0) {
        const nEnd = nextI;
        for (const patternIdx of current.outputs) {
          const tp = c.transformedPatterns[patternIdx];
          if (tp === undefined || tp.length === 0) continue;
          const nStart = nEnd - tp.length;
          if (nStart < 0) continue;
          raw.push({ nStart, nEnd, patternIdx });
        }
      }

      i = nextI;
    }

    raw.sort(
      (a, b) => a.nStart - b.nStart || b.nEnd - b.nStart - (a.nEnd - a.nStart),
    );

    const boundaryFiltered = c.options.wordBoundaries
      ? raw.filter((h) => {
          const leftBoundary =
            isWordCharAt(normalized, h.nStart - 1) !==
            isWordCharAt(normalized, h.nStart);
          const rightBoundary =
            isWordCharAt(normalized, h.nEnd - 1) !==
            isWordCharAt(normalized, h.nEnd);
          return leftBoundary && rightBoundary;
        })
      : raw;

    const out: Match[] = [];
    let lastEnd = -1;
    for (const h of boundaryFiltered) {
      if (h.nStart < lastEnd) continue;

      let start: number;
      let end: number;
      if (offsetMap === null) {
        start = h.nStart;
        end = h.nEnd;
      } else {
        const ms = offsetMap[h.nStart];
        const me = offsetMap[h.nEnd];
        if (ms === undefined || me === undefined) continue;
        start = ms;
        end = me;
      }

      const originalPattern = c.patterns[h.patternIdx];
      if (originalPattern === undefined) continue;

      out.push({ start, end, pattern: originalPattern });
      lastEnd = h.nEnd;
    }

    return Object.freeze(out);
  }
}
