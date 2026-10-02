import { createMission, createProject, type Env } from "./api";
import { DecisionService, type DecisionKind } from "./application/decision-service";

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
          executionPlane: "nextgit-executor",
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

    if (request.method === "GET" && url.pathname === "/api/demo/compete") {
      const missionId = "competition-demo";
      const objective = "Create a concise developer-facing artifact that explains and demonstrates NextGit's core concept: multiple AI implementation agents work independently in isolated repositories, then a human reviews the competing Attempts before accepting one.";

      const attempts = [
        {
          id: "competition-demo-alpha",
          agentId: "alpha",
          repositoryName: "attempt-competition-demo-alpha",
        },
        {
          id: "competition-demo-beta",
          agentId: "beta",
          repositoryName: "attempt-competition-demo-beta",
        },
      ];

      const runId = crypto.randomUUID();
      const results = await Promise.all(
        attempts.map(async (attempt) => {
          try {
            const response = await fetch("https://nextgit-executor.retro-b22.workers.dev/execute-attempt", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                runId,
                attemptId: attempt.id,
                repositoryName: attempt.repositoryName,
                agentId: attempt.agentId,
                objective,
              }),
            });
            return {
              attemptId: attempt.id,
              agentId: attempt.agentId,
              repositoryName: attempt.repositoryName,
              ok: response.ok,
              result: await response.json(),
            };
          } catch (error) {
            return {
              attemptId: attempt.id,
              agentId: attempt.agentId,
              repositoryName: attempt.repositoryName,
              ok: false,
              result: { error: error instanceof Error ? error.message : "Executor request failed" },
            };
          }
        }),
      );

      return reply({
        ok: results.every((result) => result.ok),
        missionId,
        runId,
        objective,
        results,
      }, results.every((result) => result.ok) ? 200 : 207);
    }

    if (request.method === "POST" && url.pathname === "/api/missions/execute") {
      const body = (await request.json()) as {
        missionId?: string;
        objective?: string;
        attempts?: Array<{
          id: string;
          agentId: string;
          repositoryName: string;
        }>;
      };

      if (!body.missionId || !body.objective || !body.attempts?.length) {
        return reply({ error: "missionId, objective, and attempts are required" }, 400);
      }

      const runId = crypto.randomUUID();
      const results = await Promise.all(
        body.attempts.map(async (attempt) => {
          try {
            const response = await fetch("https://nextgit-executor.retro-b22.workers.dev/execute-attempt", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                runId,
                attemptId: attempt.id,
                repositoryName: attempt.repositoryName,
                agentId: attempt.agentId,
                objective: body.objective,
              }),
            });
            const result = await response.json();
            return { attemptId: attempt.id, agentId: attempt.agentId, ok: response.ok, result };
          } catch (error) {
            return {
              attemptId: attempt.id,
              agentId: attempt.agentId,
              ok: false,
              result: { error: error instanceof Error ? error.message : "Executor request failed" },
            };
          }
        }),
      );

      return reply({
        ok: results.every((result) => result.ok),
        missionId: body.missionId,
        runId,
        results,
      }, results.every((result) => result.ok) ? 200 : 207);
    }

    if (request.method === "POST" && url.pathname === "/api/decisions") {
      const body = (await request.json()) as {
        missionId?: string;
        attemptId?: string;
        decision?: DecisionKind;
        feedback?: string;
      };

      if (!body.missionId || !body.attemptId || !body.decision ||
          !["accept", "reject", "revise"].includes(body.decision)) {
        return reply({ error: "missionId, attemptId, and a valid decision are required" }, 400);
      }

      try {
        const decision = new DecisionService().decide({
          missionId: body.missionId,
          attemptId: body.attemptId,
          decision: body.decision,
          feedback: body.feedback,
        });
        return reply({ ok: true, decision }, 201);
      } catch (error) {
        return reply({ error: error instanceof Error ? error.message : "Decision failed" }, 400);
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
