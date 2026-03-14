export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  foreground: string;
}

export interface ThemeInfo {
  id: string;
  name: string;
  builtIn: boolean;
  modeSupport: 'both' | 'dark-only' | 'light-only';
  colors: {
    dark: ThemeColors;
    light: ThemeColors;
  };
}

export const BUILT_IN_THEMES: ThemeInfo[] = [
  {
    id: 'plannotator',
    name: 'Plannotator',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'oklch(0.75 0.18 280)', secondary: 'oklch(0.65 0.15 180)', accent: 'oklch(0.70 0.20 60)', background: 'oklch(0.15 0.02 260)', foreground: 'oklch(0.90 0.01 260)' },
      light: { primary: 'oklch(0.50 0.25 280)', secondary: 'oklch(0.50 0.18 180)', accent: 'oklch(0.60 0.22 50)', background: 'oklch(0.97 0.005 260)', foreground: 'oklch(0.18 0.02 260)' },
    },
  },
  {
    id: 'claude-plus',
    name: 'Claude+',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'oklch(0.6724 0.1308 38.7559)', secondary: 'oklch(0.9818 0.0054 95.0986)', accent: 'oklch(0.6724 0.1308 38.7559)', background: 'oklch(0.2679 0.0036 106.6427)', foreground: 'oklch(0.9576 0.0027 106.4494)' },
      light: { primary: 'oklch(0.6171 0.1375 39.0427)', secondary: 'oklch(0.9245 0.0138 92.9892)', accent: 'oklch(0.6171 0.1375 39.0427)', background: 'oklch(0.9818 0.0054 95.0986)', foreground: 'oklch(0.3438 0.0269 95.7226)' },
    },
  },
  {
    id: 'soft-pop',
    name: 'Soft Pop',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'oklch(0.6801 0.1583 276.9349)', secondary: 'oklch(0.7845 0.1325 181.9120)', accent: 'oklch(0.8790 0.1534 91.6054)', background: 'oklch(0 0 0)', foreground: 'oklch(1.0000 0 0)' },
      light: { primary: 'oklch(0.5106 0.2301 276.9656)', secondary: 'oklch(0.7038 0.1230 182.5025)', accent: 'oklch(0.7686 0.1647 70.0804)', background: 'oklch(0.9789 0.0082 121.6272)', foreground: 'oklch(0 0 0)' },
    },
  },
  {
    id: 'adwaita',
    name: 'Adwaita',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: '#3584E4', secondary: '#3a3a3a', accent: '#26a269', background: '#1d1d1d', foreground: '#cccccc' },
      light: { primary: '#3584E4', secondary: '#e6e6e6', accent: '#26a269', background: '#fafafa', foreground: '#323232' },
    },
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'rgb(193, 154, 107)', secondary: 'rgb(62, 47, 36)', accent: 'rgb(139, 90, 43)', background: 'rgb(30, 22, 16)', foreground: 'rgb(230, 220, 205)' },
      light: { primary: 'rgb(139, 90, 43)', secondary: 'rgb(232, 222, 210)', accent: 'rgb(193, 154, 107)', background: 'rgb(250, 245, 238)', foreground: 'rgb(40, 30, 20)' },
    },
  },
  {
    id: 'cyberdyne',
    name: 'Cyberdyne',
    builtIn: true,
    modeSupport: 'dark-only',
    colors: {
      dark: { primary: 'rgb(255, 0, 60)', secondary: 'rgb(35, 35, 40)', accent: 'rgb(0, 255, 200)', background: 'rgb(10, 10, 15)', foreground: 'rgb(230, 230, 240)' },
      light: { primary: 'rgb(255, 0, 60)', secondary: 'rgb(35, 35, 40)', accent: 'rgb(0, 255, 200)', background: 'rgb(10, 10, 15)', foreground: 'rgb(230, 230, 240)' },
    },
  },
  {
    id: 'cyberfunk',
    name: 'Cyberfunk',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'rgb(255, 0, 102)', secondary: 'rgb(40, 20, 50)', accent: 'rgb(0, 255, 204)', background: 'rgb(15, 5, 20)', foreground: 'rgb(240, 230, 250)' },
      light: { primary: 'rgb(200, 0, 80)', secondary: 'rgb(235, 225, 240)', accent: 'rgb(0, 180, 150)', background: 'rgb(250, 245, 252)', foreground: 'rgb(20, 10, 30)' },
    },
  },
  {
    id: 'doom-64',
    name: 'Doom 64',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'rgb(200, 30, 30)', secondary: 'rgb(40, 35, 30)', accent: 'rgb(255, 160, 0)', background: 'rgb(15, 12, 10)', foreground: 'rgb(220, 210, 190)' },
      light: { primary: 'rgb(180, 20, 20)', secondary: 'rgb(230, 225, 215)', accent: 'rgb(200, 120, 0)', background: 'rgb(248, 244, 238)', foreground: 'rgb(25, 20, 15)' },
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    builtIn: true,
    modeSupport: 'dark-only',
    colors: {
      dark: { primary: 'rgb(189, 147, 249)', secondary: 'rgb(68, 71, 90)', accent: 'rgb(139, 233, 253)', background: 'rgb(40, 42, 54)', foreground: 'rgb(248, 248, 242)' },
      light: { primary: 'rgb(189, 147, 249)', secondary: 'rgb(68, 71, 90)', accent: 'rgb(139, 233, 253)', background: 'rgb(40, 42, 54)', foreground: 'rgb(248, 248, 242)' },
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'rgb(69, 133, 136)', secondary: 'rgb(102, 92, 84)', accent: 'rgb(104, 157, 106)', background: 'rgb(40, 40, 40)', foreground: 'rgb(235, 219, 178)' },
      light: { primary: 'rgb(7, 102, 120)', secondary: 'rgb(213, 196, 161)', accent: 'rgb(66, 123, 88)', background: 'rgb(251, 241, 199)', foreground: 'rgb(40, 40, 40)' },
    },
  },
  {
    id: 'paulmillr',
    name: 'PaulMillr',
    builtIn: true,
    modeSupport: 'dark-only',
    colors: {
      dark: { primary: 'rgb(57, 197, 187)', secondary: 'rgb(40, 40, 40)', accent: 'rgb(169, 220, 118)', background: 'rgb(21, 21, 21)', foreground: 'rgb(248, 248, 248)' },
      light: { primary: 'rgb(57, 197, 187)', secondary: 'rgb(40, 40, 40)', accent: 'rgb(169, 220, 118)', background: 'rgb(21, 21, 21)', foreground: 'rgb(248, 248, 248)' },
    },
  },
  {
    id: 'quantum-rose',
    name: 'Quantum Rose',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'rgb(255, 100, 130)', secondary: 'rgb(40, 30, 35)', accent: 'rgb(180, 140, 255)', background: 'rgb(18, 12, 15)', foreground: 'rgb(240, 230, 235)' },
      light: { primary: 'rgb(200, 50, 80)', secondary: 'rgb(240, 230, 235)', accent: 'rgb(140, 100, 200)', background: 'rgb(252, 248, 250)', foreground: 'rgb(25, 15, 20)' },
    },
  },
  {
    id: 'solar-dusk',
    name: 'Solar Dusk',
    builtIn: true,
    modeSupport: 'both',
    colors: {
      dark: { primary: 'oklch(0.5553 0.1455 48.9975)', secondary: 'oklch(0.3127 0.039 49.5996)', accent: 'oklch(0.6755 0.1339 50.551)', background: 'oklch(0.2183 0.0268 49.7085)', foreground: 'oklch(0.8994 0.0347 70.7236)' },
      light: { primary: 'oklch(0.5553 0.1455 48.9975)', secondary: 'oklch(0.9139 0.0359 77.3089)', accent: 'oklch(0.6755 0.1339 50.551)', background: 'oklch(0.9685 0.0187 84.078)', foreground: 'oklch(0.366 0.0251 49.6085)' },
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    builtIn: true,
    modeSupport: 'dark-only',
    colors: {
      dark: { primary: 'rgb(0, 255, 0)', secondary: 'rgb(20, 20, 20)', accent: 'rgb(0, 200, 200)', background: 'rgb(0, 0, 0)', foreground: 'rgb(0, 255, 0)' },
      light: { primary: 'rgb(0, 255, 0)', secondary: 'rgb(20, 20, 20)', accent: 'rgb(0, 200, 200)', background: 'rgb(0, 0, 0)', foreground: 'rgb(0, 255, 0)' },
    },
  },
  {
    id: 'tinacious',
    name: 'Tinacious',
    builtIn: true,
    modeSupport: 'light-only',
    colors: {
      dark: { primary: 'rgb(214, 95, 149)', secondary: 'rgb(50, 50, 60)', accent: 'rgb(119, 220, 194)', background: 'rgb(28, 28, 36)', foreground: 'rgb(230, 230, 240)' },
      light: { primary: 'rgb(214, 95, 149)', secondary: 'rgb(232, 232, 237)', accent: 'rgb(119, 220, 194)', background: 'rgb(247, 247, 250)', foreground: 'rgb(28, 28, 36)' },
    },
  },
];
