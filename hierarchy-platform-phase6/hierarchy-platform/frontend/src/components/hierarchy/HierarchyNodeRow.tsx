import { RolePill } from "../RolePill";
import type { TreeNode } from "./hierarchyUtils";
import "./HierarchyNodeRow.css";

export function HierarchyNodeRow({
  node,
  isSelf,
  onRemove,
  onReactivate,
  onShowDetails,
}: {
  node: TreeNode;
  isSelf: boolean;
  onRemove: (node: TreeNode) => void;
  onReactivate: (node: TreeNode) => void;
  onShowDetails: (node: TreeNode) => void;
}) {
  const isRemoved = node.status === "REMOVED";

  return (
    <div className={`hierarchy-row ${isRemoved ? "hierarchy-row--removed" : ""}`}>
      <div className="hierarchy-row__indent" style={{ width: node.depth * 22 }} />
      <span className={`hierarchy-row__connector ${node.depth === 0 ? "hierarchy-row__connector--root" : ""}`} />

      <div className="hierarchy-row__main">
        <div className="hierarchy-row__identity">
          <span className="hierarchy-row__name">
            {node.name}
            {isSelf && <span className="hierarchy-row__you">you</span>}
          </span>
          <span className="hierarchy-row__email mono">{node.email}</span>
        </div>

        <div className="hierarchy-row__badges">
          <RolePill role={node.role} />
          {isRemoved ? (
            <button className="removed-tag" onClick={() => onShowDetails(node)}>
              REMOVED
            </button>
          ) : (
            <span className="active-tag">
              <span className="active-tag__dot" />
              ACTIVE
            </span>
          )}
        </div>

        <div className="hierarchy-row__actions">
          {!isRemoved && !isSelf && (
            <button className="hierarchy-row__action hierarchy-row__action--danger" onClick={() => onRemove(node)}>
              Remove
            </button>
          )}
          {isRemoved && (
            <button className="hierarchy-row__action" onClick={() => onReactivate(node)}>
              Reactivate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
