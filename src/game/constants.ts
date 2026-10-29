import { Theme, ThemeColors, Skin } from './types';

// Physics & Dimensions
export const GRAVITY = 0.44;
export const JUMP_VELOCITY = -7.6;
export const MAX_FALL_VELOCITY = 11.5;
export const BIRD_SIZE = 40;
export const HITBOX_PADDING = 6;
export const PIPE_WIDTH = 68;
export const GROUND_HEIGHT = 90;
export const REFERENCE_FRAME_MS = 1000 / 60;
export const POWERUP_DURATION_MS = 7000;
export const NEAR_MISS_DISTANCE = 22; // Pixels away from obstacle edge to trigger Near Miss

// Themes & Visual Palettes
export const THEMES: Record<Theme, ThemeColors> = {
  meadow: {
    bg: ['#4fc3f7', '#81d4fa', '#b3e5fc'],
    ground: '#c4b377',
    grass: '#4caf50',
    pipeFill: '#43a047',
    pipeBorder: '#2e7d32',
    pipeCap: '#66bb6a',
    accentGlow: 'rgba(76, 175, 80, 0.4)',
    graffiti: 'SUNSHINE MEADOW',
  },
  sea: {
    bg: ['#0d47a1', '#1565c0', '#1976d2'],
    ground: '#90a4ae',
    grass: '#00838f',
    pipeFill: '#00acc1',
    pipeBorder: '#006064',
    pipeCap: '#26c6da',
    accentGlow: 'rgba(0, 188, 212, 0.4)',
    graffiti: 'ABYSSAL REEF',
  },
  night: {
    bg: ['#12002f', '#240046', '#3c096c'],
    ground: '#2b2d42',
    grass: '#7b2cbf',
    pipeFill: '#9d4edd',
    pipeBorder: '#5a189a',
    pipeCap: '#c77dff',
    accentGlow: 'rgba(157, 78, 221, 0.5)',
    graffiti: 'NEON MIDNIGHT',
  },
  mountain: {
    bg: ['#264653', '#2a9d8f', '#e9c46a'],
    ground: '#6c757d',
    grass: '#e76f51',
    pipeFill: '#f4a261',
    pipeBorder: '#e76f51',
    pipeCap: '#f8bb7e',
    accentGlow: 'rgba(244, 162, 97, 0.4)',
    graffiti: 'SOLAR PEAKS',
  },
  cyber: {
    bg: ['#050505', '#0f172a', '#1e1b4b'],
    ground: '#090d16',
    grass: '#06b6d4',
    pipeFill: '#ec4899',
    pipeBorder: '#be185d',
    pipeCap: '#f472b6',
    accentGlow: 'rgba(236, 72, 153, 0.6)',
    graffiti: 'CYBERPUNK MATRIX',
  },
};

export const getThemeForLevel = (level: number): Theme => {
  const cycle = (level - 1) % 50;
  if (cycle < 10) return 'meadow';
  if (cycle < 20) return 'sea';
  if (cycle < 30) return 'night';
  if (cycle < 40) return 'mountain';
  return 'cyber';
};

// Calibrated difficulty progression
export const getDifficultyForLevel = (level: number) => {
  const speed = 3.0 + Math.min(level - 1, 25) * 0.12;
  const gap = Math.max(154, 195 - Math.min(level - 1, 20) * 2.0);
  const spawnDistance = 270;
  const spawnRateMs = (spawnDistance / speed) * REFERENCE_FRAME_MS;
  const dynamicObstacleChance = Math.min(0.55, Math.max(0, (level - 3) * 0.05));
  return { speed, gap, spawnRateMs, dynamicObstacleChance };
};

export const SKIN_PALETTES: Record<Skin, { primary: string; secondary: string; glow: string }> = {
  aviator: { primary: '#f59e0b', secondary: '#78350f', glow: 'rgba(245, 158, 11, 0.6)' },
  gold: { primary: '#fbbf24', secondary: '#b45309', glow: 'rgba(251, 191, 36, 0.5)' },
  blue: { primary: '#38bdf8', secondary: '#0369a1', glow: 'rgba(56, 189, 248, 0.5)' },
  pink: { primary: '#f472b6', secondary: '#be185d', glow: 'rgba(244, 114, 182, 0.5)' },
  green: { primary: '#4ade80', secondary: '#15803d', glow: 'rgba(74, 222, 128, 0.5)' },
  rainbow: { primary: '#a855f7', secondary: '#6366f1', glow: 'rgba(168, 85, 247, 0.7)' },
};
