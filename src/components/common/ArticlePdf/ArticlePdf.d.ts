import React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'article-pdf': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export {};
