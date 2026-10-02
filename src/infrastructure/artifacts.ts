export interface ArtifactRepoInfo {
  id?: string;
  name?: string;
  remote?: string;
  default_branch?: string;
}

export interface ArtifactRepoHandle {
  repo: {
    info(): Promise<ArtifactRepoInfo | null>;
    fork?(name: string): Promise<ArtifactRepoHandle>;
  };
}

export interface ArtifactsBinding {
  create(name: string): Promise<ArtifactRepoHandle>;
  get?(name: string): Promise<ArtifactRepoHandle>;
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
    const created = await this.artifacts.create(name);
    const info = await created.repo.info();
    return { name, remote: info?.remote };
  }

  async createAttempt(
    canonicalRepositoryName: string,
    missionId: string,
    agentId: string,
  ): Promise<AttemptRepository> {
    if (!this.artifacts.get) {
      throw new Error("Artifacts binding does not expose repository lookup.");
    }

    const source = await this.artifacts.get(canonicalRepositoryName);
    if (!source.repo.fork) {
      throw new Error("Artifacts repository does not expose fork().");
    }

    const name = normalize(`attempt-${missionId}-${agentId}`);
    const fork = await source.repo.fork(name);
    const info = await fork.repo.info();
    return { name, remote: info?.remote };
  }
}
