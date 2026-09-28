import { matchesCustomPatterns } from './matching';
import { Provider } from './providers';

export const AGENT_COMMANDS = {
  addFiles: 'autumnContextBridge.addFilesToAgent',
  sendSelection: 'autumnContextBridge.sendSelectionToAgent',
  designate: 'autumnContextBridge.setAsAgentTerminal',
  selectTerminal: 'autumnContextBridge.selectAgentTerminal',
} as const;

export interface AgentConfig {
  id: string;
  name: string;
  terminalNamePatterns: string[];
  fileReferenceTemplate: string;
  selectionReferenceTemplate: string;
}

export const OMP: Provider = {
  id: 'omp',
  name: 'OMP',
  statusBarPriority: 48,
  designateTitle: 'Set as Agent Terminal',
  commands: AGENT_COMMANDS,
  matchesTerminalName: (name) => /(^|[^a-z])omp([^a-z]|$)|oh.my.pi/i.test(name),
  formatFileRef: (path) => formatOmpPath(path),
  formatSelectionRef: (path, start, end) =>
    `${formatOmpPath(path)}#L${start === end ? start : `${start}-${end}`}`,
};

function formatOmpPath(path: string): string {
  if (!/[\s@]/.test(path)) return `@${path}`;
  if (!path.includes('"')) return `@"${path}"`;
  if (!path.includes("'")) return `@'${path}'`;
  return `@${path}`;
}

export function formatReferenceTemplate(
  template: string,
  path: string,
  startLine?: number,
  endLine?: number,
): string {
  const values: Record<string, string> = {
    path,
    startLine: String(startLine ?? ''),
    endLine: String(endLine ?? ''),
    lineRange: startLine === undefined ? '' : startLine === endLine
      ? String(startLine)
      : `${startLine}-${endLine}`,
  };
  return template.replace(/\{(path|startLine|endLine|lineRange)\}/g, (_, key: string) => values[key]);
}

export function parseCustomAgents(value: unknown): { providers: Provider[]; errors: string[] } {
  const providers: Provider[] = [];
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    return { providers, errors: ['agents must be an array.'] };
  }

  const ids = new Set(['claude', 'codex', 'omp']);
  for (const [index, entry] of value.entries()) {
    const label = `agents[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const agent = entry as Record<string, unknown>;
    const { id, name, terminalNamePatterns, fileReferenceTemplate, selectionReferenceTemplate } = agent;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) {
      errors.push(`${label}.id must be a unique lowercase ID distinct from claude, codex, and omp.`);
      continue;
    }
    if (typeof name !== 'string' || !name.trim()) {
      errors.push(`${label}.name must be a nonempty string.`);
      continue;
    }
    if (!Array.isArray(terminalNamePatterns) || !terminalNamePatterns.every((pattern) => typeof pattern === 'string')) {
      errors.push(`${label}.terminalNamePatterns must be an array of regex strings.`);
      continue;
    }
    try {
      terminalNamePatterns.forEach((pattern) => new RegExp(pattern, 'i'));
    } catch {
      errors.push(`${label}.terminalNamePatterns contains an invalid regex.`);
      continue;
    }
    if (typeof fileReferenceTemplate !== 'string' || !fileReferenceTemplate.includes('{path}') ||
      typeof selectionReferenceTemplate !== 'string' || !selectionReferenceTemplate.includes('{path}')) {
      errors.push(`${label} needs fileReferenceTemplate and selectionReferenceTemplate containing {path}.`);
      continue;
    }
    if (/\{[^{}]+\}/.test(fileReferenceTemplate.replace(/\{path\}/g, '')) ||
      /\{[^{}]+\}/.test(selectionReferenceTemplate.replace(/\{(path|startLine|endLine|lineRange)\}/g, ''))) {
      errors.push(`${label} contains an unknown template placeholder.`);
      continue;
    }
    ids.add(id);
    const config = agent as unknown as AgentConfig;
    providers.push({
      id: config.id,
      name: config.name,
      statusBarPriority: 48,
      designateTitle: 'Set as Agent Terminal',
      commands: AGENT_COMMANDS,
      matchesTerminalName: (title) => matchesCustomPatterns(title, config.terminalNamePatterns),
      formatFileRef: (path) => formatReferenceTemplate(config.fileReferenceTemplate, path),
      formatSelectionRef: (path, start, end) =>
        formatReferenceTemplate(config.selectionReferenceTemplate, path, start, end),
    });
  }
  return { providers, errors };
}
