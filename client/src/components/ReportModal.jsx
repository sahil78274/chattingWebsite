import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { REPORT_REASONS } from '../lib/constants.js';
import { api } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

export function ReportModal({ user, conversationId, onClose }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notify } = useToast();

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.reportUser(user.id, {
        reason,
        details: details.trim() || undefined,
        conversationId: conversationId || undefined
      });
      notify.success('Report submitted. Thank you for helping keep Connectly safe.');
      onClose();
    } catch (requestError) {
      setError(requestError.message || 'Could not submit the report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Report @${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="report-form" className="btn btn--danger" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : null} Submit report
          </button>
        </>
      }
    >
      <form id="report-form" className="form" onSubmit={submit}>
        <p className="text-secondary" style={{ fontSize: 13.5 }}>
          Reports are reviewed by the team running this deployment. The reported user is not told who
          reported them.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="report-reason">
            Reason
          </label>
          <select
            id="report-reason"
            className="input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {REPORT_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="report-details">
            <span>Details</span>
            <span className="field__hint">{details.length}/1000 · optional</span>
          </label>
          <textarea
            id="report-details"
            className="input"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={1000}
            placeholder="What happened?"
            rows={4}
          />
        </div>
        {error ? <div className="alert alert--error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default ReportModal;
