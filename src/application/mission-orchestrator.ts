import type { ArtifactsRepositoryService, AttemptRepository } from "../infrastructure/artifacts";

export interface MissionAttempt {
  id: string;
  agentId: string;
  repository: AttemptRepository;
  status: "ready";
}

export interface OrchestratedMission {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  canonicalRepositoryName: string;
  attempts: MissionAttempt[];
  createdAt: string;
}

export class MissionOrchestrator {
  constructor(private readonly repositories: ArtifactsRepositoryService) {}

  async launch(input: {
    projectId: string;
    canonicalRepositoryName: string;
    title: string;
    objective: string;
    agentIds: string[];
  }): Promise<OrchestratedMission> {
    const missionId = crypto.randomUUID();

    const attempts = await Promise.all(
      input.agentIds.map(async (agentId) => {
        const id = crypto.randomUUID();
        const repository = await this.repositories.createAttempt(
          input.canonicalRepositoryName,
          missionId,
          agentId,
        );
        return { id, agentId, repository, status: "ready" as const };
      }),
    );

    return {
      id: missionId,
      projectId: input.projectId,
      title: input.title,
      objective: input.objective,
      canonicalRepositoryName: input.canonicalRepositoryName,
      attempts,
      createdAt: new Date().toISOString(),
    };
  }
}
