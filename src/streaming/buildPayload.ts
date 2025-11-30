import {getClientSessionId} from './utils/clientSession.js';
import type {BuildPayloadOptions, BuiltPayloadResult} from './types.js';

function supportsReasoning(model: string): boolean {
  const m = (model || '').toLowerCase();
  return m.startsWith('gpt-5') || /^o\d/i.test(m) || m.includes('reason');
}

function buildUpstreamParamsFromSettings(s: {model: string; reasoningEffort?: any; verbosity?: any}): any {
  const payload: any = {};
  if (supportsReasoning(s.model) && s.reasoningEffort) {
    payload.reasoning = {effort: s.reasoningEffort};
  }
  if (typeof s.verbosity !== 'undefined') payload.verbosity = s.verbosity;
  return payload;
}

function ensureTextConfig(payload: any): Record<string, any> {
  if (!payload.text || typeof payload.text !== 'object') {
    payload.text = {};
  }
  return payload.text;
}

function applyVerbosity(target: any, verbosity: any) {
  if (typeof verbosity === 'undefined') return;
  const textCfg = ensureTextConfig(target);
  textCfg.verbosity = verbosity;
}

/**
 * Builds a request payload for the responses endpoint, merging caller overrides,
 * current model defaults, and client metadata.
 */
export function buildResponsesPayload(opts: BuildPayloadOptions): BuiltPayloadResult {
  const {
    messages,
    model,
    forcedModel,
    text,
    tools,
    toolChoice,
    parallelToolCalls,
    overrides,
    clientSessionId,
    getCurrentModelSettings,
  } = opts;
  const selectedModel = typeof model === 'string' ? model : forcedModel;
  const payload: any = {messages, stream: true};
  if (selectedModel) payload.model = selectedModel;
  if (tools) payload.tools = tools;
  if (typeof toolChoice !== 'undefined') payload.tool_choice = toolChoice;
  if (typeof parallelToolCalls !== 'undefined') payload.parallel_tool_calls = parallelToolCalls;

  try {
    const settings = getCurrentModelSettings?.();
    if (settings) {
      if (!payload.model && (settings as any).model) payload.model = (settings as any).model;
      const upstreamParams = buildUpstreamParamsFromSettings({
        ...settings,
        model: payload.model || (settings as any).model,
      });
      const {verbosity, ...rest} = upstreamParams || ({} as any);
      Object.assign(payload, rest);
      applyVerbosity(payload, verbosity);
    }
  } catch {}

  if (text && typeof text === 'object') {
    Object.assign(ensureTextConfig(payload), text);
  }

  if (overrides && typeof overrides === 'object') {
    const {model: overrideModel, reasoning, verbosity} = overrides as any;
    if (overrideModel) payload.model = overrideModel;
    if (typeof reasoning !== 'undefined') payload.reasoning = reasoning;
    applyVerbosity(payload, verbosity);
  }

  const isJsonStructured = !!(payload?.text && typeof payload.text === 'object' && payload.text.format && payload.text.format.type === 'json_schema');
  const clientId = getClientSessionId() || clientSessionId;
  const uiSid = String(clientSessionId || clientId || '');
  payload.metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  if (clientId && !payload.metadata.client_session_id) payload.metadata.client_session_id = clientId;

  return {payload, isJsonStructured, uiSid, clientId};
}
