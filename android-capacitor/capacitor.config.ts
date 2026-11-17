import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.sch.securequiz.kiosk',
  appName: 'SECURE QUIZ',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Uncomment and set your deployed HTTPS URL if using live remote loading:
    // url: 'https://your-secure-quiz-host.run.app',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
