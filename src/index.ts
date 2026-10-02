import { ArtifactsRepositoryService } from "./infrastructure/artifacts";
import { createMission, createProject, type Env } from "./api";
import { DecisionService, type DecisionKind } from "./application/decision-service";
import { MissionPlanner } from "./application/mission-planner";

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
<body><main><div class="eyebrow">NEXTGIT</div><h1 class="hero">Build your idea.<br>We’ll handle the code.</h1><p class="sub">Tell NextGit what you want to build or change. We plan the work, build the pieces in parallel, check them for safety, and show you the result in plain English.</p>
<section class="panel"><h2>What are you working on?</h2><div class="row"><div><label>How would you like to start?</label><select id="source" onchange="sourceChanged()"><option value="blank">Start something new</option><option value="upload">Upload my project</option><option value="import">Bring in an existing project</option></select></div><div id="branchWrap" style="display:none"><label>Version to bring in <span class="muted">(optional)</span></label><input id="branch" placeholder="Usually leave this blank"></div></div><div id="uploadWrap" style="display:none"><label>Choose your project folder</label><input id="projectFiles" type="file" multiple webkitdirectory directory><div class="muted">Choose the folder that contains your project. NextGit keeps the folder structure and version history for you.</div><div style="margin-top:8px"><label style="display:inline"><input id="useFilesInstead" type="checkbox" onchange="uploadModeChanged()" style="width:auto"> I want to choose individual files instead</label></div></div><div id="importWrap" style="display:none"><label>Paste the link to your project</label><input id="sourceUrl" placeholder="https://github.com/your-name/your-project"><div class="muted">Works with public Git project links. NextGit makes its own working copy so future changes can happen here.</div></div><div class="row"><div><label>Project name</label><input id="project" value="My NextGit Project"></div><div><label>Project type</label><select id="projectType"><option>App or website</option><option>Automation or tool</option><option>Other software project</option></select></div></div><label>What would you like to build or change?</label><textarea id="objective" placeholder="Describe it in your own words. For example: Add subscriptions with a free plan and a $10/month Pro plan."></textarea><button onclick="launch()">Start building</button><div class="status" id="status"></div><div id="clarify" style="display:none;margin-top:14px"><label>Tell us a little more</label><textarea id="clarification" placeholder="Add anything that would help NextGit understand what you want."></textarea><button onclick="continueWithClarification()">Continue building</button></div></section>
<p class="muted">Already have the competition demo? <a href="/demo" style="color:#aeb9ff">Open Mission Review</a></p>
<script>
function sourceChanged(){
 const mode=document.getElementById('source').value;
 const imported=mode==='import';
 document.getElementById('importWrap').style.display=imported?'block':'none';
 document.getElementById('branchWrap').style.display=imported?'block':'none';
 document.getElementById('uploadWrap').style.display=mode==='upload'?'block':'none';
}
function uploadModeChanged(){
 const input=document.getElementById('projectFiles');
 const individual=document.getElementById('useFilesInstead').checked;
 if(individual){input.removeAttribute('webkitdirectory');input.removeAttribute('directory')}else{input.setAttribute('webkitdirectory','');input.setAttribute('directory','')}
 input.value='';
}
async function continueWithClarification(){
 const pending=window.nextgitPending;if(!pending)return;
 const extra=document.getElementById('clarification').value.trim();if(!extra)return;
 document.getElementById('clarify').style.display='none';
 const objective=pending.original+"\nAdditional detail from the user: "+extra;
 document.getElementById('objective').value=objective;
 document.getElementById('status').textContent='Thanks. Updating the plan…';
 window.nextgitPending=null;
 await launch();
}
async function launch(){const s=document.getElementById('status');s.textContent='Creating project…';try{const p=await fetch('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.getElementById('project').value,sourceUrl:document.getElementById('source').value==='import'?document.getElementById('sourceUrl').value:undefined,branch:document.getElementById('source').value==='import'?(document.getElementById('branch').value||undefined):undefined})}).then(r=>r.json());if(!p.id)throw new Error(p.error||'Project creation failed');if(document.getElementById('source').value==='upload'){const files=Array.from(document.getElementById('projectFiles').files||[]);if(!files.length)throw new Error('Choose at least one project file');s.textContent='Adding your project files…';for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const up=await fetch('/api/repositories/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repositoryName:p.canonicalRepositoryId,path:(file.webkitRelativePath||file.name),contentBase64:btoa(binary),message:'Add '+(file.webkitRelativePath||file.name)})});if(!up.ok){const e=await up.json();throw new Error(e.error||'Could not add '+file.name)}}}s.textContent='Understanding your project…';const analysis=await fetch('/api/projects/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repositoryName:p.canonicalRepositoryId})}).then(r=>r.json());if(analysis.ok)s.textContent='We found a '+analysis.projectType+' with '+analysis.fileCount+' files. Making a plan…';const ids=['agent-a','agent-b','agent-c','agent-d'];const m=await fetch('/api/missions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:p.id,canonicalRepositoryName:p.canonicalRepositoryId,title:'Implementation Mission',objective:document.getElementById('objective').value,agentIds:ids})}).then(r=>r.json());if(!m.id||!m.attempts)throw new Error(m.error||'Mission creation failed');s.textContent='Making a plan…';const plan=await fetch('/api/missions/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:m.id,objective:document.getElementById('objective').value,agentIds:ids})}).then(r=>r.json());if(plan.requiresClarification){s.textContent=plan.message;document.getElementById('clarify').style.display='block';window.nextgitPending={project:p,mission:m,ids,original:document.getElementById('objective').value};return}s.textContent='Building the different parts…';const attempts=m.attempts.map((a,i)=>({id:a.id,agentId:a.agentId,repositoryName:a.repository.name,task:plan.plan?.tasks?.[i]}));const x=await fetch('/api/missions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:m.id,objective:document.getElementById('objective').value,attempts:attempts.map(a=>({...a,objective:a.task?.objective||document.getElementById('objective').value}))})}).then(r=>r.json());if(!x.results)throw new Error(x.error||'Execution failed');sessionStorage.setItem('nextgit:lastMission',JSON.stringify({project:p,mission:m,execution:x}));s.textContent=x.ok?'Your update is ready. Opening review…':'We finished, but one part needs attention. Opening review…';setTimeout(()=>location.href='/mission-review',500)}catch(e){s.textContent='Error: '+e.message}}
</script></body></html>`;
      return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
    }

    if (request.method === "POST" && url.pathname === "/api/projects/analyze") {
      const body = await request.json() as { repositoryName?: string };
      if (!body.repositoryName) return reply({ error: "repositoryName is required" }, 400);
      const response = await env.EXECUTOR.fetch("https://executor/analyze-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
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
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextGit — Your update</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#f5f7fa;margin:0}main{max-width:900px;margin:auto;padding:42px 20px}.brand{color:#8b9cff;font-weight:800}.sub{color:#a8b0bd}.panel{background:#151922;border:1px solid #293041;border-radius:18px;padding:24px;margin-top:24px}.checks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.check{background:#0d1117;border-radius:11px;padding:14px}.pass{color:#8df0a6}.fail{color:#ff8f8f}.actions{display:flex;gap:9px;flex-wrap:wrap}.btn{border:0;border-radius:9px;padding:11px 14px;font-weight:800;cursor:pointer}.primary{background:#fff}.secondary{background:#252b36;color:#fff}.details{display:none;white-space:pre-wrap;background:#0d1117;padding:14px;border-radius:10px;margin-top:14px;max-height:380px;overflow:auto;font:12px ui-monospace,monospace;color:#c9d1d9}.status{color:#a8b0bd;margin-top:12px;font-size:13px}details{margin-top:22px;color:#a8b0bd}a{color:#aeb9ff}@media(max-width:650px){.checks{grid-template-columns:1fr}}</style></head>
<body><main><div class="brand">NEXTGIT</div><h1>Your update is ready</h1><p class="sub" id="asked"></p><section class="panel" id="update"></section><p><a href="/">← Back to projects</a></p></main>
<script>
const d=JSON.parse(sessionStorage.getItem('nextgit:lastMission')||'null');const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
if(!d){document.getElementById('asked').textContent='No recent update found in this browser.'}else{document.getElementById('asked').textContent='You asked: '+d.mission.objective;const x=d.execution.integration||{};const safe=x.finalSecurity?.passed===true;const tested=x.tests?.passed===true;const integrated=x.integrated===true;const ready=x.ready===true;document.getElementById('update').innerHTML='<h2>'+(ready?'Everything is ready':'Your update needs attention')+'</h2><p class="sub">'+(ready?'NextGit built the different parts, combined them, and checked the finished update.':'NextGit finished the work, but one of the final checks needs attention before this update should be used.')+'</p><div class="checks"><div class="check '+(integrated?'pass':'fail')+'">'+(integrated?'✓':'✕')+' Parts work together</div><div class="check '+(safe?'pass':'fail')+'">'+(safe?'✓':'✕')+' Safety check</div><div class="check '+(tested?'pass':'fail')+'">'+(tested?'✓':'✕')+' Project checks</div></div><div class="actions"><button class="btn secondary" onclick="changes()">See what changed</button><button class="btn secondary" onclick="revision()">Ask for changes</button><button class="btn primary" '+(ready?'':'disabled')+' onclick="useUpdate()">Use this update</button></div><div class="details" id="changes"></div><div class="status" id="status"></div><details><summary>Developer details</summary><pre>'+esc(JSON.stringify({runId:d.execution.runId,integration:x,workstreams:d.execution.results},null,2))+'</pre></details>'}
async function changes(){const e=document.getElementById('changes');e.style.display='block';e.textContent='Loading changes…';const r=await fetch('/api/attempts/diff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repositoryName:d.execution.integration.repository})});const j=await r.json();e.textContent=r.ok?(j.stdout||'No changes found'):'Could not load changes'}
function revision(){const f=prompt('What would you like changed?');if(f)document.getElementById('status').textContent='Revision request noted: '+f}
async function useUpdate(){const e=document.getElementById('status');e.textContent='Running final checks…';const r=await fetch('/api/missions/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:d.mission.id})});const j=await r.json();e.textContent=r.ok?'✓ Your project has been updated.':'Could not apply update: '+(j.error||'Final checks failed')}
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

    if (request.method === "POST" && url.pathname === "/api/missions/plan") {
      const body = await request.json() as { missionId?: string; objective?: string; agentIds?: string[]; projectType?: string };
      if (!body.missionId || !body.objective) return reply({ error: "missionId and objective are required" }, 400);
      const response = await env.EXECUTOR.fetch("https://executor/plan-mission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: body.objective, projectType: body.projectType, maxWorkstreams: Math.min(body.agentIds?.length || 4, 4) }),
      });
      const planned = await response.json() as any;
      if (!response.ok || !planned?.plan?.tasks?.length) {
        const fallback = new MissionPlanner().plan({ missionId: body.missionId, objective: body.objective, agentIds: body.agentIds?.length ? body.agentIds : ["agent-a", "agent-b"] });
        await env.STATE.put(`plan:${body.missionId}`, JSON.stringify(fallback));
        return reply({ ok: true, plan: fallback, planner: "fallback" }, 201);
      }
      const agents = body.agentIds?.length ? body.agentIds : ["agent-a", "agent-b", "agent-c", "agent-d"];
      let tasks = planned.plan.tasks.slice(0, agents.length).map((task: any, i: number) => ({
        id: crypto.randomUUID(),
        title: String(task.title || `Part ${i + 1}`),
        objective: String(task.objective || body.objective),
        agentId: agents[i],
        mode: task.mode === "sequence" ? "sequence" : "parallel",
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
      }));

      const clef = await env.AI.run("@cf/cloudflare/clef-flash", {
        model: "clef-flash",
        state: JSON.stringify({
          userRequest: body.objective,
          projectType: body.projectType || "unknown software project",
          proposedWorkstreams: tasks.map((task: any, index: number) => ({ index, title: task.title, objective: task.objective })),
        }),
        questions: {
          execution: {
            type: "choice",
            instructions: "Choose how these workstreams should be coordinated. Pick parallel only when they can proceed independently, sequential when later work depends on earlier work, mixed when both patterns are present, or clarify when the user's intent is too ambiguous to safely proceed.",
            criteria: {
              parallel: "Workstreams are independent and can run concurrently.",
              sequential: "Workstreams should run in dependency order.",
              mixed: "Some can run in parallel while others depend on prior work.",
              clarify: "The request is ambiguous enough that NextGit should be conservative."
            }
          },
          humanReview: {
            type: "noul",
            instructions: "Does this request involve unusually sensitive or high-impact changes that should receive extra human attention before application?"
          },
          risk: {
            type: "score",
            instructions: "Rate the implementation risk of this requested change.",
            criteria: ["Low", "Moderate", "High", "Critical"]
          }
        }
      }) as any;

      const executionChoice = clef?.answers?.execution?.choice || "mixed";
      const needsClarification = executionChoice === "clarify";
      if (executionChoice === "parallel") {
        tasks = tasks.map((task: any) => ({ ...task, mode: "parallel", dependsOn: [] }));
      } else if (executionChoice === "sequential" || executionChoice === "clarify") {
        tasks = tasks.map((task: any, i: number) => ({ ...task, mode: "sequence", dependsOn: i === 0 ? [] : [i - 1] }));
      }
      const decision = {
        model: "clef-flash",
        execution: executionChoice,
        needsClarification,
        extraHumanReview: Number(clef?.answers?.humanReview?.noul || 0) >= 0.5,
        riskScore: clef?.answers?.risk?.score,
        confidence: clef?.answers?.execution?.confidence
      };
      const plan = { missionId: body.missionId, summary: String(planned.plan.summary || "NextGit created a work plan."), tasks, decision };
      await env.STATE.put(`plan:${body.missionId}`, JSON.stringify(plan));
      if (decision.needsClarification) {
        return reply({
          ok: true,
          plan,
          planner: "ai",
          requiresClarification: true,
          message: "Before we start, NextGit needs a little more detail so we don't make the wrong change."
        }, 200);
      }
      return reply({ ok: true, plan, planner: "ai" }, 201);
    }

    if (request.method === "POST" && url.pathname === "/api/missions/execute") {
      const body = (await request.json()) as {
        missionId?: string;
        objective?: string;
        attempts?: Array<{
          id: string;
          agentId: string;
          repositoryName: string;
          objective?: string;
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
                objective: attempt.objective || body.objective,
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

      const mission = await env.STATE.get(`mission:${body.missionId}`, "json") as any;
      let integration: any = null;
      const safe = results.filter((result: any) => result.ok && result.security?.passed === true);
      if (mission?.canonicalRepositoryName && safe.length) {
        const repositories = new ArtifactsRepositoryService(env.ARTIFACTS);
        const integrationRepo = await repositories.createIntegration(mission.canonicalRepositoryName, body.missionId);
        integration = await env.EXECUTOR.fetch("https://executor/integrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            canonicalRepository: mission.canonicalRepositoryName,
            attemptRepositories: safe.map((result: any) => result.result.repository),
            integrationRepository: integrationRepo.name,
          }),
        }).then(async (response) => ({ httpOk: response.ok, ...(await response.json() as any) }));
        let finalSecurity: any = null;
        let tests: any = null;
        if (integration?.integrated === true) {
          finalSecurity = await env.EXECUTOR.fetch("https://executor/security-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryName: integrationRepo.name }) }).then(r => r.json());
          tests = await env.EXECUTOR.fetch("https://executor/test-project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryName: integrationRepo.name }) }).then(r => r.json());
        }
        integration = { ...integration, finalSecurity, tests, ready: integration?.integrated === true && finalSecurity?.passed === true && tests?.passed === true };
        await env.STATE.put(`integration:${body.missionId}`, JSON.stringify({ repositoryName: integrationRepo.name, ...integration }));
      }

      return reply({
        ok: results.every((result) => result.ok) && integration?.ready === true,
        missionId: body.missionId,
        runId,
        results,
        integration,
      }, results.every((result) => result.ok) && integration?.integrated === true ? 200 : 207);
    }

    if (request.method === "POST" && url.pathname === "/api/missions/apply") {
      const body = await request.json() as { missionId?: string };
      if (!body.missionId) return reply({ error: "missionId is required" }, 400);
      const mission = await env.STATE.get(`mission:${body.missionId}`, "json") as any;
      const integration = await env.STATE.get(`integration:${body.missionId}`, "json") as any;
      if (!mission || !integration?.repositoryName) return reply({ error: "Mission or integrated update could not be found." }, 404);

      const freshSecurityResponse = await env.EXECUTOR.fetch("https://executor/security-scan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryName: integration.repositoryName }),
      });
      const freshSecurity = await freshSecurityResponse.json() as any;
      const freshTestsResponse = await env.EXECUTOR.fetch("https://executor/test-project", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryName: integration.repositoryName }),
      });
      const freshTests = await freshTestsResponse.json() as any;
      if (!freshSecurityResponse.ok || freshSecurity?.passed !== true || !freshTestsResponse.ok || freshTests?.passed !== true) {
        return reply({ error: "The update no longer passes final checks.", safety: freshSecurity, projectChecks: freshTests }, 409);
      }

      const decisionId = crypto.randomUUID();
      const promote = await env.EXECUTOR.fetch("https://executor/promote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceRepository: integration.repositoryName, targetRepository: mission.canonicalRepositoryName, decisionId }),
      });
      const promotion = await promote.json() as any;
      if (!promote.ok) return reply({ error: "The verified update could not be applied.", promotion }, 409);
      const applied = { missionId: body.missionId, integrationRepository: integration.repositoryName, canonicalRepository: mission.canonicalRepositoryName, decisionId, appliedAt: new Date().toISOString() };
      await env.STATE.put(`applied:${body.missionId}`, JSON.stringify(applied));
      return reply({ ok: true, applied, promotion }, 201);
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
