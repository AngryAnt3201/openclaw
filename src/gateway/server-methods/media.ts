import type { GatewayRequestHandlers } from "./types.js";
import { resolveApiKeyForProvider, requireApiKey } from "../../agents/model-auth.js";
import { loadConfig } from "../../config/config.js";
import {
  AUTO_AUDIO_KEY_PROVIDERS,
  DEFAULT_AUDIO_MODELS,
  DEFAULT_TIMEOUT_SECONDS,
} from "../../media-understanding/defaults.js";
import {
  getMediaUnderstandingProvider,
  normalizeMediaProviderId,
} from "../../media-understanding/providers/index.js";
import { resolveModelEntries } from "../../media-understanding/resolve.js";
import { buildProviderRegistry } from "../../media-understanding/runner.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

export const mediaHandlers: GatewayRequestHandlers = {
  /**
   * Transcribe audio from a base64-encoded buffer.
   *
   * Params:
   *   audioData  – base64-encoded audio bytes (required)
   *   fileName   – original file name hint (default: "recording.webm")
   *   mime       – MIME type (default: "audio/webm")
   *   language   – language hint (optional)
   *   provider   – force a specific provider (optional)
   *   model      – force a specific model (optional)
   *
   * Response payload: { text, provider, model }
   */
  "media.transcribe": async ({ params, respond }) => {
    const audioData = typeof params.audioData === "string" ? params.audioData : "";
    if (!audioData) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "media.transcribe requires audioData (base64)"),
      );
      return;
    }

    try {
      const cfg = loadConfig();
      const buffer = Buffer.from(audioData, "base64");
      const fileName = typeof params.fileName === "string" ? params.fileName : "recording.webm";
      const mime = typeof params.mime === "string" ? params.mime : "audio/webm";
      const language =
        typeof params.language === "string" ? params.language.trim() || undefined : undefined;

      // Resolve provider: explicit param → config models → auto-discovery by API key
      const registry = buildProviderRegistry();
      let providerId: string | undefined;
      let model: string | undefined;

      if (typeof params.provider === "string" && params.provider.trim()) {
        providerId = normalizeMediaProviderId(params.provider.trim());
      }
      if (typeof params.model === "string" && params.model.trim()) {
        model = params.model.trim();
      }

      // If no explicit provider, try config-defined audio models
      if (!providerId) {
        const audioConfig = cfg.tools?.media?.audio;
        const entries = resolveModelEntries({
          cfg,
          capability: "audio",
          config: audioConfig,
          providerRegistry: registry,
        });
        if (entries.length > 0 && entries[0].provider) {
          providerId = normalizeMediaProviderId(entries[0].provider);
          if (!model && entries[0].model) {
            model = entries[0].model;
          }
        }
      }

      // Auto-discover by first available API key
      if (!providerId) {
        for (const candidate of AUTO_AUDIO_KEY_PROVIDERS) {
          try {
            const auth = await resolveApiKeyForProvider({ provider: candidate, cfg });
            if (auth.apiKey) {
              providerId = candidate;
              break;
            }
          } catch {
            // no key for this provider
          }
        }
      }

      if (!providerId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "No audio transcription provider available. Configure an API key for OpenAI, Groq, Deepgram, or Google.",
          ),
        );
        return;
      }

      const provider = getMediaUnderstandingProvider(providerId, registry);
      if (!provider?.transcribeAudio) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `Provider "${providerId}" does not support audio transcription`,
          ),
        );
        return;
      }

      const auth = await resolveApiKeyForProvider({ provider: providerId, cfg });
      const apiKey = requireApiKey(auth, providerId);
      const providerConfig = cfg.models?.providers?.[providerId];
      const audioConfig = cfg.tools?.media?.audio;
      const resolvedModel =
        model || DEFAULT_AUDIO_MODELS[providerId as keyof typeof DEFAULT_AUDIO_MODELS] || undefined;
      const timeoutMs = (audioConfig?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS.audio) * 1000;

      const result = await provider.transcribeAudio({
        buffer,
        fileName,
        mime,
        apiKey,
        baseUrl: providerConfig?.baseUrl ?? audioConfig?.baseUrl,
        headers: providerConfig?.headers,
        model: resolvedModel,
        language: language ?? audioConfig?.language,
        prompt: audioConfig?.prompt,
        timeoutMs,
      });

      respond(true, {
        text: result.text,
        provider: providerId,
        model: result.model ?? resolvedModel,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
