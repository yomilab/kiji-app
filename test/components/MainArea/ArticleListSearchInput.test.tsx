import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ArticleListSearchInput } from '@/components/MainArea/ArticleListSearchInput';

describe('ArticleListSearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('keeps search open when clicking a searched article result inside the ignored list container', () => {
    const onClose = vi.fn();
    const listContainer = document.createElement('div');
    const resultRow = document.createElement('button');
    resultRow.textContent = 'Search result';
    listContainer.appendChild(resultRow);
    document.body.appendChild(listContainer);

    try {
      render(
        <ArticleListSearchInput
          isOpen
          searchQuery="needle"
          onSearchChange={vi.fn()}
          onClose={onClose}
          ignoredOutsideClickRef={{ current: listContainer }}
        />
      );

      act(() => {
        vi.advanceTimersByTime(100);
      });

      fireEvent.mouseDown(resultRow);

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getAllByDisplayValue('needle')[0]).toBeInTheDocument();
    } finally {
      listContainer.remove();
    }
  });

  it('closes search when clicking outside the ignored list container', () => {
    const onClose = vi.fn();
    const listContainer = document.createElement('div');
    document.body.appendChild(listContainer);

    try {
      render(
        <ArticleListSearchInput
          isOpen
          searchQuery="needle"
          onSearchChange={vi.fn()}
          onClose={onClose}
          ignoredOutsideClickRef={{ current: listContainer }}
        />
      );

      act(() => {
        vi.advanceTimersByTime(100);
      });

      fireEvent.mouseDown(document.body);

      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      listContainer.remove();
    }
  });

  it('blurs the input when search closes so article-list shortcuts can run', () => {
    const { rerender } = render(
      <ArticleListSearchInput
        isOpen
        searchQuery="needle"
        onSearchChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const input = screen.getAllByDisplayValue('needle')[0];
    expect(document.activeElement).toBe(input);

    rerender(
      <ArticleListSearchInput
        isOpen={false}
        searchQuery=""
        onSearchChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(document.activeElement).not.toBe(input);
  });
});
