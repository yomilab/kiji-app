declare module 'turndown' {
  interface TurndownServiceOptions {
    headingStyle?: 'setext' | 'atx';
    codeBlockStyle?: 'indented' | 'fenced';
  }

  export default class TurndownService {
    constructor(options?: TurndownServiceOptions);
    turndown(input: string): string;
  }
}
