// ---------------------------------------------------------------------------
// Knowledge Base Types
// ---------------------------------------------------------------------------

export type KBConfig = {
  enabled: boolean;
  provider: string;
  vaultPath: string;
  vaultName?: string;
  syncFolder?: string;
  openCommand?: string;
  searchCommand?: string;
};

export type KBFilter = {
  folder?: string;
  tags?: string[];
  limit?: number;
};

export type KBNoteSummary = {
  path: string;
  title: string;
  tags: string[];
  updatedAtMs: number;
  createdAtMs: number;
  sizeBytes: number;
};

export type KBNote = {
  path: string;
  title: string;
  content: string;
  metadata: {
    frontmatter: Record<string, unknown>;
    headings: string[];
    links: string[];
    tags: string[];
    wordCount: number;
  };
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
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

export type KBStatus = {
  configured: boolean;
  provider: string;
  vaultPath: string;
  noteCount: number;
};
