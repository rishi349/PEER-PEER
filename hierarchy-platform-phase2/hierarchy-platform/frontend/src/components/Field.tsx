import type { InputHTMLAttributes } from "react";
import "../styles/forms.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Field({ label, id, ...inputProps }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field__input" {...inputProps} />
    </div>
  );
}
