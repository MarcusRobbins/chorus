// OpenAI Chat Completions with tool-calling, for use in the browser.
// No state at module scope. Caller passes the key; we never persist it.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_ITERATIONS = 20;

export const SYSTEM_PROMPT = `You are a website-editing assistant.

A user has filed a ticket asking for a change to a static website hosted on GitHub. You will be given the ticket description plus metadata about the element they annotated on the live site (tag name, CSS selector, text snippet, page URL, bounding box).

Your job:
1. Use the provided tools to explore the repository (list_files, then read_file on anything that looks relevant).
2. Make the minimum set of file edits needed to fulfill the ticket. Stage edits with write_file. You can call write_file multiple times; all staged writes are committed together at the end.
3. When done, call the finish tool with a one-sentence summary of what you changed.

Rules:
- The site is pure static HTML/CSS/JS. There is no build step, no bundler, no node_modules.
- If the site uses React, it is loaded via an ES module + import map from esm.sh, compiled in the browser. Keep the same pattern.
- All paths in the HTML and JS must be relative (./foo, not /foo) so the branch preview works via jsDelivr.
- If the repo is empty, create a minimal index.html that satisfies the request.
- Do not install dependencies. Do not introduce a build step.
- Keep changes focused. Do not refactor unrelated code.
- Do not call finish until you have staged at least one write_file, unless truly nothing needs to change.`;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the repository at a given git ref. Returns an array of paths with sizes.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch, tag, or commit SHA. Optional; defaults to the default branch.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file at a given git ref. Returns the text, or a clear error if the file does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the repo root.' },
          ref: { type: 'string', description: 'Branch, tag, or commit SHA. Optional; defaults to the default branch.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Stage a write to the given path. The file is NOT committed yet — all staged writes are committed in one atomic commit after you call finish. Calling write_file on the same path twice overwrites the previous staged content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the repo root.' },
          content: { type: 'string', description: 'Full new contents of the file.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Signal that all edits are staged and the session should commit them. After you call this, no further tool calls will be processed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-sentence summary of what was changed. Used as the commit message.' },
        },
        required: ['summary'],
      },
    },
  },
];

// Run a tool-calling conversation until the model calls `finish` or stops.
// First turn: pass `userPrompt`. Subsequent turns: pass `priorMessages` (the
// messages array returned by the previous run) and `followUp` (the new user
// message).
// Returns { summary, finished, iterations, messages }.
export async function runSession({
  apiKey,
  model = 'gpt-4o',
  userPrompt,
  priorMessages,
  followUp,
  executeTool,
  onEvent = () => {},
  signal,
}) {
  const messages = priorMessages
    ? [...priorMessages, { role: 'user', content: followUp || '' }]
    : [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

  let summary = null;
  let finished = false;
  let i = 0;

  for (i = 0; i < MAX_ITERATIONS; i++) {
    onEvent({ type: 'thinking', iteration: i });

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        parallel_tool_calls: false,
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('OpenAI returned no choices');

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    if (assistantMsg.content) {
      onEvent({ type: 'assistant_text', text: assistantMsg.content });
    }

    const toolCalls = assistantMsg.tool_calls || [];

    if (!toolCalls.length) {
      onEvent({ type: 'stopped_without_finish', content: assistantMsg.content || '' });
      break;
    }

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args;
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch (e) {
        args = {};
        onEvent({ type: 'tool_arg_parse_error', name, raw: tc.function?.arguments });
      }

      if (name === 'finish') {
        summary = args.summary || 'AI-applied changes';
        onEvent({ type: 'finish', summary });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'ok' });
        finished = true;
        break;
      }

      onEvent({ type: 'tool_call', name, args });

      let result;
      try {
        result = await executeTool(name, args);
      } catch (err) {
        result = { error: String(err.message || err) };
        onEvent({ type: 'tool_error', name, error: result.error });
      }

      onEvent({ type: 'tool_result', name, result: summariseToolResult(name, result) });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    if (finished) break;
  }

  if (!finished && i >= MAX_ITERATIONS) {
    onEvent({ type: 'iteration_limit', iterations: i });
  }

  return { summary, finished, iterations: i + 1, messages, staged: null };
}

function summariseToolResult(name, result) {
  if (name === 'list_files' && Array.isArray(result)) return { files: result.length };
  if (name === 'read_file' && typeof result === 'string') return { bytes: result.length };
  if (name === 'write_file') return result;
  return result;
}
