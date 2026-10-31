import { GoogleGenAI } from "@google/genai";
import type {
  AIProvider,
  ModelMetadata,
  ProjectAnalysisInput,
  ProviderContext,
  ProviderDefinition,
  ProviderMetadata,
  RequestOptions
} from "../../../domain/ai-provider.js";
import { parseProjectSpec, type ProjectSpec } from "../../../domain/project-spec.js";
import { ExpressForgeError, isExpressForgeError } from "../../../shared/errors.js";
import { buildPrompt, RESPONSE_JSON_SCHEMA } from "./gemini-prompt.js";

export const GEMINI_METADATA: ProviderMetadata = {
  id: "gemini",
  displayName: "Google Gemini",
  envVar: "GEMINI_API_KEY",
  modelEnvVar: "GEMINI_MODEL",
  defaultModel: "gemini-2.5-flash",
  credentialHint: "Create a key at https://aistudio.google.com/apikey"
};

interface GeminiModelInfo {
  name?: string;
  displayName?: string;
  supportedActions?: string[];
}

/** The slice of the SDK this adapter uses; tests supply a fake. */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: { responseMimeType: string; responseJsonSchema: unknown; abortSignal?: AbortSignal };
    }): Promise<{ text?: string }>;
    list(params?: {
      config?: { pageSize?: number; abortSignal?: AbortSignal };
    }): Promise<AsyncIterable<GeminiModelInfo>>;
  };
}

export type GeminiClientFactory = (apiKey: string, timeoutMs: number) => GeminiClient;

const sdkClientFactory: GeminiClientFactory = (apiKey, timeoutMs) =>
  new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });

const MAX_LISTED_MODELS = 200;

export class GeminiProvider implements AIProvider {
  readonly metadata = GEMINI_METADATA;
  private readonly client: GeminiClient;

  constructor(
    private readonly context: ProviderContext,
    clientFactory: GeminiClientFactory = sdkClientFactory
  ) {
    this.client = clientFactory(context.apiKey, context.timeoutMs);
  }

  async validateCredentials(options: RequestOptions = {}): Promise<void> {
    const signal = this.withTimeout(options.signal);
    try {
      const page = await this.client.models.list({ config: { pageSize: 1, abortSignal: signal } });
      // Reading one item guarantees the request completed; its content is irrelevant.
      for await (const _model of page) break;
    } catch (error) {
      throw mapGeminiError(error, options.signal);
    }
  }

  async listModels(options: RequestOptions = {}): Promise<ModelMetadata[]> {
    const signal = this.withTimeout(options.signal);
    const models: ModelMetadata[] = [];
    try {
      const page = await this.client.models.list({ config: { abortSignal: signal } });
      for await (const model of page) {
        if (!model.name) continue;
        if (model.supportedActions && !model.supportedActions.includes("generateContent")) continue;
        models.push({
          id: model.name.replace(/^models\//, ""),
          ...(model.displayName ? { displayName: model.displayName } : {})
        });
        if (models.length >= MAX_LISTED_MODELS) break;
      }
    } catch (error) {
      throw mapGeminiError(error, options.signal);
    }
    return models;
  }

  async proposeProjectSpec(input: ProjectAnalysisInput, options: RequestOptions = {}): Promise<ProjectSpec> {
    let text: string | undefined;
    try {
      const response = await this.client.models.generateContent({
        model: this.context.model,
        contents: buildPrompt(input),
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          abortSignal: this.withTimeout(options.signal)
        }
      });
      text = response.text;
    } catch (error) {
      throw mapGeminiError(error, options.signal);
    }

    if (!text) throw new ExpressForgeError("INVALID_AI_RESPONSE", "Gemini returned an empty response.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ExpressForgeError("INVALID_AI_RESPONSE", "Gemini returned invalid JSON.", {
        hint: "Try again, or rephrase your project description."
      });
    }
    return parseProjectSpec(parsed);
  }

  private withTimeout(signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(this.context.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
}

/**
 * Translates SDK failures into typed errors. The raw SDK message is deliberately
 * not forwarded: it can echo request details. Only the HTTP status is kept.
 */
export function mapGeminiError(error: unknown, userSignal?: AbortSignal): ExpressForgeError {
  if (isExpressForgeError(error)) return error;
  if (userSignal?.aborted) return new ExpressForgeError("CANCELLED", "The request was cancelled.");

  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return new ExpressForgeError("NETWORK_TIMEOUT", "Gemini did not respond in time.", {
      hint: "Check your connection and try again."
    });
  }

  const status =
    typeof (error as { status?: unknown } | null)?.status === "number"
      ? (error as { status: number }).status
      : undefined;
  const message = error instanceof Error ? error.message : "";

  if (status === 401 || status === 403 || (status === 400 && /api key not valid|API_KEY_INVALID/i.test(message))) {
    return new ExpressForgeError("INVALID_API_KEY", "Gemini rejected the API key.", {
      hint: "Run `expressforge config set` to replace it.",
      details: { status }
    });
  }
  if (status === 404) {
    return new ExpressForgeError("UNSUPPORTED_MODEL", "Gemini does not recognise the selected model.", {
      hint: "Choose another model with `expressforge config set --model <id>`.",
      details: { status }
    });
  }
  if (status === 429) {
    return new ExpressForgeError("RATE_LIMITED", "Gemini rate limit or quota exceeded.", {
      hint: "Wait a moment and try again, or check your quota.",
      details: { status }
    });
  }
  return new ExpressForgeError("PROVIDER_UNAVAILABLE", "Gemini could not be reached or returned an error.", {
    hint: "Check your connection and try again.",
    details: { status }
  });
}

export function createGeminiDefinition(clientFactory?: GeminiClientFactory): ProviderDefinition {
  return {
    metadata: GEMINI_METADATA,
    create: (context) => new GeminiProvider(context, clientFactory)
  };
}

export const geminiDefinition: ProviderDefinition = createGeminiDefinition();
