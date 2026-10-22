type Listener = () => void;

const listeners = new Set<Listener>();

/** Lightweight "an article's read state changed" ping for counts that aren't per feed (Today). */
export const subscribeArticleReadChanged = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notifyArticleReadChanged = (): void => {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('Article read listener failed:', error);
    }
  }
};
