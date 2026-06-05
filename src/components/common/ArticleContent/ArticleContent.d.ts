import React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'article-content': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export {};
