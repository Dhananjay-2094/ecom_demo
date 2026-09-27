import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Show uncaught browser-side errors through Angular's global error handling.
    provideBrowserGlobalErrorListeners(),
    // Make HttpClient available to the API service.
    provideHttpClient(),
    // Register the app's route table.
    provideRouter(routes)
  ]
};
