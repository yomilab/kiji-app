import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PencilGlyph, PlusGlyph, TrashGlyph } from '@/components/SettingsWindow/settingsIcons';
import { tauriClient } from '@/lib/tauriClient';
import { logger } from '@/services/logger';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import type { MuteApplyResult, MuteRule, MuteRulePreview, MuteRuleScope } from '@/types/muteRules';
import { Dialog, EmptyState } from './ManageFeedsControls';
import {
  createMuteRuleId,
  describeMuteScope,
  formatMuteApplied,
  formatMutePreview,
  MUTE_COPY,
  normalizeMuteText,
  scopeFromValue,
  scopeToValue,
  validateMuteDraft,
} from './muteRulesModel';

/** Rust-backed rule storage, matching and bulk apply; injectable for tests and stories. */
export interface MuteRulesService {
  get: () => Promise<MuteRule[]>;
  set: (rules: MuteRule[]) => Promise<MuteRule[]>;
  preview: (rule: MuteRule) => Promise<MuteRulePreview>;
  applyToExisting: () => Promise<MuteApplyResult>;
}

export const defaultMuteRulesService: MuteRulesService = tauriClient.muteRules;

/** SF Symbols `line.3.horizontal.decrease`, same grid and stroke as the Settings glyphs. */
export const FiltersGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={`settings-glyph${className ? ` ${className}` : ''}`}
    data-glyph="line.3.horizontal.decrease"
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 7h16M7 12h10M10 17h4" />
  </svg>
);

const PREVIEW_DEBOUNCE_MS = 250;

interface FiltersPaneProps {
  feeds: ReadonlyArray<{ id: string; title: string }>;
  stations: ReadonlyArray<{ name: string }>;
  service?: MuteRulesService;
}

type Editing = { rule: MuteRule | null } | null;

/* ── Rule sheet ───────────────────────────────────────────────────────────── */

const MuteRuleDialog: React.FC<{
  rule: MuteRule | null;
  rules: ReadonlyArray<MuteRule>;
  feeds: FiltersPaneProps['feeds'];
  stations: FiltersPaneProps['stations'];
  service: MuteRulesService;
  onSave: (rule: MuteRule) => Promise<boolean>;
  onClose: () => void;
}> = ({ rule, rules, feeds, stations, service, onSave, onClose }) => {
  const [text, setText] = useState(rule?.text ?? '');
  const [matchDescription, setMatchDescription] = useState(rule?.matchDescription ?? false);
  const [scope, setScope] = useState<MuteRuleScope>(rule?.scope ?? { kind: 'all' });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MuteRulePreview | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);
  const sortedFeeds = useMemo(() => [...feeds].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })), [feeds]);

  const problem = validateMuteDraft(text, scope, rules, rule?.id ?? null);
  const normalized = normalizeMuteText(text);

  // Live hint: one debounced Rust call per pause in typing; stale answers are dropped.
  useEffect(() => {
    if (!normalized) {
      setPreview(null);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void service.preview({
        id: rule?.id ?? 'draft',
        text: normalized,
        matchDescription,
        scope,
        action: 'mark-read',
      })
        .then((next) => {
          if (active) setPreview(next);
        })
        .catch((error: unknown) => {
          if (active) setPreview(null);
          logger.warn('ManageFeeds', 'Failed to preview a mute rule', { error });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [matchDescription, normalized, rule?.id, scope, service]);

  const submit = async () => {
    setTouched(true);
    if (problem || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const done = await onSave({
        id: rule?.id ?? createMuteRuleId(),
        text: normalized,
        matchDescription,
        scope,
        action: 'mark-read',
      });
      if (done) onClose();
      else setSaveError(MUTE_COPY.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const scopeValue = scopeToValue(scope);
  const scopeMissing = scope.kind === 'feed'
    ? !feeds.some((feed) => feed.id === scope.id)
    : scope.kind === 'station' && !stations.some((station) => station.name === scope.name);

  return (
    <Dialog
      title={rule ? 'Edit Mute Word' : 'New Mute Word'}
      description="New articles whose title contains this word or phrase are marked as read."
      onClose={onClose}
      busy={saving}
      initialFocusRef={textRef}
      footer={(
        <>
          <button type="button" className="settings-action-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className="settings-action-button settings-action-button-primary"
            onClick={() => { void submit(); }}
            disabled={saving || (touched && problem !== null)}
          >
            {saving ? 'Saving…' : rule ? 'Save' : 'Add'}
          </button>
        </>
      )}
    >
      <form
        className="mf-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="mf-field-label" htmlFor="mf-mute-text">Word or phrase</label>
        <input
          ref={textRef}
          id="mf-mute-text"
          className="mf-input"
          value={text}
          placeholder="For example: giveaway"
          spellCheck={false}
          maxLength={400}
          onChange={(event) => {
            setText(event.target.value);
            setSaveError(null);
          }}
        />
        <p className="mf-hint mf-mute-preview" role="status" aria-live="polite">
          {touched && problem ? problem : preview ? formatMutePreview(preview) : 'Matches whole words and ignores case.'}
        </p>
        <label className="mf-check-row mf-mute-check">
          <input
            type="checkbox"
            checked={matchDescription}
            onChange={(event) => setMatchDescription(event.target.checked)}
          />
          <span>Also check the summary</span>
        </label>
        <label className="mf-field-label" htmlFor="mf-mute-scope">Apply to</label>
        <select
          id="mf-mute-scope"
          className="settings-select mf-mute-select"
          value={scopeValue}
          onChange={(event) => setScope(scopeFromValue(event.target.value))}
        >
          <option value="all">All feeds</option>
          {scopeMissing ? <option value={scopeValue}>{describeMuteScope(scope, feeds)}</option> : null}
          {stations.length > 0 ? (
            <optgroup label="Stations">
              {stations.map((station) => (
                <option key={station.name} value={scopeToValue({ kind: 'station', name: station.name })}>{station.name}</option>
              ))}
            </optgroup>
          ) : null}
          {sortedFeeds.length > 0 ? (
            <optgroup label="Feeds">
              {sortedFeeds.map((feed) => (
                <option key={feed.id} value={scopeToValue({ kind: 'feed', id: feed.id })}>{feed.title}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {saveError ? <p className="mf-hint mf-mute-error" role="alert">{saveError}</p> : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
};

/* ── Pane ─────────────────────────────────────────────────────────────────── */

/**
 * Filters tab: mute words. Rules are stored in native settings and applied by Rust when new
 * articles arrive; "Apply to Unread Articles" runs them once over what is already unread.
 */
export const FiltersPane: React.FC<FiltersPaneProps> = ({ feeds, stations, service = defaultMuteRulesService }) => {
  const [rules, setRules] = useState<MuteRule[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    setStatus('loading');
    void service.get()
      .then((loaded) => {
        if (!active) return;
        setRules(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        logger.error('ManageFeeds', 'Failed to load mute rules', { error });
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service]);

  useEffect(() => load(), [load]);

  const persist = async (next: MuteRule[], failure: string): Promise<boolean> => {
    try {
      setRules(await service.set(next));
      return true;
    } catch (error) {
      logger.error('ManageFeeds', 'Failed to save mute rules', { error });
      setMessage(failure);
      return false;
    }
  };

  const saveRule = (rule: MuteRule) => {
    setMessage(null);
    const exists = rules.some((entry) => entry.id === rule.id);
    const next = exists ? rules.map((entry) => (entry.id === rule.id ? rule : entry)) : [...rules, rule];
    return persist(next, MUTE_COPY.saveFailed);
  };

  const deleteRule = (id: string) => {
    setMessage(null);
    void persist(rules.filter((entry) => entry.id !== id), MUTE_COPY.deleteFailed);
  };

  const applyToExisting = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const result = await service.applyToExisting();
      feedLibraryMutationBus.publishFeedsCountsUpdated(result.feeds);
      setMessage(formatMuteApplied(result.markedCount));
    } catch (error) {
      logger.error('ManageFeeds', 'Failed to apply mute rules to unread articles', { error });
      setMessage(MUTE_COPY.applyFailed);
    } finally {
      setApplying(false);
      setConfirmApply(false);
    }
  };

  const renderList = () => {
    if (status === 'loading') return <div className="mf-loading" role="status">Loading mute words…</div>;
    if (status === 'error') {
      return (
        <EmptyState
          icon={<FiltersGlyph />}
          title={MUTE_COPY.loadFailed}
          action={<button type="button" className="settings-action-button" onClick={() => load()}>Try Again</button>}
        />
      );
    }
    if (rules.length === 0) {
      return (
        <EmptyState
          icon={<FiltersGlyph />}
          title="No mute words"
          message="Add a word or phrase, and new articles that mention it are marked as read."
          action={(
            <button type="button" className="settings-action-button settings-action-button-primary" onClick={() => setEditing({ rule: null })}>
              <PlusGlyph />
              New Mute Word
            </button>
          )}
        />
      );
    }
    return (
      <ul className="mf-list mf-list-card" aria-label="Mute words">
        {rules.map((rule) => (
          <li
            key={rule.id}
            tabIndex={0}
            className="mf-row mf-mute-row"
            aria-label={`${rule.text}, ${describeMuteScope(rule.scope, feeds)}`}
            onDoubleClick={() => setEditing({ rule })}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                setEditing({ rule });
              } else if (event.key === 'Backspace' || event.key === 'Delete') {
                event.preventDefault();
                deleteRule(rule.id);
              }
            }}
          >
            <span className="mf-mute-icon" aria-hidden="true"><FiltersGlyph /></span>
            <div className="mf-row-main">
              <div className="mf-row-title">“{rule.text}”</div>
              <div className="mf-row-meta">
                <span className="mf-chip">{describeMuteScope(rule.scope, feeds)}</span>
                <span className="mf-row-site">{rule.matchDescription ? 'Title and summary' : 'Title'} · Mark as read</span>
              </div>
            </div>
            <div className="mf-row-actions">
              <button
                type="button"
                tabIndex={-1}
                className="settings-icon-button mf-row-action"
                aria-label={`Edit ${rule.text}`}
                title="Edit"
                onClick={() => setEditing({ rule })}
              >
                <PencilGlyph />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="settings-icon-button mf-row-action is-destructive"
                aria-label={`Delete ${rule.text}`}
                title="Delete"
                onClick={() => deleteRule(rule.id)}
              >
                <TrashGlyph />
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="mf-pane-body" data-pane="filters">
      <div className="mf-toolbar">
        <p className="mf-toolbar-note" role="status" aria-live="polite">
          {message ?? 'New articles that match a mute word are marked as read when they arrive.'}
        </p>
        {rules.length > 0 ? (
          <button
            type="button"
            className="settings-action-button"
            disabled={applying}
            onClick={() => setConfirmApply(true)}
          >
            Apply to Unread Articles…
          </button>
        ) : null}
        <button
          type="button"
          className="settings-action-button settings-action-button-primary"
          disabled={status !== 'ready'}
          onClick={() => setEditing({ rule: null })}
        >
          <PlusGlyph />
          New Mute Word
        </button>
      </div>
      <div className="mf-list-scroll">{renderList()}</div>

      {editing ? (
        <MuteRuleDialog
          rule={editing.rule}
          rules={rules}
          feeds={feeds}
          stations={stations}
          service={service}
          onSave={saveRule}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmApply ? (
        <Dialog
          title="Mark matching unread articles as read?"
          description="Your mute words are checked against every unread article. Matching articles are marked as read."
          onClose={() => setConfirmApply(false)}
          busy={applying}
          footer={(
            <>
              <button type="button" className="settings-action-button" onClick={() => setConfirmApply(false)} disabled={applying}>Cancel</button>
              <button
                type="button"
                className="settings-action-button settings-action-button-primary"
                disabled={applying}
                onClick={() => { void applyToExisting(); }}
              >
                {applying ? 'Marking…' : 'Mark as Read'}
              </button>
            </>
          )}
        />
      ) : null}
    </div>
  );
};
