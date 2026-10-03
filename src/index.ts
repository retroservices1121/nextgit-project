import { ArtifactsRepositoryService } from "./infrastructure/artifacts";
import { createMission, createProject, type Env } from "./api";
import { DecisionService, type DecisionKind } from "./application/decision-service";
import { MissionPlanner } from "./application/mission-planner";
import { projectPage } from "./ui/project-page";
import { currentUser, requireProjectAccess, sessionCookie } from "./application/auth";

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
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = (await request.json()) as { name?: string; sourceUrl?: string; branch?: string };
      if (!body.name) return reply({ error: "name is required" }, 400);
      if (body.sourceUrl && !/^https:\/\//i.test(body.sourceUrl)) return reply({ error: "Project link must use HTTPS" }, 400);
      const project = await createProject(env, body.name, body.sourceUrl, body.branch);
      await env.DB.prepare("INSERT INTO projects(id,owner_user_id,name,repository_name,visibility) VALUES(?,?,?,?,?)").bind(project.id,user.id,body.name,project.canonicalRepositoryId,"private").run();
      return reply(project, 201);
    }

    if (request.method === "POST" && url.pathname === "/api/missions") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = (await request.json()) as {
        projectId: string;
        title: string;
        objective: string;
        agentIds?: string[];
      };
      if (!body.projectId || !body.objective) return reply({ error: "projectId and objective are required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, body.projectId);
      if (!project || !["owner","editor"].includes(project.role)) return reply({ error: "Project not found or build access denied" }, 403);
      const mission = await createMission(env, {
        projectId: body.projectId,
        canonicalRepositoryName: project.repository_name,
        title: body.title || "Project update",
        objective: body.objective,
        agentIds: body.agentIds?.length ? body.agentIds : ["agent-a", "agent-b"],
      });
      await env.STATE.put(`mission:${mission.id}`, JSON.stringify(mission));
      await env.DB.prepare("INSERT INTO missions(id,project_id,title,objective,status,created_by_user_id) VALUES(?,?,?,?,?,?)")
        .bind(mission.id,body.projectId,body.title||"Project update",body.objective,"planning",user.id).run();
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

    if (request.method === "GET" && url.pathname === "/login") {
      const user = await currentUser(request, env.DB);
      if (user) return Response.redirect(new URL("/projects", request.url).toString(), 302);
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — NextGit</title><style>body{font-family:system-ui;background:#0b0d10;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(420px,90vw);background:#151922;border:1px solid #293041;border-radius:18px;padding:26px}input,button{width:100%;box-sizing:border-box;padding:12px;border-radius:9px;margin-top:10px}input{background:#0d1117;color:#fff;border:1px solid #303848}button{border:0;font-weight:800}.muted{color:#9ca3af}</style></head><body><form class="box" method="post" action="/login"><div style="color:#8b9cff;font-weight:800">NEXTGIT</div><h1>Welcome</h1><p class="muted">Sign in to keep your projects and code connected to you.</p><input name="name" placeholder="Your name"><input name="email" type="email" required placeholder="you@example.com"><button>Continue</button><p class="muted">Competition prototype: email sign-in creates your NextGit account. OAuth providers can be added after the prototype.</p></form></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (request.method === "POST" && url.pathname === "/login") {
      const form = await request.formData();
      const email = String(form.get("email") || "").trim().toLowerCase();
      const name = String(form.get("name") || "").trim();
      if (!email || !email.includes("@")) return reply({ error: "A valid email is required" }, 400);
      let user = await env.DB.prepare("SELECT id,email,name FROM users WHERE email=?").bind(email).first<any>();
      if (!user) {
        user = { id: crypto.randomUUID(), email, name: name || null };
        await env.DB.prepare("INSERT INTO users(id,email,name) VALUES(?,?,?)").bind(user.id,email,user.name).run();
      }
      const token = crypto.randomUUID()+crypto.randomUUID();
      await env.DB.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,datetime('now','+7 days'))").bind(token,user.id).run();
      return new Response(null,{status:302,headers:{location:"/projects","set-cookie":sessionCookie(token)}});
    }

    if (request.method === "POST" && url.pathname === "/logout") {
      const cookie=request.headers.get("cookie")||"";const token=cookie.match(/(?:^|; )nextgit_session=([^;]+)/)?.[1];if(token)await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
      return new Response(null,{status:302,headers:{location:"/login","set-cookie":"nextgit_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}});
    }

    if (request.method === "GET" && url.pathname === "/projects") {
      const user = await currentUser(request, env.DB);
      if (!user) return Response.redirect(new URL("/login", request.url).toString(), 302);
      const rows = await env.DB.prepare("SELECT DISTINCT p.id,p.name,p.repository_name,p.visibility,(SELECT COUNT(*) FROM missions m WHERE m.project_id=p.id) AS mission_count,(SELECT MAX(m.created_at) FROM missions m WHERE m.project_id=p.id) AS last_activity FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_user_id=? OR pm.user_id=? ORDER BY COALESCE(last_activity,p.created_at) DESC").bind(user.id,user.id).all<any>();
      const cards=(rows.results||[]).map((p:any)=>`<a href="/project?id=${encodeURIComponent(p.id)}" style="display:block;background:#151922;border:1px solid #293041;border-radius:14px;padding:18px;color:#fff;text-decoration:none;margin:10px 0"><strong>${p.name}</strong><div style="color:#9ca3af;margin-top:5px">${p.visibility==='public'?'Public':'Private'} project · ${p.mission_count||0} update${Number(p.mission_count||0)===1?'':'s'}</div></a>`).join("");
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your projects — NextGit</title></head><body style="font-family:system-ui;background:#0b0d10;color:#fff;margin:0"><main style="max-width:800px;margin:auto;padding:38px 20px"><div style="color:#8b9cff;font-weight:800">NEXTGIT</div><h1>Your projects</h1><p style="color:#9ca3af">Welcome, ${user.name||user.email}.</p><p><a href="/" style="color:#111;background:#fff;padding:10px 14px;border-radius:9px;text-decoration:none;font-weight:800">+ New project</a></p>${cards||'<p style="color:#9ca3af">You do not have any projects yet.</p>'}<form method="post" action="/logout"><button style="margin-top:25px">Sign out</button></form></main></body></html>`,{headers:{"content-type":"text/html; charset=utf-8"}});
    }

    if (request.method === "GET" && url.pathname === "/api/project/info") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const stats = await env.DB.prepare("SELECT COUNT(*) AS updates, SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) AS applied FROM missions WHERE project_id=?").bind(projectId).first<any>();
      return reply({ ok: true, project: { id: project.id, name: project.name, visibility: project.visibility, role: project.role }, stats: stats || { updates: 0, applied: 0 } });
    }

    if (request.method === "POST" && url.pathname === "/api/project/token") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = await request.json() as { projectId?: string };
      if (!body.projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, body.projectId);
      if (!project || !["owner","editor"].includes(project.role)) return reply({ error: "Project not found or developer access denied" }, 403);
      const repo = await env.ARTIFACTS.get(project.repository_name);
      const info = await repo.info();
      if (!info.remote) return reply({ error: "Git remote is unavailable" }, 503);
      const token = await repo.createToken("write", 3600);
      if (!token.plaintext) return reply({ error: "Git credential could not be created" }, 503);
      await env.STATE.put(`git-token:${token.id || crypto.randomUUID()}`, JSON.stringify({ projectId: body.projectId, userId: user.id, createdAt: new Date().toISOString(), expiresInSeconds: 3600 }), { expirationTtl: 3700 });
      return reply({
        ok: true,
        remote: info.remote,
        token: token.plaintext,
        expiresInSeconds: 3600,
        warning: "This temporary credential grants Git access to this Project. Treat it like a password."
      }, 201);
    }

    if (request.method === "GET" && url.pathname === "/api/project/developer") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const repo = await env.ARTIFACTS.get(project.repository_name);
      const info = await repo.info();
      const history = await repo.log({ ref: "main", limit: 10 });
      return reply({
        ok: true,
        repository: { remoteConfigured: Boolean(info.remote) },
        history: history.map((entry: any) => ({ hash: entry.hash, message: entry.message, author: entry.author, timestamp: entry.timestamp }))
      });
    }

    if (request.method === "GET" && url.pathname === "/api/project/updates") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const rows = await env.DB.prepare("SELECT id,title,objective,status,created_at FROM missions WHERE project_id=? ORDER BY created_at DESC LIMIT 50").bind(projectId).all<any>();
      return reply({ ok: true, updates: rows.results || [] });
    }

    if (request.method === "GET" && url.pathname === "/api/project/files") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const repositoryName = project.repository_name;
      const treeHash = url.searchParams.get("tree");
      
      const repo = await env.ARTIFACTS.get(repositoryName);
      const history = await repo.log({ ref: "main", limit: 1 });
      const latest = history[0];
      if (!latest) return reply({ ok: true, repositoryName, files: [], history: [] });
      const commit = await repo.readCommit(latest.hash);
      const targetTree = treeHash || commit?.treeHash;
      const files = targetTree ? await repo.readTree(targetTree) : [];
      return reply({ ok: true, repositoryName, latest, treeHash: targetTree, files: files || [] });
    }

    if (request.method === "GET" && url.pathname === "/api/project/file") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const repositoryName = project.repository_name;
      const path = url.searchParams.get("path");
      if (!repositoryName || !path) return reply({ error: "repository and path are required" }, 400);
      const repo = await env.ARTIFACTS.get(repositoryName);
      const file = await repo.readFile({ ref: "main", path });
      if (!file) return reply({ error: "File not found" }, 404);
      if (file.size > 1024 * 1024) return reply({ error: "File is too large to preview here." }, 413);
      const type = file.type || "application/octet-stream";
      const textLike = type.startsWith("text/") || /\.(md|json|js|jsx|ts|tsx|css|html|yml|yaml|toml|py|go|rs|java|c|cpp|h|sh|env|txt)$/i.test(path);
      if (!textLike) return reply({ ok: true, path, type, binary: true, size: file.size });
      return reply({ ok: true, path, type, binary: false, size: file.size, content: await file.text() });
    }

    if (request.method === "POST" && url.pathname === "/api/project/explain-file") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = await request.json() as { projectId?: string; path?: string };
      if (!body.projectId || !body.path) return reply({ error: "projectId and path are required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, body.projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const repo = await env.ARTIFACTS.get(project.repository_name);
      const file = await repo.readFile({ ref: "main", path: body.path });
      if (!file) return reply({ error: "File not found" }, 404);
      if (file.size > 200000) return reply({ error: "This file is too large to explain automatically." }, 413);
      const content = await file.text();
      const response = await env.EXECUTOR.fetch("https://executor/plan-mission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: `Explain this project file to a non-technical software builder. File: ${body.path}. Explain what it does, why the project needs it, what it connects to if evident, and what could be affected by changing it. Do not propose code changes. File contents:\n${content.slice(0, 50000)}`,
          projectType: "file explanation",
          maxWorkstreams: 1,
        }),
      });
      const explained = await response.json() as any;
      const task = explained?.plan?.tasks?.[0];
      return reply({ ok: response.ok, path: body.path, explanation: task?.objective || explained?.plan?.summary || "NextGit could not explain this file yet." }, response.ok ? 200 : 502);
    }

    if (request.method === "GET" && url.pathname === "/api/project/history") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const repositoryName = project.repository_name;
      
      const repo = await env.ARTIFACTS.get(repositoryName);
      return reply({ ok: true, history: await repo.log({ ref: "main", limit: 50 }) });
    }

    if (request.method === "GET" && url.pathname === "/project") {
      const user = await currentUser(request, env.DB);
      if (!user) return Response.redirect(new URL("/login", request.url).toString(), 302);
      const projectId = url.searchParams.get("id");
      if (!projectId) return Response.redirect(new URL("/projects", request.url).toString(), 302);
      const project = await requireProjectAccess(env.DB, user.id, projectId);
      if (!project) return new Response("Project not found or you do not have access.", { status: 404 });
      return new Response(projectPage(), { headers: { "content-type": "text/html; charset=utf-8", "x-nextgit-project-id": projectId } });
    }

    if (request.method === "GET" && url.pathname === "/") {
      const signedIn = await currentUser(request, env.DB);
      if (!signedIn) return Response.redirect(new URL("/login", request.url).toString(), 302);
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
 const s=document.getElementById('status');document.getElementById('clarify').style.display='none';
 const objective=pending.original+"
Additional detail from the user: "+extra;
 document.getElementById('objective').value=objective;s.textContent='Thanks. Updating the plan…';
 const plan=await fetch('/api/missions/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:pending.mission.id,objective,agentIds:pending.ids})}).then(r=>r.json());
 if(plan.requiresClarification){s.textContent=plan.message;document.getElementById('clarify').style.display='block';pending.original=objective;return}
 s.textContent='Building the different parts…';
 const attempts=pending.mission.attempts.map((a,i)=>({id:a.id,agentId:a.agentId,repositoryName:a.repository.name,task:plan.plan?.tasks?.[i]}));
 const x=await fetch('/api/missions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:pending.mission.id,objective,attempts:attempts.map(a=>({...a,objective:a.task?.objective||objective}))})}).then(r=>r.json());
 if(!x.results){s.textContent='We could not continue building. Please try again.';return}
 sessionStorage.setItem('nextgit:lastMission',JSON.stringify({project:pending.project,mission:pending.mission,execution:x}));window.nextgitPending=null;s.textContent=x.ok?'Your update is ready. Opening review…':'We finished, but one part needs attention. Opening review…';setTimeout(()=>location.href='/mission-review',500)
}
async function launch(){const s=document.getElementById('status');s.textContent='Creating project…';try{const p=await fetch('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.getElementById('project').value,sourceUrl:document.getElementById('source').value==='import'?document.getElementById('sourceUrl').value:undefined,branch:document.getElementById('source').value==='import'?(document.getElementById('branch').value||undefined):undefined})}).then(r=>r.json());if(!p.id)throw new Error(p.error||'Project creation failed');if(document.getElementById('source').value==='upload'){const files=Array.from(document.getElementById('projectFiles').files||[]);if(!files.length)throw new Error('Choose at least one project file');s.textContent='Adding your project files…';for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const up=await fetch('/api/repositories/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:p.id,path:(file.webkitRelativePath||file.name),contentBase64:btoa(binary),message:'Add '+(file.webkitRelativePath||file.name)})});if(!up.ok){const e=await up.json();throw new Error(e.error||'Could not add '+file.name)}}}s.textContent='Understanding your project…';const analysis=await fetch('/api/projects/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:p.id})}).then(r=>r.json());if(analysis.ok)s.textContent='We found a '+analysis.projectType+' with '+analysis.fileCount+' files. Making a plan…';const ids=['agent-a','agent-b','agent-c','agent-d'];const m=await fetch('/api/missions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:p.id,title:'Implementation Mission',objective:document.getElementById('objective').value,agentIds:ids})}).then(r=>r.json());if(!m.id||!m.attempts)throw new Error(m.error||'Mission creation failed');s.textContent='Making a plan…';const plan=await fetch('/api/missions/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:m.id,objective:document.getElementById('objective').value,agentIds:ids})}).then(r=>r.json());if(plan.requiresClarification){s.textContent=plan.message;document.getElementById('clarify').style.display='block';window.nextgitPending={project:p,mission:m,ids,original:document.getElementById('objective').value};return}s.textContent='Building the different parts…';const attempts=m.attempts.map((a,i)=>({id:a.id,agentId:a.agentId,repositoryName:a.repository.name,task:plan.plan?.tasks?.[i]}));const x=await fetch('/api/missions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:m.id,objective:document.getElementById('objective').value,attempts:attempts.map(a=>({...a,objective:a.task?.objective||document.getElementById('objective').value}))})}).then(r=>r.json());if(!x.results)throw new Error(x.error||'Execution failed');s.textContent=x.ok?'Your update is ready. Opening review…':'We finished, but one part needs attention. Opening review…';setTimeout(()=>location.href='/mission-review?missionId='+encodeURIComponent(m.id),500)}catch(e){s.textContent='Error: '+e.message}}
loadReview();
</script></body></html>`;
      return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
    }

    if (request.method === "POST" && url.pathname === "/api/projects/analyze") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = await request.json() as { projectId?: string };
      if (!body.projectId) return reply({ error: "projectId is required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, body.projectId);
      if (!project) return reply({ error: "Project not found or access denied" }, 404);
      const response = await env.EXECUTOR.fetch("https://executor/analyze-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryName: project.repository_name }),
      });
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
    }

    if (request.method === "POST" && url.pathname === "/api/repositories/upload") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = await request.json() as { projectId?: string; path?: string; contentBase64?: string; message?: string };
      if (!body.projectId || !body.path || body.contentBase64 === undefined) return reply({ error: "projectId, path, and contentBase64 are required" }, 400);
      const project = await requireProjectAccess(env.DB, user.id, body.projectId);
      if (!project || !["owner","editor"].includes(project.role)) return reply({ error: "Project not found or write access denied" }, 403);
      const response = await env.EXECUTOR.fetch("https://executor/upload-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryName: project.repository_name, path: body.path, contentBase64: body.contentBase64, message: body.message }),
      });
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
    }

    if (request.method === "POST" && url.pathname === "/api/attempts/diff") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = (await request.json()) as { missionId?: string };
      if (!body.missionId) return reply({ error: "missionId is required" }, 400);
      const row = await env.DB.prepare("SELECT m.id FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR pm.user_id=?)").bind(user.id,body.missionId,user.id,user.id).first<any>();
      if (!row) return reply({ error: "Mission not found or access denied" }, 404);
      const integration = await env.STATE.get(`integration:${body.missionId}`, "json") as any;
      if (!integration?.repositoryName) return reply({ error: "Integrated update not found" }, 404);
      const response = await env.EXECUTOR.fetch("https://executor/diff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryName: integration.repositoryName }),
      });
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
    }

    if (request.method === "POST" && url.pathname === "/api/missions/explain-changes") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = await request.json() as { missionId?: string };
      if (!body.missionId) return reply({ error: "missionId is required" }, 400);
      const row = await env.DB.prepare("SELECT m.id FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR pm.user_id=?)").bind(user.id,body.missionId,user.id,user.id).first<any>();
      if (!row) return reply({ error: "Mission not found or access denied" }, 404);
      const integration = await env.STATE.get(`integration:${body.missionId}`, "json") as any;
      if (!integration?.repositoryName) return reply({ error: "Integrated update not found" }, 404);
      const diffResponse = await env.EXECUTOR.fetch("https://executor/diff",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repositoryName:integration.repositoryName})});
      const diff = await diffResponse.json() as any;
      const raw = String(diff.stdout || "").slice(0,40000);
      const explained = await env.EXECUTOR.fetch("https://executor/plan-mission",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({objective:`Explain these software changes to a non-technical project owner. Summarize what changed, what the user will notice, and any important behavior affected. Do not discuss Git mechanics unless necessary. Diff:\n${raw}`,projectType:"change explanation",maxWorkstreams:1})});
      const data = await explained.json() as any;
      return reply({ ok: explained.ok, explanation: data?.plan?.tasks?.[0]?.objective || data?.plan?.summary || "NextGit could not explain these changes.", rawDiff: raw });
    }

    if (request.method === "GET" && url.pathname === "/api/missions/review") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const missionId = url.searchParams.get("missionId");
      if (!missionId) return reply({ error: "missionId is required" }, 400);
      const row = await env.DB.prepare("SELECT m.id,m.project_id,m.title,m.objective,m.status,p.name AS project_name,p.repository_name FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR pm.user_id=?)").bind(user.id,missionId,user.id,user.id).first<any>();
      if (!row) return reply({ error: "Mission not found or access denied" }, 404);
      const integration = await env.STATE.get(`integration:${missionId}`, "json") as any;
      const orchestration = await env.STATE.get(`orchestration:${missionId}`, "json") as any;
      return reply({ ok: true, mission: row, integration, orchestration });
    }

    if (request.method === "GET" && url.pathname === "/mission-review") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextGit — Your update</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#f5f7fa;margin:0}main{max-width:900px;margin:auto;padding:42px 20px}.brand{color:#8b9cff;font-weight:800}.sub{color:#a8b0bd}.panel{background:#151922;border:1px solid #293041;border-radius:18px;padding:24px;margin-top:24px}.checks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.check{background:#0d1117;border-radius:11px;padding:14px}.pass{color:#8df0a6}.fail{color:#ff8f8f}.actions{display:flex;gap:9px;flex-wrap:wrap}.btn{border:0;border-radius:9px;padding:11px 14px;font-weight:800;cursor:pointer}.primary{background:#fff}.secondary{background:#252b36;color:#fff}.details{display:none;white-space:pre-wrap;background:#0d1117;padding:14px;border-radius:10px;margin-top:14px;max-height:380px;overflow:auto;font:12px ui-monospace,monospace;color:#c9d1d9}.status{color:#a8b0bd;margin-top:12px;font-size:13px}details{margin-top:22px;color:#a8b0bd}a{color:#aeb9ff}@media(max-width:650px){.checks{grid-template-columns:1fr}}</style></head>
<body><main><div class="brand">NEXTGIT</div><h1>Your update is ready</h1><p class="sub" id="asked"></p><section class="panel" id="update"></section><p><a href="/">← Back to projects</a></p></main>
<script>
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));let d=null;
async function loadReview(){const missionId=new URLSearchParams(location.search).get('missionId');if(!missionId){document.getElementById('asked').textContent='No update selected.';return}const r=await fetch('/api/missions/review?missionId='+encodeURIComponent(missionId));d=await r.json();if(!r.ok){document.getElementById('asked').textContent=d.error||'Update not found.';return}document.getElementById('asked').textContent='You asked: '+d.mission.objective;const x=d.integration||{};const o=d.orchestration||{};const safe=x.finalSecurity?.passed===true;const tested=x.tests?.passed===true;const integrated=x.integrated===true;const ready=x.ready===true;document.getElementById('update').innerHTML='<h2>'+(ready?'Everything is ready':'Your update needs attention')+'</h2><p class="sub">NextGit used '+(o.model==='clef-flash'?'Clef-flash':'the planner')+' to choose a '+esc(o.execution||'planned')+' workflow'+(o.riskScore!==undefined?' · risk '+esc(o.riskScore):'')+'.</p><p class="sub">'+(ready?'NextGit built the different parts, combined them, and checked the finished update.':'NextGit finished the work, but one of the final checks needs attention before this update should be used.')+'</p><div class="checks"><div class="check '+(integrated?'pass':'fail')+'">'+(integrated?'✓':'✕')+' Parts work together</div><div class="check '+(safe?'pass':'fail')+'">'+(safe?'✓':'✕')+' Safety check</div><div class="check '+(tested?'pass':'fail')+'">'+(tested?'✓':'✕')+' Project checks</div></div><div class="actions"><button class="btn secondary" onclick="changes()">See what changed</button><button class="btn secondary" onclick="revision()">Ask for changes</button><button class="btn primary" '+(ready?'':'disabled')+' onclick="useUpdate()">Use this update</button></div><div class="details" id="changes"></div><div class="status" id="status"></div><details><summary>Developer details</summary><pre>'+esc(JSON.stringify({integration:x},null,2))+'</pre></details>'}
async function changes(){const e=document.getElementById('changes');e.style.display='block';e.textContent='Explaining what changed…';const r=await fetch('/api/missions/explain-changes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:d.mission.id})});const j=await r.json();e.textContent=r.ok?(j.explanation||'No changes found'):'Could not explain changes';if(r.ok&&j.rawDiff){const details=document.createElement('details');details.innerHTML='<summary>Developer diff</summary><pre style="white-space:pre-wrap">'+esc(j.rawDiff)+'</pre>';e.appendChild(details)}}
async function revision(){const f=prompt('What would you like changed?');if(!f)return;const e=document.getElementById('status');e.textContent='Preparing your revision…';const r=await fetch('/api/missions/revise',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:d.mission.id,feedback:f})});const j=await r.json();if(!r.ok){e.textContent=j.error||'Could not start the revision.';return}e.textContent='Updating the plan…';const ids=['agent-a','agent-b','agent-c','agent-d'];const p=await fetch('/api/missions/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:j.mission.id,objective:j.objective,agentIds:ids})}).then(x=>x.json());if(p.requiresClarification){e.textContent='The revision needs a little more detail. Open the Project Build tab to continue.';return}e.textContent='Rebuilding and checking your update…';const attempts=j.mission.attempts.map((a,i)=>({id:a.id,agentId:a.agentId,repositoryName:a.repository.name,objective:p.plan?.tasks?.[i]?.objective||j.objective}));const x=await fetch('/api/missions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:j.mission.id,objective:j.objective,attempts})}).then(q=>q.json());if(!x.results){e.textContent=x.error||'Revision failed.';return}location.href='/mission-review?missionId='+encodeURIComponent(j.mission.id)}
async function useUpdate(){const e=document.getElementById('status');e.textContent='Running final checks…';const r=await fetch('/api/missions/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId:d.mission.id})});const j=await r.json();if(r.ok){e.innerHTML='✓ Your project has been updated. <a href="/project?id='+encodeURIComponent(j.projectId)+'">Open your project</a>'}else{e.textContent='Could not apply update: '+(j.error||'Final checks failed')}}
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
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const authorizedMission = await env.DB.prepare("SELECT m.id FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR (pm.user_id=? AND pm.role IN ('owner','editor')))").bind(user.id,body.missionId,user.id,user.id).first<any>();
      if (!authorizedMission) return reply({ error: "Mission not found or planning access denied" }, 403);
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
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const missionRow = await env.DB.prepare("SELECT m.id,m.project_id FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR (pm.user_id=? AND pm.role IN ('owner','editor')))").bind(user.id,body.missionId,user.id,user.id).first<any>();
      if (!missionRow) return reply({ error: "Mission not found or build access denied" }, 403);
      const storedMission = await env.STATE.get(`mission:${body.missionId}`, "json") as any;
      const allowedAttempts = new Map((storedMission?.attempts || []).map((a:any) => [a.id, a.repository?.name]));
      if (body.attempts.some((a:any) => allowedAttempts.get(a.id) !== a.repositoryName)) return reply({ error: "One or more workspaces do not belong to this Mission" }, 403);

      const runId = crypto.randomUUID();
      const storedPlan = await env.STATE.get(`plan:${body.missionId}`, "json") as any;
      const executionMode = storedPlan?.decision?.execution || "parallel";
      const orchestration = { model: storedPlan?.decision?.model || "planner", execution: executionMode, riskScore: storedPlan?.decision?.riskScore, extraHumanReview: storedPlan?.decision?.extraHumanReview === true, confidence: storedPlan?.decision?.confidence };
      await env.STATE.put(`orchestration:${body.missionId}`, JSON.stringify(orchestration));
      const storedMissionForExecution = await env.STATE.get(`mission:${body.missionId}`, "json") as any;
      const completedByIndex = new Map<number, any>();
      const seedDependencies = async (attempt: any, index: number) => {
        const deps = Array.isArray(storedPlan?.tasks?.[index]?.dependsOn) ? storedPlan.tasks[index].dependsOn : [];
        if (!deps.length) return { ok: true, inherited: 0 };
        const dependencyRepositories = deps.map((dep: number) => completedByIndex.get(dep)?.result?.repository).filter(Boolean);
        if (dependencyRepositories.length !== deps.length) return { ok: false, error: "A required workstream did not complete successfully." };
        const seeded = await env.EXECUTOR.fetch("https://executor/integrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            canonicalRepository: storedMissionForExecution.canonicalRepositoryName,
            attemptRepositories: dependencyRepositories,
            integrationRepository: attempt.repositoryName,
          }),
        });
        const result = await seeded.json() as any;
        return { ok: seeded.ok && result?.integrated === true, inherited: dependencyRepositories.length, result };
      };
      const executeOne = async (attempt: any, index = body.attempts!.findIndex((candidate: any) => candidate.id === attempt.id)) => {
          try {
            const inheritance = await seedDependencies(attempt, index);
            if (!inheritance.ok) return { attemptId: attempt.id, agentId: attempt.agentId, ok: false, result: { error: inheritance.error || "Dependency inheritance failed", inheritance } };
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
        };
      let results: any[] = [];
      if (executionMode === "sequential") {
        for (let i=0;i<body.attempts.length;i++) {
          const result = await executeOne(body.attempts[i], i);
          results.push(result);
          if (result.ok) completedByIndex.set(i, result);
        }
      } else if (executionMode === "mixed" && Array.isArray(storedPlan?.tasks)) {
        const remaining = body.attempts.map((attempt: any, index: number) => ({ attempt, index }));
        const completed = new Set<number>();
        while (remaining.length) {
          const ready = remaining.filter(({ index }) => {
            const deps = Array.isArray(storedPlan.tasks[index]?.dependsOn) ? storedPlan.tasks[index].dependsOn : [];
            return deps.every((dep: number) => completed.has(dep));
          });
          if (!ready.length) {
            return reply({ error: "The work plan contains unresolved task dependencies." }, 409);
          }
          const batch = await Promise.all(ready.map(({ attempt, index }) => executeOne(attempt, index)));
          results.push(...batch);
          ready.forEach(({ index }, i) => { completed.add(index); if (batch[i]?.ok) completedByIndex.set(index, batch[i]); });
          for (const item of ready) {
            const pos = remaining.findIndex((candidate) => candidate.index === item.index);
            if (pos >= 0) remaining.splice(pos, 1);
          }
        }
      } else {
        results = await Promise.all(body.attempts.map(executeOne));
      }

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
        if (integration?.integrated !== true && integration?.exitCode >= 50) {
          integration = { ...integration, conflict: true, needsHumanReview: true, message: "NextGit could not safely combine all completed workstreams automatically." };
        }
        let finalSecurity: any = null;
        let tests: any = null;
        if (integration?.integrated === true) {
          finalSecurity = await env.EXECUTOR.fetch("https://executor/security-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryName: integrationRepo.name }) }).then(r => r.json());
          tests = await env.EXECUTOR.fetch("https://executor/test-project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryName: integrationRepo.name }) }).then(r => r.json());
        }
        integration = { ...integration, finalSecurity, tests, ready: integration?.integrated === true && finalSecurity?.passed === true && tests?.passed === true, workstreamsIntegrated: safe.length };
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

    if (request.method === "POST" && url.pathname === "/api/missions/revise") {
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const body = await request.json() as { missionId?: string; feedback?: string };
      if (!body.missionId || !body.feedback?.trim()) return reply({ error: "missionId and feedback are required" }, 400);
      const row = await env.DB.prepare("SELECT m.id,m.project_id,m.objective,p.repository_name FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR (pm.user_id=? AND pm.role IN ('owner','editor')))").bind(user.id,body.missionId,user.id,user.id).first<any>();
      if (!row) return reply({ error: "Mission not found or revision access denied" }, 403);
      const objective = row.objective + "\nRevision requested by the user: " + body.feedback.trim();
      const revised = await createMission(env, { projectId: row.project_id, canonicalRepositoryName: row.repository_name, title: "Revision", objective, agentIds: ["agent-a","agent-b","agent-c","agent-d"] });
      await env.STATE.put(`mission:${revised.id}`, JSON.stringify(revised));
      await env.DB.prepare("INSERT INTO missions(id,project_id,title,objective,status,created_by_user_id) VALUES(?,?,?,?,?,?)").bind(revised.id,row.project_id,"Revision",objective,"planning",user.id).run();
      await Promise.all(revised.attempts.map((attempt:any)=>env.STATE.put(`attempt:${attempt.id}`,JSON.stringify({missionId:revised.id,projectId:revised.projectId,canonicalRepositoryName:revised.canonicalRepositoryName,attemptId:attempt.id,agentId:attempt.agentId,repositoryName:attempt.repository.name}))));
      return reply({ ok: true, mission: revised, objective }, 201);
    }

    if (request.method === "POST" && url.pathname === "/api/missions/apply") {
      const body = await request.json() as { missionId?: string };
      if (!body.missionId) return reply({ error: "missionId is required" }, 400);
      const user = await currentUser(request, env.DB);
      if (!user) return reply({ error: "Sign in is required" }, 401);
      const authorizedMission = await env.DB.prepare("SELECT m.id FROM missions m JOIN projects p ON p.id=m.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE m.id=? AND (p.owner_user_id=? OR (pm.user_id=? AND pm.role IN ('owner','editor')))").bind(user.id,body.missionId,user.id,user.id).first<any>();
      if (!authorizedMission) return reply({ error: "Mission not found or apply access denied" }, 403);
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
      await env.DB.prepare("UPDATE missions SET status='applied' WHERE id=?").bind(body.missionId).run();
      return reply({ ok: true, applied, promotion, projectId: mission.projectId }, 201);
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
