import { start } from './boot.js';

const running = await start(process.env);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void running.stop().then(() => {
      process.exit(0);
    });
  });
}
