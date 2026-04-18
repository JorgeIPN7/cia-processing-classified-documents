export interface ParserOptions {
  readonly trim?: boolean;
}

export interface ResolvedParserOptions {
  readonly trim: boolean;
}

export const DEFAULT_PARSER_OPTIONS: ResolvedParserOptions = {
  trim: true,
} as const;

export function resolveParserOptions(
  opts?: ParserOptions,
): ResolvedParserOptions {
  return {
    trim: opts?.trim ?? DEFAULT_PARSER_OPTIONS.trim,
  };
}
