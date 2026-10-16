// Phase 1 Track C: minimal Gemini client for the baseline agent (demo-server).
// Uses the Gemini REST generateContent endpoint directly (no @google/genai
// dependency). Model name comes from AGENT_LLM env (e.g. gemini:gemini-1.5-flash).
// Verify current model names and endpoint in Google docs before changing.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const PLACEHOLDER_KEYS = new Set(['', 'your_gemini_api_key_here', 'changeme', 'xxx']);

function hasRealKey(apiKey) {
  return Boolean(apiKey) && !PLACEHOLDER_KEYS.has(String(apiKey).trim().toLowerCase());
}

export function createGemini(model) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!hasRealKey(apiKey)) {
    // Scripted fallback: always propose the tool call for the task, so the raw
    // (unhealed) executor retries against the mutated mock until the cap —
    // producing a visible failure after MAX_ITERATIONS.
    const selectedModel = model?.startsWith('gemini:') ? model.slice('gemini:'.length) : model;
    const resolvedModel = !selectedModel || selectedModel === 'default' ? DEFAULT_MODEL : selectedModel;
    return {
      mode: 'scripted',
      async generate({ messages = [] } = {}) {
        const last = messages[messages.length - 1];
        const toolResult = last && last.role === 'tool'
          ? last.parts.map((p) => p.text ?? '').join('')
          : null;
        return {
          text: toolResult ? 'retrying tool call (scripted)' : 'calling tool (scripted)',
          toolCalls: [{ id: `tc_scripted_${messages.length}`, name: 'get_user' }],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          error: 'no_api_key',
        };
      },
    };
  }

  return {
    mode: 'gemini',
    async generate({ system, messages, temperature = 0 }) {
      // Build a single prompt from system + conversation history.
      const parts = [];
      if (system) parts.push({ text: `System: ${system}\n\n` });
      for (const m of messages) {
        if (m.role === 'user') parts.push({ text: `User: ${m.parts.map((p) => p.text ?? '').join('')}\n` });
        if (m.role === 'assistant') parts.push({ text: `Assistant: ${m.parts.map((p) => p.text ?? '').join('')}\n` });
        if (m.role === 'tool') parts.push({ text: `Tool result: ${m.parts.map((p) => p.text ?? '').join('')}\n` });
      }
      parts.push({ text: 'Assistant:' });

      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature },
      };

      const resp = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        let text = '';
        try { text = await resp.text(); } catch {}
        throw new Error(`Gemini API ${resp.status}: ${text}`);
      }

      const json = await resp.json();
      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text ?? '';
      const usage = json.usageMetadata ?? {};

      // Parse tool calls from the assistant text using a simple protocol:
      // TOOL_CALL: {"tool": "name", "args": {...}}
      const toolCalls = [];
      const toolRegex = /TOOL_CALL:\s*(\{[\s\S]*?\})/g;
      let match;
      while ((match = toolRegex.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed.tool && parsed.args) {
            toolCalls.push({ id: `tc_${toolCalls.length}`, name: parsed.tool, args: parsed.args });
          }
        } catch {
          // ignore unparseable tool calls
        }
      }

      return {
        text,
        toolCalls,
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          totalTokens: usage.totalTokenCount ?? 0,
        },
      };
    },
  };
}
