// ---------------------------------------------------------------------------
// Analytics – Types
// ---------------------------------------------------------------------------

export type InboundAnalytics = {
  volumeByPlatform: Record<string, number>;
  volumeByHour: number[]; // 24 slots
  volumeByDayOfWeek: number[]; // 7 slots
  topContacts: { personId: string; displayName: string; count: number }[];
  topTopics: { label: string; count: number }[];
  responseTimeAvg: number;
  responseTimeByDay: Record<string, number>; // ISO date → avg ms
  sentimentDistribution: Record<string, number>;
  periodMs: { from: number; to: number };
};

export type SLAProfile = {
  id: string;
  name: string;
  targetResponseMs: number;
  escalateAfterMs: number;
  appliesTo: "person" | "org";
  entityIds: string[];
};

export type ResponseTimeEntry = {
  messageId: string;
  personId?: string;
  receivedAtMs: number;
  repliedAtMs?: number;
};

export type SLAStatus = {
  personId: string;
  orgId?: string;
  profileId: string;
  pendingMessages: {
    messageId: string;
    receivedAtMs: number;
    breached: boolean;
    remainingMs: number;
  }[];
  complianceRate: number;
};

export type SLAProfilePatch = Partial<
  Pick<SLAProfile, "name" | "targetResponseMs" | "escalateAfterMs" | "entityIds">
>;

export type AnalyticsStoreFile = {
  version: 1;
  slaProfiles: SLAProfile[];
  responseEntries: ResponseTimeEntry[];
};
