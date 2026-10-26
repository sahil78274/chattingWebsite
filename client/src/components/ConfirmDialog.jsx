import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from './Modal.jsx';

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', destructive = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (requestError) {
      setError(requestError.message || 'The action could not be completed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn--danger' : 'btn--primary'}`}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-secondary" style={{ fontSize: 14, lineHeight: 1.6 }}>
        {message}
      </p>
      {error ? <div className="alert alert--error">{error}</div> : null}
    </Modal>
  );
}

export default ConfirmDialog;
