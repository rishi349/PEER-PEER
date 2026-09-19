import type { ReactNode } from "react";
import { RadarSweepBackground } from "./RadarSweepBackground";
import "./AuthShell.css";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth-shell">
      <RadarSweepBackground />
      <div className="auth-shell__card">
        <div className="auth-shell__brand">
          <span className="auth-shell__mark" />
          <span className="auth-shell__brand-name">VANTAGE</span>
        </div>
        <p className="auth-shell__eyebrow">{eyebrow}</p>
        <h1 className="auth-shell__title">{title}</h1>
        <p className="auth-shell__subtitle">{subtitle}</p>
        <div className="auth-shell__body">{children}</div>
        <div className="auth-shell__footer">{footer}</div>
      </div>
    </div>
  );
}
