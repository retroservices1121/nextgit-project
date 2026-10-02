export interface AgentSandboxStub {
  prepareAttempt(input: {
    remote: string;
    token: string;
    branch?: string;
  }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  run(argv: string[], env?: Record<string, string>): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  destroy(): Promise<void>;
}

export interface AgentSandboxNamespace {
  getByName(name: string): AgentSandboxStub;
}

export interface AttemptRuntimeInput {
  attemptId: string;
  repositoryRemote: string;
  repositoryToken: string;
  branch?: string;
}

export class AgentRuntimeLauncher {
  constructor(private readonly sandboxes: AgentSandboxNamespace) {}

  async prepare(input: AttemptRuntimeInput) {
    const sandbox = this.sandboxes.getByName(`attempt-${input.attemptId}`);

    const result = await sandbox.prepareAttempt({
      remote: input.repositoryRemote,
      token: input.repositoryToken,
      branch: input.branch ?? "main",
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to prepare Attempt sandbox: ${result.stderr || result.stdout}`,
      );
    }

    return {
      sandbox,
      workspace: "/workspace/project",
    };
  }
}
