import { useEffect, useState } from "react";
import { useAuthStore } from "../../state/authStore";
import { useHierarchyStore } from "../../state/hierarchyStore";
import { AddMemberForm } from "./AddMemberForm";
import { HierarchyTree } from "./HierarchyTree";
import { RemoveConfirmModal } from "./RemoveConfirmModal";
import { RemovalDetailsModal } from "./RemovalDetailsModal";
import { countActiveDescendants, type TreeNode } from "./hierarchyUtils";
import "./HierarchyPanel.css";

export function HierarchyPanel() {
  const currentUser = useAuthStore((s) => s.user);
  const { root, members, isLoading, error, fetchSubtree, removeMember, reactivateMember } =
    useHierarchyStore();

  const [removeTarget, setRemoveTarget] = useState<TreeNode | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<TreeNode | null>(null);

  useEffect(() => {
    fetchSubtree();
  }, [fetchSubtree]);

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    const ok = await removeMember(removeTarget.id);
    if (ok) setRemoveTarget(null);
  }

  async function handleReactivate(node: TreeNode) {
    await reactivateMember(node.id);
  }

  // PEER cannot create anyone (ROLE_CREATION_RULES on the backend) — this
  // hides the form as a UI convenience only; the server independently
  // enforces the same rule regardless of what the frontend shows.
  const canAddMembers = currentUser?.role !== "PEER";

  return (
    <section className="hierarchy-panel">
      <div className="hierarchy-panel__header">
        <p className="dashboard__section-heading">Your subgroup</p>
        {canAddMembers && <AddMemberForm />}
      </div>

      {isLoading && !root && <p className="hierarchy-panel__status">Loading hierarchy…</p>}
      {error && !isLoading && <div className="form-error">{error}</div>}

      {root && (
        <HierarchyTree
          root={root}
          members={members}
          onRemove={setRemoveTarget}
          onReactivate={handleReactivate}
          onShowDetails={setDetailsTarget}
        />
      )}

      {removeTarget && (
        <RemoveConfirmModal
          target={removeTarget}
          cascadeCount={countActiveDescendants(members, removeTarget.id)}
          onConfirm={handleConfirmRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {detailsTarget && root && (
        <RemovalDetailsModal
          target={detailsTarget}
          root={root}
          members={members}
          onClose={() => setDetailsTarget(null)}
        />
      )}
    </section>
  );
}
