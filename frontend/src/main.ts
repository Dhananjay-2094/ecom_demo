import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Start the standalone Angular app with its configured providers.
bootstrapApplication(App, appConfig)
  // Log bootstrap failures so they are visible during local development.
  .catch((err) => console.error(err));
