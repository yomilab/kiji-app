import React from 'react';
import { CONTACT_EMAIL_ADDRESS } from '@/config/appIdentity';
import { SettingsGroup, SettingsRow } from '../settingsControls';
import { EnvelopeGlyph } from '../settingsIcons';
import type { SettingsWindowState } from '../useSettingsWindowState';

export const ContactPane: React.FC<{ state: SettingsWindowState['contact'] }> = ({ state }) => (
  <div className="settings-section">
    <SettingsGroup title="Email">
      <SettingsRow
        label="Support email"
        description="Opens a new message to the Yomi Reader team in your email app."
        status={state.emailStatus}
        control={(
          <button
            type="button"
            className="settings-action-button settings-email-button"
            onClick={() => {
              void state.onContactEmailOpen();
            }}
            disabled={state.isOpeningContactEmail}
          >
            <EnvelopeGlyph />
            <span>{state.isOpeningContactEmail ? 'Opening…' : CONTACT_EMAIL_ADDRESS}</span>
          </button>
        )}
      />
    </SettingsGroup>

    <SettingsGroup title="Feedback">
      <SettingsRow
        label="Share feedback"
        description="Ideas, suggestions or problems. We'll open it as an email draft for you to send."
        htmlFor="settings-feedback"
        stacked
        control={(
          <div className="settings-feedback-form">
            <textarea
              id="settings-feedback"
              className="settings-textarea"
              value={state.feedbackDraft}
              onChange={(event) => state.onFeedbackDraftChange(event.target.value)}
              placeholder="What's on your mind?"
            />
            <div className="settings-feedback-actions">
              {state.feedbackStatus ? <p className="settings-inline-status" role="status">{state.feedbackStatus}</p> : null}
              <button
                type="button"
                className="settings-action-button settings-action-button-primary"
                onClick={() => {
                  void state.onFeedbackSubmit();
                }}
                disabled={state.isSubmittingFeedback}
              >
                {state.isSubmittingFeedback ? 'Opening…' : 'Submit Feedback'}
              </button>
            </div>
          </div>
        )}
      />
    </SettingsGroup>

    <SettingsGroup title="Diagnostics">
      <SettingsRow
        label="Error report"
        description="Save recent logs to a file you can attach to an email. Nothing is sent automatically."
        status={state.reportStatus}
        control={(
          <button
            type="button"
            className="settings-action-button"
            onClick={() => {
              void state.onExportDiagnostics();
            }}
            disabled={state.isExportingReport}
          >
            {state.isExportingReport ? 'Exporting…' : 'Export Error Report'}
          </button>
        )}
      />
    </SettingsGroup>
  </div>
);
