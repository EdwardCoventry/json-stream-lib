function readEnv(key: string, env: Record<string, any>, procEnv: Record<string, any>) {
  const val = env[key] ?? procEnv?.[key];
  return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' ? val : undefined;
}

export function getStreamingEnv() {
  const env = (import.meta as any)?.env ?? {};
  const procEnv = (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env) ? (globalThis as any).process.env : {};
  const apiBaseRaw =
    readEnv('STREAM_API_BASE', env, procEnv) ??
    readEnv('STREAM_API_BASE_URL', env, procEnv) ??
    readEnv('PUBLIC_API_BASE', env, procEnv) ??
    readEnv('VITE_PUBLIC_API_BASE', env, procEnv) ??
    '';
  let apiBase = String(apiBaseRaw || '').replace(/\/$/, '');
  // Browser fallback: default to current origin when no base is configured
  if (!apiBase && typeof window !== 'undefined' && (window as any).location?.origin) {
    apiBase = String((window as any).location.origin || '').replace(/\/$/, '');
  }
  const forcedModelRaw =
    readEnv('STREAM_DEFAULT_MODEL', env, procEnv) ??
    readEnv('PUBLIC_DEFAULT_MODEL', env, procEnv) ??
    readEnv('VITE_PUBLIC_DEFAULT_OPENAI_MODEL', env, procEnv) ??
    undefined;
  const forcedModel = forcedModelRaw ? String(forcedModelRaw) : undefined;
  return {
    apiBase,
    forcedModel,
    usePipelineV2: !!(readEnv('STREAM_PIPELINE_V2', env, procEnv) ?? readEnv('VITE_STREAM_PIPELINE_V2', env, procEnv)),
    shadowMode: !!(readEnv('STREAM_PIPELINE_SHADOW', env, procEnv) ?? readEnv('VITE_STREAM_PIPELINE_SHADOW', env, procEnv)),
    maxQueueFrames: Number(readEnv('STREAM_MAX_FRAMES', env, procEnv) ?? readEnv('VITE_STREAM_MAX_FRAMES', env, procEnv) ?? 500),
    maxQueueBytes: Number(readEnv('STREAM_MAX_BYTES', env, procEnv) ?? readEnv('VITE_STREAM_MAX_BYTES', env, procEnv) ?? 2_000_000), // 2MB default
  } as const;
}
