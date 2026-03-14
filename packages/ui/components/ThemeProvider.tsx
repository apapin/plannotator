import { createContext, useContext, useEffect, useState } from 'react';
import { storage } from '../utils/storage';
import { BUILT_IN_THEMES, type ThemeInfo } from '../utils/themeRegistry';

type Mode = 'dark' | 'light' | 'system';

type ThemeProviderState = {
  // Mode (dark/light/system) — backward-compatible with old "theme" API
  theme: Mode;
  setTheme: (mode: Mode) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  // Color theme (palette)
  colorTheme: string;
  setColorTheme: (theme: string) => void;
  availableThemes: ThemeInfo[];
};

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: 'dark',
  setTheme: () => null,
  mode: 'dark',
  setMode: () => null,
  colorTheme: 'plannotator',
  setColorTheme: () => null,
  availableThemes: BUILT_IN_THEMES,
});

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Mode;
  defaultColorTheme?: string;
  storageKey?: string;
  colorThemeStorageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  defaultColorTheme = 'plannotator',
  storageKey = 'plannotator-theme',
  colorThemeStorageKey = 'plannotator-color-theme',
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<Mode>(
    () => (storage.getItem(storageKey) as Mode) || defaultTheme
  );

  const [colorTheme, setColorThemeState] = useState<string>(
    () => storage.getItem(colorThemeStorageKey) || defaultColorTheme
  );

  // Resolve whether the .light class should be applied, respecting theme's modeSupport
  const resolveClasses = (effectiveMode: 'dark' | 'light') => {
    const themeInfo = BUILT_IN_THEMES.find(t => t.id === colorTheme);
    const modeSupport = themeInfo?.modeSupport ?? 'both';

    let applyLight = effectiveMode === 'light';
    // Dark-only themes: never apply .light (would trigger light-mode CSS overrides on dark bg)
    if (modeSupport === 'dark-only') applyLight = false;
    // Light-only themes: always apply .light
    if (modeSupport === 'light-only') applyLight = true;

    return `theme-${colorTheme}${applyLight ? ' light' : ''}`;
  };

  // Apply theme class + mode class to document element
  useEffect(() => {
    const root = window.document.documentElement;

    let effectiveMode: 'dark' | 'light' = 'dark';
    if (mode === 'system') {
      effectiveMode = window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    } else {
      effectiveMode = mode;
    }

    root.className = resolveClasses(effectiveMode);
  }, [mode, colorTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (mode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      const root = window.document.documentElement;
      root.className = resolveClasses(mediaQuery.matches ? 'light' : 'dark');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mode, colorTheme]);

  const setMode = (newMode: Mode) => {
    storage.setItem(storageKey, newMode);
    setModeState(newMode);
  };

  const setColorTheme = (newTheme: string) => {
    storage.setItem(colorThemeStorageKey, newTheme);
    setColorThemeState(newTheme);
  };

  const value: ThemeProviderState = {
    // Backward compat: theme/setTheme map to mode/setMode
    theme: mode,
    setTheme: setMode,
    mode,
    setMode,
    colorTheme,
    setColorTheme,
    availableThemes: BUILT_IN_THEMES,
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
