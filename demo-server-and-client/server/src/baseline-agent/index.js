// Phase 1 Track C: baseline agent — Gemini-driven loop over logical tools with a
// RAW HTTP executor (no healing adapter), same logical tools as the healed side.
// max_iterations=10 (§6 Track C). Against M5 it loops and fails visibly.
// Falls back to scripted retry when GEMINI_API_KEY is absent (flagged mode:'scripted').
import { emit } from './../events/bus.js';
import { newId } from '../lib/ids.js';
import { createGemini } from './llm.js';

const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are a baseline agent with direct (unhealed) access to HTTP tools.
You must complete the task using the provided tools. If a tool returns an error,
you may retry with corrected arguments, but you cannot change the wire format
beyond what the tool schema allows. Do not invent values. Stop when you have the
answer or hit the iteration cap.
`;

// Fixed task used in the demo: fetch user 123, update their email, report name+email.
const DEFAULT_TASK = (email) => `Task: Fetch user 123, then update their email to "${email}", then report the user's name and email.`;

function rawSend(baseUrl, tool, args) {
  const path = tool.path ?? '/api/users/get';
  const method = tool.method ?? 'POST';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  }).then(async (resp) => {
    let json;
    try { json = await resp.json(); } catch { json = null; }
    return { ok: resp.ok, status: resp.status, json, text: JSON.stringify(json ?? null) };
  });
}

export async function runTask({ apiId, tool, args, baseUrl, runId }) {
  const callId = newId('c');
  const iterations = [];
  let totalTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let lastResult = null;
  const baselineMode = process.env.BASELINE_MODE ?? 'scripted';
  const llm = createGemini(
    baselineMode === 'gemini'
      ? (process.env.AGENT_LLM ?? 'gemini:gemini-2.5-flash')
      : 'scripted',
  );

  // Build the logical tool schema description for the prompt.
  const toolSchema = JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.parameters ?? { type: 'object', properties: {}, required: [] },
  }, null, 2);

  const taskEmail = args && args.email ? String(args.email) : 'asha.new@example.com';
  const userPrompt = `${SYSTEM_PROMPT}\n\nTool schema:\n${toolSchema}\n\n${DEFAULT_TASK(taskEmail)}\n\nRespond with either a TOOL_CALL line or your final answer.`;

  let messages = [
    { role: 'user', parts: [{ text: userPrompt }] },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const iter = i + 1;
    const gen = await llm.generate({ system: SYSTEM_PROMPT, messages, temperature: 0 });
    totalTokens.inputTokens += gen.usage.inputTokens;
    totalTokens.outputTokens += gen.usage.outputTokens;
    totalTokens.totalTokens += gen.usage.totalTokens;

    emit({ type: 'agent.step', runId, callId, apiId, tool: tool.name, iteration: iter, tokens: gen.usage, cumulative: { ...totalTokens } });

    if (!gen.toolCalls || gen.toolCalls.length === 0) {
      // Model answered without a tool call — treat as final answer.
      emit({ type: 'agent.final', runId, callId, apiId, tool: tool.name, iteration: iter, outcome: 'answer_no_tool', iterations: iter, tokens: { ...totalTokens }, answer: gen.text });
      return { ok: false, outcome: 'answer_no_tool', iterations: iter, tokens: { ...totalTokens }, answer: gen.text, events: iterations };
    }

    // Execute the first tool call through the RAW executor (no healing).
    const tc = gen.toolCalls[0];
    const callArgs = tc.args ?? args ?? {};
    const result = await rawSend(baseUrl, tool, callArgs);
    lastResult = result;
    iterations.push({ iteration: iter, ok: result.ok, status: result.status, toolCall: tc.name, args: callArgs, tokens: gen.usage });

    emit({ type: result.ok ? 'call.succeeded' : 'call.failed', runId, callId, apiId, tool: tool.name, iteration: iter, status: result.status, tokens: gen.usage });

    // Feed the raw result back to the model as a tool result.
    messages.push({ role: 'tool', parts: [{ text: JSON.stringify({ ok: result.ok, status: result.status, body: result.json }) }] });

    if (result.ok) {
      emit({ type: 'agent.final', runId, callId, apiId, tool: tool.name, outcome: 'success', iterations: iter, tokens: { ...totalTokens }, data: result.json });
      return { ok: true, outcome: 'success', iterations: iter, tokens: { ...totalTokens }, data: result.json, events: iterations };
    }
  }

  emit({ type: 'agent.final', runId, callId, apiId, tool: tool.name, outcome: 'fail', iterations: MAX_ITERATIONS, tokens: { ...totalTokens }, error: lastResult });
  return { ok: false, outcome: 'fail', iterations: MAX_ITERATIONS, tokens: { ...totalTokens }, error: lastResult, events: iterations };
}

export { MAX_ITERATIONS };
