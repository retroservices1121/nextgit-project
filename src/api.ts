import type { ArtifactsBinding } from "./infrastructure/artifacts";
import { ArtifactsRepositoryService } from "./infrastructure/artifacts";
import { MissionOrchestrator } from "./application/mission-orchestrator";

export interface Env {
  ARTIFACTS: ArtifactsBinding;
  EXECUTOR: Fetcher;
}

export async function createProject(env: Env, name: string, sourceUrl?: string, branch?: string) {
  const repositories = new ArtifactsRepositoryService(env.ARTIFACTS);
  const id = crypto.randomUUID();
  const repository = sourceUrl
    ? await repositories.importCanonicalProject(id, sourceUrl, branch)
    : await repositories.createCanonicalProject(id);
  return {
    id,
    name,
    canonicalRepositoryId: repository.name,
    createdAt: new Date().toISOString(),
  };
}

export async function createMission(
  env: Env,
  input: {
    projectId: string;
    canonicalRepositoryName: string;
    title: string;
    objective: string;
    agentIds: string[];
  },
) {
  const service = new MissionOrchestrator(new ArtifactsRepositoryService(env.ARTIFACTS));
  return service.launch(input);
}
