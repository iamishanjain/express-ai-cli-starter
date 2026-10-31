import type { AIProvider, ProjectAnalysisInput } from "../domain/ai-provider.js";
import { parseProjectSpec, type ProjectSpec } from "../domain/project-spec.js";

/**
 * Asks a provider for a project specification and validates the result again,
 * so no adapter can hand unvalidated AI output to the rest of the application.
 * The result is a proposal only; nothing in it is ever executed.
 */
export async function analyzeProject(
  provider: AIProvider,
  input: ProjectAnalysisInput,
  signal?: AbortSignal
): Promise<ProjectSpec> {
  const proposal = await provider.proposeProjectSpec(input, signal ? { signal } : undefined);
  return parseProjectSpec(proposal);
}
