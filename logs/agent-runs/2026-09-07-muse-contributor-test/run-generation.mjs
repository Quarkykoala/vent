import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the key explicitly supplied in this task is read. Never persist or print it.
const transcriptPath = 'C:/Users/lenovo/.codex/sessions/2026/09/05/rollout-2026-09-05T16-33-52-01a0713d-36c8-7741-b288-e14e2ff84ddb.jsonl';
const taskDir = path.dirname(fileURLToPath(import.meta.url));
const receiptPath = path.join(taskDir, 'generation-result.json');
if (fs.existsSync(receiptPath)) throw new Error('A generation receipt already exists; refusing an accidental paid rerun.');
let apiKey;
const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  let row;
  try { row = JSON.parse(lines[i]); } catch { continue; }
  let message = '';
  if (row.type === 'event_msg' && row.payload?.type === 'user_message') message = row.payload.message ?? '';
  if (row.type === 'response_item' && row.payload?.role === 'user') {
    message = (row.payload.content ?? []).filter(x => x.type === 'input_text').map(x => x.text).join('\n');
  }
  if (!/use this muse API to test/i.test(message)) continue;
  apiKey = message.replace(/\\_/g, '_').match(/LLM[_|]\d+[_|][A-Za-z0-9_-]+/)?.[0];
  if (apiKey) break;
}
if (!apiKey) throw new Error('The key supplied for this specific task was not found.');
const redact = value => String(value).split(apiKey).join('[REDACTED]').replace(/LLM[_|]\d+[_|][A-Za-z0-9_-]+/g, '[REDACTED]');
const request = {
  model: 'muse-spark-1.3-contributor',
  messages: [
    { role: 'developer', content: 'You are a coding workhorse. Produce only the requested source artifact. Do not claim execution or verification.' },
    { role: 'user', content: fs.readFileSync(path.join(taskDir, 'prompt.txt'), 'utf8') },
  ],
  reasoning_effort: 'medium',
  max_completion_tokens: 8192,
  stream: false,
};
fs.writeFileSync(path.join(taskDir, 'request.json'), JSON.stringify(request, null, 2));
const receipt = {
  startedAt: new Date().toISOString(),
  endpoint: 'https://api.meta.ai/v1/chat/completions',
  requestedModel: request.model,
  reasoningEffort: request.reasoning_effort,
  maxCompletionTokens: request.max_completion_tokens,
  generationRequests: 1,
  automaticRetries: 0,
  fallbackModels: false,
  listedInputUsdPerMillion: 0.10,
  listedOutputUsdPerMillion: 0.20,
};
const start = performance.now();
try {
  const response = await fetch(receipt.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  receipt.httpStatus = response.status;
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Non-JSON response, HTTP ${response.status}`); }
  if (!response.ok) {
    receipt.error = redact(JSON.stringify(data.error ?? data)).slice(0,1000);
    process.exitCode = 1;
  } else {
    const choice = data.choices?.[0];
    receipt.returnedModel = data.model;
    receipt.finishReason = choice?.finish_reason;
    receipt.usage = data.usage;
    if (data.usage?.prompt_tokens != null && data.usage?.completion_tokens != null) {
      receipt.estimatedListCostUsd = (data.usage.prompt_tokens * 0.10 + data.usage.completion_tokens * 0.20) / 1e6;
      receipt.costNote = 'Estimate from listed Contributor token rates; not an invoice. Prompt caching discounts, if any, are not subtracted.';
    }
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('No usable source returned.');
    if (content.includes(apiKey)) throw new Error('Credential detected in output; refusing to write content.');
    fs.writeFileSync(path.join(taskDir, 'model-output.txt'), content);
    const source = content.trim().replace(/^```(?:tsx|typescript|jsx)?\s*\n/, '').replace(/\n```\s*$/, '') + '\n';
    fs.writeFileSync(path.join(taskDir, 'PhoneSignIn.tsx'), source);
    receipt.sourceBytes = Buffer.byteLength(source);
  }
} catch (err) {
  receipt.error = redact(err.message);
  process.exitCode = 1;
} finally {
  receipt.elapsedMs = Math.round(performance.now() - start);
  receipt.finishedAt = new Date().toISOString();
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
  apiKey = undefined;
}
