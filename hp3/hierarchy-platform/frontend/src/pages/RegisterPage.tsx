import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { Field } from "../components/Field";
import { useAuthStore } from "../state/authStore";
import "../styles/forms.css";

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const isSubmitting = useAuthStore((s) => s.isSubmitting);
  const error = useAuthStore((s) => s.error);

  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await register({ organizationName, name, email, password });
    if (ok) navigate("/dashboard", { replace: true });
  }

  return (
    <AuthShell
      eyebrow="New organization"
      title="Stand up an organization"
      subtitle="This creates the organization and makes you its Root Leader."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div className="form-error">{error}</div>}
        <Field
          id="organizationName"
          label="Organization name"
          type="text"
          placeholder="Northline Ops"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          required
        />
        <Field
          id="name"
          label="Your name"
          type="text"
          autoComplete="name"
          placeholder="Jordan Alvarez"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@organization.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <button className="btn btn--primary btn--block" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating organization…" : "Create organization"}
        </button>
      </form>
    </AuthShell>
  );
}
