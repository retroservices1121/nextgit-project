export interface ArtifactRepoInfo {
  id?: string;
  name?: string;
  remote?: string;
  defaultBranch?: string;
}

export interface ArtifactRepoCapability {
  info(): Promise<ArtifactRepoInfo | null>;
  fork?(params: {
    target: {
      name: string;
      opts?: { description?: string; readOnly?: boolean };
    };
    defaultBranchOnly?: boolean;
  }): Promise<ArtifactCreateResult>;
}

export interface ArtifactRepoHandle {
  repo: ArtifactRepoCapability;
}

export interface ArtifactCreateResult {
  name: string;
  remote?: string;
  repo: ArtifactRepoCapability;
}

export interface ArtifactsBinding {
  create(
    name: string,
    opts?: { description?: string; readOnly?: boolean; defaultBranch?: string },
  ): Promise<ArtifactCreateResult>;
  get(name: string): Promise<ArtifactRepoHandle>;
}

export interface AttemptRepository {
  name: string;
  remote?: string;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

export class ArtifactsRepositoryService {
  constructor(private readonly artifacts: ArtifactsBinding) {}

  async createCanonicalProject(projectId: string): Promise<AttemptRepository> {
    const name = normalize(`project-${projectId}`);
    const created = await this.artifacts.create(name, {
      description: "Canonical project repository",
      readOnly: false,
      defaultBranch: "main",
    });
    return { name: created.name ?? name, remote: created.remote };
  }

  async createAttempt(
    canonicalRepositoryName: string,
    missionId: string,
    agentId: string,
  ): Promise<AttemptRepository> {
    const source = await this.artifacts.get(canonicalRepositoryName);
    if (!source.repo.fork) {
      throw new Error("Artifacts repository does not expose fork().");
    }

    const name = normalize(`attempt-${missionId}-${agentId}`);
    const fork = await source.repo.fork({
      target: {
        name,
        opts: {
          description: `Isolated Mission attempt for ${agentId}`,
          readOnly: false,
        },
      },
      defaultBranchOnly: true,
    });

    return { name: fork.name ?? name, remote: fork.remote };
  }
}
