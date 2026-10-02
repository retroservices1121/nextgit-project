export { AgentSandbox } from "./runtime/agent-sandbox";

import { createMission, createProject, executeAttempt, type Env } from "./api";

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return reply({ ok: true, service: "nextgit-project", phase: "mission-infrastructure" });
    }

    if (request.method === "GET" && url.pathname === "/api/self-test") {
      try {
        const repo = await env.ARTIFACTS.get("nextgit-source");
        const info = await repo.info();
        return reply({
          ok: true,
          artifacts: {
            repository: info.name ?? "nextgit-source",
            remoteConfigured: Boolean(info.remote),
          },
          sandbox: Boolean(env.AGENT_SANDBOX),
          modelConfigured: Boolean(env.AGENT_MODEL),
        });
      } catch (error) {
        return reply({
          ok: false,
          error: error instanceof Error ? error.message : "Self-test failed",
        }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const body = (await request.json()) as { name?: string };
      if (!body.name) return reply({ error: "name is required" }, 400);
      return reply(await createProject(env, body.name), 201);
    }

    if (request.method === "POST" && url.pathname === "/api/missions") {
      const body = (await request.json()) as {
        projectId: string;
        canonicalRepositoryName: string;
        title: string;
        objective: string;
        agentIds?: string[];
      };
      return reply(await createMission(env, {
        projectId: body.projectId,
        canonicalRepositoryName: body.canonicalRepositoryName,
        title: body.title,
        objective: body.objective,
        agentIds: body.agentIds?.length ? body.agentIds : ["agent-a", "agent-b"],
      }), 201);
    }

    if (request.method === "POST" && url.pathname === "/api/attempts/execute") {
      const body = (await request.json()) as {
        attemptId: string;
        repositoryName: string;
        objective: string;
        agentId: string;
      };

      if (!body.attemptId || !body.repositoryName || !body.objective || !body.agentId) {
        return reply({ error: "Missing required Attempt execution fields" }, 400);
      }

      try {
        return reply(await executeAttempt(env, body), 200);
      } catch (error) {
        return reply(
          { error: error instanceof Error ? error.message : "Attempt execution failed" },
          500,
        );
      }
    }

    return reply({
      name: "NextGit Project",
      endpoints: [
        "GET /health",
        "POST /api/projects",
        "POST /api/missions",
        "POST /api/attempts/execute"
      ],
    });
  },
};
