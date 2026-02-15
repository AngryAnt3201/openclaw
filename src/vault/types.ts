// ---------------------------------------------------------------------------
// Vault (Knowledge Base) – Core Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Note metadata extracted from markdown content
// ---------------------------------------------------------------------------

export type VaultLink = {
  target: string;
  alias?: string;
  position: { line: number; col: number };
};

export type VaultTag = {
  name: string;
  position: { line: number; col: number };
};

export type VaultHeading = {
  level: number;
  text: string;
  line: number;
};

export type VaultNoteMetadata = {
  frontmatter: Record<string, unknown>;
  headings: VaultHeading[];
  links: VaultLink[];
  tags: VaultTag[];
  wordCount: number;
};

// ---------------------------------------------------------------------------
// Core note types
// ---------------------------------------------------------------------------

export type VaultNote = {
  path: string;
  title: string;
  content: string;
  metadata: VaultNoteMetadata;
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
};

export type VaultNoteSummary = {
  path: string;
  title: string;
  tags: string[];
  linkCount: number;
  wordCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// CRUD inputs
// ---------------------------------------------------------------------------

export type VaultNoteCreateInput = {
  path: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  templatePath?: string;
};

export type VaultNotePatch = {
  content?: string;
  frontmatter?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Tree structure
// ---------------------------------------------------------------------------

export type VaultTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: VaultTreeNode[];
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type VaultSearchResult = {
  path: string;
  title: string;
  score: number;
  matches: string[];
};

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export type VaultBacklink = {
  sourcePath: string;
  sourceTitle: string;
  context: string;
};

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type VaultGraphNode = {
  id: string;
  title: string;
  path: string;
  tags: string[];
  linkCount: number;
};

export type VaultGraphEdge = {
  source: string;
  target: string;
};

export type VaultGraph = {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
};

// ---------------------------------------------------------------------------
// Canvas (Obsidian JSON Canvas)
// ---------------------------------------------------------------------------

export type CanvasNode = {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  color?: string;
};

export type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
  color?: string;
};

export type CanvasData = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

// ---------------------------------------------------------------------------
// Filter + Config
// ---------------------------------------------------------------------------

export type VaultFilter = {
  folder?: string;
  tags?: string[];
  query?: string;
  limit?: number;
};

export type VaultConfig = {
  vaultPath?: string;
  dailyNoteFormat?: string;
  defaultTemplate?: string;
  ignoreFolders?: string[];
};
