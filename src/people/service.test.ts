// ---------------------------------------------------------------------------
// PeopleService – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PeopleService } from "./service.js";

let tmpDir: string;
let storePath: string;
let broadcast: ReturnType<typeof vi.fn>;
let service: PeopleService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "people-svc-"));
  storePath = path.join(tmpDir, "store.json");
  broadcast = vi.fn();
  service = new PeopleService({
    storePath,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast,
    nowMs: () => 1000,
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Person CRUD
// ---------------------------------------------------------------------------

describe("Person CRUD", () => {
  it("createPerson — creates with UUID, timestamps", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    expect(person.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(person.displayName).toBe("Alice");
    expect(person.accounts).toEqual([]);
    expect(person.groupIds).toEqual([]);
    expect(person.tags).toEqual([]);
    expect(person.notes).toBe("");
    expect(person.createdAtMs).toBe(1000);
    expect(person.updatedAtMs).toBe(1000);
  });

  it("getPerson — returns person by ID, null for missing", async () => {
    const person = await service.createPerson({ displayName: "Bob" });
    const found = await service.getPerson(person.id);
    expect(found).not.toBeNull();
    expect(found!.displayName).toBe("Bob");

    const missing = await service.getPerson("nonexistent");
    expect(missing).toBeNull();
  });

  it("listPersons — returns all, empty when none", async () => {
    const empty = await service.listPersons();
    expect(empty).toEqual([]);

    await service.createPerson({ displayName: "Alice" });
    await service.createPerson({ displayName: "Bob" });

    const all = await service.listPersons();
    expect(all).toHaveLength(2);
  });

  it("listPersons with filter — filters by org, group, tag, platform, searchText", async () => {
    const org = await service.createOrg({ name: "Acme", domain: "acme.com" });
    const alice = await service.createPerson({
      displayName: "Alice",
      organizationId: org.id,
      tags: ["vip"],
    });
    const bob = await service.createPerson({ displayName: "Bob", tags: ["support"] });

    // Add alice to a group
    const group = await service.createGroup({ name: "Team", memberIds: [alice.id] });

    // Link a discord account to Alice
    await service.linkAccount(alice.id, {
      platform: "discord",
      platformUserId: "alice-discord",
      platformUsername: "alice#1234",
      confidence: "manual",
    });

    // Filter by org
    const byOrg = await service.listPersons({ organizationId: org.id });
    expect(byOrg).toHaveLength(1);
    expect(byOrg[0]!.id).toBe(alice.id);

    // Filter by group
    const byGroup = await service.listPersons({ groupId: group.id });
    expect(byGroup).toHaveLength(1);
    expect(byGroup[0]!.id).toBe(alice.id);

    // Filter by tag
    const byTag = await service.listPersons({ tags: ["vip"] });
    expect(byTag).toHaveLength(1);
    expect(byTag[0]!.id).toBe(alice.id);

    // Filter by platform
    const byPlatform = await service.listPersons({ platform: "discord" });
    expect(byPlatform).toHaveLength(1);
    expect(byPlatform[0]!.id).toBe(alice.id);

    // Filter by searchText
    const bySearch = await service.listPersons({ searchText: "bob" });
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0]!.id).toBe(bob.id);
  });

  it("updatePerson — patches fields, updates timestamp", async () => {
    let tick = 1000;
    const svc = new PeopleService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast,
      nowMs: () => tick,
    });

    const person = await svc.createPerson({ displayName: "Alice" });
    tick = 2000;

    const updated = await svc.updatePerson(person.id, {
      displayName: "Alice Updated",
      tags: ["vip"],
      notes: "important person",
    });

    expect(updated).not.toBeNull();
    expect(updated!.displayName).toBe("Alice Updated");
    expect(updated!.tags).toEqual(["vip"]);
    expect(updated!.notes).toBe("important person");
    expect(updated!.updatedAtMs).toBe(2000);
    expect(updated!.createdAtMs).toBe(1000);
  });

  it("deletePerson — removes, returns true; false for missing", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    const deleted = await service.deletePerson(person.id);
    expect(deleted).toBe(true);

    const after = await service.getPerson(person.id);
    expect(after).toBeNull();

    const again = await service.deletePerson(person.id);
    expect(again).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Organization CRUD
// ---------------------------------------------------------------------------

describe("Organization CRUD", () => {
  it("createOrg — creates org with UUID", async () => {
    const org = await service.createOrg({ name: "Acme", domain: "acme.com" });
    expect(org.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(org.name).toBe("Acme");
    expect(org.domain).toBe("acme.com");
    expect(org.members).toEqual([]);
    expect(org.tags).toEqual([]);
    expect(org.createdAtMs).toBe(1000);
  });

  it("updateOrg — patches, updates timestamp", async () => {
    let tick = 1000;
    const svc = new PeopleService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast,
      nowMs: () => tick,
    });

    const org = await svc.createOrg({ name: "Acme" });
    tick = 2000;

    const updated = await svc.updateOrg(org.id, { name: "Acme Corp", domain: "acme.io" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Acme Corp");
    expect(updated!.domain).toBe("acme.io");
    expect(updated!.updatedAtMs).toBe(2000);
  });

  it("deleteOrg — removes org, clears organizationId on members", async () => {
    const org = await service.createOrg({ name: "Acme" });
    const person = await service.createPerson({
      displayName: "Alice",
      organizationId: org.id,
    });

    const deleted = await service.deleteOrg(org.id);
    expect(deleted).toBe(true);

    const updatedPerson = await service.getPerson(person.id);
    expect(updatedPerson!.organizationId).toBeUndefined();

    const orgs = await service.listOrgs();
    expect(orgs).toHaveLength(0);
  });

  it("listOrgs — returns all orgs", async () => {
    await service.createOrg({ name: "Acme" });
    await service.createOrg({ name: "Globex" });

    const orgs = await service.listOrgs();
    expect(orgs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

describe("Group CRUD", () => {
  it("createGroup — creates group", async () => {
    const group = await service.createGroup({ name: "Team A", color: "#ff0000" });
    expect(group.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(group.name).toBe("Team A");
    expect(group.color).toBe("#ff0000");
    expect(group.memberIds).toEqual([]);
    expect(group.createdAtMs).toBe(1000);
  });

  it("deleteGroup — removes group, clears groupId from members", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    const group = await service.createGroup({
      name: "Team A",
      memberIds: [person.id],
    });

    // Verify person has the groupId
    const personBefore = await service.getPerson(person.id);
    expect(personBefore!.groupIds).toContain(group.id);

    const deleted = await service.deleteGroup(group.id);
    expect(deleted).toBe(true);

    const personAfter = await service.getPerson(person.id);
    expect(personAfter!.groupIds).not.toContain(group.id);

    const groups = await service.listGroups();
    expect(groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Account Linking
// ---------------------------------------------------------------------------

describe("Account Linking", () => {
  it("linkAccount — adds account to person", async () => {
    const person = await service.createPerson({ displayName: "Alice" });

    const link = await service.linkAccount(person.id, {
      platform: "discord",
      platformUserId: "alice-discord-123",
      platformUsername: "alice#1234",
      confidence: "manual",
    });

    expect(link).not.toBeNull();
    expect(link!.platform).toBe("discord");
    expect(link!.platformUserId).toBe("alice-discord-123");
    expect(link!.linkedAtMs).toBe(1000);

    const updated = await service.getPerson(person.id);
    expect(updated!.accounts).toHaveLength(1);
    expect(updated!.accounts[0]!.id).toBe(link!.id);
  });

  it("linkAccount — returns null for missing person", async () => {
    const link = await service.linkAccount("nonexistent", {
      platform: "discord",
      platformUserId: "abc",
      platformUsername: "user",
      confidence: "manual",
    });
    expect(link).toBeNull();
  });

  it("unlinkAccount — removes account from person", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    const link = await service.linkAccount(person.id, {
      platform: "discord",
      platformUserId: "alice-discord-123",
      platformUsername: "alice#1234",
      confidence: "manual",
    });

    const removed = await service.unlinkAccount(person.id, link!.id);
    expect(removed).toBe(true);

    const updated = await service.getPerson(person.id);
    expect(updated!.accounts).toHaveLength(0);
  });

  it("unlinkAccount — returns false for missing", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    const removed = await service.unlinkAccount(person.id, "nonexistent");
    expect(removed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Identity Resolution
// ---------------------------------------------------------------------------

describe("Identity Resolution", () => {
  it("resolveIdentity — exact platformUserId match", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    await service.linkAccount(person.id, {
      platform: "discord",
      platformUserId: "alice-discord-123",
      platformUsername: "alice#1234",
      confidence: "manual",
    });

    const result = await service.resolveIdentity("alice-discord-123", "discord");
    expect(result.personId).toBe(person.id);
    expect(result.suggestion).toBeUndefined();
  });

  it("resolveIdentity — email domain match to org", async () => {
    const org = await service.createOrg({ name: "Acme", domain: "acme.com" });
    const person = await service.createPerson({
      displayName: "Alice",
      organizationId: org.id,
    });

    const result = await service.resolveIdentity(
      "unknown-sender",
      "email",
      undefined,
      "bob@acme.com",
    );
    expect(result.personId).toBe(person.id);
    expect(result.suggestion).toBeUndefined();
  });

  it("resolveIdentity — fuzzy name match creates suggestion with status pending", async () => {
    const person = await service.createPerson({ displayName: "Alice Smith" });

    const result = await service.resolveIdentity("new-sender-123", "telegram", "Alice");

    expect(result.personId).toBeUndefined();
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion!.personId).toBe(person.id);
    expect(result.suggestion!.status).toBe("pending");
    expect(result.suggestion!.accountLink.platform).toBe("telegram");
    expect(result.suggestion!.accountLink.platformUserId).toBe("new-sender-123");
    expect(result.suggestion!.confidence).toBeGreaterThan(0);
    expect(result.suggestion!.confidence).toBeLessThanOrEqual(1);
  });

  it("resolveIdentity — no match returns empty", async () => {
    const result = await service.resolveIdentity("unknown-sender", "discord");
    expect(result.personId).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

describe("Suggestions", () => {
  it("acceptSuggestion — links account, sets status to accepted", async () => {
    const person = await service.createPerson({ displayName: "Alice Smith" });

    // Create suggestion via identity resolution
    const result = await service.resolveIdentity("sender-456", "slack", "Alice");
    expect(result.suggestion).toBeDefined();

    const accepted = await service.acceptSuggestion(result.suggestion!.id);
    expect(accepted).toBe(true);

    // Verify account was linked
    const updatedPerson = await service.getPerson(person.id);
    expect(updatedPerson!.accounts).toHaveLength(1);
    expect(updatedPerson!.accounts[0]!.platformUserId).toBe("sender-456");

    // Verify suggestion status is accepted
    const pending = await service.listPendingSuggestions();
    expect(pending).toHaveLength(0);
  });

  it("dismissSuggestion — sets status to dismissed", async () => {
    await service.createPerson({ displayName: "Alice Smith" });

    const result = await service.resolveIdentity("sender-789", "telegram", "Alice");
    expect(result.suggestion).toBeDefined();

    const dismissed = await service.dismissSuggestion(result.suggestion!.id);
    expect(dismissed).toBe(true);

    const pending = await service.listPendingSuggestions();
    expect(pending).toHaveLength(0);
  });

  it("listPendingSuggestions — returns only pending", async () => {
    await service.createPerson({ displayName: "Alice Smith" });

    // Create two suggestions
    await service.resolveIdentity("sender-1", "discord", "Alice");
    const result2 = await service.resolveIdentity("sender-2", "telegram", "Alice");

    // Dismiss one
    await service.dismissSuggestion(result2.suggestion!.id);

    const pending = await service.listPendingSuggestions();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.accountLink.platformUserId).toBe("sender-1");
  });
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

describe("Merge", () => {
  it("mergePersons — combines accounts, tags, groups; deletes merged person", async () => {
    const alice = await service.createPerson({
      displayName: "Alice",
      tags: ["vip", "dev"],
    });
    const aliceDup = await service.createPerson({
      displayName: "Alice S.",
      tags: ["vip", "support"],
    });

    // Link accounts
    await service.linkAccount(alice.id, {
      platform: "discord",
      platformUserId: "alice-discord",
      platformUsername: "alice#1234",
      confidence: "manual",
    });
    await service.linkAccount(aliceDup.id, {
      platform: "telegram",
      platformUserId: "alice-telegram",
      platformUsername: "alice_t",
      confidence: "manual",
    });
    await service.linkAccount(aliceDup.id, {
      platform: "discord",
      platformUserId: "alice-discord",
      platformUsername: "alice#1234",
      confidence: "manual",
    });

    // Create groups
    const group = await service.createGroup({
      name: "Team",
      memberIds: [aliceDup.id],
    });

    const merged = await service.mergePersons(alice.id, aliceDup.id);
    expect(merged).not.toBeNull();
    expect(merged!.displayName).toBe("Alice"); // keepId's displayName
    expect(merged!.accounts).toHaveLength(2); // deduped: discord + telegram
    expect(merged!.tags).toContain("vip");
    expect(merged!.tags).toContain("dev");
    expect(merged!.tags).toContain("support");
    expect(merged!.groupIds).toContain(group.id);

    // Merged person should be deleted
    const deletedPerson = await service.getPerson(aliceDup.id);
    expect(deletedPerson).toBeNull();

    // Group should reference keepId
    const updatedGroup = await service.getGroup(group.id);
    expect(updatedGroup!.memberIds).toContain(alice.id);
    expect(updatedGroup!.memberIds).not.toContain(aliceDup.id);
  });

  it("mergePersons — returns null for missing IDs", async () => {
    const alice = await service.createPerson({ displayName: "Alice" });
    const result = await service.mergePersons(alice.id, "nonexistent");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Broadcast events
// ---------------------------------------------------------------------------

describe("Broadcast events", () => {
  it("emits correct events on CRUD operations", async () => {
    // Person
    const person = await service.createPerson({ displayName: "Alice" });
    expect(broadcast).toHaveBeenCalledWith("people.person.created", person);

    await service.updatePerson(person.id, { displayName: "Alice Updated" });
    expect(broadcast).toHaveBeenCalledWith(
      "people.person.updated",
      expect.objectContaining({ displayName: "Alice Updated" }),
    );

    await service.deletePerson(person.id);
    expect(broadcast).toHaveBeenCalledWith("people.person.deleted", { id: person.id });

    // Org
    const org = await service.createOrg({ name: "Acme" });
    expect(broadcast).toHaveBeenCalledWith("people.org.created", org);

    await service.updateOrg(org.id, { name: "Acme Corp" });
    expect(broadcast).toHaveBeenCalledWith(
      "people.org.updated",
      expect.objectContaining({ name: "Acme Corp" }),
    );

    await service.deleteOrg(org.id);
    expect(broadcast).toHaveBeenCalledWith("people.org.deleted", { id: org.id });

    // Group
    const group = await service.createGroup({ name: "Team" });
    expect(broadcast).toHaveBeenCalledWith("people.group.created", group);

    await service.updateGroup(group.id, { name: "Team Updated" });
    expect(broadcast).toHaveBeenCalledWith(
      "people.group.updated",
      expect.objectContaining({ name: "Team Updated" }),
    );

    await service.deleteGroup(group.id);
    expect(broadcast).toHaveBeenCalledWith("people.group.deleted", { id: group.id });
  });

  it("emits people.account.linked and people.account.unlinked", async () => {
    const person = await service.createPerson({ displayName: "Alice" });
    broadcast.mockClear();

    const link = await service.linkAccount(person.id, {
      platform: "discord",
      platformUserId: "alice-123",
      platformUsername: "alice",
      confidence: "manual",
    });

    expect(broadcast).toHaveBeenCalledWith("people.account.linked", {
      personId: person.id,
      account: link,
    });

    broadcast.mockClear();

    await service.unlinkAccount(person.id, link!.id);
    expect(broadcast).toHaveBeenCalledWith("people.account.unlinked", {
      personId: person.id,
      accountLinkId: link!.id,
    });
  });

  it("emits people.person.merged on merge", async () => {
    const alice = await service.createPerson({ displayName: "Alice" });
    const bob = await service.createPerson({ displayName: "Bob" });
    broadcast.mockClear();

    const merged = await service.mergePersons(alice.id, bob.id);
    expect(broadcast).toHaveBeenCalledWith("people.person.merged", {
      keepId: alice.id,
      mergeId: bob.id,
      person: merged,
    });
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("Concurrency", () => {
  it("concurrent writes are serialized — two simultaneous creates don't lose data", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.createPerson({ displayName: `Person ${i}` }),
    );

    await Promise.all(promises);

    const all = await service.listPersons();
    expect(all).toHaveLength(10);
  });
});
