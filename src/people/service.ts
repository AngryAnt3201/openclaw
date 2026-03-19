// ---------------------------------------------------------------------------
// PeopleService – Core people/contacts management service
// ---------------------------------------------------------------------------
// Follows the InboundService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { InboundSourceType } from "../inbound/types.js";
import type {
  Person,
  PersonPatch,
  PersonFilter,
  Organization,
  OrgPatch,
  Group,
  GroupPatch,
  AccountLink,
  IdentitySuggestion,
  PeopleStoreFile,
} from "./types.js";
import { readPeopleStore, writePeopleStore } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type PeopleServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type ServiceState = {
  deps: PeopleServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: PeopleServiceDeps): ServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as inbound/service.ts)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: ServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// PeopleService
// ---------------------------------------------------------------------------

export class PeopleService {
  private readonly state: ServiceState;

  constructor(deps: PeopleServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // =========================================================================
  // Person CRUD
  // =========================================================================

  async createPerson(input: {
    displayName: string;
    avatar?: string;
    organizationId?: string;
    tags?: string[];
  }): Promise<Person> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const now = this.now();

      const person: Person = {
        id: randomUUID(),
        displayName: input.displayName,
        avatar: input.avatar,
        accounts: [],
        organizationId: input.organizationId,
        groupIds: [],
        tags: input.tags ?? [],
        aiTopics: [],
        notes: "",
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.persons.push(person);

      // If organizationId given, add person to org members list
      if (input.organizationId) {
        const org = store.organizations.find((o) => o.id === input.organizationId);
        if (org && !org.members.includes(person.id)) {
          org.members.push(person.id);
        }
      }

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.person.created", person);
      this.state.deps.log.info(`person created: ${person.id}`);
      return person;
    });
  }

  async getPerson(id: string): Promise<Person | null> {
    const store = await readPeopleStore(this.state.deps.storePath);
    return store.persons.find((p) => p.id === id) ?? null;
  }

  async listPersons(filter?: PersonFilter): Promise<Person[]> {
    const store = await readPeopleStore(this.state.deps.storePath);
    let persons = store.persons;

    if (filter) {
      if (filter.organizationId) {
        persons = persons.filter((p) => p.organizationId === filter.organizationId);
      }
      if (filter.groupId) {
        persons = persons.filter((p) => p.groupIds.includes(filter.groupId!));
      }
      if (filter.tags && filter.tags.length > 0) {
        const filterTags = new Set(filter.tags);
        persons = persons.filter((p) => p.tags.some((t) => filterTags.has(t)));
      }
      if (filter.platform) {
        persons = persons.filter((p) => p.accounts.some((a) => a.platform === filter.platform));
      }
      if (filter.searchText) {
        const text = filter.searchText.toLowerCase();
        persons = persons.filter((p) => p.displayName.toLowerCase().includes(text));
      }
    }

    return persons;
  }

  async updatePerson(id: string, patch: PersonPatch): Promise<Person | null> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.persons.findIndex((p) => p.id === id);
      if (idx === -1) {
        return null;
      }

      const person = store.persons[idx]!;

      if (patch.displayName !== undefined) {
        person.displayName = patch.displayName;
      }
      if (patch.avatar !== undefined) {
        person.avatar = patch.avatar;
      }
      if (patch.organizationId !== undefined) {
        person.organizationId = patch.organizationId;
      }
      if (patch.groupIds !== undefined) {
        person.groupIds = patch.groupIds;
      }
      if (patch.tags !== undefined) {
        person.tags = patch.tags;
      }
      if (patch.notes !== undefined) {
        person.notes = patch.notes;
      }
      if (patch.slaProfileId !== undefined) {
        person.slaProfileId = patch.slaProfileId;
      }
      person.updatedAtMs = this.now();

      store.persons[idx] = person;
      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.person.updated", person);
      return person;
    });
  }

  async deletePerson(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.persons.findIndex((p) => p.id === id);
      if (idx === -1) {
        return false;
      }

      store.persons.splice(idx, 1);

      // Remove from org members lists
      for (const org of store.organizations) {
        const memberIdx = org.members.indexOf(id);
        if (memberIdx !== -1) {
          org.members.splice(memberIdx, 1);
        }
      }

      // Remove from group memberIds lists
      for (const group of store.groups) {
        const memberIdx = group.memberIds.indexOf(id);
        if (memberIdx !== -1) {
          group.memberIds.splice(memberIdx, 1);
        }
      }

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.person.deleted", { id });
      this.state.deps.log.info(`person deleted: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Organization CRUD
  // =========================================================================

  async createOrg(input: {
    name: string;
    domain?: string;
    avatar?: string;
    tags?: string[];
  }): Promise<Organization> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const now = this.now();

      const org: Organization = {
        id: randomUUID(),
        name: input.name,
        domain: input.domain,
        avatar: input.avatar,
        tags: input.tags ?? [],
        members: [],
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.organizations.push(org);
      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.org.created", org);
      this.state.deps.log.info(`org created: ${org.id}`);
      return org;
    });
  }

  async getOrg(id: string): Promise<Organization | null> {
    const store = await readPeopleStore(this.state.deps.storePath);
    return store.organizations.find((o) => o.id === id) ?? null;
  }

  async listOrgs(): Promise<Organization[]> {
    const store = await readPeopleStore(this.state.deps.storePath);
    return store.organizations;
  }

  async updateOrg(id: string, patch: OrgPatch): Promise<Organization | null> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.organizations.findIndex((o) => o.id === id);
      if (idx === -1) {
        return null;
      }

      const org = store.organizations[idx]!;

      if (patch.name !== undefined) {
        org.name = patch.name;
      }
      if (patch.domain !== undefined) {
        org.domain = patch.domain;
      }
      if (patch.avatar !== undefined) {
        org.avatar = patch.avatar;
      }
      if (patch.tags !== undefined) {
        org.tags = patch.tags;
      }
      org.updatedAtMs = this.now();

      store.organizations[idx] = org;
      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.org.updated", org);
      return org;
    });
  }

  async deleteOrg(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.organizations.findIndex((o) => o.id === id);
      if (idx === -1) {
        return false;
      }

      store.organizations.splice(idx, 1);

      // Clear organizationId on member persons
      for (const person of store.persons) {
        if (person.organizationId === id) {
          person.organizationId = undefined;
        }
      }

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.org.deleted", { id });
      this.state.deps.log.info(`org deleted: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Group CRUD
  // =========================================================================

  async createGroup(input: { name: string; color?: string; memberIds?: string[] }): Promise<Group> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const now = this.now();

      const memberIds = input.memberIds ?? [];

      const group: Group = {
        id: randomUUID(),
        name: input.name,
        color: input.color,
        memberIds,
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.groups.push(group);

      // Add groupId to member persons
      for (const person of store.persons) {
        if (memberIds.includes(person.id) && !person.groupIds.includes(group.id)) {
          person.groupIds.push(group.id);
        }
      }

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.group.created", group);
      this.state.deps.log.info(`group created: ${group.id}`);
      return group;
    });
  }

  async getGroup(id: string): Promise<Group | null> {
    const store = await readPeopleStore(this.state.deps.storePath);
    return store.groups.find((g) => g.id === id) ?? null;
  }

  async listGroups(): Promise<Group[]> {
    const store = await readPeopleStore(this.state.deps.storePath);
    return store.groups;
  }

  async updateGroup(id: string, patch: GroupPatch): Promise<Group | null> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.groups.findIndex((g) => g.id === id);
      if (idx === -1) {
        return null;
      }

      const group = store.groups[idx]!;

      if (patch.name !== undefined) {
        group.name = patch.name;
      }
      if (patch.color !== undefined) {
        group.color = patch.color;
      }
      if (patch.memberIds !== undefined) {
        group.memberIds = patch.memberIds;
      }
      group.updatedAtMs = this.now();

      store.groups[idx] = group;
      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.group.updated", group);
      return group;
    });
  }

  async deleteGroup(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.groups.findIndex((g) => g.id === id);
      if (idx === -1) {
        return false;
      }

      store.groups.splice(idx, 1);

      // Clear groupId from member persons
      for (const person of store.persons) {
        const gIdx = person.groupIds.indexOf(id);
        if (gIdx !== -1) {
          person.groupIds.splice(gIdx, 1);
        }
      }

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.group.deleted", { id });
      this.state.deps.log.info(`group deleted: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Account Linking
  // =========================================================================

  async linkAccount(
    personId: string,
    account: Omit<AccountLink, "id" | "linkedAtMs">,
  ): Promise<AccountLink | null> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.persons.findIndex((p) => p.id === personId);
      if (idx === -1) {
        return null;
      }

      const person = store.persons[idx]!;
      const now = this.now();

      const link: AccountLink = {
        id: randomUUID(),
        platform: account.platform,
        platformUserId: account.platformUserId,
        platformUsername: account.platformUsername,
        platformAvatar: account.platformAvatar,
        confidence: account.confidence,
        linkedAtMs: now,
      };

      person.accounts.push(link);
      person.updatedAtMs = now;

      store.persons[idx] = person;
      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.account.linked", { personId, account: link });
      this.state.deps.log.info(`account linked: ${link.id} → person ${personId}`);
      return link;
    });
  }

  async unlinkAccount(personId: string, accountLinkId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const personIdx = store.persons.findIndex((p) => p.id === personId);
      if (personIdx === -1) {
        return false;
      }

      const person = store.persons[personIdx]!;
      const accIdx = person.accounts.findIndex((a) => a.id === accountLinkId);
      if (accIdx === -1) {
        return false;
      }

      person.accounts.splice(accIdx, 1);
      person.updatedAtMs = this.now();

      store.persons[personIdx] = person;
      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.account.unlinked", { personId, accountLinkId });
      this.state.deps.log.info(`account unlinked: ${accountLinkId} from person ${personId}`);
      return true;
    });
  }

  // =========================================================================
  // Identity Resolution
  // =========================================================================

  async resolveIdentity(
    senderId: string,
    platform: InboundSourceType,
    senderName?: string,
    senderEmail?: string,
  ): Promise<{ personId?: string; suggestion?: IdentitySuggestion }> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);

      // Step 1: Exact platformUserId match
      for (const person of store.persons) {
        for (const account of person.accounts) {
          if (account.platform === platform && account.platformUserId === senderId) {
            return { personId: person.id };
          }
        }
      }

      // Step 2: Email domain match to org
      if (senderEmail) {
        const emailParts = senderEmail.split("@");
        if (emailParts.length === 2) {
          const domain = emailParts[1]!.toLowerCase();

          for (const org of store.organizations) {
            if (org.domain && org.domain.toLowerCase() === domain) {
              // Find first org member
              const memberPerson = store.persons.find((p) => p.organizationId === org.id);
              if (memberPerson) {
                return { personId: memberPerson.id };
              }

              // No members yet — create suggestion for first person in store (if any)
              // Actually, no match to return since org has no members
              break;
            }
          }
        }
      }

      // Step 3: Fuzzy name match
      if (senderName) {
        const nameLower = senderName.toLowerCase();

        for (const person of store.persons) {
          const displayLower = person.displayName.toLowerCase();
          if (displayLower.includes(nameLower) || nameLower.includes(displayLower)) {
            // Calculate confidence based on similarity
            const shorter = Math.min(nameLower.length, displayLower.length);
            const longer = Math.max(nameLower.length, displayLower.length);
            const confidence = shorter / longer;

            const now = this.now();
            const suggestion: IdentitySuggestion = {
              id: randomUUID(),
              personId: person.id,
              accountLink: {
                id: randomUUID(),
                platform,
                platformUserId: senderId,
                platformUsername: senderName,
                confidence: "suggested",
                linkedAtMs: now,
              },
              reason: `Name match: "${senderName}" ≈ "${person.displayName}"`,
              confidence,
              createdAtMs: now,
              status: "pending",
            };

            store.suggestions.push(suggestion);
            await writePeopleStore(this.state.deps.storePath, store);

            this.emit("people.suggestion.created", suggestion);
            return { suggestion };
          }
        }
      }

      // Step 4: No match
      return {};
    });
  }

  // =========================================================================
  // Suggestions
  // =========================================================================

  async acceptSuggestion(suggestionId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.suggestions.findIndex((s) => s.id === suggestionId);
      if (idx === -1) {
        return false;
      }

      const suggestion = store.suggestions[idx]!;
      if (suggestion.status !== "pending") {
        return false;
      }

      // Link the account to the person
      const personIdx = store.persons.findIndex((p) => p.id === suggestion.personId);
      if (personIdx === -1) {
        return false;
      }

      const person = store.persons[personIdx]!;
      const now = this.now();

      const link: AccountLink = {
        ...suggestion.accountLink,
        linkedAtMs: now,
      };

      person.accounts.push(link);
      person.updatedAtMs = now;
      store.persons[personIdx] = person;

      suggestion.status = "accepted";
      store.suggestions[idx] = suggestion;

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.account.linked", { personId: person.id, account: link });
      this.state.deps.log.info(`suggestion accepted: ${suggestionId}`);
      return true;
    });
  }

  async dismissSuggestion(suggestionId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);
      const idx = store.suggestions.findIndex((s) => s.id === suggestionId);
      if (idx === -1) {
        return false;
      }

      const suggestion = store.suggestions[idx]!;
      if (suggestion.status !== "pending") {
        return false;
      }

      suggestion.status = "dismissed";
      store.suggestions[idx] = suggestion;

      await writePeopleStore(this.state.deps.storePath, store);

      this.state.deps.log.info(`suggestion dismissed: ${suggestionId}`);
      return true;
    });
  }

  async listPendingSuggestions(): Promise<IdentitySuggestion[]> {
    const store = await readPeopleStore(this.state.deps.storePath);
    return store.suggestions.filter((s) => s.status === "pending");
  }

  // =========================================================================
  // Merge
  // =========================================================================

  async mergePersons(keepId: string, mergeId: string): Promise<Person | null> {
    return locked(this.state, async () => {
      const store = await readPeopleStore(this.state.deps.storePath);

      const keepIdx = store.persons.findIndex((p) => p.id === keepId);
      const mergeIdx = store.persons.findIndex((p) => p.id === mergeId);

      if (keepIdx === -1 || mergeIdx === -1) {
        return null;
      }

      const keep = store.persons[keepIdx]!;
      const merge = store.persons[mergeIdx]!;
      const now = this.now();

      // Combine accounts (dedupe by platform + platformUserId)
      const accountKey = (a: AccountLink) => `${a.platform}:${a.platformUserId}`;
      const existingKeys = new Set(keep.accounts.map(accountKey));
      for (const account of merge.accounts) {
        if (!existingKeys.has(accountKey(account))) {
          keep.accounts.push(account);
          existingKeys.add(accountKey(account));
        }
      }

      // Combine tags (dedupe)
      const tagSet = new Set([...keep.tags, ...merge.tags]);
      keep.tags = [...tagSet];

      // Combine groupIds (dedupe)
      const groupSet = new Set([...keep.groupIds, ...merge.groupIds]);
      keep.groupIds = [...groupSet];

      keep.updatedAtMs = now;
      store.persons[keepIdx] = keep;

      // Delete merged person
      store.persons.splice(mergeIdx, 1);

      // Update group memberIds: replace mergeId with keepId where needed
      for (const group of store.groups) {
        const mIdx = group.memberIds.indexOf(mergeId);
        if (mIdx !== -1) {
          group.memberIds.splice(mIdx, 1);
          if (!group.memberIds.includes(keepId)) {
            group.memberIds.push(keepId);
          }
        }
      }

      // Update org members: replace mergeId with keepId where needed
      for (const org of store.organizations) {
        const mIdx = org.members.indexOf(mergeId);
        if (mIdx !== -1) {
          org.members.splice(mIdx, 1);
          if (!org.members.includes(keepId)) {
            org.members.push(keepId);
          }
        }
      }

      await writePeopleStore(this.state.deps.storePath, store);

      this.emit("people.person.merged", { keepId, mergeId, person: keep });
      this.state.deps.log.info(`persons merged: ${mergeId} → ${keepId}`);
      return keep;
    });
  }
}
