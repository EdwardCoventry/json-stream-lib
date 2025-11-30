export type BackoffProfile = 'aggressive' | 'balanced' | 'conservative';

export type NetworkSettings = {
  maxAttempts: number;
  ttfbTimeoutMs: number;
  backoffProfile: BackoffProfile;
  retryOnServerErrors: boolean;
  retryOnlyBeforeBytes: boolean;
  midStreamStallMs: number;
};

let currentSettings: NetworkSettings | undefined;

export function setCurrentNetworkSettings(s: NetworkSettings) {
  currentSettings = s;
}

export function getCurrentNetworkSettings(): NetworkSettings | undefined {
  return currentSettings;
}
