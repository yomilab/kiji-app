import React from 'react';
import { useFeedCollection, useFeedOverlay } from '@/contexts/FeedContext';
import CloseIcon from '@mui/icons-material/Close';
import './ArticleViewModal.css';

interface ArticleViewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArticleViewModal: React.FC<ArticleViewModalProps> = ({ isOpen, onClose }) => {
  const { articles } = useFeedCollection();
  const { activeArticleHash } = useFeedOverlay();

  if (!isOpen || !activeArticleHash) {
    return null;
  }

  const selectedArticle = articles.find((article) => article.hash === activeArticleHash);

  if (!selectedArticle) {
    return null;
  }

  return (
    <>
      <div className="article-view-modal-backdrop" onClick={onClose} />
      <div className="article-view-modal">
        <div className="article-view-modal-header">
          <button
            className="article-view-modal-close"
            onClick={onClose}
            aria-label="Close article view"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="article-view-modal-content">
          <article className="article-view-article">
            <header className="article-view-header mb-5">
              <h1 className="article-view-title theme-text-primary">
                {selectedArticle.title}
              </h1>
              <div className="article-view-meta">
                {selectedArticle.author && (
                  <span className="article-view-author theme-text-secondary">
                    {selectedArticle.author}
                  </span>
                )}
                {selectedArticle.author && selectedArticle.publishedDate && (
                  <span className="theme-text-tertiary mx-2">•</span>
                )}
                {selectedArticle.publishedDate && (
                  <time className="article-view-date theme-text-secondary">
                    {new Date(selectedArticle.publishedDate).toLocaleDateString()}
                  </time>
                )}
              </div>
            </header>

            {selectedArticle.content ? (
              <div
                className="article-view-content theme-text-primary"
                dangerouslySetInnerHTML={{ __html: selectedArticle.content }}
              />
            ) : (
              <p className="theme-text-secondary">No content available for this article.</p>
            )}

            {selectedArticle.link && (
              <footer className="article-view-footer mt-5">
                <a
                  href={selectedArticle.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="article-view-link"
                >
                  Read original article →
                </a>
              </footer>
            )}
          </article>
        </div>
      </div>
    </>
  );
};
