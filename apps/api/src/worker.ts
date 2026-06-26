import app from './app';
import { runScheduledOpsChecks } from './ops';

type WorkerEnv = {
  ASSETS: {
    fetch(request: Request): Response | Promise<Response>;
  };
  SENTRY_DSN?: string;
  DISCORD_WEBHOOK_URL?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  OPS_MIN_ACTIVITY_HOURS?: string;
};

export default {
  fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api') || url.pathname === '/health' || url.pathname === '/ready') {
      return app.fetch(request, env);
    }
    return env.ASSETS.fetch(request);
  },
  scheduled(_controller: unknown, env: WorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledOpsChecks(env));
  },
};
