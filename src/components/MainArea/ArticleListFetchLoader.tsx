import { memo } from 'react';
import { motion } from 'motion/react';
import { FeedLineLoader } from '@/components/common/FeedLineLoader';

const TITLE_LOADER_FOLD_ANIMATION_SECONDS = 0.38;

export interface ArticleListFetchLoaderProps {
  shouldShow: boolean;
  label: string;
}

export const ArticleListFetchLoader = memo(function ArticleListFetchLoader({
  shouldShow,
  label,
}: ArticleListFetchLoaderProps) {
  return (
    <motion.div
      className="article-list-fixed-loader-shell"
      initial={false}
      animate={{
        opacity: shouldShow ? 1 : 0,
        y: shouldShow ? 0 : -14,
      }}
      transition={{ duration: TITLE_LOADER_FOLD_ANIMATION_SECONDS, ease: 'easeInOut' }}
      aria-hidden={!shouldShow}
    >
      <div className="article-list-fixed-loader">
        <FeedLineLoader
          size={18}
          variant="ring"
          color="var(--theme-primary-color)"
          ariaLabel={label}
        />
      </div>
    </motion.div>
  );
});
