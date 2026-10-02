import type { ArtifactsRepositoryService } from "../infrastructure/artifacts";
import type {
  AgentRuntimeLauncher,
  AgentSandboxStub,
} from "./agent-runtime";

export interface CodingHarness {
  id: string;
  run(input: {
    sandbox: AgentSandboxStub;
    workspace: string;
    objective: string;
  }): Promise<{
    summary: string;
    filesChanged: string[];
  }>;
}

export class AttemptExecutionRuntime {
  constructor(
    private readonly repositories: ArtifactsRepositoryService,
    private readonly launcher: AgentRuntimeLauncher,
  ) {}

  async execute(input: {
    attemptId: string;
    repositoryName: string;
    objective: string;
    harness: CodingHarness;
  }) {
    const capability = await this.repositories.mintAttemptCapability(
      input.repositoryName,
      30 * 60,
    );

    try {
      const prepared = await this.launcher.prepare({
        attemptId: input.attemptId,
        repositoryRemote: capability.repository.remote,
        repositoryToken: capability.token.plaintext,
      });

      const result = await input.harness.run({
        sandbox: prepared.sandbox,
        workspace: prepared.workspace,
        objective: input.objective,
      });

      const push = await prepared.sandbox.run(
        [
          "sh",
          "-lc",
          [
            "set -eu",
            "cd /workspace/project",
            "git add -A",
            "if git diff --cached --quiet; then exit 0; fi",
            "git commit -m \"agent: complete mission attempt\"",
            "GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/git-askpass.sh git push origin HEAD",
          ].join("\n"),
        ],
        {
          ARTIFACT_REPO_TOKEN: capability.token.plaintext,
        },
      );

      if (push.exitCode !== 0) {
        throw new Error(
          `Attempt push failed: ${push.stderr || push.stdout}`,
        );
      }

      return result;
    } finally {
      // Tokens are disposable capabilities. Revoke them even when the agent
      // fails, and never persist plaintext tokens in Mission state.
      await this.repositories.revokeAttemptCapability(
        input.repositoryName,
        capability.token.id ?? capability.token.plaintext,
      );
    }
  }
}
