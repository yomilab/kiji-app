declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const source: string;
  export default source;
}

declare module 'lite-youtube-embed/src/lite-yt-embed.js';
