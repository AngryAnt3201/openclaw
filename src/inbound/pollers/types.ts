// ---------------------------------------------------------------------------
// Poller Types — shared interface for all platform pollers
// ---------------------------------------------------------------------------

export interface PollerConfig {
  channelId: string;
  channelName: string;
  /** Credentials resolved from credential vault */
  credentials: Record<string, string>;
  /** Platform-specific options from channel.config */
  options?: Record<string, unknown>;
}

export interface Poller {
  /** Unique channel ID this poller serves */
  readonly channelId: string;
  /** Start polling/listening. Resolves when connected. */
  start(): Promise<void>;
  /** Stop polling/listening. Resolves when fully torn down. */
  stop(): Promise<void>;
  /** Current connection state */
  status(): PollerStatus;
}

export type PollerStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "syncing"
  | "disconnected"
  | "error";

export type PollerStatusCallback = (
  channelId: string,
  status: PollerStatus,
  error?: string,
) => void;

export type PollerLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};
