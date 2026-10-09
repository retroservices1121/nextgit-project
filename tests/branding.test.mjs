import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

// Load actual Worker modules without needing Cloudflare bindings for these routes.
const cache = new Map();
function loadModule(path) {
  path = resolve(path);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const requireLocal = specifier => {
    assert.ok(specifier.startsWith("."), "Smoke routes must use local modules");
    return loadModule(resolve(dirname(path), specifier + ".ts"));
  };
  new Function("require", "module", "exports", output)(requireLocal, module, module.exports);
  return module.exports;
}
const worker = loadModule("src/index.ts").default;
const auth = loadModule("src/application/auth.ts");
const env = {
  DB: {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { id: "project-test", name: "Test User", email: "demo@example.test", role: "owner" }; },
        async all() { return { results: [] }; }
      };
    }
  }
};

for (const path of ["/login", "/", "/projects", "/project?id=project-test", "/mission-review", "/demo"]) {
  test("rendered branding and browser script syntax: " + path, async () => {
    const headers = path === "/login" ? {} : { cookie: "nextgit_session=demo" };
    const response = await worker.fetch(new Request("https://example.test" + path, { headers }), env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>[^<]*GitFlare[^<]*<\/title>/);
    assert.match(html, /Your code\. Your agents\. Your platform\./);
    assert.match(html, /name="application-name" content="GitFlare"/);
    assert.doesNotMatch(html, /\bNextGit\b|\bNEXTGIT\b/);
    for (const [i, match] of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries()) {
      new Script(match[1], { filename: path + "-script-" + i });
    }
  });
}

test("sessions, project headers, health and E2E authorization remain compatible", async () => {
  assert.match(auth.sessionCookie("demo"), /^nextgit_session=demo;/);
  const project = await worker.fetch(new Request("https://example.test/project?id=project-test", {
    headers: { cookie: "nextgit_session=demo" }
  }), env);
  assert.equal(project.headers.get("x-nextgit-project-id"), "project-test");
  const health = await worker.fetch(new Request("https://example.test/health"), env);
  assert.equal((await health.json()).service, "nextgit-project");
  for (const [path, method] of [["run", "POST"], ["start", "POST"], ["status", "GET"]]) {
    const denied = await worker.fetch(new Request("https://example.test/api/competition/e2e/" + path, { method }), env);
    assert.equal(denied.status, 404);
  }
  const redirect = await worker.fetch(new Request("https://example.test/"), env);
  assert.equal(redirect.status, 302);
  assert.equal(new URL(redirect.headers.get("location")).pathname, "/login");
});

test("Cloudflare resource identifiers stay intact", () => {
  const control = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  const executor = JSON.parse(readFileSync("wrangler.executor.jsonc", "utf8"));
  assert.equal(control.name, "nextgit-project");
  assert.equal(executor.name, "nextgit-executor");
  assert.equal(control.services[0].service, "nextgit-executor");
  assert.equal(control.artifacts[0].namespace, "nextgit");
  assert.equal(executor.artifacts[0].namespace, "nextgit");
  assert.equal(control.d1_databases[0].database_name, "nextgit-app");
  assert.equal(control.d1_databases[0].database_id, "c54b4f4a-090b-481b-801e-3f20e16092aa");
  assert.equal(control.kv_namespaces[0].id, "7a5548912018497fb61082af5000f22d");
});
