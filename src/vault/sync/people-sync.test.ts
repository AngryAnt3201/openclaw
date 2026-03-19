import { describe, expect, it, vi } from "vitest";
import type { Person, Organization, AccountLink } from "../../people/types.js";
import type { VaultService } from "../service.js";
import {
  syncPersonToVault,
  syncOrgToVault,
  readPersonPatchFromVault,
  personNotePath,
  formatAccountsTable,
} from "./people-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPerson(overrides?: Partial<Person>): Person {
  return {
    id: "person-uuid-001",
    displayName: "Alice Smith",
    accounts: [],
    groupIds: [],
    tags: ["customer", "vip"],
    aiTopics: [],
    notes: "",
    createdAtMs: 1000000,
    updatedAtMs: 2000000,
    ...overrides,
  };
}

function mockOrg(overrides?: Partial<Organization>): Organization {
  return {
    id: "org-uuid-001",
    name: "Acme Corp",
    domain: "acme.com",
    tags: ["enterprise"],
    members: ["person-uuid-001", "person-uuid-002"],
    createdAtMs: 1000000,
    updatedAtMs: 2000000,
    ...overrides,
  };
}

function mockAccountLink(overrides?: Partial<AccountLink>): AccountLink {
  return {
    id: "acct-001",
    platform: "discord",
    platformUserId: "discord-123",
    platformUsername: "alice#1234",
    confidence: "manual",
    linkedAtMs: 1000000,
    ...overrides,
  };
}

function mockVaultService() {
  return {
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  } as unknown as VaultService & {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests: syncPersonToVault
// ---------------------------------------------------------------------------

describe("syncPersonToVault", () => {
  // -----------------------------------------------------------------------
  // 1. Creates markdown file with correct frontmatter
  // -----------------------------------------------------------------------

  it("creates a new note with correct frontmatter when none exists", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue(null);

    await syncPersonToVault(mockPerson(), vs);

    expect(vs.create).toHaveBeenCalledTimes(1);
    expect(vs.update).not.toHaveBeenCalled();

    const createCall = vs.create.mock.calls[0]![0] as { path: string; content: string };
    expect(createCall.path).toBe("People/Alice Smith.md");
    expect(createCall.content).toMatch(/^---\n/);
    expect(createCall.content).toContain("type: person");
    expect(createCall.content).toContain("miranda_id: person-uuid-001");
    expect(createCall.content).toContain("customer");
    expect(createCall.content).toContain("vip");
  });

  // -----------------------------------------------------------------------
  // 2. Updates existing file, preserves content below ## Notes
  // -----------------------------------------------------------------------

  it("updates an existing note and preserves user content below ## Notes", async () => {
    const vs = mockVaultService();
    const existingContent =
      "---\ntype: person\n---\n## Accounts\n\n## Notes\nSome user notes here.\n";
    vs.get.mockResolvedValue({ path: "People/Alice Smith.md", content: existingContent });

    await syncPersonToVault(mockPerson(), vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    expect(vs.create).not.toHaveBeenCalled();

    const updateCall = vs.update.mock.calls[0]![1] as { content: string };
    expect(updateCall.content).toContain("## Notes");
    expect(updateCall.content).toContain("Some user notes here.");
  });

  // -----------------------------------------------------------------------
  // 3. Includes accounts table when accounts exist
  // -----------------------------------------------------------------------

  it("includes an accounts table when the person has linked accounts", async () => {
    const vs = mockVaultService();
    const person = mockPerson({
      accounts: [mockAccountLink()],
    });

    await syncPersonToVault(person, vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("## Accounts");
    expect(createCall.content).toContain("discord");
    expect(createCall.content).toContain("alice#1234");
    expect(createCall.content).toContain("manual");
  });

  // -----------------------------------------------------------------------
  // 4. Uses orgName param when provided
  // -----------------------------------------------------------------------

  it("uses the orgName param for the organization frontmatter field", async () => {
    const vs = mockVaultService();

    await syncPersonToVault(mockPerson({ organizationId: "org-uuid-001" }), vs, "Acme Corp");

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("organization: Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// Tests: syncOrgToVault
// ---------------------------------------------------------------------------

describe("syncOrgToVault", () => {
  // -----------------------------------------------------------------------
  // 5. Creates org page with correct frontmatter
  // -----------------------------------------------------------------------

  it("creates a new org note with correct frontmatter", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue(null);

    await syncOrgToVault(mockOrg(), vs);

    expect(vs.create).toHaveBeenCalledTimes(1);
    expect(vs.update).not.toHaveBeenCalled();

    const createCall = vs.create.mock.calls[0]![0] as { path: string; content: string };
    expect(createCall.path).toBe("Organizations/Acme Corp.md");
    expect(createCall.content).toContain("type: organization");
    expect(createCall.content).toContain("miranda_id: org-uuid-001");
    expect(createCall.content).toContain("domain: acme.com");
    expect(createCall.content).toContain("enterprise");
  });

  // -----------------------------------------------------------------------
  // 6. Preserves user notes on update
  // -----------------------------------------------------------------------

  it("updates an existing org note and preserves user content below ## Notes", async () => {
    const vs = mockVaultService();
    const existingContent =
      "---\ntype: organization\n---\n## Members\n\n## Notes\nKey partnership org.\n";
    vs.get.mockResolvedValue({ path: "Organizations/Acme Corp.md", content: existingContent });

    await syncOrgToVault(mockOrg(), vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    const updateCall = vs.update.mock.calls[0]![1] as { content: string };
    expect(updateCall.content).toContain("Key partnership org.");
  });
});

// ---------------------------------------------------------------------------
// Tests: readPersonPatchFromVault
// ---------------------------------------------------------------------------

describe("readPersonPatchFromVault", () => {
  // -----------------------------------------------------------------------
  // 7. Parses frontmatter tags back from vault note
  // -----------------------------------------------------------------------

  it("parses tags from a vault note's frontmatter", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue({
      path: "People/Alice Smith.md",
      content:
        "---\ntype: person\nmiranda_id: person-uuid-001\ntags:\n  - vip\n  - customer\n---\n## Notes\n",
    });

    const patch = await readPersonPatchFromVault("People/Alice Smith.md", vs);

    expect(patch).not.toBeNull();
    expect(patch?.tags).toEqual(["vip", "customer"]);
  });

  // -----------------------------------------------------------------------
  // 8. Returns null for a missing file
  // -----------------------------------------------------------------------

  it("returns null when the vault note does not exist", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue(null);

    const patch = await readPersonPatchFromVault("People/Nobody.md", vs);

    expect(patch).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 9. Returns null gracefully when get rejects
  // -----------------------------------------------------------------------

  it("returns null gracefully when vaultService.get rejects", async () => {
    const vs = mockVaultService();
    vs.get.mockRejectedValue(new Error("vault offline"));

    const patch = await readPersonPatchFromVault("People/Alice Smith.md", vs);

    expect(patch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: personNotePath
// ---------------------------------------------------------------------------

describe("personNotePath", () => {
  // -----------------------------------------------------------------------
  // 10. Handles special characters in names
  // -----------------------------------------------------------------------

  it("replaces slashes, backslashes, and colons with dashes", () => {
    expect(personNotePath("John/Doe")).toBe("People/John-Doe.md");
    expect(personNotePath("John\\Doe")).toBe("People/John-Doe.md");
    expect(personNotePath("John:Doe")).toBe("People/John-Doe.md");
    expect(personNotePath("Alice Smith")).toBe("People/Alice Smith.md");
  });
});

// ---------------------------------------------------------------------------
// Tests: formatAccountsTable
// ---------------------------------------------------------------------------

describe("formatAccountsTable", () => {
  // -----------------------------------------------------------------------
  // 11. Returns empty string for no accounts
  // -----------------------------------------------------------------------

  it("returns an empty string when accounts array is empty", () => {
    expect(formatAccountsTable([])).toBe("");
  });

  // -----------------------------------------------------------------------
  // 12. Creates correct markdown table
  // -----------------------------------------------------------------------

  it("creates a markdown table with platform, username and confidence columns", () => {
    const accounts: AccountLink[] = [
      mockAccountLink({
        platform: "discord",
        platformUsername: "alice#1234",
        confidence: "manual",
      }),
      mockAccountLink({
        id: "acct-002",
        platform: "telegram",
        platformUsername: "alice_tg",
        platformUserId: "tg-456",
        confidence: "auto",
      }),
    ];

    const table = formatAccountsTable(accounts);
    expect(table).toContain("## Accounts");
    expect(table).toContain("| Platform | Username | Confidence |");
    expect(table).toContain("| discord | alice#1234 | manual |");
    expect(table).toContain("| telegram | alice_tg | auto |");
  });
});
