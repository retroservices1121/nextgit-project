export interface ArtifactRepoInfo {
  id?: string;
  name?: string;
  remote?: string;
  defaultBranch?: string;
}

export interface ArtifactCreateTokenResult {
  id?: string;
  plaintext: string;
  scope?: "read" | "write";
  expiresAt?: string;
}

export interface ArtifactCreateResult {
  name: string;
  remote: string;
  defaultBranch?: string;
  token?: string;
}

export interface ArtifactRepoCapability {
  info(): Promise<ArtifactRepoInfo>;
  createToken(
    scope?: "read" | "write",
    ttl?: number,
  ): Promise<ArtifactCreateTokenResult>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      defaultBranchOnly?: boolean;
    },
  ): Promise<ArtifactCreateResult>;
}

export interface ArtifactsBinding {
  create(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    },
  ): Promise<ArtifactCreateResult>;
  get(name: string): Promise<ArtifactRepoCapability>;
}

export interface AttemptRepository {
  name: string;
  remote: string;
}

export interface AttemptCapability {
  repository: AttemptRepository;
  token: ArtifactCreateTokenResult;
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
      setDefaultBranch: "main",
    });

    return { name: created.name, remote: created.remote };
  }

  async createAttempt(
    canonicalRepositoryName: string,
    missionId: string,
    agentId: string,
  ): Promise<AttemptRepository> {
    const source = await this.artifacts.get(canonicalRepositoryName);
    const name = normalize(`attempt-${missionId}-${agentId}`);

    const fork = await source.fork(name, {
      description: `Isolated Mission attempt for ${agentId}`,
      readOnly: false,
      defaultBranchOnly: true,
    });

    return { name: fork.name, remote: fork.remote };
  }

  async mintAttemptCapability(
    repositoryName: string,
    ttlSeconds = 1800,
  ): Promise<AttemptCapability> {
    const repo = await this.artifacts.get(repositoryName);
    const info = await repo.info();
    const token = await repo.createToken("write", ttlSeconds);

    if (!info.remote) {
      throw new Error(`Artifacts repository ${repositoryName} has no remote URL.`);
    }

    return {
      repository: {
        name: info.name ?? repositoryName,
        remote: info.remote,
      },
      token,
    };
  }

  async revokeAttemptCapability(
    repositoryName: string,
    tokenOrId: string,
  ): Promise<boolean> {
    const repo = await this.artifacts.get(repositoryName);
    return repo.revokeToken(tokenOrId);
  }
}
