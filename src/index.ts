export interface Env {}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "nextgit-project",
        phase: "foundation",
      });
    }

    return json({
      name: "NextGit Project",
      thesis: "Humans define intent and decisions; agents perform software work.",
      primitives: ["Project", "Mission", "Attempt", "Finding", "Decision", "Release"],
      endpoints: ["/health"],
    });
  },
};
