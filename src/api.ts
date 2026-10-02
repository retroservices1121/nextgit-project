import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import type { ArtifactsBinding } from "./infrastructure/artifacts";
import { ArtifactsRepositoryService } from "./infrastructure/artifacts";
import { MissionService } from "./application/mission-service";
import { MastraSandboxHarness } from "./agents/implementation/mastra-sandbox-harness";
import type { AgentSandboxStub } from "./runtime/agent-runtime";

export interface Env {
  ARTIFACTS: ArtifactsBinding;
  Sandbox: DurableObjectNamespace<Sandbox>;
  AGENT_MODEL?: string;
}

class StableSandboxAdapter implements AgentSandboxStub {
  constructor(private readonly sandbox: ReturnType<typeof getSandbox>) {}

  async prepareAttempt(input: { remote: string; token: string; branch?: string }) {
    const secret = input.token.split("?expires=")[0];
    const remote = `https://x:${secret}@${input.remote.slice("https://".length)}`;
    await this.sandbox.setEnvVars({ ARTIFACTS_GIT_REMOTE: remote });

    const result = await this.sandbox.exec(
      [
        "set -eu",
        "rm -rf /workspace/project",
        'git clone --branch "' + (input.branch ?? "main") + '" --single-branch "$ARTIFACTS_GIT_REMOTE" /workspace/project',
        "cd /workspace/project",
        "git config user.name 'NextGit Agent'",
        "git config user.email 'agent@nextgit.local'",
      ].join("\n"),
    );

    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async run(argv: string[], env: Record<string, string> = {}) {
    if (Object.keys(env).length) await this.sandbox.setEnvVars(env);
    const command = argv.length >= 3 && argv[0] === "sh" && argv[1] === "-lc"
      ? argv[2]
      : argv.map((x) => JSON.stringify(x)).join(" ");
    const result = await this.sandbox.exec(command);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async destroy() {
    await this.sandbox.destroy();
  }
}

export async function createProject(env: Env, name: string) {
  const repositories = new ArtifactsRepositoryService(env.ARTIFACTS);
  const id = crypto.randomUUID();
  const repository = await repositories.createCanonicalProject(id);
  return { id, name, canonicalRepositoryId: repository.name, createdAt: new Date().toISOString() };
}

export async function createMission(env: Env, input: {
  projectId: string; canonicalRepositoryName: string; title: string; objective: string; agentIds: string[];
}) {
  return new MissionService(new ArtifactsRepositoryService(env.ARTIFACTS)).launch(input);
}

export async function executeAttempt(env: Env, input: {
  attemptId: string; repositoryName: string; objective: string; agentId: string;
}) {
  if (!env.AGENT_MODEL) throw new Error("AGENT_MODEL is not configured.");

  const repositories = new ArtifactsRepositoryService(env.ARTIFACTS);
  const capability = await repositories.mintAttemptCapability(input.repositoryName, 30 * 60);
  const sandbox = new StableSandboxAdapter(getSandbox(env.Sandbox, `attempt-${input.attemptId}`));

  try {
    const prepared = await sandbox.prepareAttempt({
      remote: capability.repository.remote,
      token: capability.token.plaintext!,
      branch: "main",
    });
    if (prepared.exitCode !== 0) throw new Error(prepared.stderr || prepared.stdout);

    const harness = new MastraSandboxHarness(input.agentId, env.AGENT_MODEL);
    const result = await harness.run({ sandbox, workspace: "/workspace/project", objective: input.objective });

    const push = await sandbox.run(["sh","-lc",[
      "set -eu","cd /workspace/project","git add -A",
      "if git diff --cached --quiet; then exit 0; fi",
      "git commit -m 'agent: complete mission attempt'",
      "git push origin HEAD"
    ].join("\n")]);

    if (push.exitCode !== 0) throw new Error(push.stderr || push.stdout);
    return result;
  } finally {
    await repositories.revokeAttemptCapability(input.repositoryName, capability.token.id ?? capability.token.plaintext!);
  }
}
