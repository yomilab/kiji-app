import React from 'react';
import { motion } from 'motion/react';
import '../../MainArea/ArticleView.css';

export const ArticleContentSkeleton: React.FC = () => {
  // Generate enough paragraphs to fill the content height for most screens
  const paragraphs = Array.from({ length: 20 }, (_, i) => {
    // Vary the line counts and end-line widths for a more natural look
    const lineCount = 3 + (i % 3);
    const endLineWidth = 60 + (i % 4) * 10; // 60, 70, 80, 90

    return (
      <div key={i} className="article-skeleton-paragraph">
        {Array.from({ length: lineCount - 1 }, (_, j) => (
          <div key={j} className="skeleton-placeholder skeleton-line" />
        ))}
        <div className={`skeleton-placeholder skeleton-line skeleton-line-${endLineWidth}`} />
      </div>
    );
  });

  return (
    <motion.div
      className="article-skeleton-body"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {paragraphs}
    </motion.div>
  );
};
