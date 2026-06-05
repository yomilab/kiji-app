import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'article-content': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'feed-audio-player': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        title?: string;
      };
    }
  }
}

export {};
