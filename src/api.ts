import type { ArtifactsBinding } from "./infrastructure/artifacts";
import { ArtifactsRepositoryService } from "./infrastructure/artifacts";
import { MissionService } from "./application/mission-service";
import type { AgentSandboxNamespace } from "./runtime/agent-runtime";
import { AgentRuntimeLauncher } from "./runtime/agent-runtime";
import { AttemptExecutionRuntime } from "./runtime/attempt-execution";
import { MastraSandboxHarness } from "./agents/implementation/mastra-sandbox-harness";

export interface Env {
  ARTIFACTS: ArtifactsBinding;
  AGENT_SANDBOX: AgentSandboxNamespace;
  AGENT_MODEL?: string;
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

export async function executeAttempt(
  env: Env,
  input: {
    attemptId: string;
    repositoryName: string;
    objective: string;
    agentId: string;
  },
) {
  if (!env.AGENT_MODEL) {
    throw new Error("AGENT_MODEL is not configured.");
  }

  const repositories = new ArtifactsRepositoryService(env.ARTIFACTS);
  const launcher = new AgentRuntimeLauncher(env.AGENT_SANDBOX);
  const runtime = new AttemptExecutionRuntime(repositories, launcher);
  const harness = new MastraSandboxHarness(input.agentId, env.AGENT_MODEL);

  return runtime.execute({
    attemptId: input.attemptId,
    repositoryName: input.repositoryName,
    objective: input.objective,
    harness,
  });
}
