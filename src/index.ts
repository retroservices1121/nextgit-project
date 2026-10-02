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

    if (request.method === "GET" && url.pathname === "/api/demo/review-data") {
      const attempts = [
        { id: "competition-demo-alpha", agentId: "alpha", repositoryName: "attempt-competition-demo-alpha", path: "docs/CONCEPT_OVERVIEW.md" },
        { id: "competition-demo-beta", agentId: "beta", repositoryName: "attempt-competition-demo-beta", path: "docs/CONCEPTS.md" },
      ];

      const results = await Promise.all(attempts.map(async (attempt) => {
        const repo = await env.ARTIFACTS.get(attempt.repositoryName);
        const info = await repo.info();
        const file = await repo.readFile({ ref: "main", path: attempt.path });
        return {
          ...attempt,
          remoteConfigured: Boolean(info.remote),
          content: file ? await file.text() : undefined,
        };
      }));

      return reply({
        missionId: "competition-demo",
        objective: "Create a concise developer-facing artifact that explains and demonstrates NextGit's core concept: multiple AI implementation agents work independently in isolated repositories, then a human reviews the competing Attempts before accepting one.",
        canonicalRepository: "nextgit-source",
        attempts: results,
      });
    }

    if (request.method === "GET" && url.pathname === "/demo") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextGit — Mission Review</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#f5f7fa;margin:0}main{max-width:1180px;margin:auto;padding:32px 20px}.eyebrow{color:#8b9cff;font-weight:700}.sub{color:#9ca3af;max-width:850px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.card{background:#151922;border:1px solid #293041;border-radius:16px;padding:20px}.badge{display:inline-block;padding:5px 9px;border-radius:99px;background:#15351f;color:#8df0a6;font-size:12px;font-weight:700}.file{background:#0d1117;border-radius:10px;padding:12px;margin:14px 0;font:13px ui-monospace,monospace}.preview{white-space:pre-wrap;background:#0d1117;border-radius:10px;padding:14px;max-height:260px;overflow:auto;color:#c9d1d9;font:12px ui-monospace,monospace}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:9px;padding:10px 13px;font-weight:700;cursor:pointer}.accept{background:#fff}.reject,.revise{background:#252b36;color:#fff}.status{margin-top:10px;color:#9ca3af;font-size:13px}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><div class="eyebrow">NEXTGIT / MISSION REVIEW</div><h1>Competing Attempts</h1><p class="sub" id="mission">Loading Mission…</p><div class="grid" id="attempts"></div></main>
<script>
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){const d=await fetch('/api/demo/review-data').then(r=>r.json());document.getElementById('mission').textContent=d.objective;document.getElementById('attempts').innerHTML=d.attempts.map(a=>`<section class="card"><span class="badge">ARTIFACTS: LIVE</span><h2>${esc(a.agentId)}</h2><div class="file">${esc(a.path)} · ${esc(a.repositoryName)}</div><div class="preview">${esc(a.content||'No readable artifact')}</div><div class="actions"><button class="accept" onclick="decide('${a.id}','accept')">Accept</button><button class="reject" onclick="decide('${a.id}','reject')">Reject</button><button class="revise" onclick="revise('${a.id}')">Request revision</button></div><div class="status" id="${a.id}"></div></section>`).join('')}
async function decide(id,decision,feedback){const el=document.getElementById(id);el.textContent='Saving…';const r=await fetch('/api/decisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:'competition-demo',attemptId:id,decision,feedback})});const j=await r.json();el.textContent=r.ok?'Decision recorded: '+decision:'Error: '+(j.error||'promotion failed')}
function revise(id){const f=prompt('What should this agent revise?');if(f)decide(id,'revise',f)}load();
</script></body></html>`;
      return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
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
            const response = await env.EXECUTOR.fetch("https://executor/execute-attempt", {
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
            const response = await env.EXECUTOR.fetch("https://executor/execute-attempt", {
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

        if (body.decision === "accept" && body.missionId === "competition-demo") {
          const repositoryName = body.attemptId === "competition-demo-alpha"
            ? "attempt-competition-demo-alpha"
            : body.attemptId === "competition-demo-beta"
              ? "attempt-competition-demo-beta"
              : undefined;

          if (repositoryName) {
            const promote = await env.EXECUTOR.fetch("https://executor/promote", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                sourceRepository: repositoryName,
                targetRepository: "nextgit-source",
                decisionId: decision.id,
              }),
            });
            const promotion = await promote.json();
            return reply({ ok: promote.ok, decision, promotion }, promote.ok ? 201 : 502);
          }
        }

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
