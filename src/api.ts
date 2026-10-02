import type { ArtifactsBinding } from "./infrastructure/artifacts";
import { ArtifactsRepositoryService } from "./infrastructure/artifacts";
import { MissionService } from "./application/mission-service";

export interface Env {
  ARTIFACTS: ArtifactsBinding;
}

export async function createProject(env: Env, name: string) {
  const repositories = new ArtifactsRepositoryService(env.ARTIFACTS);
  const id = crypto.randomUUID();
  const repository = await repositories.createCanonicalProject(id);
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
  const service = new MissionService(new ArtifactsRepositoryService(env.ARTIFACTS));
  return service.launch(input);
}
