'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ColorScheme = 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large';

interface ThemeContextValue {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colorScheme: 'light',
  fontSize: 'medium',
  setColorScheme: () => {},
  setFontSize: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>('light');
  const [fontSize, setFontSizeState] = useState<FontSize>('medium');

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('aso-color-scheme') as ColorScheme | null;
    const savedSize = localStorage.getItem('aso-font-size') as FontSize | null;
    if (saved === 'dark' || saved === 'light') setColorSchemeState(saved);
    if (savedSize === 'small' || savedSize === 'medium' || savedSize === 'large') {
      setFontSizeState(savedSize);
    }
  }, []);

  // Apply to <html> whenever values change
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', colorScheme);
    html.setAttribute('data-font-size', fontSize);
  }, [colorScheme, fontSize]);

  const setColorScheme = useCallback((s: ColorScheme) => {
    setColorSchemeState(s);
    localStorage.setItem('aso-color-scheme', s);
    document.documentElement.setAttribute('data-theme', s);
  }, []);

  const setFontSize = useCallback((s: FontSize) => {
    setFontSizeState(s);
    localStorage.setItem('aso-font-size', s);
    document.documentElement.setAttribute('data-font-size', s);
  }, []);

  return (
    <ThemeContext.Provider value={{ colorScheme, fontSize, setColorScheme, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
