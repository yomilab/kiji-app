import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import './TagEditModal.css';

interface TagEditModalProps {
  feedId: string;
  onClose: () => void;
  onTagsChanged: () => void;
}

export const TagEditModal: React.FC<TagEditModalProps> = ({ feedId, onClose, onTagsChanged }) => {
  const [currentTags, setCurrentTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      const feed = await feedsManager.getFeedById(feedId);
      if (feed) {
        setCurrentTags(feed.tags || []);
      }

      const tags = await tagsManager.getAllTags();
      setAllTags(tags.map((t) => t.name));
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  }, [feedId]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const publishTagMutations = useCallback(async (tagName: string) => {
    const [updatedFeed, allTags] = await Promise.all([
      feedsManager.getFeedById(feedId),
      tagsManager.getAllTags(),
    ]);
    if (updatedFeed) {
      feedLibraryMutationBus.publishFeedPatched(feedId, { tags: updatedFeed.tags });
    }

    const updatedTag = allTags.find((tag) => tag.name === tagName);
    if (updatedTag) {
      feedLibraryMutationBus.publishStationPatched(tagName, {
        name: updatedTag.name,
        emoji: updatedTag.emoji,
        feedIds: updatedTag.feedIds,
        createdAt: updatedTag.createdAt,
        sortOrder: updatedTag.sortOrder,
      });
    }
  }, [feedId]);

  const handleAddTag = async (tagName: string) => {
    if (!tagName.trim() || currentTags.includes(tagName)) {
      return;
    }

    try {
      setIsLoading(true);
      await tagsManager.addTagToFeed(feedId, tagName);
      setCurrentTags([...currentTags, tagName]);
      setNewTagInput('');
      await publishTagMutations(tagName);
      onTagsChanged();
    } catch (error) {
      console.error('Error adding tag:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    try {
      setIsLoading(true);
      await tagsManager.removeTagFromFeed(feedId, tagName);
      setCurrentTags(currentTags.filter((t) => t !== tagName));
      await publishTagMutations(tagName);
      onTagsChanged();
    } catch (error) {
      console.error('Error removing tag:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewTagSubmit = () => {
    if (newTagInput.trim()) {
      handleAddTag(newTagInput.trim());
    }
  };

  const suggestedTags = allTags.filter((tag) => !currentTags.includes(tag));
  const handleClose = () => {
    if (!isLoading) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={handleClose}
      maxWidth="480px"
      closeOnBackdrop={!isLoading}
      closeOnEscape={!isLoading}
    >
      <section className="tag-edit-modal-body">
        {currentTags.length > 0 && (
          <div className="tag-edit-section">
            <label className="tag-edit-label">Current Tags</label>
            <div className="tag-edit-pills">
              {currentTags.map((tag) => (
                <span key={tag} className="tag-pill">
                  {tag}
                  <button
                    className="tag-pill-remove"
                    onClick={() => handleRemoveTag(tag)}
                    disabled={isLoading}
                    title="Remove tag"
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="tag-edit-section">
          <label className="tag-edit-label">Add Tag</label>
          <div className="modal-input-row tag-edit-input-group">
            <input
              type="text"
              className="tag-edit-input modal-input"
              placeholder="Enter tag name..."
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleNewTagSubmit();
                }
              }}
              disabled={isLoading}
            />
            <button
              className="modal-confirm-button tag-edit-add-btn"
              onClick={handleNewTagSubmit}
              disabled={!newTagInput.trim() || isLoading}
              type="button"
            >
              Add
            </button>
          </div>
        </div>

        {suggestedTags.length > 0 && (
          <div className="tag-edit-section">
            <label className="tag-edit-label">Suggested Tags</label>
            <div className="tag-edit-suggestions">
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  className="tag-edit-suggestion-btn"
                  onClick={() => handleAddTag(tag)}
                  disabled={isLoading}
                  type="button"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
};
