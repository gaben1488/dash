import { config } from './config.js';
import { createApp, preloadData, startServer } from './app.js';

try {
  const app = await createApp();
  await startServer(app, config.server.port);
  preloadData(app);
} catch (err) {
  console.error(err);
  process.exit(1);
}
