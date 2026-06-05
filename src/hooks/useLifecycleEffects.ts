import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

export const useMountEffect = (effect: () => void | (() => void)): void => {
  useEffect(effect, []);
};

export const useDependencyEffect = (
  effect: () => void | (() => void),
  dependencies: DependencyList
): void => {
  useEffect(effect, dependencies);
};

export const useUnmountEffect = (cleanup: () => void): void => {
  const cleanupRef = useRef(cleanup);

  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);

  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);
};

export const useResizeObserverEffect = <T extends HTMLElement>(
  elementRef: RefObject<T>,
  onResize: (element: T) => void
): void => {
  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    let frameId: number | null = null;

    const scheduleResize = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const currentElement = elementRef.current;
        if (!currentElement) {
          return;
        }

        onResize(currentElement);
      });
    };

    scheduleResize();

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [elementRef, onResize]);
};
