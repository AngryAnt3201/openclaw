export type {
  InboundSourceType,
  InboundMessageStatus,
  InboundPriority,
  InboundSource,
  InboundAttachment,
  InboundProcessingResult,
  InboundPendingAction,
  InboundMessage,
  InboundChannel,
  InboundFilter,
  InboundRouteAction,
  InboundRoute,
  InboundStoreFile,
  InboundMessageFilter,
  RawInboundMessage,
  InboundChannelCreateInput,
  InboundChannelPatch,
  InboundRouteCreateInput,
  InboundRoutePatch,
} from "./types.js";
export { PRIORITY_ORDER } from "./types.js";
export { resolveInboundStorePath, readInboundStore, writeInboundStore } from "./store.js";
export { InboundService } from "./service.js";
export type { InboundServiceDeps, InboundActionExecutor } from "./service.js";
export {
  setInboundBridge,
  clearInboundBridge,
  isInboundBridgeActive,
  forwardToInbound,
  normalizeDiscordMessage,
  normalizeTelegramMessage,
  normalizeSlackMessage,
} from "./bridge.js";
