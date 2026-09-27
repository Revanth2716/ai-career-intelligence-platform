import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button className={`btn btn-${variant}`} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

export function TextArea({
  label,
  ...props
}: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea {...props} />
    </label>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? 'var(--ok)' : score >= 40 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="score-ring" style={{ borderColor: color }}>
      <div className="score-value" style={{ color }}>
        {score}
      </div>
      <div className="score-label">/100</div>
    </div>
  );
}

export function SkillChip({ skill, tone = 'default', title }: { skill: string; tone?: 'default' | 'good' | 'warn' | 'bad'; title?: string }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {skill}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="spinner">{label}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="error-note">{message}</div>;
}
