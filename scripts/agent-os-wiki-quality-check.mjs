import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateArtifact } from '../src/engine.mjs';
import { assessWikiQuality } from '../src/wiki-quality.mjs';

const project = {
  id: 'agent-os-quality-audit',
  title: 'Agent OS 技术栈深度调查',
  topic: 'Agent OS 技术栈',
  description: '深度调查自主 Agent runtime、工具系统、MCP、Skills、权限、记忆、评估与生产部署最佳实践和算法。',
  type: 'research',
  wikiLanguage: 'zh-CN',
};

const artifact = generateArtifact(project, { prompt: '以深度调查 Agent OS 技术栈，输出详细的 LLM Wiki' });
const audit = assessWikiQuality(artifact, { topic: project.topic, requireAgentOs: true });
const lines = [
  '# Agent OS LLM Wiki 质量审计',
  '',
  `- 审计时间：${audit.generatedAt}`,
  '- 主题：以深度调查 Agent OS 技术栈，输出详细的 LLM Wiki',
  '- Provider：offline deterministic baseline（不代表真实 LLM 供应商质量）',
  '- 实时来源：未启用；所有事实性主张保持 `unverified`',
  '',
  '## 结论',
  '',
  `- 结构/技术门禁：${audit.pass ? '通过' : '失败'}`,
  `- 综合分：${audit.overall}`,
  `- 可发布候选：${audit.publicationReady ? '是' : '否'}`,
  `- 建议：${audit.recommendation}`,
  '',
  '## 质量维度',
  '',
  '| 维度 | 分数 |',
  '| --- | ---: |',
  ...Object.entries(audit.dimensions).map(([name, value]) => `| ${name} | ${value} |`),
  '',
  '## Deep Dive 统计',
  '',
  '| 文档 | 总字符 | 六节字符数 |',
  '| --- | ---: | --- |',
  ...audit.deepDive.map((document) => `| ${document.slug} | ${document.totalCharacters} | ${document.sectionLengths.join(', ')} |`),
  '',
  '## 专题覆盖',
  '',
  `- Agent OS 术语命中：${audit.termCoverage.count}`,
  `- Runtime/框架命中：${audit.runtimeCoverage.count}（${audit.runtimeCoverage.hits.join(', ')}）`,
  `- evidence status：\`${audit.evidence.status}\``,
  `- 已映射来源：${audit.evidence.mappedSources}`,
  `- 已映射 claims：${audit.evidence.mappedClaims}/${audit.evidence.totalClaims}`,
  '',
  '## 硬门禁失败项',
  '',
  ...(audit.hardFailures.length ? audit.hardFailures.map((failure) => `- ${failure}`) : ['- 无']),
  '',
  '## 解释',
  '',
  '本审计将“文档存在、章节数量正确、字数足够”和“专业研究已经被证据支持”分开处理。离线基线可以通过结构和技术覆盖门禁，但没有真实受控来源时不能标记为 publication-ready。真实 MiniMax/其他 Provider、实时论文/GitHub/Web 来源和领域专家抽检仍需单独验收。',
  '',
];
await mkdir('docs', { recursive: true });
await writeFile(join('docs', 'agent-os-wiki-quality-audit.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(`agent-os-wiki-quality-check: pass=${audit.pass}, publicationReady=${audit.publicationReady}, overall=${audit.overall}, documents=${audit.deepDive.length}`);
