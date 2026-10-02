import type { Attempt, Mission } from "../domain";
import { ArtifactsRepositoryService } from "../infrastructure/artifacts";

export interface LaunchMissionInput {
  projectId: string;
  canonicalRepositoryName: string;
  title: string;
  objective: string;
  agentIds: string[];
}

export interface LaunchedMission {
  mission: Mission;
  attempts: Attempt[];
}

export class MissionService {
  constructor(private readonly repositories: ArtifactsRepositoryService) {}

  async launch(input: LaunchMissionInput): Promise<LaunchedMission> {
    if (input.agentIds.length < 2) {
      throw new Error("A Mission requires at least two implementation agents.");
    }

    const missionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const mission: Mission = {
      id: missionId,
      projectId: input.projectId,
      title: input.title,
      objective: input.objective,
      status: "running",
      createdAt,
    };

    // Attempts are intentionally created concurrently. Each gets its own
    // Artifacts fork and can evolve without touching canonical project state.
    const attempts = await Promise.all(
      input.agentIds.map(async (agentId): Promise<Attempt> => {
        const repository = await this.repositories.createAttempt(
          input.canonicalRepositoryName,
          missionId,
          agentId,
        );

        return {
          id: crypto.randomUUID(),
          missionId,
          agentId,
          repositoryId: repository.name,
          status: "queued",
          createdAt,
        };
      }),
    );

    return { mission, attempts };
  }
}
