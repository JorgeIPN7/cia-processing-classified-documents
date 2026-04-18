export interface Mapping {
  readonly pos: number;
  readonly len: number;
  readonly original: string;
}

export interface RedactionKeyPayload {
  readonly v: 1;
  readonly m: readonly Mapping[];
}
