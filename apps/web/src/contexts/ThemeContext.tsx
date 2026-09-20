import React, { createContext, useContext, useEffect, useState } from 'react';
import { themeManager, Theme } from '../lib/ThemeManager';

// --- OBSERVER PATTERN ---
// ThemeContext acts as the mechanism to distribute the theme state to all React components.
// Components "observe" changes to the context value.

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(themeManager.getTheme());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(themeManager.getResolvedTheme());

  useEffect(() => {
    // Subscribe to ThemeManager (Subject)
    const unsubscribe = themeManager.subscribe((newResolvedTheme) => {
      setResolvedTheme(newResolvedTheme);
      setThemeState(themeManager.getTheme());
    });

    return () => unsubscribe();
  }, []);

  const setTheme = (newTheme: Theme) => {
    themeManager.setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
