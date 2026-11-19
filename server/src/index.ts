/**
 * SahiPick server bootstrap.
 */

import { createApp } from './api/index.ts';
import { config, hasRemoteLlm } from './config.ts';
import { closeDb } from './db/index.ts';
import { GroundedLocalProvider, OpenAiCompatibleProvider, setActiveProvider } from './ai/provider.ts';
import { setBrowserAdapter } from './services/browser-manager.ts';
import { SteelBrowserManager } from './services/steel-browser-manager.ts';

if ((process.env.SAHIPICK_BROWSER_ENGINE ?? '').toLowerCase() === 'steel') {
  setBrowserAdapter(new SteelBrowserManager());
  console.log('[sahipick] browser engine: steel (Steel Browser)');
}

function configureAiProvider(): void {
  if (hasRemoteLlm()) {
    setActiveProvider(
      new OpenAiCompatibleProvider({
        baseUrl: config.aiBaseUrl as string,
        apiKey: config.aiApiKey as string,
        model: config.aiModel as string,
      }),
    );
    console.log(`[ai] using OpenAI-compatible provider with model "${config.aiModel}"`);
  } else {
    setActiveProvider(new GroundedLocalProvider());
    console.log('[ai] no remote model configured — using the deterministic grounded composer');
    console.log('[ai] set AI_BASE_URL, AI_MODEL and AI_API_KEY to enable model-written synthesis');
  }
}

const app = createApp();
configureAiProvider();

const server = app.listen(config.port, config.host, () => {
  console.log(`[sahipick] API listening on http://${config.host}:${config.port}`);
  console.log(`[sahipick] database: ${config.databasePath}`);
});

function shutdown(signal: string): void {
  console.log(`[sahipick] ${signal} received, shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
