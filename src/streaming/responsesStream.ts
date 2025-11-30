import {getStreamingEnv} from './config/StreamingEnv.js';
import {runWithShadow} from './pipeline/shadow.js';
import {buildResponsesPayload} from './buildPayload.js';
import {NetworkPolicy} from './policy/NetworkPolicy.js';
import {runJsonDeltaPipeline} from './pipeline/StreamingPipeline.js';
import {JsonDeltaDebugLogger} from './debug/StreamDebug.js';
import type {JsonDeltaHandlers, JsonDeltaResponsesOptions} from './types.js';

/**
 * High-level helper to stream responses from an SSE endpoint with sensible defaults
 * (policy, queue sizing, debug) and optional shadow replay for comparison.
 */
export async function runJsonResponsesStream(
  messages: any[],
  model?: string,
  handlers?: JsonDeltaHandlers,
  opts: JsonDeltaResponsesOptions = {}
) {
  const env = getStreamingEnv();
  const apiBase = (((opts.apiBase ?? env.apiBase) || '') as string).replace(/\/$/, '');
  const endpointPathRaw = opts.endpointPath ?? '/api/responses';
  const endpointPath = endpointPathRaw.startsWith('/') ? endpointPathRaw : `/${endpointPathRaw}`;
  const forcedModel = typeof opts.forcedModel === 'string' ? opts.forcedModel : env.forcedModel;
  const shadowMode = typeof opts.shadowMode === 'boolean' ? opts.shadowMode : env.shadowMode;
  const maxQueueFrames = typeof opts.maxQueueFrames === 'number' ? opts.maxQueueFrames : env.maxQueueFrames;
  const maxQueueBytes = typeof opts.maxQueueBytes === 'number' ? opts.maxQueueBytes : env.maxQueueBytes;

  const {payload, isJsonStructured, uiSid, clientId} = buildResponsesPayload({
    messages,
    model,
    forcedModel,
    text: opts.text,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
    parallelToolCalls: opts.parallelToolCalls,
    overrides: opts.overrides,
    clientSessionId: opts.clientSessionId,
    getCurrentModelSettings: opts.getCurrentModelSettings,
  });
  payload.metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  if (clientId) payload.metadata.client_session_id = clientId;

  const dbg = opts.dbg || new JsonDeltaDebugLogger(uiSid, opts.qr);
  const url = `${apiBase}${endpointPath}`;
  const run = () => runJsonDeltaPipeline({
    url,
    payload,
    uiSid,
    isJsonStructured,
    policy: opts?.policy || NetworkPolicy.fromCurrent(),
    dbg,
    maxFrames: maxQueueFrames,
    maxBytes: maxQueueBytes,
    abortSignal: opts?.signal,
    onDone: handlers?.onDone,
    onDeltaText: handlers?.onDeltaText,
    qr: opts?.qr,
  });
  return runWithShadow(run, shadowMode, dbg, uiSid);
}
