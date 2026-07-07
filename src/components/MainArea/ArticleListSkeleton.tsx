import React from 'react';
import { motion } from 'motion/react';
import './ArticleList.css';

interface ArticleListSkeletonProps {
  className?: string;
}

export const ArticleListHeaderSkeleton: React.FC = () => {
  return (
    <div className="article-list-header-skeleton">
      <div className="article-list-title" style={{ display: 'flex', alignItems: 'center', height: '1.2em' }}>
        <div className="skeleton-placeholder skeleton-header-title" />
      </div>
      <div className="article-list-subtitle" style={{ display: 'flex', alignItems: 'center', height: '1.2em' }}>
        <div className="skeleton-placeholder skeleton-header-subtitle" />
      </div>
    </div>
  );
};

export const ArticleListSkeleton: React.FC<ArticleListSkeletonProps> = ({ className }) => {
  const rootClassName = className
    ? `article-list-item skeleton-item ${className}`
    : 'article-list-item skeleton-item';

  return (
    <div className={rootClassName}>
      <div className="article-list-item-content">
        <div className="article-list-item-source-wrapper">
          <div className="article-list-item-source-left">
            <div className="skeleton-placeholder skeleton-source" />
          </div>
          <div className="skeleton-placeholder skeleton-date" />
        </div>
        <div className="article-list-item-main">
          <div className="article-list-item-text">
            <div className="article-list-item-header">
              <div className="skeleton-placeholder skeleton-favicon" aria-hidden="true" />
              <div className="skeleton-placeholder skeleton-title" />
            </div>
            <div className="skeleton-placeholder skeleton-description" />
            <div className="skeleton-placeholder skeleton-description-short" />
          </div>
          <div className="skeleton-placeholder skeleton-image" />
        </div>
      </div>
    </div>
  );
};

export const ArticleListSkeletonGroup = React.forwardRef<HTMLDivElement, { count?: number; animateEntry?: boolean }>(
  ({ count = 6, animateEntry = true }, ref) => {
    const items = Array.from({ length: count }).map((_, i) => (
      <ArticleListSkeleton key={i} />
    ));

    if (!animateEntry) {
      return (
        <div ref={ref} className="article-list-skeleton-group" style={{ width: '100%' }}>
          {items}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        className="article-list-skeleton-group"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{ width: '100%' }}
      >
        {items}
      </motion.div>
    );
  }
);

ArticleListSkeletonGroup.displayName = 'ArticleListSkeletonGroup';
