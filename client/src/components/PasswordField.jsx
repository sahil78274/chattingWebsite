import { useId, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

/** Password input with a visibility toggle, used across all auth forms. */
export function PasswordField({
  label,
  value,
  onChange,
  error,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  hint,
  name,
  disabled = false,
  showStrength = false,
  strength = 0
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>
        {hint ? <span className="field__hint">{hint}</span> : null}
      </label>
      <div className="field__control field__control--with-action">
        <Lock size={16} aria-hidden />
        <input
          id={id}
          name={name}
          className={`input${error ? ' input--invalid' : ''}`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="field__action"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={0}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {showStrength ? (
        <div className="password-meter" aria-hidden>
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={index < strength ? 'is-active' : ''} />
          ))}
        </div>
      ) : null}
      {error ? (
        <span className="field__error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default PasswordField;
