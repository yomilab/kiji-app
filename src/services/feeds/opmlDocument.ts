const BARE_AMPERSAND_PATTERN = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g;

export const sanitizeOpmlXmlForParsing = (opmlText: string): string => (
  opmlText.replace(BARE_AMPERSAND_PATTERN, '&amp;')
);

type OpmlValidationFailure =
  | { kind: 'empty' }
  | { kind: 'not-opml' }
  | { kind: 'xml-parse'; message: string }
  | { kind: 'missing-body' };

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const getXmlParserErrorMessage = (xmlDoc: Document): string | null => {
  const parseError = xmlDoc.querySelector('parsererror');
  if (!parseError) {
    return null;
  }

  return compactWhitespace(parseError.textContent ?? '') || 'The file contains malformed XML.';
};

export const parseOpmlXmlDocument = (opmlText: string): Document => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(sanitizeOpmlXmlForParsing(opmlText), 'text/xml');
  const parserMessage = getXmlParserErrorMessage(xmlDoc);

  if (parserMessage) {
    throw new Error(`XML parse error: ${parserMessage}`);
  }

  return xmlDoc;
};

const toValidationErrorMessage = (
  failure: OpmlValidationFailure,
  emptyMessage = 'OPML file is empty.',
): string => {
  switch (failure.kind) {
    case 'empty':
      return emptyMessage;
    case 'not-opml':
      return 'URL does not appear to be an OPML file.';
    case 'xml-parse':
      return `XML parse error: ${failure.message}`;
    case 'missing-body':
      return 'Invalid OPML file: missing body section.';
    default:
      return 'Invalid OPML file.';
  }
};

export const getOpmlValidationFailure = (
  text: string,
): OpmlValidationFailure | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'empty' };
  }

  if (!/<opml[\s>]/i.test(trimmed)) {
    return { kind: 'not-opml' };
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(sanitizeOpmlXmlForParsing(trimmed), 'text/xml');
  const parserMessage = getXmlParserErrorMessage(xmlDoc);
  if (parserMessage) {
    return { kind: 'xml-parse', message: parserMessage };
  }

  if (!xmlDoc.querySelector('opml > body, body')) {
    return { kind: 'missing-body' };
  }

  return null;
};

export const assertValidOpmlText = (
  text: string,
  options: { emptyMessage?: string } = {},
): void => {
  const failure = getOpmlValidationFailure(text);
  if (!failure) {
    return;
  }

  throw new Error(toValidationErrorMessage(failure, options.emptyMessage));
};

export const isOpmlDocument = (text: string): boolean => (
  getOpmlValidationFailure(text) === null
);
