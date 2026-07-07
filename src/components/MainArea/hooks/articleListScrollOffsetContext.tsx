import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

interface ArticleListScrollOffsetContextValue {
  hasListScrollOffset: boolean;
  setHasListScrollOffset: Dispatch<SetStateAction<boolean>>;
}

const ArticleListScrollOffsetContext = createContext<ArticleListScrollOffsetContextValue | null>(null);

export function ArticleListScrollOffsetProvider({ children }: { children: ReactNode }) {
  const [hasListScrollOffset, setHasListScrollOffset] = useState(false);
  const value = useMemo(
    () => ({ hasListScrollOffset, setHasListScrollOffset }),
    [hasListScrollOffset],
  );

  return (
    <ArticleListScrollOffsetContext.Provider value={value}>
      {children}
    </ArticleListScrollOffsetContext.Provider>
  );
}

export function useArticleListScrollOffset(): ArticleListScrollOffsetContextValue {
  const context = useContext(ArticleListScrollOffsetContext);
  if (!context) {
    throw new Error('useArticleListScrollOffset must be used within ArticleListScrollOffsetProvider');
  }
  return context;
}
