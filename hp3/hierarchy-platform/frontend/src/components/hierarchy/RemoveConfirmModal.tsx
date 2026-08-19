import { useState } from "react";
import type { HierarchyNode } from "../../types";
import "./Modal.css";

export function RemoveConfirmModal({
  target,
  cascadeCount,
  onConfirm,
  onCancel,
}: {
  target: HierarchyNode;
  cascadeCount: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setIsSubmitting(true);
    await onConfirm();
    setIsSubmitting(false);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3 className="modal-card__title">Remove {target.name}?</h3>
        <p className="modal-card__subtitle">
          This is a {target.role === "LEADER" ? "leader" : "peer"} in your subgroup.
        </p>

        {target.role === "LEADER" && cascadeCount > 0 && (
          <div className="modal-card__warning">
            ⚠ This will also cascade to <strong>{cascadeCount}</strong> currently active
            member{cascadeCount === 1 ? "" : "s"} in {target.name}&rsquo;s subgroup — each one
            will be marked removed with reason &ldquo;Group leader removed.&rdquo; Nobody is
            deleted; this can be undone member-by-member later.
          </div>
        )}
        {target.role === "PEER" && (
          <div className="modal-card__warning">
            This marks {target.name} as removed. Their record and history are preserved and can
            be restored later.
          </div>
        )}

        <div className="modal-card__actions">
          <button className="btn btn--ghost" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button className="btn btn--danger" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
