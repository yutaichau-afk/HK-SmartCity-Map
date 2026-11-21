export interface Env {
  ASSETS: Fetcher
}

/** Minimal Worker: static assets serve the SPA; no API proxying. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },
}
