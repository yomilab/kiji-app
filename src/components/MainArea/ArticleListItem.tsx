import { memo, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { motion } from 'motion/react';
import StarIcon from '@mui/icons-material/Star';
import type { Article } from '@/types/article';
import { renderHighlightedTextWithNonAsciiFont } from '@/utils/nonAsciiTypography';
import { getArticleListRowSignature } from './articleListRowSignature';

const isBase64DataUrl = (str: string): boolean => str.startsWith('data:');

// Article-list favicon chip is an in-flow leading column on the title row.
const ArticleListFavicon = ({
  localFavicon,
  alt = '',
  itemId,
}: {
  localFavicon?: string;
  alt?: string;
  itemId?: string;
}): ReactElement => {
  const [errored, setErrored] = useState(false);
  const showImage = !!localFavicon && isBase64DataUrl(localFavicon) && !errored;

  return (
    <span
      className={`article-list-favicon-container${showImage ? '' : ' is-fallback'}`}
      aria-hidden={!showImage || undefined}
    >
      {showImage ? (
        <img
          className="article-list-favicon-img"
          src={localFavicon}
          alt={alt}
          onError={() => {
            console.warn('[ArticleListFavicon] Failed to load favicon for:', itemId);
            setErrored(true);
          }}
        />
      ) : (
        <span className="article-list-favicon-fallback">
          <StarIcon sx={{ fontSize: '0.9rem' }} />
        </span>
      )}
    </span>
  );
};

interface ArticleListItemProps {
  article: Article;
  isActive: boolean;
  isNew: boolean;
  newAnimationOrder: number;
  enableLayoutAnimation?: boolean;
  readStateMode?: 'normal' | 'none';
  searchQuery?: string;
  deferPreviewImages?: boolean;
  onSelect: (hash: string) => void;
  formatDateDisplay: (dateString: string) => string;
}

export const ArticleListItem = memo<ArticleListItemProps>(
  ({
    article,
    isActive,
    isNew,
    newAnimationOrder,
    enableLayoutAnimation = true,
    readStateMode = 'normal',
    searchQuery = '',
    deferPreviewImages = false,
    onSelect,
    formatDateDisplay
  }) => {
    const staggerDelay = isNew && newAnimationOrder >= 0 ? Math.min(newAnimationOrder, 16) * 0.03 : 0;

    const readClass = readStateMode === 'none'
      ? ''
      : article.read
        ? 'is-read'
        : 'is-unread';

    const previewImageUrl = article.previewImage;
    const [imageError, setImageError] = useState(false);
    const [previewLoaded, setPreviewLoaded] = useState(false);

    const previewImageRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
      setImageError(false);
      setPreviewLoaded(false);
    }, [previewImageUrl]);

    const shouldAssignPreviewSrc = previewImageUrl
      && !imageError
      && (!deferPreviewImages || previewLoaded);
    const previewImageSrc = shouldAssignPreviewSrc ? previewImageUrl : undefined;

    useEffect(() => {
      if (!previewImageSrc) {
        return;
      }
      const image = previewImageRef.current;
      if (image?.complete && image.naturalWidth > 0) {
        setPreviewLoaded(true);
      }
    }, [previewImageSrc]);

    const previewImageClassName = [
      'article-list-item-preview-image',
      previewLoaded ? 'is-loaded' : 'is-placeholder',
    ].join(' ');
    const publishedDateLabel = article.publishedDate ? formatDateDisplay(article.publishedDate) : '';

    return (
      <div
        className={`article-list-item ${isActive ? 'is-active' : ''} ${readClass} ${isNew ? 'is-new-article' : ''}`}
        onClick={() => {
          onSelect(article.hash);
        }}
        tabIndex={0}
        data-section="article-item"
        data-component="article-card"
        data-action="select-article"
        data-entity-id={article.hash}
      >
        <motion.div
          layout={enableLayoutAnimation}
          initial={isNew ? { opacity: 0.05, scale: 0.985 } : false}
          animate={
            isNew
              ? { opacity: [0.05, 1], scale: [0.985, 1] }
              : { opacity: 1, scale: 1 }
          }
          transition={{
            layout: { duration: 0.46, ease: [0.22, 1, 0.36, 1] },
            opacity: isNew
              ? { duration: 0.44, ease: 'easeOut', delay: staggerDelay }
              : { duration: 0.2 },
            scale: isNew
              ? { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: staggerDelay }
              : { duration: 0.3, ease: 'easeOut' },
          }}
          className="article-list-item-content"
        >
          {article.feedTitle && (
            <div className="article-list-item-source-wrapper" data-section="article-item-source-name">
              <div className="article-list-item-source-left">
                <span className="article-list-item-source-text" data-section="article-source-title">
                  {renderHighlightedTextWithNonAsciiFont(article.feedTitle, searchQuery, `${article.hash}-feed-title`)}
                </span>
              </div>
              {article.publishedDate && (
                <span className="article-list-item-date">
                  {new Date(article.publishedDate).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                  {publishedDateLabel ? ` ${publishedDateLabel}` : ''}
                </span>
              )}
            </div>
          )}
          <div className="article-list-item-main">
            <div className="article-list-item-text">
              <div className="article-list-item-header">
                <ArticleListFavicon
                  localFavicon={article.feedFavicon}
                  alt={article.feedTitle || article.title}
                  itemId={article.hash}
                />
                <h3 className="article-list-item-title">
                  {renderHighlightedTextWithNonAsciiFont(article.title, searchQuery, `${article.hash}-title`)}
                </h3>
              </div>
              {article.description && (
                <div className="article-list-item-description">
                  {renderHighlightedTextWithNonAsciiFont(article.description, searchQuery, `${article.hash}-description`)}
                </div>
              )}
            </div>
            {previewImageUrl && !imageError && (
              <div className={previewImageClassName} aria-hidden="true">
                <img
                  ref={previewImageRef}
                  className="article-list-item-preview-image-content"
                  src={previewImageSrc}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onLoad={() => setPreviewLoaded(true)}
                  onError={() => setImageError(true)}
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Keep comparator maintainable: compare one row-level render signature
    // instead of repeating many display field checks inline.
    const prevRowSignature = getArticleListRowSignature(prevProps.article);
    const nextRowSignature = getArticleListRowSignature(nextProps.article);

    return (
      prevRowSignature === nextRowSignature &&
      prevProps.isActive === nextProps.isActive &&
      prevProps.isNew === nextProps.isNew &&
      prevProps.enableLayoutAnimation === nextProps.enableLayoutAnimation &&
      prevProps.readStateMode === nextProps.readStateMode &&
      prevProps.searchQuery === nextProps.searchQuery &&
      prevProps.deferPreviewImages === nextProps.deferPreviewImages &&
      prevProps.newAnimationOrder === nextProps.newAnimationOrder
    );
  }
);

ArticleListItem.displayName = 'ArticleListItem';
