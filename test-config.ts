interface AppConfig {
  apiUrl: string;
  timeout: number;
  retries: number;
  features: {
    darkMode: boolean;
    notifications: boolean;
    analytics: boolean;
  };
}

const defaults: AppConfig = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
  retries: 3,
  features: {
    darkMode: true,
    notifications: true,
    analytics: false,
  },
};

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    ...defaults,
    ...overrides,
    features: {
      ...defaults.features,
      ...overrides?.features,
    },
  };
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];
  if (!config.apiUrl.startsWith('http')) {
    errors.push('apiUrl must start with http');
  }
  if (config.timeout < 1000) {
    errors.push('timeout must be at least 1000ms');
  }
  if (config.retries < 0 || config.retries > 10) {
    errors.push('retries must be between 0 and 10');
  }
  return errors;
}
