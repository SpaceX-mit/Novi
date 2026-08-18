import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai';

const PROVIDERS = Object.freeze([
  { id: 'openai', name: 'OpenAI', family: 'openai', defaultModel: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', apiKeyRequired: true },
  { id: 'anthropic', name: 'Anthropic', family: 'anthropic', defaultModel: 'claude-sonnet-4-5', apiKeyRequired: true },
  { id: 'google', name: 'Google Gemini', family: 'google', defaultModel: 'gemini-2.5-flash', apiKeyRequired: true },
  { id: 'deepseek', name: 'DeepSeek', family: 'openai', defaultModel: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKeyRequired: true },
  { id: 'openrouter', name: 'OpenRouter', family: 'openai', defaultModel: 'openai/gpt-4.1-mini', baseUrl: 'https://openrouter.ai/api/v1', apiKeyRequired: true },
  { id: 'mistral', name: 'Mistral AI', family: 'openai', defaultModel: 'mistral-small-latest', baseUrl: 'https://api.mistral.ai/v1', apiKeyRequired: true },
  { id: 'xai', name: 'xAI', family: 'openai', defaultModel: 'grok-3-mini', baseUrl: 'https://api.x.ai/v1', apiKeyRequired: true },
  { id: 'groq', name: 'Groq', family: 'openai', defaultModel: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1', apiKeyRequired: true },
  { id: 'minimax', name: 'MiniMax', family: 'openai', defaultModel: 'MiniMax-M3', baseUrl: 'https://api.minimaxi.com/v1', apiKeyRequired: true },
  { id: 'azure-openai', name: 'Azure OpenAI', family: 'azure', defaultModel: '', configurableBaseUrl: true, apiVersion: '2024-10-21', apiKeyRequired: true },
  { id: 'ollama', name: 'Ollama', family: 'openai', defaultModel: 'llama3.2', baseUrl: 'http://127.0.0.1:11434/v1', configurableBaseUrl: true, apiKeyRequired: false },
  { id: 'custom', name: 'OpenAI-compatible', family: 'openai', defaultModel: '', configurableBaseUrl: true, apiKeyRequired: false },
]);

const byId = new Map(PROVIDERS.map((provider) => [provider.id, provider]));
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function providerCatalog() {
  return PROVIDERS.map(({ family: _family, ...provider }) => ({ ...provider }));
}

function configuredTimeout() {
  const value = Number(process.env.NOVI_LLM_TIMEOUT_MS || 90_000);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1_000), 120_000) : 90_000;
}

function configuredMaxOutputTokens() {
  const value = Number(process.env.NOVI_LLM_MAX_OUTPUT_TOKENS || 8_192);
  return Number.isFinite(value) ? Math.min(Math.max(value, 512), 32_768) : 8_192;
}

function allowedCustomHosts() {
  return new Set(String(process.env.NOVI_LLM_ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function validatedBaseUrl(provider, rawValue) {
  const supplied = String(rawValue || provider.baseUrl || '').trim();
  if (!supplied) throw new Error('A provider base URL is required');
  let url;
  try { url = new URL(supplied); } catch { throw new Error('Provider base URL must be a valid URL'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Provider base URL cannot contain credentials, query parameters, or fragments');
  const hostname = url.hostname.toLowerCase();
  const isLocal = localHosts.has(hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) throw new Error('Provider base URL must use HTTPS; HTTP is only allowed for loopback development');
  if (provider.id === 'ollama' && !isLocal) throw new Error('Ollama is restricted to a loopback endpoint');
  if (provider.id === 'azure-openai' && !(hostname.endsWith('.openai.azure.com') || hostname.endsWith('.services.ai.azure.com'))) throw new Error('Azure OpenAI endpoint must use an approved Azure AI hostname');
  if (provider.id === 'custom' && !isLocal && !allowedCustomHosts().has(hostname)) throw new Error('Custom provider hostname is not listed in NOVI_LLM_ALLOWED_HOSTS');
  return url.toString().replace(/\/$/, '');
}

export function normalizeProviderInput(input = {}) {
  const providerId = String(input.provider || '').trim();
  const provider = byId.get(providerId);
  if (!provider) throw new Error('Unsupported LLM provider');
  const model = String(input.model || provider.defaultModel || '').trim();
  if (!model || model.length > 160 || /[\u0000-\u001f]/.test(model)) throw new Error('A valid model name of 160 characters or less is required');
  const apiKey = input.apiKey === undefined ? undefined : String(input.apiKey).trim();
  if (apiKey !== undefined && (apiKey.length > 2_000 || /[\r\n]/.test(apiKey))) throw new Error('API key is invalid');
  const baseUrl = provider.configurableBaseUrl ? validatedBaseUrl(provider, input.baseUrl) : provider.baseUrl;
  const apiVersion = provider.id === 'azure-openai' ? String(input.apiVersion || provider.apiVersion).trim() : undefined;
  if (apiVersion && (apiVersion.length > 40 || !/^[a-zA-Z0-9.-]+$/.test(apiVersion))) throw new Error('Azure API version is invalid');
  return { provider: provider.id, model, baseUrl, apiVersion, apiKey, apiKeyRequired: provider.apiKeyRequired };
}

function keyFile() {
  const dataFile = process.env.NOVI_DATA_FILE || join(process.cwd(), 'data', 'novi.json');
  return join(dirname(dataFile), '.novi-config-key');
}

async function encryptionKey() {
  const configured = process.env.NOVI_CONFIG_ENCRYPTION_KEY;
  if (configured) {
    if (process.env.NODE_ENV === 'production' && configured.length < 32) throw new Error('NOVI_CONFIG_ENCRYPTION_KEY must contain at least 32 characters in production');
    return createHash('sha256').update(configured).digest();
  }
  if (process.env.NODE_ENV === 'production') throw new Error('NOVI_CONFIG_ENCRYPTION_KEY is required before provider credentials can be stored in production');
  const file = keyFile();
  try { return Buffer.from((await readFile(file, 'utf8')).trim(), 'base64'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const generated = randomBytes(32).toString('base64');
    try { await writeFile(file, `${generated}\n`, { mode: 0o600, flag: 'wx' }); }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
    await chmod(file, 0o600).catch(() => {});
    return Buffer.from((await readFile(file, 'utf8')).trim(), 'base64');
  }
}

export async function encryptApiKey(value) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export async function decryptApiKey(value) {
  if (!value) return '';
  const [version, iv, tag, ciphertext] = String(value).split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Stored provider credential is invalid');
  const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function publicProviderConfig(config) {
  if (!config) return null;
  const { encryptedApiKey: _encryptedApiKey, ...safe } = config;
  return { ...safe, hasApiKey: Boolean(config.encryptedApiKey), apiKeyLast4: config.apiKeyLast4 || null };
}

export async function resolvedProviderConfig(state, tenantId) {
  const record = (state.llmProviderConfigs || []).find((config) => config.tenantId === tenantId && config.active);
  if (!record) return null;
  return { ...record, apiKey: await decryptApiKey(record.encryptedApiKey) };
}

export async function saveProviderConfig(state, tenantId, userId, input) {
  state.llmProviderConfigs ||= [];
  const normalized = normalizeProviderInput(input);
  const existing = state.llmProviderConfigs.find((config) => config.tenantId === tenantId && config.provider === normalized.provider);
  const encryptedApiKey = normalized.apiKey ? await encryptApiKey(normalized.apiKey) : existing?.encryptedApiKey || null;
  if (normalized.apiKeyRequired && !encryptedApiKey) throw new Error('An API key is required for this provider');
  for (const config of state.llmProviderConfigs) if (config.tenantId === tenantId) config.active = false;
  const now = new Date().toISOString();
  const record = {
    id: existing?.id || `${tenantId}:${normalized.provider}`,
    tenantId,
    provider: normalized.provider,
    model: normalized.model,
    baseUrl: normalized.baseUrl,
    ...(normalized.apiVersion ? { apiVersion: normalized.apiVersion } : {}),
    encryptedApiKey,
    apiKeyLast4: normalized.apiKey ? normalized.apiKey.slice(-4) : existing?.apiKeyLast4 || null,
    active: true,
    createdBy: existing?.createdBy || userId,
    updatedBy: userId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existing) Object.assign(existing, record); else state.llmProviderConfigs.push(record);
  return publicProviderConfig(record);
}

export function createChatModel(config) {
  const provider = byId.get(config.provider);
  if (!provider) throw new Error('Configured LLM provider is unsupported');
  const common = { model: config.model, temperature: 0.2, maxRetries: 0 };
  if (provider.family === 'anthropic') return new ChatAnthropic({ ...common, apiKey: config.apiKey, maxTokens: configuredMaxOutputTokens() });
  if (provider.family === 'google') return new ChatGoogleGenerativeAI({ ...common, apiKey: config.apiKey, maxOutputTokens: configuredMaxOutputTokens() });
  if (provider.family === 'azure') return new AzureChatOpenAI({ ...common, maxTokens: configuredMaxOutputTokens(), azureOpenAIApiKey: config.apiKey, azureOpenAIEndpoint: config.baseUrl, azureOpenAIApiDeploymentName: config.model, azureOpenAIApiVersion: config.apiVersion });
  const defaultHeaders = provider.id === 'openrouter' ? { 'HTTP-Referer': process.env.NOVI_APP_ORIGIN || 'https://novi.local', 'X-Title': 'Novi' } : undefined;
  return new ChatOpenAI({ ...common, maxTokens: configuredMaxOutputTokens(), apiKey: config.apiKey || 'ollama', configuration: { baseURL: config.baseUrl, ...(defaultHeaders ? { defaultHeaders } : {}) } });
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.map((part) => typeof part === 'string' ? part : part?.type === 'text' ? part.text : '').join('');
  return '';
}

export async function testProviderConnection(config) {
  const started = Date.now();
  const response = await createChatModel(config).invoke([
    { role: 'system', content: 'Return only the word OK.' },
    { role: 'user', content: 'Connection test.' },
  ], { signal: AbortSignal.timeout(configuredTimeout()) });
  if (!messageText(response).trim()) throw new Error('Provider returned an empty response');
  return { ok: true, provider: config.provider, model: config.model, latencyMs: Date.now() - started };
}

export { configuredTimeout, messageText };
