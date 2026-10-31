/**
 * Public type surface. ExpressForge is a CLI; these types let provider authors
 * implement the adapter contract without depending on internal paths.
 */
export type {
  AIProvider,
  ModelMetadata,
  ProjectAnalysisInput,
  ProviderContext,
  ProviderDefinition,
  ProviderMetadata,
  RequestOptions
} from "./domain/ai-provider.js";
export type { ProjectSpec } from "./domain/project-spec.js";
export { ExpressForgeError } from "./shared/errors.js";
export type { ErrorCode } from "./shared/errors.js";
