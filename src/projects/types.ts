// ---------------------------------------------------------------------------
// Project Types – first-class entity for grouping tasks
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  status: ProjectStatus;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ProjectCreateInput = {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
};

export type ProjectPatch = {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  status?: ProjectStatus;
};

export type ProjectFilter = {
  status?: ProjectStatus;
};

export type ProjectStoreFile = {
  version: 1;
  projects: Project[];
};
