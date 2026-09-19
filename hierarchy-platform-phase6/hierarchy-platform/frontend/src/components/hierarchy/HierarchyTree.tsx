import type { HierarchyNode } from "../../types";
import { HierarchyNodeRow } from "./HierarchyNodeRow";
import { buildTree, flattenTree, type TreeNode } from "./hierarchyUtils";
import "./HierarchyTree.css";

export function HierarchyTree({
  root,
  members,
  onRemove,
  onReactivate,
  onShowDetails,
}: {
  root: HierarchyNode;
  members: HierarchyNode[];
  onRemove: (node: TreeNode) => void;
  onReactivate: (node: TreeNode) => void;
  onShowDetails: (node: TreeNode) => void;
}) {
  const rows = flattenTree(buildTree(root, members));

  return (
    <div className="hierarchy-tree">
      {rows.map((node) => (
        <HierarchyNodeRow
          key={node.id}
          node={node}
          isSelf={node.id === root.id}
          onRemove={onRemove}
          onReactivate={onReactivate}
          onShowDetails={onShowDetails}
        />
      ))}
    </div>
  );
}
