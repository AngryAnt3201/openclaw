// ---------------------------------------------------------------------------
// Gateway RPC handlers for person.*, org.*, group.*, suggestion.* methods
// Follows server-methods/inbound.ts pattern
// ---------------------------------------------------------------------------

import type { PeopleService } from "../../people/service.js";
import type { PersonPatch, OrgPatch, GroupPatch, PersonFilter } from "../../people/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = params[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

export const peopleHandlers: GatewayRequestHandlers = {
  // =========================================================================
  // Person CRUD
  // =========================================================================

  // -------------------------------------------------------------------------
  // person.create
  // -------------------------------------------------------------------------
  "person.create": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const displayName = requireString(params, "displayName");
    if (!displayName) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing displayName"));
      return;
    }
    const avatar = typeof params.avatar === "string" ? params.avatar : undefined;
    const organizationId =
      typeof params.organizationId === "string" ? params.organizationId : undefined;
    const tags = Array.isArray(params.tags)
      ? (params.tags as string[]).filter((t) => typeof t === "string")
      : undefined;
    const result = await svc.createPerson({ displayName, avatar, organizationId, tags });
    respond(true, result, undefined);
  },

  // -------------------------------------------------------------------------
  // person.get
  // -------------------------------------------------------------------------
  "person.get": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "personId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const person = await svc.getPerson(id);
    if (!person) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `person not found: ${id}`));
      return;
    }
    respond(true, person, undefined);
  },

  // -------------------------------------------------------------------------
  // person.list
  // -------------------------------------------------------------------------
  "person.list": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const filter = (params.filter as PersonFilter | undefined) ?? undefined;
    const persons = await svc.listPersons(filter);
    respond(true, { persons }, undefined);
  },

  // -------------------------------------------------------------------------
  // person.update
  // -------------------------------------------------------------------------
  "person.update": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "personId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const { id: _a, personId: _b, ...patch } = params;
    const person = await svc.updatePerson(id, patch as PersonPatch);
    if (!person) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `person not found: ${id}`));
      return;
    }
    respond(true, person, undefined);
  },

  // -------------------------------------------------------------------------
  // person.delete
  // -------------------------------------------------------------------------
  "person.delete": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "personId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const deleted = await svc.deletePerson(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `person not found: ${id}`));
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // person.linkAccount
  // -------------------------------------------------------------------------
  "person.linkAccount": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const personId = requireString(params, "personId");
    if (!personId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing personId"));
      return;
    }
    const account = params.account as Record<string, unknown> | undefined;
    if (!account || typeof account !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing account"));
      return;
    }
    if (typeof account.platform !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing account.platform"));
      return;
    }
    if (typeof account.platformUserId !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing account.platformUserId"),
      );
      return;
    }
    const link = await svc.linkAccount(personId, account as any);
    if (!link) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `person not found: ${personId}`),
      );
      return;
    }
    respond(true, link, undefined);
  },

  // -------------------------------------------------------------------------
  // person.unlinkAccount
  // -------------------------------------------------------------------------
  "person.unlinkAccount": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const personId = requireString(params, "personId");
    if (!personId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing personId"));
      return;
    }
    const accountLinkId = requireString(params, "accountLinkId");
    if (!accountLinkId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing accountLinkId"));
      return;
    }
    const removed = await svc.unlinkAccount(personId, accountLinkId);
    if (!removed) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `account link not found: ${accountLinkId}`),
      );
      return;
    }
    respond(true, { removed: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // person.merge
  // -------------------------------------------------------------------------
  "person.merge": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const keepId = requireString(params, "keepId");
    if (!keepId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing keepId"));
      return;
    }
    const mergeId = requireString(params, "mergeId");
    if (!mergeId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing mergeId"));
      return;
    }
    const person = await svc.mergePersons(keepId, mergeId);
    if (!person) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "one or both persons not found"),
      );
      return;
    }
    respond(true, person, undefined);
  },

  // -------------------------------------------------------------------------
  // person.resolve
  // -------------------------------------------------------------------------
  "person.resolve": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const senderId = requireString(params, "senderId");
    if (!senderId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing senderId"));
      return;
    }
    const platform = requireString(params, "platform");
    if (!platform) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing platform"));
      return;
    }
    const senderName = typeof params.senderName === "string" ? params.senderName : undefined;
    const senderEmail = typeof params.senderEmail === "string" ? params.senderEmail : undefined;
    const result = await svc.resolveIdentity(senderId, platform as any, senderName, senderEmail);
    respond(true, result, undefined);
  },

  // =========================================================================
  // Organization CRUD
  // =========================================================================

  // -------------------------------------------------------------------------
  // org.create
  // -------------------------------------------------------------------------
  "org.create": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const domain = typeof params.domain === "string" ? params.domain : undefined;
    const avatar = typeof params.avatar === "string" ? params.avatar : undefined;
    const tags = Array.isArray(params.tags)
      ? (params.tags as string[]).filter((t) => typeof t === "string")
      : undefined;
    const org = await svc.createOrg({ name, domain, avatar, tags });
    respond(true, org, undefined);
  },

  // -------------------------------------------------------------------------
  // org.get
  // -------------------------------------------------------------------------
  "org.get": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "orgId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const org = await svc.getOrg(id);
    if (!org) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `org not found: ${id}`));
      return;
    }
    respond(true, org, undefined);
  },

  // -------------------------------------------------------------------------
  // org.list
  // -------------------------------------------------------------------------
  "org.list": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const orgs = await svc.listOrgs();
    respond(true, { orgs }, undefined);
  },

  // -------------------------------------------------------------------------
  // org.update
  // -------------------------------------------------------------------------
  "org.update": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "orgId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const { id: _a, orgId: _b, ...patch } = params;
    const org = await svc.updateOrg(id, patch as OrgPatch);
    if (!org) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `org not found: ${id}`));
      return;
    }
    respond(true, org, undefined);
  },

  // -------------------------------------------------------------------------
  // org.delete
  // -------------------------------------------------------------------------
  "org.delete": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "orgId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const deleted = await svc.deleteOrg(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `org not found: ${id}`));
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // =========================================================================
  // Group CRUD (People groups — distinct from the chat group.* handlers)
  // =========================================================================

  // -------------------------------------------------------------------------
  // people.group.create
  // -------------------------------------------------------------------------
  "people.group.create": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const color = typeof params.color === "string" ? params.color : undefined;
    const memberIds = Array.isArray(params.memberIds)
      ? (params.memberIds as string[]).filter((m) => typeof m === "string")
      : undefined;
    const group = await svc.createGroup({ name, color, memberIds });
    respond(true, group, undefined);
  },

  // -------------------------------------------------------------------------
  // people.group.get
  // -------------------------------------------------------------------------
  "people.group.get": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "groupId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const group = await svc.getGroup(id);
    if (!group) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${id}`));
      return;
    }
    respond(true, group, undefined);
  },

  // -------------------------------------------------------------------------
  // people.group.list
  // -------------------------------------------------------------------------
  "people.group.list": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const groups = await svc.listGroups();
    respond(true, { groups }, undefined);
  },

  // -------------------------------------------------------------------------
  // people.group.update
  // -------------------------------------------------------------------------
  "people.group.update": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "groupId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const { id: _a, groupId: _b, ...patch } = params;
    const group = await svc.updateGroup(id, patch as GroupPatch);
    if (!group) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${id}`));
      return;
    }
    respond(true, group, undefined);
  },

  // -------------------------------------------------------------------------
  // people.group.delete
  // -------------------------------------------------------------------------
  "people.group.delete": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "groupId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const deleted = await svc.deleteGroup(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${id}`));
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // =========================================================================
  // Suggestions
  // =========================================================================

  // -------------------------------------------------------------------------
  // suggestion.list
  // -------------------------------------------------------------------------
  "suggestion.list": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const suggestions = await svc.listPendingSuggestions();
    respond(true, { suggestions }, undefined);
  },

  // -------------------------------------------------------------------------
  // suggestion.accept
  // -------------------------------------------------------------------------
  "suggestion.accept": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "suggestionId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const accepted = await svc.acceptSuggestion(id);
    if (!accepted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `suggestion not found or not pending: ${id}`),
      );
      return;
    }
    respond(true, { accepted: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // suggestion.dismiss
  // -------------------------------------------------------------------------
  "suggestion.dismiss": async ({ params, respond, context }) => {
    const svc = (context as any).peopleService as PeopleService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "people not enabled"));
      return;
    }
    const id = requireString(params, "id", "suggestionId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const dismissed = await svc.dismissSuggestion(id);
    if (!dismissed) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `suggestion not found or not pending: ${id}`),
      );
      return;
    }
    respond(true, { dismissed: true }, undefined);
  },
};
