// ---------------------------------------------------------------------------
// People → Vault Sync – creates/updates vault notes for persons and orgs
// ---------------------------------------------------------------------------

import type { Person, Organization, AccountLink } from "../../people/types.js";
import type { VaultService } from "../service.js";
import { serializeFrontmatter, extractFrontmatter } from "../metadata-parser.js";

// ---------------------------------------------------------------------------
// Note path helpers
// ---------------------------------------------------------------------------

export function personNotePath(displayName: string): string {
  const safe = displayName.replace(/[/\\:]/g, "-");
  return `People/${safe}.md`;
}

export function orgNotePath(name: string): string {
  const safe = name.replace(/[/\\:]/g, "-");
  return `Organizations/${safe}.md`;
}

// ---------------------------------------------------------------------------
// Account table formatter
// ---------------------------------------------------------------------------

export function formatAccountsTable(accounts: AccountLink[]): string {
  if (accounts.length === 0) {
    return "";
  }
  const header =
    "## Accounts\n| Platform | Username | Confidence |\n|----------|----------|------------|\n";
  const rows = accounts
    .map((a) => `| ${a.platform} | ${a.platformUsername} | ${a.confidence} |`)
    .join("\n");
  return header + rows;
}

// ---------------------------------------------------------------------------
// syncPersonToVault
// ---------------------------------------------------------------------------

export async function syncPersonToVault(
  person: Person,
  vaultService: VaultService,
  orgName?: string,
): Promise<void> {
  const notePath = personNotePath(person.displayName);
  const frontmatter: Record<string, unknown> = {
    type: "person",
    miranda_id: person.id,
    platforms: person.accounts.map((a) => a.platform),
    organization: orgName ?? person.organizationId,
    tags: person.tags,
    sentiment: person.sentiment?.current,
    sla_tier: person.slaProfileId,
  };

  // Check for existing note, preserve user content below ## Notes
  const existing = await vaultService.get(notePath).catch(() => null);
  let userNotes = "";
  if (existing) {
    const notesIdx = existing.content.indexOf("## Notes");
    if (notesIdx >= 0) {
      userNotes = existing.content.slice(notesIdx);
    }
  }

  const accountsTable = formatAccountsTable(person.accounts);
  const body = `${accountsTable}\n\n${userNotes || "## Notes\n"}`;
  const content = serializeFrontmatter(frontmatter, body);

  if (existing) {
    await vaultService.update(notePath, { content });
  } else {
    await vaultService.create({ path: notePath, content });
  }
}

// ---------------------------------------------------------------------------
// syncOrgToVault
// ---------------------------------------------------------------------------

export async function syncOrgToVault(org: Organization, vaultService: VaultService): Promise<void> {
  const notePath = orgNotePath(org.name);
  const frontmatter: Record<string, unknown> = {
    type: "organization",
    miranda_id: org.id,
    domain: org.domain,
    tags: org.tags,
    members: org.members,
  };

  // Preserve user content below ## Notes
  const existing = await vaultService.get(notePath).catch(() => null);
  let userNotes = "";
  if (existing) {
    const notesIdx = existing.content.indexOf("## Notes");
    if (notesIdx >= 0) {
      userNotes = existing.content.slice(notesIdx);
    }
  }

  const memberLines =
    org.members.length > 0 ? `## Members\n${org.members.map((m) => `- ${m}`).join("\n")}\n` : "";
  const body = `${memberLines}\n${userNotes || "## Notes\n"}`;
  const content = serializeFrontmatter(frontmatter, body);

  if (existing) {
    await vaultService.update(notePath, { content });
  } else {
    await vaultService.create({ path: notePath, content });
  }
}

// ---------------------------------------------------------------------------
// readPersonPatchFromVault – read editable fields back from a vault note
// ---------------------------------------------------------------------------

export async function readPersonPatchFromVault(
  notePath: string,
  vaultService: VaultService,
): Promise<{ tags?: string[] } | null> {
  const note = await vaultService.get(notePath).catch(() => null);
  if (!note) {
    return null;
  }
  const { frontmatter } = extractFrontmatter(note.content);
  return {
    tags: Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : undefined,
  };
}
