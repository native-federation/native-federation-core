export type SkipFn = (name: string) => boolean;
export type SkipListEntry = string | RegExp | SkipFn;
export type SkipList = SkipListEntry[];

export type PreparedSkipList = {
  strings: Set<string>;
  functions: SkipFn[];
  regexps: RegExp[];
};
