export type MemoryCommandOptions = {
  agent?: string;
  json?: boolean;
  deep?: boolean;
  index?: boolean;
  force?: boolean;
  verbose?: boolean;
};

export type MemorySearchCommandOptions = MemoryCommandOptions & {
  query?: string;
  expandGraph?: boolean;
  tokenLimit?: number;
};
