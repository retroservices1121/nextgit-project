import assert from "node:assert/strict";
import { Script } from "node:vm";
const base = process.argv[2];
assert.ok(base, "Supply the existing competition Worker URL");
for (const path of ["/login", "/demo", "/mission-review"]) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.match(html, /<title>[^<]*GitFlare[^<]*<\/title>/);
  assert.match(html, /Your code\. Your agents\. Your platform\./);
  assert.doesNotMatch(html, /\bNextGit\b|\bNEXTGIT\b/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  console.log("PASS live branding and script syntax:", path);
}
const health = await fetch(new URL("/health", base));
assert.equal(health.status, 200);
assert.equal((await health.json()).service, "nextgit-project");
const redirect = await fetch(new URL("/", base), { redirect: "manual" });
assert.equal(redirect.status, 302);
assert.equal(new URL(redirect.headers.get("location")).pathname, "/login");
console.log("PASS live health and existing sign-in redirect");
