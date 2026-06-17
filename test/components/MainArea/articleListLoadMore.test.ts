import { describe, expect, it } from 'vitest';
import {
  ARTICLE_LIST_SCROLL_LOAD_MAX_DISTANCE_PX,
  ARTICLE_LIST_SCROLL_LOAD_MIN_DISTANCE_PX,
  ARTICLE_LIST_SCROLL_LOAD_VIEWPORT_FACTOR,
  getArticleListLoadMorePaddingEnd,
  getArticleListLoadMorePriority,
  getArticleListScrollLoadDistancePx,
  getDistanceFromScrollBottom,
  getRemainingLoadedRows,
  shouldShowArticleListLoadMoreTail,
  shouldTriggerArticleListLoadMore,
  shouldTriggerArticleListLoadMoreFromScroll,
} from '@/components/MainArea/articleListLoadMore';

describe('articleListLoadMore', () => {
  it('computes remaining loaded rows from the last visible index', () => {
    expect(getRemainingLoadedRows(100, 91)).toBe(8);
    expect(getRemainingLoadedRows(100, -1)).toBe(100);
  });

  it('requests urgent priority near the loaded end', () => {
    expect(getArticleListLoadMorePriority(100, 91)).toBe('urgent');
    expect(getArticleListLoadMorePriority(100, 50)).toBe('prefetch');
  });

  it('triggers prefetch before the loaded list is exhausted', () => {
    expect(shouldTriggerArticleListLoadMore(100, 200, 59)).toBe(true);
    expect(shouldTriggerArticleListLoadMore(100, 200, 35)).toBe(false);
  });

  it('extends virtual padding only while more articles exist', () => {
    expect(getArticleListLoadMorePaddingEnd(100, 200)).toBe(336);
    expect(getArticleListLoadMorePaddingEnd(200, 200)).toBe(0);
  });

  it('triggers scroll-based prefetch when the viewport nears the loaded bottom', () => {
    const scrollElement = {
      scrollHeight: 2000,
      scrollTop: 1500,
      clientHeight: 500,
    } as HTMLElement;

    expect(getDistanceFromScrollBottom(scrollElement)).toBe(0);
    expect(shouldTriggerArticleListLoadMoreFromScroll(scrollElement, 100, 200)).toBe(true);
    expect(shouldTriggerArticleListLoadMoreFromScroll({
      ...scrollElement,
      scrollTop: 200,
    } as HTMLElement, 100, 200)).toBe(false);
    expect(shouldTriggerArticleListLoadMoreFromScroll(scrollElement, 200, 200)).toBe(false);
  });

  it('shows the load-more tail only while in flight near the loaded end', () => {
    expect(shouldShowArticleListLoadMoreTail({
      hasMoreArticles: true,
      isLoadMoreInFlight: true,
      loadedRowCount: 100,
      lastVisibleIndex: 91,
    })).toBe(true);

    expect(shouldShowArticleListLoadMoreTail({
      hasMoreArticles: true,
      isLoadMoreInFlight: true,
      loadedRowCount: 100,
      lastVisibleIndex: 50,
    })).toBe(false);

    expect(shouldShowArticleListLoadMoreTail({
      hasMoreArticles: true,
      isLoadMoreInFlight: false,
      loadedRowCount: 100,
      lastVisibleIndex: 91,
    })).toBe(false);
  });

  it('scales scroll trigger distance with viewport height and caps on tall windows', () => {
    expect(getArticleListScrollLoadDistancePx(250)).toBe(375);
    expect(getArticleListScrollLoadDistancePx(500)).toBe(560);
    expect(getArticleListScrollLoadDistancePx(900)).toBe(ARTICLE_LIST_SCROLL_LOAD_MAX_DISTANCE_PX);
    expect(getArticleListScrollLoadDistancePx(0)).toBe(ARTICLE_LIST_SCROLL_LOAD_MIN_DISTANCE_PX);
  });

  it('prefetches on short windows when within one and a half viewports of the bottom', () => {
    const shortViewport = {
      scrollHeight: 1800,
      scrollTop: 1420,
      clientHeight: 250,
    } as HTMLElement;

    expect(getArticleListScrollLoadDistancePx(shortViewport.clientHeight)).toBe(375);
    expect(getDistanceFromScrollBottom(shortViewport)).toBe(130);
    expect(shouldTriggerArticleListLoadMoreFromScroll(shortViewport, 100, 200)).toBe(true);

    expect(shouldTriggerArticleListLoadMoreFromScroll({
      ...shortViewport,
      scrollTop: 900,
    } as HTMLElement, 100, 200)).toBe(false);
  });

  it('keeps scroll trigger bounds tied to row height, not arbitrary pixels', () => {
    expect(ARTICLE_LIST_SCROLL_LOAD_MIN_DISTANCE_PX).toBe(112);
    expect(ARTICLE_LIST_SCROLL_LOAD_MAX_DISTANCE_PX).toBe(560);
    expect(ARTICLE_LIST_SCROLL_LOAD_VIEWPORT_FACTOR).toBe(1.5);
  });
});
