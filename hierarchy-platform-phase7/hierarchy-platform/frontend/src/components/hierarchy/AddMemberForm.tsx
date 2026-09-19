import { type FormEvent, useState } from "react";
import { Field } from "../Field";
import { useHierarchyStore } from "../../state/hierarchyStore";
import "./AddMemberForm.css";

// POST /hierarchy/leaders and POST /hierarchy/peers always create the new
// node under the caller (hierarchy.service.ts: parentId = freshActor.id) —
// there is no "create under an arbitrary node" API yet, so this form only
// ever adds directly beneath the signed-in user.
export function AddMemberForm() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"LEADER" | "PEER">("PEER");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const addMember = useHierarchyStore((s) => s.addMember);
  const isMutating = useHierarchyStore((s) => s.isMutating);
  const error = useHierarchyStore((s) => s.error);
  const clearError = useHierarchyStore((s) => s.clearError);

  function openForm() {
    clearError();
    setOpen(true);
  }

  function closeForm() {
    setOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    clearError();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await addMember(role, { name, email, password });
    if (ok) closeForm();
  }

  if (!open) {
    return (
      <button className="btn btn--primary add-member-toggle" onClick={openForm}>
        + Add member
      </button>
    );
  }

  return (
    <form className="add-member-form" onSubmit={handleSubmit}>
      <div className="add-member-form__tabs">
        <button
          type="button"
          className={`add-member-form__tab ${role === "LEADER" ? "add-member-form__tab--active" : ""}`}
          onClick={() => setRole("LEADER")}
        >
          Leader
        </button>
        <button
          type="button"
          className={`add-member-form__tab ${role === "PEER" ? "add-member-form__tab--active" : ""}`}
          onClick={() => setRole("PEER")}
        >
          Peer
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      <Field
        id="new-member-name"
        label="Name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Field
        id="new-member-email"
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Field
        id="new-member-password"
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        required
      />

      <div className="add-member-form__actions">
        <button type="button" className="btn btn--ghost" onClick={closeForm} disabled={isMutating}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={isMutating}>
          {isMutating ? "Adding…" : `Add ${role === "LEADER" ? "leader" : "peer"}`}
        </button>
      </div>
    </form>
  );
}
