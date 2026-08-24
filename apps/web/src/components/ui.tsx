import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { AlertCircle, CheckCircle2, Info, LoaderCircle, Search, X } from 'lucide-react';

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx('button', `button--${variant}`, `button--${size}`, className)}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cx('card', className)} {...props}>
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
};

export function Field({ label, hint, error, icon, className, id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <label className={cx('field', className)} htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <span className={cx('field__control', Boolean(icon) && 'field__control--icon')}>
        {icon}
        <input id={inputId} aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props} />
      </span>
      {error ? (
        <span className="field__error" id={`${inputId}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint" id={`${inputId}-hint`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <label className={cx('field', className)} htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <textarea id={inputId} aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props} />
      {error ? (
        <span className="field__error" id={`${inputId}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint" id={`${inputId}-hint`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  options,
  hint,
  error,
  className,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <label className={cx('field', className)} htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <select id={inputId} aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props}>
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="field__error" id={`${inputId}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint" id={`${inputId}-hint`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function SearchField({ className, ...props }: Omit<FieldProps, 'label' | 'icon'>) {
  return <Field className={cx('search-field', className)} icon={<Search aria-hidden="true" size={17} />} label="Search" {...props} />;
}

const pillTones: Record<string, string> = {
  ACTIVE: 'positive',
  SUCCESS: 'positive',
  CONFIRMED: 'positive',
  COMPLETED: 'positive',
  AVAILABLE: 'positive',
  OPEN: 'info',
  SCHEDULED: 'info',
  BOARDING: 'info',
  IN_PROGRESS: 'info',
  PENDING: 'warning',
  DELAYED: 'warning',
  POTENTIAL_MATCH: 'warning',
  MAINTENANCE: 'warning',
  CANCELLED: 'danger',
  FAILED: 'danger',
  INACTIVE: 'neutral',
  CLOSED: 'neutral',
  EXPIRED: 'neutral',
};

export function Pill({ children, tone }: { children: ReactNode; tone?: 'positive' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  const content = String(children);
  return <span className={cx('pill', `pill--${tone ?? pillTones[content] ?? 'neutral'}`)}>{children}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Skeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div aria-label="Loading" className={cx('skeleton-group', className)} role="status">
      {Array.from({ length: lines }, (_, index) => (
        <span className="skeleton" key={index} />
      ))}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('table-scroll', className)}>
      <table>{children}</table>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('modal-open');
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="presentation">
      <section aria-labelledby={titleId} aria-modal="true" className="modal" role="dialog">
        <header className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  notify: (message: Omit<ToastMessage, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let toastSequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const notify = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = ++toastSequence;
    setMessages((current) => [...current.slice(-3), { ...message, id }]);
    window.setTimeout(() => setMessages((current) => current.filter((toast) => toast.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <aside aria-live="polite" aria-relevant="additions" className="toast-region">
        {messages.map((message) => {
          const Icon = message.tone === 'success' ? CheckCircle2 : message.tone === 'error' ? AlertCircle : Info;
          return (
            <div className={cx('toast', `toast--${message.tone}`)} key={message.id} role="status">
              <Icon aria-hidden="true" size={20} />
              <div>
                <strong>{message.title}</strong>
                {message.description && <p>{message.description}</p>}
              </div>
              <button
                aria-label="Dismiss notification"
                className="icon-button"
                onClick={() => setMessages((current) => current.filter((toast) => toast.id !== message.id))}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          );
        })}
      </aside>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

export function InlineAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'warning' | 'info' | 'success';
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={cx('inline-alert', `inline-alert--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" size={18} />
      <div>{children}</div>
    </div>
  );
}
