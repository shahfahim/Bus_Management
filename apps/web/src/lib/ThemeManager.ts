export type Theme = 'light' | 'dark' | 'system';

// --- SINGLETON PATTERN ---
// The ThemeManager acts as a single source of truth for the application's theme.
// It encapsulates the logic for reading/writing to localStorage and observing system preferences.

class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: Theme = 'light';
  private resolvedTheme: 'light' | 'dark' = 'light';
  private listeners: Set<(theme: 'light' | 'dark') => void> = new Set();

  private constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  private init() {
    this.setTheme('light');
  }

  private applyTheme() {
    document.documentElement.classList.remove('dark');
    this.listeners.forEach((listener) => listener(this.resolvedTheme));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public setTheme(_theme?: Theme) {
    this.currentTheme = 'light';
    this.resolvedTheme = 'light';
    localStorage.setItem('uniride-theme', 'light');
    this.applyTheme();
  }

  public getTheme(): Theme {
    return this.currentTheme;
  }

  public getResolvedTheme(): 'light' | 'dark' {
    return this.resolvedTheme;
  }

  public subscribe(listener: (theme: 'light' | 'dark') => void): () => void {
    this.listeners.add(listener);
    listener(this.resolvedTheme);
    return () => this.listeners.delete(listener);
  }
}

export const themeManager = ThemeManager.getInstance();
