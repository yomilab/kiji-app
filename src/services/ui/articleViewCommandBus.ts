/**
 * Commands for the open article view that come from outside its own keyboard
 * handler (the ⌘K palette). The article view applies the same guards as its
 * shortcut, so a command with nothing to act on is a no-op.
 */
export type ArticleViewCommand = 'toggleReaderMode';

type ArticleViewCommandListener = (command: ArticleViewCommand) => void;

const listeners = new Set<ArticleViewCommandListener>();

export function subscribeArticleViewCommand(listener: ArticleViewCommandListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishArticleViewCommand(command: ArticleViewCommand): void {
  for (const listener of listeners) {
    listener(command);
  }
}
