import type { Role } from "../types";
import "./RolePill.css";

const ROLE_LABEL: Record<Role, string> = {
  ROOT_LEADER: "Root Leader",
  LEADER: "Leader",
  PEER: "Peer",
};

const ROLE_CLASS: Record<Role, string> = {
  ROOT_LEADER: "role-pill--root",
  LEADER: "role-pill--leader",
  PEER: "role-pill--peer",
};

export function RolePill({ role }: { role: Role }) {
  return <span className={`role-pill ${ROLE_CLASS[role]}`}>{ROLE_LABEL[role]}</span>;
}
