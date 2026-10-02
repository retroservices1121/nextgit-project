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
      const mission = await createMission(env, {
        projectId: body.projectId,
        canonicalRepositoryName: body.canonicalRepositoryName,
        title: body.title,
        objective: body.objective,
        agentIds: body.agentIds?.length ? body.agentIds : ["agent-a", "agent-b"],
      });
      await env.STATE.put(`mission:${mission.id}`, JSON.stringify(mission));
      await Promise.all(mission.attempts.map((attempt) =>
        env.STATE.put(`attempt:${attempt.id}`, JSON.stringify({
          missionId: mission.id,
          projectId: mission.projectId,
          canonicalRepositoryName: mission.canonicalRepositoryName,
          attemptId: attempt.id,
          agentId: attempt.agentId,
          repositoryName: attempt.repository.name,
        }))
      ));
      return reply(mission, 201);
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

    if (request.method === "GET" && url.pathname === "/") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextGit</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#f5f7fa;margin:0}main{max-width:920px;margin:auto;padding:54px 20px}.eyebrow{color:#8b9cff;font-weight:800}.hero{font-size:clamp(40px,8vw,78px);line-height:.95;margin:16px 0}.sub{color:#a8b0bd;font-size:18px;max-width:700px}.panel{margin-top:36px;background:#151922;border:1px solid #293041;border-radius:18px;padding:22px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;color:#a8b0bd;font-size:13px;margin:10px 0 6px}input,textarea,select{width:100%;box-sizing:border-box;background:#0d1117;color:#fff;border:1px solid #303848;border-radius:9px;padding:11px}textarea{min-height:120px}button,a.btn{display:inline-block;margin-top:16px;background:#fff;color:#111;border:0;border-radius:9px;padding:11px 16px;font-weight:800;text-decoration:none;cursor:pointer}.muted{color:#7f8998;font-size:13px}.status{white-space:pre-wrap;margin-top:14px;color:#a8b0bd;font:12px ui-monospace,monospace}@media(max-width:650px){.row{grid-template-columns:1fr}}</style></head>
<body><main><div class="eyebrow">NEXTGIT</div><h1 class="hero">Ship the best attempt,<br>not the first one.</h1><p class="sub">Give one Mission to multiple isolated AI implementation agents. Review their competing Git changes, then choose what becomes canonical.</p>
<section class="panel"><h2>Create a project</h2><div class="row"><div><label>Source</label><select id="source" onchange="sourceChanged()"><option value="blank">Start blank</option><option value="import">Import Git repository</option></select></div><div id="branchWrap" style="display:none"><label>Branch (optional)</label><input id="branch" placeholder="main"></div></div><div id="importWrap" style="display:none"><label>HTTPS Git URL</label><input id="sourceUrl" placeholder="https://github.com/owner/repository.git"><div class="muted">Imported into Cloudflare Artifacts; future Attempts fork from the imported canonical repository.</div></div><div class="row"><div><label>Project name</label><input id="project" value="My NextGit Project"></div><div><label>Agents</label><select id="agents"><option value="2">2 competing agents</option><option value="3">3 competing agents</option></select></div></div><label>Mission</label><textarea id="objective" placeholder="Describe what you want implemented…"></textarea><button onclick="launch()">Create & launch Mission</button><div class="status" id="status"></div></section>
<p class="muted">Already have the competition demo? <a href="/demo" style="color:#aeb9ff">Open Mission Review</a></p>
<script>
async function launch(){const s=document.getElementById('status');s.textContent='Creating project…';try{const p=await fetch('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.getElementById('project').value,sourceUrl:document.getElementById('source').value==='import'?document.getElementById('sourceUrl').value:undefined,branch:document.getElementById('source').value==='import'?(document.getElementById('branch').value||undefined):undefined})}).then(r=>r.json());if(!p.id)throw new Error(p.error||'Project creation failed');const n=Number(document.getElementById('agents').value);const ids=Array.from({length:n},(_,i)=>'agent-'+String.fromCharCode(97+i));s.textContent='Creating isolated Attempts…';const m=await fetch('/api/missions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:p.id,canonicalRepositoryName:p.canonicalRepositoryId,title:'Implementation Mission',objective:document.getElementById('objective').value,agentIds:ids})}).then(r=>r.json());if(!m.id||!m.attempts)throw new Error(m.error||'Mission creation failed');s.textContent='Agents are implementing independently…';const attempts=m.attempts.map(a=>({id:a.id,agentId:a.agentId,repositoryName:a.repository.name}));const x=await fetch('/api/missions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:m.id,objective:document.getElementById('objective').value,attempts})}).then(r=>r.json());if(!x.results)throw new Error(x.error||'Execution failed');sessionStorage.setItem('nextgit:lastMission',JSON.stringify({project:p,mission:m,execution:x}));s.textContent=x.ok?'Mission complete. Opening review…':'Mission completed with one or more failed Attempts. Opening review…';setTimeout(()=>location.href='/mission-review',500)}catch(e){s.textContent='Error: '+e.message}}
</script></body></html>`;
      return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
    }

    if (request.method === "POST" && url.pathname === "/api/repositories/upload") {
      const body = await request.json() as { repositoryName?: string; path?: string; contentBase64?: string; message?: string };
      if (!body.repositoryName || !body.path || body.contentBase64 === undefined) return reply({ error: "repositoryName, path, and contentBase64 are required" }, 400);
      const response = await env.EXECUTOR.fetch("https://executor/upload-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
    }

    if (request.method === "POST" && url.pathname === "/api/attempts/diff") {
      const body = (await request.json()) as { repositoryName?: string };
      if (!body.repositoryName) return reply({ error: "repositoryName is required" }, 400);
      const response = await env.EXECUTOR.fetch("https://executor/diff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryName: body.repositoryName }),
      });
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
    }

    if (request.method === "GET" && url.pathname === "/mission-review") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextGit — Mission Review</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#f5f7fa;margin:0}main{max-width:1100px;margin:auto;padding:34px 20px}.top{color:#8b9cff;font-weight:800}.sub{color:#a8b0bd}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:24px}.card{background:#151922;border:1px solid #293041;border-radius:16px;padding:20px}.ok{color:#8df0a6;font-size:13px;font-weight:700}.bad{color:#ff8f8f;font-size:13px;font-weight:700}button:disabled{opacity:.35;cursor:not-allowed}.file{font:13px ui-monospace,monospace;background:#0d1117;padding:12px;border-radius:9px;margin:14px 0;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer}.primary{background:#fff}.secondary{background:#252b36;color:#fff}.details{display:none;white-space:pre-wrap;background:#0d1117;padding:12px;border-radius:9px;margin-top:12px;max-height:300px;overflow:auto;font:12px ui-monospace,monospace;color:#c9d1d9}.status{color:#a8b0bd;font-size:13px;margin-top:10px}a{color:#aeb9ff}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><div class="top">NEXTGIT / MISSION REVIEW</div><h1 id="title">Competing Attempts</h1><p class="sub" id="objective"></p><div class="grid" id="cards"></div><p><a href="/">← New Mission</a></p></main>
<script>
const d=JSON.parse(sessionStorage.getItem('nextgit:lastMission')||'null');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
if(!d){document.getElementById('objective').textContent='No Mission in this browser session.'}else{
 document.getElementById('title').textContent=d.mission.title||'Mission Review';document.getElementById('objective').textContent=d.mission.objective;
 document.getElementById('cards').innerHTML=d.execution.results.map((r,i)=>{const x=r.result||{};const path=x.selectedPath||'No file produced';const label='Agent '+String.fromCharCode(65+i);const secure=r.security&&r.security.passed===true;const securityLabel=secure?'✓ Security: Pass':'✕ Security: Blocked';const securityClass=secure?'ok':'bad';return '<section class="card"><div class="'+securityClass+'">'+securityLabel+'</div><h2>'+label+'</h2><div class="file">+ '+esc(path)+'</div><p class="sub">'+(r.ok?'Independent implementation ready for review.':'This Attempt is not eligible for acceptance.')+'</p><div class="actions"><button class="secondary" onclick="showDiff(\''+r.attemptId+'\')">View changes</button><button class="primary" '+(secure?'':'disabled title="Blocked by Security Agent"')+' onclick="decide(\''+r.attemptId+'\',\'accept\')">Accept</button><button class="secondary" onclick="revise(\''+r.attemptId+'\')">Request revision</button><button class="secondary" onclick="decide(\''+r.attemptId+'\',\'reject\')">Reject</button></div><div class="details" id="detail-'+r.attemptId+'">'+esc(JSON.stringify({agent:r.agentId,path:x.selectedPath,repository:x.repository},null,2))+'</div><div class="status" id="status-'+r.attemptId+'"></div></section>'}).join('');
}
async function showDiff(id){const item=d.execution.results.find(r=>r.attemptId===id);const e=document.getElementById('detail-'+id);e.style.display='block';e.textContent='Loading Git diff…';const r=await fetch('/api/attempts/diff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repositoryName:item.result.repository})});const j=await r.json();e.textContent=r.ok?(j.stdout||'No diff'):'Unable to load diff: '+(j.error||j.stderr||'unknown error')}
async function decide(id,decision,feedback){const e=document.getElementById('status-'+id);e.textContent='Saving…';const r=await fetch('/api/decisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:d.mission.id,attemptId:id,decision,feedback})});const j=await r.json();e.textContent=r.ok?'Decision recorded: '+decision:'Error: '+(j.error||'decision failed')}
function revise(id){const f=prompt('What should this agent revise?');if(f)decide(id,'revise',f)}
</script></body></html>`;
      return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
    }

    if (request.method === "GET" && url.pathname === "/demo") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextGit — Mission Review</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#f5f7fa;margin:0}main{max-width:1180px;margin:auto;padding:32px 20px}.eyebrow{color:#8b9cff;font-weight:700}.sub{color:#9ca3af;max-width:850px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.card{background:#151922;border:1px solid #293041;border-radius:16px;padding:20px}.badge{display:inline-block;padding:5px 9px;border-radius:99px;background:#15351f;color:#8df0a6;font-size:12px;font-weight:700}.file{background:#0d1117;border-radius:10px;padding:12px;margin:14px 0;font:13px ui-monospace,monospace}.preview{white-space:pre-wrap;background:#0d1117;border-radius:10px;padding:14px;max-height:260px;overflow:auto;color:#c9d1d9;font:12px ui-monospace,monospace}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:9px;padding:10px 13px;font-weight:700;cursor:pointer}.accept{background:#fff}.reject,.revise{background:#252b36;color:#fff}.status{margin-top:10px;color:#9ca3af;font-size:13px}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><div class="eyebrow">NEXTGIT / MISSION REVIEW</div><h1>Competing Attempts</h1><p class="sub" id="mission">Loading Mission…</p><div class="grid" id="attempts"></div></main>
<script>
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){const d=await fetch('/api/demo/review-data').then(r=>r.json());document.getElementById('mission').textContent=d.objective;document.getElementById('attempts').innerHTML=d.attempts.map(a=>'<section class="card"><span class="badge">ARTIFACTS: LIVE</span><h2>'+esc(a.agentId)+'</h2><div class="file">'+esc(a.path)+' · '+esc(a.repositoryName)+'</div><div class="preview">'+esc(a.content||'No readable artifact')+'</div><div class="actions"><button class="accept" data-id="'+esc(a.id)+'">Accept</button><button class="reject" data-id="'+esc(a.id)+'">Reject</button><button class="revise" data-id="'+esc(a.id)+'">Request revision</button></div><div class="status" id="'+esc(a.id)+'"></div></section>').join('');document.querySelectorAll('.accept').forEach(b=>b.onclick=()=>decide(b.dataset.id,'accept'));document.querySelectorAll('.reject').forEach(b=>b.onclick=()=>decide(b.dataset.id,'reject'));document.querySelectorAll('.revise').forEach(b=>b.onclick=()=>revise(b.dataset.id))}
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
            const result = await response.json() as any;
            let security: any = { ok: false, passed: false, status: "unavailable", findings: [{ severity: "high", message: "Security scan did not run." }] };
            if (response.ok && result?.repository) {
              const scan = await env.EXECUTOR.fetch("https://executor/security-scan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ repositoryName: result.repository }),
              });
              security = await scan.json();
            }
            return { attemptId: attempt.id, agentId: attempt.agentId, ok: response.ok && security?.passed === true, result, security };
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
        const stored = await env.STATE.get(`attempt:${body.attemptId}`, "json") as { missionId: string; canonicalRepositoryName: string; repositoryName: string } | null;
        const demo = body.missionId === "competition-demo" ? {
          missionId: "competition-demo",
          canonicalRepositoryName: "nextgit-source",
          repositoryName: body.attemptId === "competition-demo-alpha" ? "attempt-competition-demo-alpha" : body.attemptId === "competition-demo-beta" ? "attempt-competition-demo-beta" : "",
        } : null;
        const attempt = stored ?? demo;
        if (!attempt || !attempt.repositoryName || attempt.missionId !== body.missionId) return reply({ error: "Attempt does not belong to this Mission or cannot be resolved." }, 404);

        if (body.decision === "accept") {
          const scan = await env.EXECUTOR.fetch("https://executor/security-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryName: attempt.repositoryName }) });
          const security = await scan.json() as any;
          if (!scan.ok || security?.passed !== true) return reply({ error: "Attempt blocked by Security Agent.", security }, 409);
        }

        const decision = new DecisionService().decide({ missionId: body.missionId, attemptId: body.attemptId, decision: body.decision, feedback: body.feedback });
        await env.STATE.put(`decision:${body.missionId}:${body.attemptId}`, JSON.stringify(decision));

        if (body.decision === "accept") {
          const promote = await env.EXECUTOR.fetch("https://executor/promote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceRepository: attempt.repositoryName, targetRepository: attempt.canonicalRepositoryName, decisionId: decision.id }) });
          const promotion = await promote.json();
          if (promote.ok) await env.STATE.put(`mission-decision:${body.missionId}`, JSON.stringify({ acceptedAttemptId: body.attemptId, decidedAt: decision.decidedAt }));
          return reply({ ok: promote.ok, decision, promotion }, promote.ok ? 201 : 502);
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
