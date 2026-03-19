// ---------------------------------------------------------------------------
// Triage – Core Types
// ---------------------------------------------------------------------------

export type PriorityFactor = {
  reason: string;
  weight: number;
};

export type TopicTagSource = "ai" | "manual" | "rule";

export type TopicTag = {
  label: string;
  confidence: number;
  source: TopicTagSource;
};

export type TriageSentiment = "positive" | "neutral" | "negative" | "urgent";
export type TriageSuggestedAction = "reply" | "delegate" | "archive" | "snooze";

export type MessageTriage = {
  messageId: string;
  personId?: string;
  priorityScore: number;
  priorityFactors: PriorityFactor[];
  topics: TopicTag[];
  sentiment: TriageSentiment;
  suggestedAction?: TriageSuggestedAction;
  autoDraft?: string;
  autoDraftModel?: string;
  processedAtMs: number;
};

export type TriageStoreFile = {
  version: 1;
  triages: MessageTriage[];
};
