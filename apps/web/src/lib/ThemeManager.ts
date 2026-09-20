export type Theme = 'light' | 'dark' | 'system';

// --- SINGLETON PATTERN ---
// The ThemeManager acts as a single source of truth for the application's theme.
// It encapsulates the logic for reading/writing to localStorage and observing system preferences.

class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: Theme = 'system';
  private resolvedTheme: 'light' | 'dark' = 'light';
  private listeners: Set<(theme: 'light' | 'dark') => void> = new Set();
  private mediaQuery: MediaQueryList | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);
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
    const savedTheme = localStorage.getItem('uniride-theme') as Theme | null;
    if (savedTheme) {
      this.setTheme(savedTheme);
    } else {
      this.setTheme('system');
    }
  }

  private handleSystemThemeChange = (e: MediaQueryListEvent) => {
    if (this.currentTheme === 'system') {
      this.resolvedTheme = e.matches ? 'dark' : 'light';
      this.applyTheme();
    }
  };

  private applyTheme() {
    const isDark = this.resolvedTheme === 'dark';
    
    // Apply class to HTML root
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // Notify observers
    this.listeners.forEach((listener) => listener(this.resolvedTheme));
  }

  public setTheme(theme: Theme) {
    this.currentTheme = theme;
    localStorage.setItem('uniride-theme', theme);

    if (theme === 'system') {
      this.resolvedTheme = this.mediaQuery?.matches ? 'dark' : 'light';
    } else {
      this.resolvedTheme = theme;
    }

    this.applyTheme();
  }

  public getTheme(): Theme {
    return this.currentTheme;
  }

  public getResolvedTheme(): 'light' | 'dark' {
    return this.resolvedTheme;
  }

  // --- OBSERVER PATTERN (Subject capabilities) ---
  public subscribe(listener: (theme: 'light' | 'dark') => void): () => void {
    this.listeners.add(listener);
    // Immediately notify the new listener of the current state
    listener(this.resolvedTheme);
    return () => this.listeners.delete(listener);
  }
}

export const themeManager = ThemeManager.getInstance();
