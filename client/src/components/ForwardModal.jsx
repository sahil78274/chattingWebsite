import { Modal } from './Modal.jsx';
import { Avatar } from './Avatar.jsx';

export function ForwardModal({ conversations, currentId, onChoose, onClose }) {
  const options = (conversations || []).filter((conversation) => conversation.id !== currentId);

  return (
    <Modal title="Forward message" onClose={onClose}>
      {options.length === 0 ? (
        <p className="muted">Start another conversation first, then you can forward messages into it.</p>
      ) : (
        <div className="forward-list">
          {options.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className="forward-list__item"
              onClick={() => onChoose(conversation)}
            >
              <Avatar user={conversation.peer} size="sm" />
              <span>
                <strong>{conversation.peer?.displayName || conversation.peer?.username}</strong>
                <span className="muted">@{conversation.peer?.username}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default ForwardModal;
