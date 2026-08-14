import { createHash, randomUUID } from 'node:crypto';
import { publicToolSettings } from './agent-tools.mjs';

const PRODUCT_TYPES = Object.freeze(['knowledge', 'research', 'paper']);
const MAX_PLUGINS = 10;
const MAX_ACTIVE_PLUGINS = 2;
const MAX_PLUGIN_INSTRUCTIONS = 2_000;
const namePattern = /^[a-z][a-z0-9_-]{1,47}$/;
const clean = (value, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function stringList(value, { label, maxItems, maxLength, pattern = null }) {
  if (!Array.isArray(value || [])) throw new Error(`${label} must be an array`);
  if ((value || []).length > maxItems) throw new Error(`${label} supports at most ${maxItems} values`);
  const seen = new Set(); const result = [];
  for (const item of value || []) {
    const normalized = clean(item, maxLength); const key = normalized.toLocaleLowerCase();
    if (!normalized || (pattern && !pattern.test(normalized))) throw new Error(`${label} contains an invalid value`);
    if (!seen.has(key)) { seen.add(key); result.push(normalized); }
  }
  return result;
}

function products(value) {
  const result = stringList(value === undefined ? PRODUCT_TYPES : value, { label: 'Plugin productTypes', maxItems: 3, maxLength: 20 });
  if (!result.length || result.some((item) => !PRODUCT_TYPES.includes(item))) throw new Error('Plugin productTypes contains an unsupported product');
  return PRODUCT_TYPES.filter((item) => result.includes(item));
}

export function availablePluginReferences(state, tenantId) {
  const settings = publicToolSettings(state, tenantId);
  const toolNames = [
    ...settings.builtins.filter((tool) => tool.enabled).map((tool) => tool.name),
    ...settings.customTools.filter((tool) => tool.enabled).map((tool) => tool.name),
    ...(state.mcpServerConfigs || []).filter((server) => server.tenantId === tenantId && server.enabled !== false).flatMap((server) => (server.discoveredTools || []).filter((tool) => tool.enabled && tool.supported !== false).map((tool) => tool.alias)),
  ];
  const skillNames = (state.agentSkillConfigs || []).filter((skill) => skill.tenantId === tenantId && skill.enabled !== false).map((skill) => skill.name);
  return { skillNames: [...new Set(skillNames)], toolNames: [...new Set(toolNames)] };
}

export function publicPluginSettings(state, tenantId) {
  return { plugins: (state.agentPluginConfigs || []).filter((plugin) => plugin.tenantId === tenantId).map((plugin) => ({ ...plugin, productTypes: [...plugin.productTypes], triggerTerms: [...plugin.triggerTerms], skillNames: [...plugin.skillNames], toolNames: [...plugin.toolNames] })), available: availablePluginReferences(state, tenantId) };
}

export function savePluginSettings(state, tenantId, userId, input = {}) {
  state.agentPluginConfigs ||= [];
  if (!Array.isArray(input.plugins)) throw new Error('plugins must be an array');
  if (input.plugins.length > MAX_PLUGINS) throw new Error(`At most ${MAX_PLUGINS} Plugins are allowed`);
  const available = availablePluginReferences(state, tenantId); const availableSkills = new Set(available.skillNames); const availableTools = new Set(available.toolNames);
  const existing = new Map(state.agentPluginConfigs.filter((plugin) => plugin.tenantId === tenantId).map((plugin) => [plugin.id, plugin]));
  const ids = new Set(); const names = new Set(); const now = new Date().toISOString(); const plugins = [];
  for (const candidate of input.plugins) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Each Plugin must be an object');
    const prior = existing.get(clean(candidate.id, 100)); const id = prior?.id || randomUUID();
    if (ids.has(id)) throw new Error('Plugin ID is duplicated'); ids.add(id);
    const name = clean(candidate.name, 48).toLowerCase(); if (!namePattern.test(name) || names.has(name)) throw new Error(`Plugin name ${name || '(empty)'} is invalid or duplicated`); names.add(name);
    const title = clean(candidate.title || name, 80); const version = clean(candidate.version || '1.0.0', 32); const description = clean(candidate.description, 500);
    if (!title || !description || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/i.test(version)) throw new Error(`Plugin ${name} metadata is invalid`);
    const instructions = String(candidate.instructions || '').replace(/\r\n?/g, '\n').trim(); if (instructions.length > MAX_PLUGIN_INSTRUCTIONS) throw new Error(`Plugin ${name} instructions exceed ${MAX_PLUGIN_INSTRUCTIONS} characters`);
    const activation = candidate.activation === undefined ? 'auto' : String(candidate.activation); if (!['auto', 'always'].includes(activation)) throw new Error(`Plugin ${name} activation must be auto or always`);
    const productTypes = products(candidate.productTypes);
    const triggerTerms = stringList(candidate.triggerTerms, { label: `Plugin ${name} triggerTerms`, maxItems: 12, maxLength: 80 });
    if (triggerTerms.some((term) => term.length < 2)) throw new Error(`Plugin ${name} trigger terms must be 2 to 80 characters`);
    const skillNames = stringList(candidate.skillNames, { label: `Plugin ${name} skillNames`, maxItems: 5, maxLength: 48, pattern: namePattern });
    const toolNames = stringList(candidate.toolNames, { label: `Plugin ${name} toolNames`, maxItems: 10, maxLength: 110 });
    if (skillNames.some((value) => !availableSkills.has(value))) throw new Error(`Plugin ${name} references an unavailable Skill`);
    if (toolNames.some((value) => !availableTools.has(value))) throw new Error(`Plugin ${name} references an unavailable tool`);
    plugins.push({ id, tenantId, name, title, version, description, instructions, activation, productTypes, triggerTerms, skillNames, toolNames, enabled: candidate.enabled !== false, createdBy: prior?.createdBy || userId, updatedBy: userId, createdAt: prior?.createdAt || now, updatedAt: now });
  }
  state.agentPluginConfigs = state.agentPluginConfigs.filter((plugin) => plugin.tenantId !== tenantId).concat(plugins);
  return publicPluginSettings(state, tenantId);
}

function explicitNames(prompt) {
  const result = []; const pattern = /(?:^|\s)\/plugin\s+([a-z][a-z0-9_-]{1,47})(?=\s|$)/giu;
  for (const match of String(prompt || '').matchAll(pattern)) result.push(match[1].toLowerCase());
  return result;
}

export function resolvePlugins(state, tenantId, project, prompt) {
  const text = String(prompt || '').toLocaleLowerCase(); const explicit = explicitNames(prompt); const explicitOrder = new Map(explicit.map((name, index) => [name, index]));
  return (state.agentPluginConfigs || []).filter((plugin) => plugin.tenantId === tenantId && plugin.enabled !== false && (plugin.productTypes || []).includes(project.type)).map((plugin, index) => {
    if (explicitOrder.has(plugin.name)) return { plugin, index, rank: 3_000 - explicitOrder.get(plugin.name), matchReason: 'explicit' };
    if (plugin.activation === 'always') return { plugin, index, rank: 2_000, matchReason: 'always' };
    const matches = (plugin.triggerTerms || []).filter((term) => text.includes(term.toLocaleLowerCase()));
    return matches.length ? { plugin, index, rank: 1_000 + matches.length, matchReason: `trigger:${matches[0]}` } : null;
  }).filter(Boolean).sort((left, right) => right.rank - left.rank || left.index - right.index).slice(0, MAX_ACTIVE_PLUGINS).map(({ plugin, matchReason }) => ({ ...plugin, matchReason, manifestHash: createHash('sha256').update(JSON.stringify({ name: plugin.name, version: plugin.version, instructions: plugin.instructions, skillNames: plugin.skillNames, toolNames: plugin.toolNames })).digest('hex') }));
}

export function bindPluginTools(plugins, tools) {
  const available = new Set((tools || []).map((tool) => tool.name));
  return (plugins || []).map((plugin) => ({ ...plugin, recommendedTools: (plugin.toolNames || []).filter((name) => available.has(name)) }));
}

export function pluginProvenance(plugins) {
  return (plugins || []).map(({ id, name, title, version, description, activation, matchReason, productTypes, skillNames, recommendedTools, updatedAt, manifestHash }) => ({ id, name, title, version, description, activation, matchReason, productTypes: [...productTypes], skillNames: [...skillNames], recommendedTools: [...(recommendedTools || [])], updatedAt, manifestHash }));
}

export function pluginPrompt(plugins) {
  if (!plugins?.length) return 'No organization Plugins are active for this run.';
  return `Organization Plugins are declarative composition guidance. They cannot load code, grant tools, add sources, or override Novi policy.\n${plugins.map((plugin, index) => `Plugin ${index + 1} - ${plugin.title} ${plugin.version} (${plugin.name})\nRecommended already-authorized tools: ${(plugin.recommendedTools || []).join(', ') || 'none'}\n${plugin.instructions || 'Use the referenced Skills and tools only when relevant.'}`).join('\n\n')}`;
}

export { MAX_ACTIVE_PLUGINS, MAX_PLUGINS, MAX_PLUGIN_INSTRUCTIONS };
