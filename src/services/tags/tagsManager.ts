import type { Tag } from '@/types/tag';
import * as feedStore from '@/stores/feedStore';

class TagsManager {
  async getAllTags(): Promise<Tag[]> {
    const rows = await feedStore.tags.listWithFeedIds();
    return rows.map((row) => ({
      name: row.name,
      feedIds: row.feedIds ?? [],
      color: row.color ?? undefined,
      createdAt: row.createdAt,
      emoji: row.emoji ?? undefined,
      sortOrder: row.sortOrder,
    }));
  }

  async saveTag(tag: Tag): Promise<void> {
    await feedStore.tags.upsert({
      tag: {
        name: tag.name,
        color: tag.color ?? null,
        emoji: tag.emoji ?? null,
        createdAt: tag.createdAt,
        sortOrder: tag.sortOrder ?? 0,
      },
    });
  }

  async updateTag(tagName: string, updates: Partial<Tag>): Promise<Tag | null> {
    await feedStore.tags.update({
      name: tagName,
      updates: {
        color: updates.color ?? null,
        emoji: updates.emoji ?? null,
        sortOrder: updates.sortOrder,
      },
    });

    const tags = await this.getAllTags();
    return tags.find((tag) => tag.name === tagName) ?? null;
  }

  async addTagToFeed(feedId: string, tagName: string): Promise<void> {
    await feedStore.tags.attachFeed({ feedId, tagName });
  }

  async removeTagFromFeed(feedId: string, tagName: string): Promise<void> {
    await feedStore.tags.detachFeed({ feedId, tagName });
  }

  async getFeedsByTag(tagName: string): Promise<string[]> {
    return feedStore.tags.listFeedIds({ tagName });
  }

  async deleteTag(tagName: string): Promise<void> {
    await feedStore.tags.delete({ name: tagName });
  }

  async renameTag(currentName: string, nextName: string): Promise<void> {
    await feedStore.tags.rename({ currentName, nextName });
  }
}

export const tagsManager = new TagsManager();
