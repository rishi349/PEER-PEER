// The set of hierarchy actions the authorization service can decide on.
// Extend this union as new modules need new decisions (presence/radar/P2P
// authorization in later phases should add cases here rather than
// growing their own separate rule tables) — canPerform's switch is
// written to fail a type check if a case is added here and not handled.
export type Action =
  | "CREATE_LEADER"
  | "CREATE_PEER"
  | "REMOVE_NODE"
  | "REACTIVATE_NODE"
  | "VIEW_VISIBILITY_SCOPE";
