import { useNavigate } from "react-router-dom";
import { RadarContainer } from "../components/radar/RadarContainer";
import "./DashboardPage.css"; // reuses the existing topbar/content chrome (dashboard__*
                                // classes) deliberately, rather than duplicating it — see
                                // HANDOFF.md's Phase 7 section for the reasoning.
import "./RadarPage.css";

export function RadarPage() {
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <header className="dashboard__topbar">
        <div className="dashboard__brand">
          <span className="dashboard__mark" />
          VANTAGE
        </div>
        <button className="dashboard__signout" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </button>
      </header>

      <main className="radar-page__content">
        <h1 className="radar-page__heading">Radar</h1>
        <p className="radar-page__subheading">
          Authorized, discoverable users near you — filtered by role, never by proximity alone.
        </p>
        <RadarContainer />
      </main>
    </div>
  );
}
