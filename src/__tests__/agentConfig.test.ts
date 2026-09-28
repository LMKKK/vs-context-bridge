import { describe, expect, it } from 'vitest';
import { formatReferenceTemplate, parseCustomAgents, OMP } from '../agentConfig';

describe('agent configuration', () => {
  it('formats single lines, ranges, and path placeholders', () => {
    expect(formatReferenceTemplate('@{path}#L{lineRange}', 'src/a.ts', 5, 5)).toBe('@src/a.ts#L5');
    expect(formatReferenceTemplate('@{path}#L{lineRange}', 'src/a.ts', 5, 9)).toBe('@src/a.ts#L5-9');
    expect(OMP.formatSelectionRef('src/a.ts', 5, 9)).toBe('@src/a.ts#L5-9');
    expect(OMP.formatSelectionRef('src/a.ts', 5, 5)).toBe('@src/a.ts#L5');
    expect(OMP.formatFileRef('src/my file.ts')).toBe('@"src/my file.ts"');
    expect(OMP.formatSelectionRef('src/my file.ts', 5, 9)).toBe('@"src/my file.ts"#L5-9');
  });

  it('rejects duplicate IDs, unknown placeholders, and invalid regex without losing valid entries', () => {
    const base = {
      name: 'Helper', terminalNamePatterns: ['helper'],
      fileReferenceTemplate: '@{path}', selectionReferenceTemplate: '@{path}:{lineRange}',
    };
    const { providers, errors } = parseCustomAgents([
      { ...base, id: 'helper' },
      { ...base, id: 'helper' },
      { ...base, id: 'bad-regex', terminalNamePatterns: ['['] },
      { ...base, id: 'bad-template', selectionReferenceTemplate: '{unknown}:{path}' },
    ]);
    expect(providers.map((provider) => provider.id)).toEqual(['helper']);
    expect(errors).toHaveLength(3);
    expect(providers[0].matchesTerminalName('HELPER', [])).toBe(true);
  });
});
