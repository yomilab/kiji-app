import { memo, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { motion } from 'motion/react';
import StarIcon from '@mui/icons-material/Star';
import type { Article } from '@/types/article';
import { renderHighlightedTextWithNonAsciiFont } from '@/utils/nonAsciiTypography';
import { getArticleListRowSignature } from './articleListRowSignature';
import { isUsableImageUrl } from '@/utils/mediaUrl';
import { DEFAULT_ARTICLE_LIST_DENSITY, type ArticleListDensity } from '@/lib/articleListDensity';

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
  density?: ArticleListDensity;
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
    density = DEFAULT_ARTICLE_LIST_DENSITY,
    onSelect,
    formatDateDisplay
  }) => {
    const staggerDelay = isNew && newAnimationOrder >= 0 ? Math.min(newAnimationOrder, 16) * 0.03 : 0;

    const readClass = readStateMode === 'none'
      ? ''
      : article.read
        ? 'is-read'
        : 'is-unread';

    // Stored rows may still carry a podcast/video file as previewImage; never load it as an <img>.
    // Compact never renders a preview, so it never requests one either.
    const previewImageUrl = density !== 'compact' && isUsableImageUrl(article.previewImage)
      ? article.previewImage
      : undefined;
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
    const publishedTimeLabel = article.publishedDate
      ? new Date(article.publishedDate).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      : '';
    const hasPreviewImage = !!previewImageUrl && !imageError;
    // Large Images only changes rows that have an image; the rest stay Comfortable.
    const isLargeImageRow = density === 'large-images' && hasPreviewImage;
    const densityClass = density === 'compact'
      ? ' article-list-item--compact'
      : isLargeImageRow
        ? ' article-list-item--large-image'
        : '';

    const favicon = (
      <ArticleListFavicon
        localFavicon={article.feedFavicon}
        alt={article.feedTitle || article.title}
        itemId={article.hash}
      />
    );
    const title = (
      <h3 className="article-list-item-title">
        {renderHighlightedTextWithNonAsciiFont(article.title, searchQuery, `${article.hash}-title`)}
      </h3>
    );
    const feedTitle = article.feedTitle
      ? renderHighlightedTextWithNonAsciiFont(article.feedTitle, searchQuery, `${article.hash}-feed-title`)
      : null;
    const previewImage = hasPreviewImage ? (
      <div
        className={isLargeImageRow ? `${previewImageClassName} article-list-item-preview-image--large` : previewImageClassName}
        aria-hidden="true"
      >
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
    ) : null;

    return (
      <div
        className={`article-list-item ${isActive ? 'is-active' : ''} ${readClass} ${isNew ? 'is-new-article' : ''}${densityClass}`}
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
          {density === 'compact' ? (
            <div className="article-list-item-compact-row">
              {favicon}
              {title}
              {(feedTitle || article.publishedDate) && (
                <span className="article-list-item-compact-meta">
                  {feedTitle && (
                    <span className="article-list-item-source-text" data-section="article-source-title">
                      {feedTitle}
                    </span>
                  )}
                  {article.publishedDate && (
                    <span className="article-list-item-date">
                      {publishedDateLabel || publishedTimeLabel}
                    </span>
                  )}
                </span>
              )}
            </div>
          ) : (
            <>
              {isLargeImageRow && previewImage}
              {feedTitle && (
                <div className="article-list-item-source-wrapper" data-section="article-item-source-name">
                  <div className="article-list-item-source-left">
                    <span className="article-list-item-source-text" data-section="article-source-title">
                      {feedTitle}
                    </span>
                  </div>
                  {article.publishedDate && (
                    <span className="article-list-item-date">
                      {publishedTimeLabel}
                      {publishedDateLabel ? ` ${publishedDateLabel}` : ''}
                    </span>
                  )}
                </div>
              )}
              <div className="article-list-item-main">
                <div className="article-list-item-text">
                  <div className="article-list-item-header">
                    {favicon}
                    {title}
                  </div>
                  {article.description && (
                    <div className="article-list-item-description">
                      {renderHighlightedTextWithNonAsciiFont(article.description, searchQuery, `${article.hash}-description`)}
                    </div>
                  )}
                </div>
                {!isLargeImageRow && previewImage}
              </div>
            </>
          )}
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
      prevProps.density === nextProps.density &&
      prevProps.newAnimationOrder === nextProps.newAnimationOrder
    );
  }
);

ArticleListItem.displayName = 'ArticleListItem';
