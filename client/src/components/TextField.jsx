import { useId } from 'react';

export function TextField({
  label,
  value,
  onChange,
  error,
  icon: Icon,
  hint,
  type = 'text',
  autoComplete,
  placeholder,
  disabled,
  inputMode,
  maxLength,
  name
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>
        {hint ? <span className="field__hint">{hint}</span> : null}
      </label>
      <div className="field__control">
        {Icon ? <Icon size={16} aria-hidden /> : null}
        <input
          id={id}
          name={name}
          className={`input${error ? ' input--invalid' : ''}`}
          style={Icon ? undefined : { paddingLeft: 14 }}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          inputMode={inputMode}
          maxLength={maxLength}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>
      {error ? (
        <span className="field__error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default TextField;
