// Knowledge Base – Core Types

export type KBLink = {
  target: string;
  alias?: string;
  position: { line: number; col: number };
};

export type KBTag = {
  name: string;
  position: { line: number; col: number };
};

export type KBHeading = {
  level: number;
  text: string;
  line: number;
};

export type KBNoteMetadata = {
  frontmatter: Record<string, unknown>;
  headings: KBHeading[];
  links: KBLink[];
  tags: KBTag[];
  wordCount: number;
};

export type KBNote = {
  path: string;
  title: string;
  content: string;
  metadata: KBNoteMetadata;
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
};

export type KBNoteSummary = {
  path: string;
  title: string;
  tags: string[];
  linkCount: number;
  wordCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type KBNoteCreateInput = {
  path: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
};

export type KBSearchResult = {
  path: string;
  title: string;
  score: number;
  matches: string[];
};

export type KBFilter = {
  folder?: string;
  tags?: string[];
  query?: string;
  limit?: number;
};

export type KBProviderType = "obsidian" | "logseq" | "notion" | "custom";

export type KBConfig = {
  enabled: boolean;
  provider: KBProviderType;
  vaultPath: string;
  vaultName?: string;
  syncFolder?: string;
  openCommand?: string;
  searchCommand?: string;
};

export type KBStatus = {
  configured: boolean;
  provider: KBProviderType | null;
  vaultPath: string | null;
  noteCount: number;
};
