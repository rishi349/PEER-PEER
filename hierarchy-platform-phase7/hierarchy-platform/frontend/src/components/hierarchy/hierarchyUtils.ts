import type { HierarchyNode } from "../../types";

export interface TreeNode extends HierarchyNode {
  depth: number;
  children: TreeNode[];
}

function groupByParent(members: HierarchyNode[]): Map<string, HierarchyNode[]> {
  const byParent = new Map<string, HierarchyNode[]>();
  for (const m of members) {
    const key = m.parentId ?? "";
    const bucket = byParent.get(key);
    if (bucket) bucket.push(m);
    else byParent.set(key, [m]);
  }
  return byParent;
}

/** Builds a tree from the flat `{ root, members }` shape GET /hierarchy/subtree
 *  returns, by walking parentId links client-side (HANDOFF §7 item 2). */
export function buildTree(root: HierarchyNode, members: HierarchyNode[]): TreeNode {
  const byParent = groupByParent(members);

  function attach(node: HierarchyNode, depth: number): TreeNode {
    const kids = [...(byParent.get(node.id) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    return { ...node, depth, children: kids.map((k) => attach(k, depth + 1)) };
  }

  return attach(root, 0);
}

/** Flattens back to a depth-ordered list for simple row-by-row rendering. */
export function flattenTree(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

/**
 * Predicts how many currently-ACTIVE descendants a removal would cascade
 * to, so the confirmation dialog can warn with a real number before the
 * request is sent. Mirrors the backend's own filter (removeNode only
 * cascades to descendants that are ACTIVE at the moment of removal —
 * hierarchy.service.ts) — this is a client-side prediction for UX only,
 * the server remains the authority on what actually happens.
 */
export function countActiveDescendants(members: HierarchyNode[], targetId: string): number {
  const byParent = groupByParent(members);
  let count = 0;
  const stack = [...(byParent.get(targetId) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop() as HierarchyNode;
    if (node.status === "ACTIVE") count += 1;
    stack.push(...(byParent.get(node.id) ?? []));
  }
  return count;
}

/** Resolves a removedBy/removedBecauseOf id to a display name within the
 *  current actor's own subtree (root + members) — see removal-history
 *  design note in HierarchyPanel.tsx for why this id always resolves. */
export function nodeName(
  id: string | null,
  root: HierarchyNode,
  members: HierarchyNode[]
): string {
  if (!id) return "—";
  if (id === root.id) return root.name;
  const found = members.find((m) => m.id === id);
  return found ? found.name : `${id.slice(0, 8)}…`;
}
