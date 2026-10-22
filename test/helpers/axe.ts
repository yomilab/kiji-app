import axe from 'axe-core';

export interface AxeFinding {
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
}

/**
 * Runs axe-core on a rendered subtree and returns serious/critical findings.
 * jsdom has no layout or paint, so rules that need real rendering are off
 * (color-contrast) and page-level rules that a component fixture cannot meet
 * (landmarks, page title, html lang) are skipped.
 */
export async function findSeriousAxeViolations(root: Element): Promise<AxeFinding[]> {
  const result = await axe.run(root, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
      'document-title': { enabled: false },
      'html-has-lang': { enabled: false },
    },
    resultTypes: ['violations'],
  });
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}
