import app from './app';

type WorkerEnv = {
  ASSETS: {
    fetch(request: Request): Response | Promise<Response>;
  };
};

export default {
  fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api') || url.pathname === '/health') {
      return app.fetch(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
