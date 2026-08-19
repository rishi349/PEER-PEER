import { useNavigate } from "react-router-dom";
import { HierarchyPanel } from "../components/hierarchy/HierarchyPanel";
import { RolePill } from "../components/RolePill";
import { useAuthStore } from "../state/authStore";
import "./DashboardPage.css";

const ROLE_AVATAR_BG: Record<string, string> = {
  ROOT_LEADER: "var(--role-root-dim)",
  LEADER: "var(--role-leader-dim)",
  PEER: "var(--role-peer-dim)",
};

const ROLE_AVATAR_COLOR: Record<string, string> = {
  ROOT_LEADER: "var(--role-root)",
  LEADER: "var(--role-leader)",
  PEER: "var(--role-peer)",
};

const UPCOMING_PHASES = [
  {
    title: "Authorization",
    desc: "Server-enforced visibility scoped to parents and authorized descendants.",
    phase: "Phase 3",
  },
  {
    title: "Presence",
    desc: "Real-time online/offline state, backed by Redis heartbeats.",
    phase: "Phase 4",
  },
  {
    title: "Radar",
    desc: "Spatial view of who you're authorized to discover, filtered by role.",
    phase: "Phase 7",
  },
  {
    title: "P2P sessions",
    desc: "Authorized, revocable WebRTC connections between peers.",
    phase: "Phase 5",
  },
  {
    title: "Device identity",
    desc: "Per-device keys, so an account isn't just one browser session.",
    phase: "Phase 8",
  },
];

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) return null;

  async function handleSignOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dashboard">
      <header className="dashboard__topbar">
        <div className="dashboard__brand">
          <span className="dashboard__mark" />
          VANTAGE
        </div>
        <div className="dashboard__topbar-right">
          <span className="connection-pill">
            <span className="connection-pill__dot" />
            Session active
          </span>
          <button className="dashboard__signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dashboard__content">
        <section className="identity-card">
          <div
            className="identity-card__avatar"
            style={{
              background: ROLE_AVATAR_BG[user.role],
              color: ROLE_AVATAR_COLOR[user.role],
            }}
          >
            {initials(user.name)}
          </div>
          <h2 className="identity-card__name">{user.name}</h2>
          <p className="identity-card__email mono">{user.email}</p>
          <RolePill role={user.role} />

          <div className="identity-card__row">
            <span className="identity-card__row-label">Hierarchy position</span>
            <span className="identity-card__row-value">
              {user.parentId ? "reports to a leader" : "root of organization"}
            </span>
          </div>
          <div className="identity-card__row">
            <span className="identity-card__row-label">Organization</span>
            <span className="identity-card__row-value">
              {user.organizationId.slice(0, 8)}…
            </span>
          </div>
          <div className="identity-card__row">
            <span className="identity-card__row-label">Status</span>
            <span className="identity-card__row-value">{user.status}</span>
          </div>
          <div className="identity-card__row">
            <span className="identity-card__row-label">Member since</span>
            <span className="identity-card__row-value">
              {new Date(user.createdAt).toLocaleDateString()}
            </span>
          </div>
        </section>

        <div className="dashboard__main-column">
          <HierarchyPanel />

          <section>
            <p className="dashboard__section-heading">Coming up</p>
            <div className="phase-grid">
              {UPCOMING_PHASES.map((p) => (
                <div className="phase-panel" key={p.title}>
                  <div className="phase-panel__title">{p.title}</div>
                  <p className="phase-panel__desc">{p.desc}</p>
                  <span className="phase-panel__tag">{p.phase}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
