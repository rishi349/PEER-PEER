import type { HierarchyNode } from "../../types";
import { nodeName } from "./hierarchyUtils";
import "./Modal.css";

const REASON_LABEL: Record<string, string> = {
  DIRECT: "Direct removal",
  GROUP_LEADER_REMOVED: "Group leader removed",
};

export function RemovalDetailsModal({
  target,
  root,
  members,
  onClose,
}: {
  target: HierarchyNode;
  root: HierarchyNode;
  members: HierarchyNode[];
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3 className="modal-card__title">Removal details</h3>
        <p className="modal-card__subtitle">{target.name}</p>

        <div>
          <div className="removal-details__row">
            <span className="removal-details__label">Status</span>
            <span className="removal-details__value">REMOVED</span>
          </div>
          <div className="removal-details__row">
            <span className="removal-details__label">Reason</span>
            <span className="removal-details__value">
              {target.removalReason ? REASON_LABEL[target.removalReason] : "—"}
            </span>
          </div>
          {target.removalReason === "GROUP_LEADER_REMOVED" && (
            <div className="removal-details__row">
              <span className="removal-details__label">Removed because of</span>
              <span className="removal-details__value">
                {nodeName(target.removedBecauseOf, root, members)}
              </span>
            </div>
          )}
          <div className="removal-details__row">
            <span className="removal-details__label">Removed by</span>
            <span className="removal-details__value">
              {nodeName(target.removedBy, root, members)}
            </span>
          </div>
          <div className="removal-details__row">
            <span className="removal-details__label">Removed at</span>
            <span className="removal-details__value">
              {target.removedAt ? new Date(target.removedAt).toLocaleString() : "—"}
            </span>
          </div>
        </div>

        <div className="modal-card__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
