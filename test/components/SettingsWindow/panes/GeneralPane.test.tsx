import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/tauriClient", () => ({
  tauriClient: {
    shell: {
      backgroundMode: { get: vi.fn(() => new Promise(() => undefined)), set: vi.fn() },
      attention: { get: vi.fn(() => new Promise(() => undefined)), set: vi.fn() },
    },
  },
}));
vi.mock("@/services/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GeneralPane } from "@/components/SettingsWindow/panes/GeneralPane";
import type { SettingsWindowState } from "@/components/SettingsWindow/useSettingsWindowState";

const makeState = (
  overrides: Partial<SettingsWindowState["general"]> = {},
): SettingsWindowState["general"] => ({
  backgroundUpdate: "every-15m",
  contentParser: "defuddle",
  articleRetention: "never",
  savedArticlesSyncFolder: null,
  isPickingSavedArticlesSyncFolder: false,
  onBackgroundUpdateChange: vi.fn(),
  onContentParserChange: vi.fn(),
  onArticleRetentionChange: vi.fn(),
  onSavedArticlesSyncToggle: vi.fn(),
  onSavedArticlesSyncFolderPick: vi.fn(),
  ...overrides,
});

describe("GeneralPane — Remove old read articles", () => {
  afterEach(cleanup);

  it("shows the retention choices with Never selected by default", () => {
    render(<GeneralPane state={makeState()} />);
    const select = screen.getByLabelText("Remove old read articles") as HTMLSelectElement;
    expect(select.value).toBe("never");
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Never",
      "After 1 month",
      "After 3 months",
      "After 6 months",
      "After 1 year",
    ]);
    expect(screen.getByText(/Saved, starred, and unread articles are always kept/)).toBeTruthy();
  });

  it("saves the chosen retention", () => {
    const state = makeState({ articleRetention: "6m" });
    render(<GeneralPane state={state} />);
    const select = screen.getByLabelText("Remove old read articles") as HTMLSelectElement;
    expect(select.value).toBe("6m");
    fireEvent.change(select, { target: { value: "3m" } });
    expect(state.onArticleRetentionChange).toHaveBeenCalledWith("3m");
  });
});
