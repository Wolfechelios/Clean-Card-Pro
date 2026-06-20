import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.215e08f1661d43bb917dae09df3c0a39',
  appName: 'cleancards',
  webDir: 'dist',
  server: {
    url: 'https://215e08f1-661d-43bb-917d-ae09df3c0a39.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#1a1a1a",
      showSpinner: false
    }
  }
};

export default config;
