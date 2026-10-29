export type GameState =
  | 'START'
  | 'PLAYING'
  | 'GAMEOVER'
  | 'PAUSED'
  | 'COUNTDOWN'
  | 'LOBBY'
  | 'MULTI_COUNTDOWN'
  | 'MULTI_PLAYING'
  | 'MULTI_GAMEOVER';

export type Skin = 'gold' | 'blue' | 'pink' | 'green' | 'rainbow' | 'aviator';

export type CollectibleType =
  | 'COIN'
  | 'GROW_EGG'
  | 'SHRINK_EGG'
  | 'RAINBOW_EGG'
  | 'MAGNET'
  | 'CHRONO';

export type ObstacleType = 'PIPE' | 'MOVING_PIPE' | 'LASER_GATE' | 'SPEED_RING';

export type Theme = 'meadow' | 'sea' | 'night' | 'mountain' | 'cyber';

export interface ThemeColors {
  bg: string[];
  ground: string;
  grass: string;
  pipeFill: string;
  pipeBorder: string;
  pipeCap: string;
  accentGlow: string;
  graffiti: string;
}

export interface PipeData {
  id: number;
  x: number;
  topHeight: number;
  bottomHeight: number;
  passed: boolean;
  type: ObstacleType;
  oscillationSpeed?: number;
  oscillationRange?: number;
  baseTopHeight?: number;
  nearMissAwarded?: boolean;
}

export interface Collectible {
  id: number;
  x: number;
  y: number;
  type: CollectibleType;
  collected: boolean;
  size?: number;
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'feather' | 'sparkle' | 'ring' | 'text';
  text?: string;
}

export interface MovingObject {
  id: number;
  x: number;
  y: number;
  size?: number;
  type?: string;
  speed?: number;
  yOffset?: number;
  scale?: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
}

export interface RemotePlayerRow {
  name: string;
  score: number;
  coins: number;
  extra_lives: number;
  updated_at?: string;
}

export interface PlayerProgress {
  name: string;
  score: number;
  coins: number;
  extraLives: number;
}

export interface OpponentState {
  name: string;
  skin: Skin;
  score: number;
  birdY: number;
  birdVel: number;
  alive: boolean;
  ready: boolean;
  lastUpdateTime: number;
}

export type RoomRole = 'host' | 'guest';
export type LobbyMode = 'menu' | 'create_waiting' | 'join_input' | 'join_waiting';
