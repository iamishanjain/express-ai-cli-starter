import type { ProjectSpec } from "../types/spec.js";

export interface ProjectAnalysisInput {
  description: string;
  database: string;
}

export interface AIProvider {
  proposeProjectSpec(input: ProjectAnalysisInput): Promise<ProjectSpec>;
}
