import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  TextInput,
  StatusBar,
  TouchableWithoutFeedback,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Ably from 'ably';

// Game constants
const GRAVITY = 0.5;
const JUMP = -8;
const PIPE_WIDTH = 65;
const BIRD_SIZE = 34;
const HITBOX_PADDING = 8; // Hitbox further from bird edges
const GROUND_HEIGHT = 100;
const BASE_PIPE_SPAWN_INTERVAL = 1800;
const REFERENCE_FRAME_MS = 1000 / 60;
const POWERUP_DURATION_MS = 6000;

// Multiplayer constants
const ABLY_API_KEY = process.env.EXPO_PUBLIC_ABLY_API_KEY || '';
const ABLY_ENABLED = Boolean(ABLY_API_KEY);
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OPPONENT_UPDATE_INTERVAL = 50;
const OPPONENT_STALE_TIMEOUT = 5000;

const PLAYER_NAME_KEY = 'flappyPlayerName';
const LEADERBOARD_KEY = 'flappyLeaderboard';
const COINS_KEY = 'flappyCoins';
const EXTRA_LIVES_KEY = 'flappyExtraLives';

const RAW_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL = RAW_SUPABASE_URL ? RAW_SUPABASE_URL.replace(/\/+$/, '') : '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_TABLE = process.env.EXPO_PUBLIC_SUPABASE_TABLE || 'flappy_leaderboard';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

type GameState = 'START' | 'PLAYING' | 'GAMEOVER' | 'PAUSED' | 'COUNTDOWN' | 'LOBBY' | 'MULTI_COUNTDOWN' | 'MULTI_PLAYING' | 'MULTI_GAMEOVER';
type Skin = 'gold' | 'blue' | 'pink' | 'green' | 'rainbow';
type CollectibleType = 'GROW_EGG' | 'SHRINK_EGG' | 'COIN' | 'RAINBOW_EGG';
type RoomRole = 'host' | 'guest';
type LobbyMode = 'menu' | 'create_waiting' | 'join_input' | 'join_waiting';
type Theme = 'meadow' | 'sea' | 'night' | 'mountain';

const THEME_COLORS: Record<Theme, { bg: string; ground: string; grass: string; graffiti: string }> = {
  meadow:   { bg: '#70c5ce', ground: '#ded895', grass: '#73bf2e', graffiti: 'FLIPPY BARD 2026' },
  sea:      { bg: '#1a5276', ground: '#c2b280', grass: '#154360', graffiti: 'DEEP SEA VIBES' },
  night:    { bg: '#0a0a2e', ground: '#1a1a2e', grass: '#0d1f0d', graffiti: 'MIDNIGHT FLIGHT' },
  mountain: { bg: '#5b9bd5', ground: '#808080', grass: '#6b8e6b', graffiti: 'PEAK PERFORMANCE' },
};

const getTheme = (lvl: number): Theme => {
  const c = ((lvl - 1) % 48);
  if (c < 11) return 'meadow';
  if (c < 24) return 'sea';
  if (c < 36) return 'night';
  return 'mountain';
};

interface PipeData {
  x: number;
  topHeight: number;
  bottomHeight: number;
  passed: boolean;
}

interface LeaderboardEntry {
  name: string;
  score: number;
}

interface RemotePlayerRow {
  name: string;
  score: number;
  coins: number;
  extra_lives: number;
  updated_at?: string;
}

interface PlayerProgress {
  name: string;
  score: number;
  coins: number;
  extraLives: number;
}

interface MovingObject {
  id: number;
  x: number;
  y: number;
  size?: number;
  type?: string | CollectibleType;
  speed?: number;
  yOffset?: number;
  scale?: number;
  collected: boolean;
}

interface OpponentState {
  name: string;
  skin: Skin;
  score: number;
  birdY: number;
  birdVel: number;
  alive: boolean;
  ready: boolean;
  lastUpdateTime: number;
}

const SKIN_STYLES: Record<Skin, { fill: string; border: string }> = {
  gold: { fill: '#f1c40f', border: '#d35400' },
  blue: { fill: '#3498db', border: '#2980b9' },
  pink: { fill: '#e84393', border: '#c0392b' },
  green: { fill: '#2ecc71', border: '#27ae60' },
  rainbow: { fill: 'transparent', border: '#6c5ce7' },
};

const RAINBOW_COLORS: readonly [string, string, ...string[]] = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#8b00ff'];

const sanitizeName = (rawName: string) => (rawName.trim() || 'Anonymous').slice(0, 12);
const clampNonNegativeInt = (value: number) => Math.max(0, Math.floor(value));

const normalizeLeaderboard = (entries: LeaderboardEntry[]) => {
  const deduped = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const name = sanitizeName(entry.name);
    const score = clampNonNegativeInt(entry.score);
    const key = name.toLowerCase();
    const existing = deduped.get(key);
    if (!existing || score > existing.score) deduped.set(key, { name, score });
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score).slice(0, 10);
};

const getBestScoreForName = (entries: LeaderboardEntry[], name: string) => {
  const key = sanitizeName(name).toLowerCase();
  return entries.reduce((best, entry) => {
    if (sanitizeName(entry.name).toLowerCase() !== key) return best;
    return Math.max(best, clampNonNegativeInt(entry.score));
  }, 0);
};

const supabaseHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
});

const supabaseEndpoint = (query = '') => `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}${query}`;

const toRemotePlayerRow = (value: unknown): RemotePlayerRow | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as {
    name?: unknown;
    score?: unknown;
    coins?: unknown;
    extra_lives?: unknown;
    updated_at?: unknown;
  };
  if (typeof row.name !== 'string') return null;
  const score = typeof row.score === 'number' ? row.score : Number(row.score ?? 0);
  const coins = typeof row.coins === 'number' ? row.coins : Number(row.coins ?? 0);
  const extraLives = typeof row.extra_lives === 'number' ? row.extra_lives : Number(row.extra_lives ?? 0);
  if (!Number.isFinite(score) || !Number.isFinite(coins) || !Number.isFinite(extraLives)) return null;
  return {
    name: sanitizeName(row.name),
    score: clampNonNegativeInt(score),
    coins: clampNonNegativeInt(coins),
    extra_lives: clampNonNegativeInt(extraLives),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
};

const fetchRemotePlayerState = async (name: string): Promise<RemotePlayerRow | null> => {
  if (!SUPABASE_ENABLED) return null;
  const encodedName = encodeURIComponent(sanitizeName(name));
  const response = await fetch(
    supabaseEndpoint(`?select=name,score,coins,extra_lives,updated_at&name=eq.${encodedName}&limit=1`),
    { headers: supabaseHeaders() }
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return toRemotePlayerRow(rows[0]);
};

const upsertRemotePlayerState = async (progress: PlayerProgress): Promise<void> => {
  if (!SUPABASE_ENABLED) return;
  const safeName = sanitizeName(progress.name);
  const existingRow = await fetchRemotePlayerState(safeName);
  const payload = {
    name: safeName,
    score: Math.max(existingRow?.score ?? 0, clampNonNegativeInt(progress.score)),
    coins: clampNonNegativeInt(progress.coins),
    extra_lives: clampNonNegativeInt(progress.extraLives),
    updated_at: new Date().toISOString(),
  };
  const headers = { ...supabaseHeaders(), Prefer: 'return=minimal' };
  if (existingRow) {
    await fetch(supabaseEndpoint(`?name=eq.${encodeURIComponent(safeName)}`), {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    });
    return;
  }
  await fetch(supabaseEndpoint(), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
};

const fetchRemoteLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  if (!SUPABASE_ENABLED) return [];
  try {
    const response = await fetch(
      supabaseEndpoint('?select=name,score&order=score.desc&limit=10'),
      { headers: supabaseHeaders() }
    );
    if (!response.ok) return [];
    const rows = (await response.json()) as unknown[];
    if (!Array.isArray(rows)) return [];
    return rows
      .map(r => {
        if (!r || typeof r !== 'object') return null;
        const row = r as { name?: unknown; score?: unknown };
        if (typeof row.name !== 'string') return null;
        const s = typeof row.score === 'number' ? row.score : Number(row.score);
        if (!Number.isFinite(s)) return null;
        return { name: sanitizeName(row.name), score: clampNonNegativeInt(s) };
      })
      .filter((e): e is LeaderboardEntry => e !== null);
  } catch (e) {
    return [];
  }
};

const syncLocalLeaderboardToRemote = async (entries: LeaderboardEntry[]): Promise<void> => {
  if (!SUPABASE_ENABLED) return;
  for (const entry of entries) {
    try {
      const safeName = sanitizeName(entry.name);
      const safeScore = clampNonNegativeInt(entry.score);
      const existing = await fetchRemotePlayerState(safeName);
      if (existing && existing.score >= safeScore) continue;
      const payload = {
        name: safeName,
        score: safeScore,
        coins: existing?.coins ?? 0,
        extra_lives: existing?.extra_lives ?? 0,
        updated_at: new Date().toISOString(),
      };
      const headers = { ...supabaseHeaders(), Prefer: 'return=minimal' };
      if (existing) {
        await fetch(supabaseEndpoint(`?name=eq.${encodeURIComponent(safeName)}`), {
          method: 'PATCH', headers, body: JSON.stringify(payload),
        });
      } else {
        await fetch(supabaseEndpoint(), {
          method: 'POST', headers, body: JSON.stringify(payload),
        });
      }
    } catch (e) {}
  }
};

const generateRoomCode = () => {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
};

// --- Custom Drawn Components ---

type GradientColors = readonly [string, string, ...string[]];

const DrawEgg = ({ type, colors }: { type: CollectibleType, colors?: GradientColors }) => {
  let eggColor = '#fff';
  if (type === 'GROW_EGG') eggColor = '#2ecc71';
  if (type === 'SHRINK_EGG') eggColor = '#3498db';
  return (
    <View style={styles.eggContainer}>
      <View style={[styles.eggBody, { backgroundColor: eggColor }]}>
        {colors && <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />}
        <View style={styles.eggHighlight} />
      </View>
    </View>
  );
};

const DrawShell = ({ type, colors }: { type: CollectibleType, colors?: GradientColors }) => (
  <View style={styles.shellContainer}>
    <View style={[styles.shellMain, { backgroundColor: type === 'GROW_EGG' ? '#2ecc71' : '#3498db' }]}>
      {colors && <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />}
      <View style={styles.shellGroove} /><View style={[styles.shellGroove, { left: 10 }]} /><View style={[styles.shellGroove, { left: 18 }]} />
    </View>
  </View>
);

const DrawRabbit = () => (
  <View style={styles.rabbitBody}>
    <View style={styles.rabbitEarLeft} /><View style={styles.rabbitEarRight} />
    <View style={styles.rabbitTail} /><View style={styles.rabbitEye} />
  </View>
);

const DrawFish = () => (
  <View style={styles.fishBody}>
    <View style={styles.fishTailFin} /><View style={styles.fishEyeSmall} />
  </View>
);

const DrawSeaweed = () => (
  <View style={styles.seaweedContainer}>
    <View style={styles.seaweedStalk} />
    <View style={[styles.seaweedLeaf, { left: -6, top: 5 }]} />
    <View style={[styles.seaweedLeaf, { right: -6, top: 15 }]} />
    <View style={[styles.seaweedLeaf, { left: -5, top: 28 }]} />
  </View>
);

const DrawOwl = () => (
  <View style={styles.owlBody}>
    <View style={styles.owlEarLeft} /><View style={styles.owlEarRight} />
    <View style={styles.owlEyeLeft}><View style={styles.owlPupil} /></View>
    <View style={styles.owlEyeRight}><View style={styles.owlPupil} /></View>
    <View style={styles.owlBeak} />
  </View>
);

const DrawEagle = () => (
  <View style={styles.eagleBody}>
    <View style={styles.eagleHead} />
    <View style={styles.eagleWing} />
    <View style={styles.eagleBeak} />
    <View style={styles.eagleEye} />
  </View>
);

const DrawPineTree = () => (
  <View style={styles.pineContainer}>
    <View style={[styles.pineTriangle, { bottom: 30, width: 24, borderBottomWidth: 18 }]} />
    <View style={[styles.pineTriangle, { bottom: 18, width: 30, borderBottomWidth: 20 }]} />
    <View style={[styles.pineTriangle, { bottom: 4, width: 36, borderBottomWidth: 22 }]} />
    <View style={styles.pineTrunk} />
  </View>
);

const DrawDeadTree = () => (
  <View style={styles.deadTreeContainer}>
    <View style={styles.deadTreeTrunk} />
    <View style={styles.deadTreeBranchLeft} />
    <View style={styles.deadTreeBranchRight} />
    <View style={styles.deadTreeBranchSmall} />
  </View>
);

// --- Main App ---

export default function App() {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [gameState, setGameState] = useState<GameState>('START');
  const [birdPos, setBirdPos] = useState(SCREEN_HEIGHT / 2);
  const [birdVel, setBirdVel] = useState(0);
  const [pipes, setPipes] = useState<PipeData[]>([]);
  const [score, setScore] = useState(0);
  const [playerName, setPlayerName] = useState('Player 1');
  const [skin, setSkin] = useState<Skin>('gold');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalCoins, setTotalCoins] = useState(0);
  const [extraLives, setExtraLives] = useState(0);
  const [sizeMultiplier, setSizeMultiplier] = useState(1);
  const [activePowerup, setActivePowerup] = useState<CollectibleType | null>(null);
  const [wallImmunityCount, setWallImmunityCount] = useState(0);
  const [countdown, setCountdown] = useState(3);

  const [clouds, setClouds] = useState<MovingObject[]>([]);
  const [animals, setAnimals] = useState<MovingObject[]>([]);
  const [bushes, setBushes] = useState<MovingObject[]>([]);
  const [collectibles, setCollectibles] = useState<MovingObject[]>([]);

  // Multiplayer state
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [lobbyMode, setLobbyMode] = useState<LobbyMode>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomRole, setRoomRole] = useState<RoomRole>('host');
  const [lobbyError, setLobbyError] = useState('');
  const [opponent, setOpponent] = useState<OpponentState | null>(null);
  const [multiplayerWinner, setMultiplayerWinner] = useState<'me' | 'them' | 'draw' | null>(null);

  const birdPosRef = useRef(birdPos);
  const birdVelRef = useRef(birdVel);
  const pipesRef = useRef<PipeData[]>(pipes);
  const scoreRef = useRef(score);
  const gameStateRef = useRef<GameState>(gameState);
  const playerNameRef = useRef(playerName);
  const leaderboardRef = useRef<LeaderboardEntry[]>(leaderboard);
  const sizeMultiplierRef = useRef(1);
  const wallImmunityRef = useRef(0);
  const totalCoinsRef = useRef(0);
  const extraLivesRef = useRef(0);
  const collectiblesRef = useRef<MovingObject[]>([]);

  // Multiplayer refs
  const ablyRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<any>(null);
  const isMultiplayerRef = useRef(false);
  const opponentRef = useRef<OpponentState | null>(null);
  const lastPositionBroadcastRef = useRef(0);
  const roomCodeRef = useRef('');
  const skinRef = useRef<Skin>(skin);

  const level = Math.floor(score / 5) + 1;
  const theme: Theme = getTheme(level);

  const requestRef = useRef<number>();
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastPipeSpawnRef = useRef<number>(0);
  const gameOverHandledRef = useRef(false);
  const powerupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const remoteSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const persistLeaderboard = useCallback(async (nextBoard: LeaderboardEntry[]) => {
    leaderboardRef.current = nextBoard;
    setLeaderboard(nextBoard);
    await AsyncStorage.setItem(LEADERBOARD_KEY, JSON.stringify(nextBoard));
  }, []);

  const persistPlayerInventory = useCallback(async (coins: number, lives: number) => {
    await Promise.all([
      AsyncStorage.setItem(COINS_KEY, clampNonNegativeInt(coins).toString()),
      AsyncStorage.setItem(EXTRA_LIVES_KEY, clampNonNegativeInt(lives).toString()),
    ]);
  }, []);

  const syncRemotePlayerProgress = useCallback(async (scoreOverride?: number) => {
    if (!SUPABASE_ENABLED) return;
    await upsertRemotePlayerState({
      name: playerNameRef.current,
      score: scoreOverride ?? getBestScoreForName(leaderboardRef.current, playerNameRef.current),
      coins: totalCoinsRef.current,
      extraLives: extraLivesRef.current,
    });
  }, []);

  const scheduleRemotePlayerSync = useCallback(() => {
    if (!SUPABASE_ENABLED) return;
    if (remoteSyncTimeoutRef.current) clearTimeout(remoteSyncTimeoutRef.current);
    remoteSyncTimeoutRef.current = setTimeout(() => {
      remoteSyncTimeoutRef.current = null;
      void syncRemotePlayerProgress();
    }, 500);
  }, [syncRemotePlayerProgress]);

  const flushRemotePlayerSync = useCallback(async (scoreOverride?: number) => {
    if (!SUPABASE_ENABLED) return;
    if (remoteSyncTimeoutRef.current) {
      clearTimeout(remoteSyncTimeoutRef.current);
      remoteSyncTimeoutRef.current = null;
    }
    await syncRemotePlayerProgress(scoreOverride);
  }, [syncRemotePlayerProgress]);

  const updateLeaderboard = useCallback(async (finalScore: number) => {
    const safeScore = clampNonNegativeInt(finalScore);
    const name = sanitizeName(playerNameRef.current);
    const nextLocalBoard = normalizeLeaderboard([...leaderboardRef.current, { name, score: safeScore }]);
    await persistLeaderboard(nextLocalBoard);
    if (SUPABASE_ENABLED) {
      try {
        await flushRemotePlayerSync(safeScore);
      } catch (e) {}
    }
  }, [flushRemotePlayerSync, persistLeaderboard]);

  // --- Multiplayer: determine winner ---
  const determineWinner = useCallback(async (myScore: number, theirScore: number) => {
    let winner: 'me' | 'them' | 'draw';
    if (myScore > theirScore) winner = 'me';
    else if (theirScore > myScore) winner = 'them';
    else winner = 'draw';
    setMultiplayerWinner(winner);
    setGameState('MULTI_GAMEOVER');
    gameStateRef.current = 'MULTI_GAMEOVER';
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = undefined; }
    // Save winner's score to leaderboard
    if (winner === 'me' || winner === 'draw') {
      await updateLeaderboard(myScore);
    }
    await persistPlayerInventory(totalCoinsRef.current, extraLivesRef.current);
  }, [updateLeaderboard, persistPlayerInventory]);

  const handleGameOver = useCallback(async () => {
    if (gameOverHandledRef.current) return;
    gameOverHandledRef.current = true;

    if (isMultiplayerRef.current) {
      // Broadcast gameover to opponent
      try {
        channelRef.current?.publish('gameover', { score: scoreRef.current });
      } catch (e) {}

      const opp = opponentRef.current;
      if (opp && !opp.alive) {
        // Both dead - determine winner
        await determineWinner(scoreRef.current, opp.score);
      } else {
        // Opponent still alive - stop our game loop, wait for their gameover
        if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = undefined; }
        setGameState('MULTI_PLAYING'); // Stay in MULTI_PLAYING but we're dead
        gameStateRef.current = 'MULTI_PLAYING';
      }
      return;
    }

    setGameState('GAMEOVER'); gameStateRef.current = 'GAMEOVER';
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = undefined; }
    await updateLeaderboard(scoreRef.current);
    await persistPlayerInventory(totalCoinsRef.current, extraLivesRef.current);
  }, [persistPlayerInventory, updateLeaderboard, determineWinner]);

  const resetGame = useCallback(() => {
    if (powerupTimerRef.current) clearTimeout(powerupTimerRef.current);
    gameOverHandledRef.current = false;
    setBirdPos(SCREEN_HEIGHT / 2); birdPosRef.current = SCREEN_HEIGHT / 2;
    setBirdVel(0); birdVelRef.current = 0;
    setPipes([]); pipesRef.current = [];
    setScore(0); scoreRef.current = 0;
    setGameState('START'); gameStateRef.current = 'START';
    lastFrameTimeRef.current = null; lastPipeSpawnRef.current = 0;
    setSizeMultiplier(1); sizeMultiplierRef.current = 1;
    setActivePowerup(null); wallImmunityRef.current = 0; setWallImmunityCount(0);
    setCollectibles([]); collectiblesRef.current = [];
  }, [SCREEN_HEIGHT]);

  const startCountdown = useCallback((initialCount: number = 3) => {
    setGameState('COUNTDOWN');
    gameStateRef.current = 'COUNTDOWN';
    setCountdown(initialCount);
    let count = initialCount;
    const interval = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count === 0) {
        clearInterval(interval);
        setGameState('PLAYING');
        gameStateRef.current = 'PLAYING';
        // Add an initial jump boost
        setBirdVel(JUMP);
        birdVelRef.current = JUMP;
        lastFrameTimeRef.current = null;
      }
    }, 1000);
  }, []);

  const handleRevive = useCallback(async () => {
    if (extraLives > 0) {
      const nextLives = extraLives - 1;
      setExtraLives(nextLives);
      extraLivesRef.current = nextLives;
      await persistPlayerInventory(totalCoinsRef.current, nextLives);
      if (SUPABASE_ENABLED) {
        try {
          await flushRemotePlayerSync();
        } catch (e) {}
      }

      // Only clear pipes that are very close to the bird's current X position
      const birdX = SCREEN_WIDTH / 2;
      pipesRef.current = pipesRef.current.filter(p => Math.abs(p.x - birdX) > 80);
      setPipes([...pipesRef.current]);

      setBirdPos(SCREEN_HEIGHT / 2); birdPosRef.current = SCREEN_HEIGHT / 2;
      setBirdVel(0); birdVelRef.current = 0;
      gameOverHandledRef.current = false;
      startCountdown();
    }
  }, [extraLives, SCREEN_HEIGHT, SCREEN_WIDTH, flushRemotePlayerSync, persistPlayerInventory, startCountdown]);

  const togglePause = useCallback(() => {
    if (gameStateRef.current === 'PLAYING') {
      setGameState('PAUSED');
      gameStateRef.current = 'PAUSED';
    } else if (gameStateRef.current === 'PAUSED') {
      startCountdown();
    }
  }, [startCountdown]);

  const buyExtraLife = async () => {
    if (totalCoins >= 100) {
      const nextCoins = totalCoins - 100;
      const nextLives = extraLives + 1;
      setTotalCoins(nextCoins);
      setExtraLives(nextLives);
      totalCoinsRef.current = nextCoins;
      extraLivesRef.current = nextLives;
      await persistPlayerInventory(nextCoins, nextLives);
      if (SUPABASE_ENABLED) {
        try {
          await flushRemotePlayerSync();
        } catch (e) {}
      }
    }
  };

  // --- Multiplayer: Ably connection management ---

  const disconnectFromRoom = useCallback(() => {
    if (channelRef.current) {
      try { channelRef.current.unsubscribe(); } catch (e) {}
      channelRef.current = null;
    }
    if (ablyRef.current) {
      try { ablyRef.current.close(); } catch (e) {}
      ablyRef.current = null;
    }
    isMultiplayerRef.current = false;
    setIsMultiplayer(false);
    opponentRef.current = null;
    setOpponent(null);
    setRoomCode('');
    roomCodeRef.current = '';
    setLobbyMode('menu');
    setLobbyError('');
    setMultiplayerWinner(null);
  }, []);

  const startMultiplayerGame = useCallback(() => {
    // Reset game state for multiplayer
    if (powerupTimerRef.current) clearTimeout(powerupTimerRef.current);
    gameOverHandledRef.current = false;
    setBirdPos(SCREEN_HEIGHT / 2); birdPosRef.current = SCREEN_HEIGHT / 2;
    setBirdVel(0); birdVelRef.current = 0;
    setPipes([]); pipesRef.current = [];
    setScore(0); scoreRef.current = 0;
    lastFrameTimeRef.current = null; lastPipeSpawnRef.current = 0;
    setSizeMultiplier(1); sizeMultiplierRef.current = 1;
    setActivePowerup(null); wallImmunityRef.current = 0; setWallImmunityCount(0);
    setCollectibles([]); collectiblesRef.current = [];
    lastPositionBroadcastRef.current = 0;
    setMultiplayerWinner(null);

    // Reset opponent game state (keep name/skin)
    if (opponentRef.current) {
      opponentRef.current = { ...opponentRef.current, score: 0, birdY: SCREEN_HEIGHT / 2, birdVel: 0, alive: true };
      setOpponent({ ...opponentRef.current });
    }

    // Start 3-2-1 countdown -> MULTI_PLAYING
    setGameState('MULTI_COUNTDOWN');
    gameStateRef.current = 'MULTI_COUNTDOWN';
    setCountdown(3);
    let count = 3;
    const interval = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count === 0) {
        clearInterval(interval);
        setGameState('MULTI_PLAYING');
        gameStateRef.current = 'MULTI_PLAYING';
        lastFrameTimeRef.current = null;
        // Initial flap
        setBirdVel(JUMP); birdVelRef.current = JUMP;
      }
    }, 1000);
  }, [SCREEN_HEIGHT]);

  const setupChannelSubscriptions = useCallback((channel: any, role: RoomRole) => {
    channel.subscribe('join', (message: any) => {
      if (role === 'host') {
        // Guest joined
        if (opponentRef.current) {
          // Room already has an opponent
          channel.publish('room_full', {});
          return;
        }
        const data = message.data;
        const opp: OpponentState = {
          name: sanitizeName(data.name || 'Guest'),
          skin: data.skin || 'gold',
          score: 0,
          birdY: 0,
          birdVel: 0,
          alive: true,
          ready: true,
          lastUpdateTime: Date.now(),
        };
        opponentRef.current = opp;
        setOpponent(opp);
        // Send host info back
        channel.publish('host_info', {
          name: playerNameRef.current,
          skin: skinRef.current,
        });
      }
    });

    channel.subscribe('host_info', (message: any) => {
      if (role === 'guest') {
        const data = message.data;
        const opp: OpponentState = {
          name: sanitizeName(data.name || 'Host'),
          skin: data.skin || 'gold',
          score: 0,
          birdY: 0,
          birdVel: 0,
          alive: true,
          ready: true,
          lastUpdateTime: Date.now(),
        };
        opponentRef.current = opp;
        setOpponent(opp);
        setLobbyError('');
      }
    });

    channel.subscribe('start', () => {
      startMultiplayerGame();
    });

    channel.subscribe('tap', (message: any) => {
      const data = message.data;
      if (opponentRef.current) {
        opponentRef.current = {
          ...opponentRef.current,
          birdY: data.birdY ?? opponentRef.current.birdY,
          birdVel: data.birdVel ?? opponentRef.current.birdVel,
          lastUpdateTime: Date.now(),
        };
        setOpponent({ ...opponentRef.current });
      }
    });

    channel.subscribe('position', (message: any) => {
      const data = message.data;
      if (opponentRef.current) {
        opponentRef.current = {
          ...opponentRef.current,
          birdY: data.birdY ?? opponentRef.current.birdY,
          birdVel: data.birdVel ?? opponentRef.current.birdVel,
          score: data.score ?? opponentRef.current.score,
          lastUpdateTime: Date.now(),
        };
        setOpponent({ ...opponentRef.current });
      }
    });

    channel.subscribe('score', (message: any) => {
      const data = message.data;
      if (opponentRef.current) {
        opponentRef.current = {
          ...opponentRef.current,
          score: data.score ?? opponentRef.current.score,
          lastUpdateTime: Date.now(),
        };
        setOpponent({ ...opponentRef.current });
      }
    });

    channel.subscribe('gameover', (message: any) => {
      const data = message.data;
      if (opponentRef.current) {
        opponentRef.current = {
          ...opponentRef.current,
          alive: false,
          score: data.score ?? opponentRef.current.score,
          lastUpdateTime: Date.now(),
        };
        setOpponent({ ...opponentRef.current });

        // If we're also dead, determine winner
        if (gameOverHandledRef.current) {
          void determineWinner(scoreRef.current, opponentRef.current.score);
        }
      }
    });

    channel.subscribe('room_full', () => {
      setLobbyError('Room is full!');
      disconnectFromRoom();
    });

    channel.subscribe('rematch', () => {
      startMultiplayerGame();
    });
  }, [startMultiplayerGame, determineWinner, disconnectFromRoom]);

  const connectToRoom = useCallback((code: string, role: RoomRole) => {
    if (!ABLY_ENABLED) {
      setLobbyError('Multiplayer not configured (missing ABLY API key)');
      return;
    }
    try {
      const ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: `player_${Date.now()}_${Math.random().toString(36).slice(2)}` });
      ablyRef.current = ably;

      ably.connection.on('connected', () => {
        const channel = ably.channels.get(`room:${code}`);
        channelRef.current = channel;
        setupChannelSubscriptions(channel, role);

        if (role === 'guest') {
          channel.publish('join', {
            name: playerNameRef.current,
            skin: skinRef.current,
          });
        }
      });

      ably.connection.on('failed', () => {
        setLobbyError('Connection failed. Please try again.');
        disconnectFromRoom();
      });

      // Timeout for join_waiting guests
      if (role === 'guest') {
        setTimeout(() => {
          if (!opponentRef.current) {
            setLobbyError('Room not found or host unavailable.');
            disconnectFromRoom();
          }
        }, 10000);
      }
    } catch (e) {
      setLobbyError('Failed to connect. Please try again.');
    }
  }, [setupChannelSubscriptions, disconnectFromRoom]);

  // --- Multiplayer: Lobby flow ---

  const handleCreateRoom = useCallback(() => {
    const code = generateRoomCode();
    setRoomCode(code);
    roomCodeRef.current = code;
    setRoomRole('host');
    setLobbyMode('create_waiting');
    setLobbyError('');
    isMultiplayerRef.current = true;
    setIsMultiplayer(true);
    connectToRoom(code, 'host');
  }, [connectToRoom]);

  const handleJoinRoom = useCallback(() => {
    const code = roomCodeInput.trim().toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) {
      setLobbyError('Room code must be 6 characters');
      return;
    }
    setRoomCode(code);
    roomCodeRef.current = code;
    setRoomRole('guest');
    setLobbyMode('join_waiting');
    setLobbyError('');
    isMultiplayerRef.current = true;
    setIsMultiplayer(true);
    connectToRoom(code, 'guest');
  }, [roomCodeInput, connectToRoom]);

  const handleHostStart = useCallback(() => {
    if (channelRef.current && opponentRef.current) {
      channelRef.current.publish('start', {});
      startMultiplayerGame();
    }
  }, [startMultiplayerGame]);

  const handleRematch = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.publish('rematch', {});
      startMultiplayerGame();
    }
  }, [startMultiplayerGame]);

  const handleMultiplayerHome = useCallback(() => {
    disconnectFromRoom();
    resetGame();
  }, [disconnectFromRoom, resetGame]);

  const applyPowerupEffect = useCallback((type: CollectibleType) => {
    if (powerupTimerRef.current) {
      clearTimeout(powerupTimerRef.current);
      powerupTimerRef.current = null;
    }

    if (type === 'RAINBOW_EGG') {
      wallImmunityRef.current = 4;
      setWallImmunityCount(4);
      setActivePowerup(type);
      setSizeMultiplier(1); sizeMultiplierRef.current = 1;
      return;
    }

    setActivePowerup(type);
    setSizeMultiplier(1); sizeMultiplierRef.current = 1;

    if (type === 'GROW_EGG') {
      setSizeMultiplier(1.7); sizeMultiplierRef.current = 1.4;
    }
    else if (type === 'SHRINK_EGG') {
      setSizeMultiplier(0.6); sizeMultiplierRef.current = 0.6;
    }

    powerupTimerRef.current = setTimeout(() => {
      setSizeMultiplier(1); sizeMultiplierRef.current = 1; setActivePowerup(null);
      powerupTimerRef.current = null;
    }, POWERUP_DURATION_MS);
  }, []);

  const spawnPipe = useCallback((timestamp: number) => {
    const curLevel = Math.floor(scoreRef.current / 5) + 1;
    const curSpeedBase = (curLevel >= 12 ? 3.7 : 3.0) + Math.min((curLevel - 1) * 0.35, 3.0);
    const spawnRate = Math.max(650, (320 / curSpeedBase) * REFERENCE_FRAME_MS);

    if (timestamp - lastPipeSpawnRef.current > spawnRate) {
      const currentGap = curLevel >= 12 ? 160 : 185;
      const minPipeH = 60;
      const maxPipeH = SCREEN_HEIGHT - GROUND_HEIGHT - currentGap - minPipeH;

      const lastPipe = pipesRef.current[pipesRef.current.length - 1];
      const lastTopH = lastPipe ? lastPipe.topHeight : SCREEN_HEIGHT / 2 - currentGap / 2;
      const moveRange = 250;
      let topH = Math.floor(lastTopH + (Math.random() * moveRange - moveRange / 2));
      topH = Math.max(minPipeH, Math.min(maxPipeH, topH));

      pipesRef.current = [...pipesRef.current, { x: SCREEN_WIDTH, topHeight: topH, bottomHeight: SCREEN_HEIGHT - GROUND_HEIGHT - topH - currentGap, passed: false }];
      setPipes([...pipesRef.current]);
      lastPipeSpawnRef.current = timestamp;

      if (Math.random() > 0.7) {
        const rand = Math.random();
        let type: CollectibleType = 'COIN';
        if (curLevel >= 5 && rand > 0.88) type = 'GROW_EGG';
        else if (rand > 0.75) type = 'SHRINK_EGG';
        else if (rand > 0.7) type = 'RAINBOW_EGG';
        const newCollectible = { id: timestamp, x: SCREEN_WIDTH + 15, y: topH + (currentGap/2) - 15, type, collected: false };
        collectiblesRef.current = [...collectiblesRef.current, newCollectible];
        setCollectibles([...collectiblesRef.current]);
      }
    }
  }, [SCREEN_HEIGHT, SCREEN_WIDTH]);

  const gameLoop = useCallback((timestamp: number) => {
    if (gameStateRef.current !== 'PLAYING' && gameStateRef.current !== 'MULTI_PLAYING') return;
    // If we're dead in multiplayer, don't run our physics
    if (gameStateRef.current === 'MULTI_PLAYING' && gameOverHandledRef.current) return;

    if (lastFrameTimeRef.current === null) { lastFrameTimeRef.current = timestamp; requestRef.current = requestAnimationFrame(gameLoop); return; }
    const frameScale = Math.min((timestamp - lastFrameTimeRef.current) / REFERENCE_FRAME_MS, 2.5);
    lastFrameTimeRef.current = timestamp;

    const curSize = BIRD_SIZE * sizeMultiplierRef.current;
    const nextBirdVel = birdVelRef.current + GRAVITY * frameScale;
    const nextBirdPos = birdPosRef.current + birdVelRef.current * frameScale;
    if (nextBirdPos >= SCREEN_HEIGHT - GROUND_HEIGHT - curSize || nextBirdPos <= 0) { handleGameOver(); return; }
    setBirdPos(nextBirdPos); setBirdVel(nextBirdVel);
    birdPosRef.current = nextBirdPos; birdVelRef.current = nextBirdVel;

    spawnPipe(timestamp);
    const curLevel = Math.floor(scoreRef.current / 5) + 1;
    const curSpeed = ( (curLevel >= 12 ? 3.7 : 3.0) + Math.min((curLevel - 1) * 0.35, 3.0) ) * frameScale;

    const curTheme = getTheme(curLevel);
    const cloudSpeedMap: Record<Theme, number> = { meadow: 0.3, sea: 0.1, night: 0.15, mountain: 0.25 };
    setClouds(prev => prev.map(c => {
      const nx = c.x - (curSpeed * cloudSpeedMap[curTheme]);
      const ny = curTheme === 'sea' ? c.y - 0.5 : c.y;
      return { ...c, x: nx, y: ny };
    }).map(c => (c.x + (c.size||0) < -100 || c.y < -100) ? { ...c, x: SCREEN_WIDTH + 100, y: curTheme === 'sea' ? SCREEN_HEIGHT : Math.random() * 200 + 50 } : c));
    setAnimals(prev => prev.map(a => ({ ...a, x: a.x - (curSpeed + (a.speed||0)), yOffset: Math.abs(Math.sin((timestamp + (a.x * 10)) / 200)) * 12 })).map(a => a.x < -100 ? { ...a, x: SCREEN_WIDTH + 100 } : a));
    setBushes(prev => prev.map(b => ({ ...b, x: b.x - curSpeed })).map(b => b.x < -150 ? { ...b, x: SCREEN_WIDTH + 150 } : b));

    const birdX = SCREEN_WIDTH / 2 - curSize / 2;
    const bL = birdX + HITBOX_PADDING;
    const bR = birdX + curSize - HITBOX_PADDING;
    const bT = nextBirdPos + HITBOX_PADDING;
    const bB = nextBirdPos + curSize - HITBOX_PADDING;

    let hitCollectible: CollectibleType | 'COIN' | null = null;
    collectiblesRef.current = collectiblesRef.current.map(c => {
      if (c.collected) return { ...c, x: c.x - curSpeed };
      const mx = c.x - curSpeed;
      if (bR > mx && bL < mx + 35 && bB > c.y && bT < c.y + 35) {
        hitCollectible = c.type as any;
        return { ...c, x: mx, collected: true };
      }
      return { ...c, x: mx };
    }).filter(c => c.x + 100 > 0);
    setCollectibles([...collectiblesRef.current]);

    if (hitCollectible) {
      if (hitCollectible === 'COIN') {
        totalCoinsRef.current += 1; setTotalCoins(totalCoinsRef.current);
        void persistPlayerInventory(totalCoinsRef.current, extraLivesRef.current);
        scheduleRemotePlayerSync();
      } else {
        applyPowerupEffect(hitCollectible as CollectibleType);
      }
    }

    let scoredCount = 0; let pipeCollided = false;
    pipesRef.current = pipesRef.current.map(p => ({ ...p, x: p.x - curSpeed })).filter(p => p.x + PIPE_WIDTH > 0).map(pipe => {
      if (bR > pipe.x && bL < pipe.x + PIPE_WIDTH && (bT < pipe.topHeight || bB > SCREEN_HEIGHT - GROUND_HEIGHT - pipe.bottomHeight)) {
        if (wallImmunityRef.current > 0) {
          wallImmunityRef.current -= 1; setWallImmunityCount(wallImmunityRef.current);
          if (wallImmunityRef.current === 0) setActivePowerup(null);
          return { ...pipe, passed: true };
        }
        pipeCollided = true;
      }
      if (!pipe.passed && bL > pipe.x + PIPE_WIDTH) { scoredCount += 1; return { ...pipe, passed: true }; }
      return pipe;
    });
    setPipes([...pipesRef.current]);
    if (scoredCount > 0) {
      setScore(s => { const n = s + scoredCount; scoreRef.current = n; return n; });
      // Broadcast score in multiplayer
      if (isMultiplayerRef.current && channelRef.current) {
        try { channelRef.current.publish('score', { score: scoreRef.current + scoredCount }); } catch (e) {}
      }
    }
    if (pipeCollided) { handleGameOver(); return; }

    // Broadcast position periodically in multiplayer
    if (isMultiplayerRef.current && channelRef.current && timestamp - lastPositionBroadcastRef.current > OPPONENT_UPDATE_INTERVAL) {
      lastPositionBroadcastRef.current = timestamp;
      try {
        channelRef.current.publish('position', {
          birdY: birdPosRef.current,
          birdVel: birdVelRef.current,
          score: scoreRef.current,
        });
      } catch (e) {}
    }

    requestRef.current = requestAnimationFrame(gameLoop);
  }, [handleGameOver, spawnPipe, applyPowerupEffect, SCREEN_HEIGHT, SCREEN_WIDTH, persistPlayerInventory, scheduleRemotePlayerSync]);

  const flap = useCallback(() => {
    if (gameStateRef.current === 'PLAYING' || gameStateRef.current === 'MULTI_PLAYING') {
      if (gameStateRef.current === 'MULTI_PLAYING' && gameOverHandledRef.current) return;
      setBirdVel(JUMP);
      birdVelRef.current = JUMP;
      // Broadcast tap in multiplayer
      if (isMultiplayerRef.current && channelRef.current) {
        try {
          channelRef.current.publish('tap', {
            birdY: birdPosRef.current,
            birdVel: JUMP,
          });
        } catch (e) {}
      }
    }
  }, []);

  const handleStartGame = useCallback(() => {
    resetGame();
    startCountdown(2);
  }, [resetGame, startCountdown]);

  const handleTryAgain = useCallback(() => {
    resetGame();
    startCountdown();
  }, [resetGame, startCountdown]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleKeyDown = (e: any) => {
        if (e.key === ' ' || e.key === 'ArrowUp') {
          if (gameStateRef.current === 'PLAYING' || gameStateRef.current === 'MULTI_PLAYING') flap();
        } else if (e.key === 'Escape') {
          if (gameStateRef.current !== 'MULTI_PLAYING' && gameStateRef.current !== 'MULTI_COUNTDOWN') {
            togglePause();
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [flap, togglePause]);

  useEffect(() => {
    const loadData = async () => {
      const [sc, sn, sb, sl] = await Promise.all([AsyncStorage.getItem(COINS_KEY), AsyncStorage.getItem(PLAYER_NAME_KEY), AsyncStorage.getItem(LEADERBOARD_KEY), AsyncStorage.getItem(EXTRA_LIVES_KEY)]);
      const storedName = sanitizeName(sn || 'Player 1');
      const localCoins = clampNonNegativeInt(sc ? parseInt(sc, 10) : 0);
      const localLives = clampNonNegativeInt(sl ? parseInt(sl, 10) : 0);
      const lb = normalizeLeaderboard(toLeaderboardEntries(sb ? JSON.parse(sb) : []));
      const localBestScore = getBestScoreForName(lb, storedName);
      const hasLocalProgress = localCoins > 0 || localLives > 0 || localBestScore > 0;

      totalCoinsRef.current = localCoins;
      extraLivesRef.current = localLives;
      playerNameRef.current = storedName;
      leaderboardRef.current = lb;

      setTotalCoins(localCoins);
      setExtraLives(localLives);
      setPlayerName(storedName);
      setLeaderboard(lb);
      await AsyncStorage.setItem(PLAYER_NAME_KEY, storedName);

      if (SUPABASE_ENABLED) {
        try {
          // Fetch full remote leaderboard and merge with local
          const remoteBoard = await fetchRemoteLeaderboard();
          const mergedBoard = normalizeLeaderboard([...lb, ...remoteBoard]);
          await persistLeaderboard(mergedBoard);

          // Sync all local leaderboard entries to Supabase
          if (lb.length > 0) {
            await syncLocalLeaderboardToRemote(lb);
          }

          // Sync current player's coins/lives
          const remoteState = await fetchRemotePlayerState(storedName);
          if (remoteState) {
            if (hasLocalProgress) {
              const needsRemoteUpdate =
                localCoins !== remoteState.coins ||
                localLives !== remoteState.extra_lives ||
                localBestScore > remoteState.score;
              if (needsRemoteUpdate) {
                await upsertRemotePlayerState({
                  name: storedName,
                  score: Math.max(localBestScore, remoteState.score),
                  coins: localCoins,
                  extraLives: localLives,
                });
              }
            } else {
              totalCoinsRef.current = remoteState.coins;
              extraLivesRef.current = remoteState.extra_lives;
              setTotalCoins(remoteState.coins);
              setExtraLives(remoteState.extra_lives);
              await persistPlayerInventory(remoteState.coins, remoteState.extra_lives);
            }
          } else if (hasLocalProgress) {
            await upsertRemotePlayerState({
              name: storedName,
              score: localBestScore,
              coins: localCoins,
              extraLives: localLives,
            });
          }
        } catch (e) {}
      }
    };
    loadData();
  }, [persistLeaderboard, persistPlayerInventory]);

  useEffect(() => {
    setAnimals([{ id:1, x: 100, y:0, speed: 1.2, collected: false }, { id:2, x: 350, y:0, speed: theme === 'sea' ? 0.5 : 0.8, collected: false }]);
    if (theme === 'meadow') {
      setBushes([{ id:1, x: 50, y:0, scale: 1, collected: false }, { id:2, x: 250, y:0, scale: 0.8, collected: false }, { id:3, x: 450, y:0, scale: 1.1, collected: false }]);
    } else if (theme === 'sea') {
      setBushes([{ id:1, x: 80, y:0, scale: 1, collected: false }, { id:2, x: 280, y:0, scale: 0.8, collected: false }, { id:3, x: 480, y:0, scale: 1.1, collected: false }]);
    } else if (theme === 'night') {
      setBushes([{ id:1, x: 60, y:0, scale: 1, collected: false }, { id:2, x: 260, y:0, scale: 0.9, collected: false }, { id:3, x: 460, y:0, scale: 1.1, collected: false }]);
    } else {
      setBushes([{ id:1, x: 70, y:0, scale: 1, collected: false }, { id:2, x: 270, y:0, scale: 0.8, collected: false }, { id:3, x: 470, y:0, scale: 1.1, collected: false }]);
    }
    const cloudY = theme === 'sea' ? SCREEN_HEIGHT : undefined;
    setClouds(Array.from({ length: 6 }).map((_, i) => ({ id:i, x: (i * SCREEN_WIDTH / 2), y: cloudY ?? (Math.random() * 200 + 50), size: Math.random() * 60 + 50, collected: false })));
  }, [SCREEN_WIDTH, SCREEN_HEIGHT, theme]);

  useEffect(() => {
    birdPosRef.current = birdPos; birdVelRef.current = birdVel; scoreRef.current = score; gameStateRef.current = gameState;
    playerNameRef.current = playerName; sizeMultiplierRef.current = sizeMultiplier;
    totalCoinsRef.current = totalCoins; extraLivesRef.current = extraLives;
    skinRef.current = skin; isMultiplayerRef.current = isMultiplayer;
  }, [birdPos, birdVel, score, gameState, playerName, sizeMultiplier, totalCoins, extraLives, skin, isMultiplayer]);

  useEffect(() => {
    if (gameState === 'PLAYING' || gameState === 'MULTI_PLAYING') {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [gameLoop, gameState]);

  useEffect(() => () => {
    if (remoteSyncTimeoutRef.current) clearTimeout(remoteSyncTimeoutRef.current);
    // Cleanup multiplayer on unmount
    if (channelRef.current) {
      try { channelRef.current.unsubscribe(); } catch (e) {}
    }
    if (ablyRef.current) {
      try { ablyRef.current.close(); } catch (e) {}
    }
  }, []);

  const birdVisualSize = BIRD_SIZE * sizeMultiplier;
  let birdBodyColor = skin === 'rainbow' ? 'transparent' : SKIN_STYLES[skin].fill;
  let birdBorderColor = SKIN_STYLES[skin].border;
  let birdBeakColor = '#e67e22';
  let birdBeakBorder = '#d35400';

  if (activePowerup === 'GROW_EGG') {
    birdBodyColor = '#2ecc71';
    birdBorderColor = '#27ae60';
  } else if (activePowerup === 'SHRINK_EGG') {
    birdBodyColor = '#3498db';
    birdBorderColor = '#2980b9';
    birdBeakColor = '#f39c12';
  }

  const showRainbow = activePowerup === 'RAINBOW_EGG' || (skin === 'rainbow' && !activePowerup);

  const toLeaderboardEntries = (value: unknown): LeaderboardEntry[] => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { name?: unknown; score?: unknown };
      if (typeof row.name !== 'string') return null;
      const numericScore = typeof row.score === 'number' ? row.score : Number(row.score);
      if (!Number.isFinite(numericScore)) return null;
      return { name: row.name, score: numericScore };
    }).filter((entry): entry is LeaderboardEntry => entry !== null);
  };

  // Opponent stale check
  const opponentIsStale = opponent ? (Date.now() - opponent.lastUpdateTime > OPPONENT_STALE_TIMEOUT) : false;

  return (
    <View
      style={[styles.container, { backgroundColor: THEME_COLORS[theme].bg }]}
      onStartShouldSetResponder={() => true}
      onResponderGrant={() => { if (gameState === 'PLAYING' || gameState === 'MULTI_PLAYING') flap(); }}
    >
      <StatusBar hidden />
      {clouds.map((c, i) => ( <View key={`cloud-${i}`} style={[theme === 'sea' ? styles.bubble : theme === 'night' ? styles.nightCloud : styles.cloud, { left: c.x, top: c.y, width: c.size, height: (c.size||0) * (theme === 'sea' ? 1 : 0.6), borderRadius: (c.size||0) / 2 }]} /> ))}

      {/* Moon and stars for night theme */}
      {theme === 'night' && (
        <>
          <View style={styles.moon}>
            <View style={[styles.moonCrater, { top: 8, left: 10, width: 10, height: 10 }]} />
            <View style={[styles.moonCrater, { top: 22, left: 25, width: 7, height: 7 }]} />
            <View style={[styles.moonCrater, { top: 14, left: 30, width: 5, height: 5 }]} />
          </View>
          {[{x:30,y:40,s:3},{x:80,y:100,s:2},{x:150,y:30,s:3},{x:200,y:80,s:2},{x:50,y:180,s:2},{x:120,y:150,s:3},{x:250,y:50,s:2},{x:300,y:120,s:3},{x:180,y:200,s:2},{x:350,y:30,s:2},{x:20,y:250,s:3},{x:280,y:180,s:2},{x:160,y:70,s:2},{x:90,y:220,s:3},{x:320,y:90,s:2}].map((star, i) => (
            <View key={`star-${i}`} style={[styles.star, { left: star.x % SCREEN_WIDTH, top: star.y, width: star.s, height: star.s, borderRadius: star.s / 2 }]} />
          ))}
        </>
      )}

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.coinBadge}><Text style={styles.coinIcon}>🪙</Text><Text style={styles.coinCount}>{totalCoins}</Text></View>
          <View style={[styles.coinBadge, {backgroundColor: 'rgba(231,76,60,0.6)'}]}><Text style={styles.coinIcon}>❤️</Text><Text style={styles.coinCount}>{extraLives}</Text></View>
        </View>

        <View style={styles.scoreArea}>
          <Text style={styles.scoreText}>{score}</Text>
          <View style={styles.levelBadge}><Text style={styles.levelText}>LVL {level}</Text></View>
        </View>

        {gameState !== 'MULTI_PLAYING' && gameState !== 'MULTI_COUNTDOWN' && (
          <TouchableOpacity style={styles.pauseBtn} onPress={togglePause}>
            <Text style={{fontSize: 24}}>{gameState === 'PAUSED' ? '▶️' : '⏸️'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.bird, { left: SCREEN_WIDTH / 2 - birdVisualSize / 2, top: birdPos, width: birdVisualSize, height: birdVisualSize, borderRadius: birdVisualSize/2, backgroundColor: showRainbow ? 'transparent' : birdBodyColor, borderColor: birdBorderColor, transform: [{ rotate: `${Math.min(Math.max(birdVel * 3, -25), 90)}deg` }] }]}>
        {showRainbow && <LinearGradient colors={RAINBOW_COLORS} style={[StyleSheet.absoluteFill, { borderRadius: birdVisualSize/2 }]} />}
        {activePowerup === 'RAINBOW_EGG' && <View style={styles.immunityBadge}><Text style={{fontSize: 10, color: 'white'}}>{wallImmunityCount}</Text></View>}
        <View style={[styles.birdTail, { borderLeftColor: birdBorderColor, left: -birdVisualSize/3, top: birdVisualSize/3 }]} />
        <View style={[styles.birdWing, { width: birdVisualSize/1.5, height: birdVisualSize/2, left: birdVisualSize/10, top: birdVisualSize/3 }]} />
        <View style={[styles.birdBigEye, { width: birdVisualSize/2.5, height: birdVisualSize/2.5, right: birdVisualSize/10, top: birdVisualSize/10, backgroundColor: 'white' }]}><View style={[styles.birdPupil, { width: birdVisualSize/8, height: birdVisualSize/8 }]} /></View>
        <View style={[styles.birdBeakUpper, { width: birdVisualSize/2, height: birdVisualSize/3.5, right: -birdVisualSize/3, top: birdVisualSize/2.5, backgroundColor: birdBeakColor, borderColor: birdBeakBorder }]} /><View style={[styles.birdBeakLower, { width: birdVisualSize/2.5, height: birdVisualSize/4, right: -birdVisualSize/4, top: birdVisualSize/1.6, backgroundColor: birdBeakColor, borderColor: birdBeakBorder }]} />
      </View>

      {collectibles.map((c) => !c.collected && (
        <View key={c.id} style={[styles.collectible, { left: c.x, top: c.y }]}>
          {c.type === 'COIN' ? <Text style={{fontSize: 24}}>🪙</Text> :
           theme === 'sea' ? <DrawShell type={c.type as CollectibleType} colors={c.type === 'RAINBOW_EGG' ? RAINBOW_COLORS : undefined} /> :
           <DrawEgg type={c.type as CollectibleType} colors={c.type === 'RAINBOW_EGG' ? RAINBOW_COLORS : undefined} />}
        </View>
      ))}

      {pipes.map((pipe, i) => (
        <React.Fragment key={i}>
          {/* Top pipe */}
          <View style={[
            theme === 'sea' ? styles.coral : theme === 'night' ? styles.stonePipe : theme === 'mountain' ? styles.pipe : styles.pipe,
            styles.pipeTop, { left: pipe.x, top: 0, height: pipe.topHeight }
          ]}>
            {theme === 'meadow' && <><View style={styles.logBark} /><View style={styles.logBarkAlt} /><View style={styles.logEnd} /></>}
            {theme === 'sea' && <><View style={[styles.coralPolyp, { top: 10, left: 8 }]} /><View style={[styles.coralPolyp, { top: 30, right: 10, backgroundColor: '#f1948a' }]} /><View style={[styles.coralPolyp, { bottom: 20, left: 15, backgroundColor: '#fadbd8' }]} /></>}
            {theme === 'night' && <><View style={[styles.stoneCrack, { left: 12, top: 10, height: '40%' }]} /><View style={[styles.stoneCrack, { right: 18, top: '30%', height: '30%' }]} /><View style={[styles.stoneMoss, { bottom: 0 }]} /></>}
            {theme === 'mountain' && <><View style={styles.logBark} /><View style={styles.logBarkAlt} /><View style={styles.logEnd} /><View style={styles.treePipeLeafCluster}><View style={styles.treePipeLeaf} /><View style={[styles.treePipeLeaf, { left: 10 }]} /><View style={[styles.treePipeLeaf, { left: 5, top: -8 }]} /></View></>}
          </View>
          {/* Bottom pipe */}
          <View style={[
            theme === 'sea' ? styles.coral : theme === 'night' ? styles.stonePipe : theme === 'mountain' ? styles.pipe : styles.pipe,
            styles.pipeBottom, { left: pipe.x, bottom: GROUND_HEIGHT, height: pipe.bottomHeight }
          ]}>
            {theme === 'meadow' && <><View style={styles.logBark} /><View style={styles.logBarkAlt} /><View style={[styles.logEnd, { top: 0, bottom: undefined }]} /></>}
            {theme === 'sea' && <><View style={[styles.coralPolyp, { top: 15, left: 10 }]} /><View style={[styles.coralPolyp, { top: 35, right: 8, backgroundColor: '#f1948a' }]} /><View style={[styles.coralPolyp, { top: 55, left: 20, backgroundColor: '#fadbd8' }]} /></>}
            {theme === 'night' && <><View style={[styles.stoneCrack, { left: 15, top: '20%', height: '35%' }]} /><View style={[styles.stoneCrack, { right: 12, top: '50%', height: '25%' }]} /><View style={[styles.stoneMoss, { top: 0, bottom: undefined }]} /></>}
            {theme === 'mountain' && <><View style={styles.logBark} /><View style={styles.logBarkAlt} /><View style={[styles.logEnd, { top: 0, bottom: undefined }]} /><View style={[styles.treePipeLeafCluster, { top: 0, bottom: undefined }]}><View style={styles.treePipeLeaf} /><View style={[styles.treePipeLeaf, { left: 10 }]} /><View style={[styles.treePipeLeaf, { left: 5, top: 8 }]} /></View></>}
          </View>
        </React.Fragment>
      ))}
      <View style={[styles.ground, { backgroundColor: THEME_COLORS[theme].ground }]}>
        {/* Sea waves at ground top */}
        {theme === 'sea' && (
          <View style={styles.waveContainer}>
            {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400].map((wx, i) => (
              <View key={`wave-${i}`} style={[styles.wave, { left: wx }]} />
            ))}
          </View>
        )}

        {/* Mountain peaks in background */}
        {theme === 'mountain' && (
          <>
            <View style={[styles.mountainPeak, { left: 20, borderBottomWidth: 50, borderLeftWidth: 40, borderRightWidth: 40 }]}>
              <View style={[styles.snowCap, { borderBottomWidth: 15, borderLeftWidth: 12, borderRightWidth: 12 }]} />
            </View>
            <View style={[styles.mountainPeak, { left: 140, borderBottomWidth: 65, borderLeftWidth: 50, borderRightWidth: 50 }]}>
              <View style={[styles.snowCap, { borderBottomWidth: 18, borderLeftWidth: 14, borderRightWidth: 14 }]} />
            </View>
            <View style={[styles.mountainPeak, { left: 300, borderBottomWidth: 45, borderLeftWidth: 35, borderRightWidth: 35 }]}>
              <View style={[styles.snowCap, { borderBottomWidth: 12, borderLeftWidth: 10, borderRightWidth: 10 }]} />
            </View>
          </>
        )}

        {/* Ground decorations per theme */}
        {theme === 'meadow' && bushes.map((b, i) => (
          <View key={`bush-${i}`} style={[styles.bushWrapper, { left: b.x, transform: [{ scale: b.scale||1 }] }]}>
            <View style={[styles.bushCircle, { width: 40, height: 40, bottom: 0, left: 0, backgroundColor: '#2d5a27' }]} />
            <View style={[styles.bushCircle, { width: 50, height: 50, bottom: 10, left: 15, backgroundColor: '#3a7d32' }]} />
            <View style={[styles.bushCircle, { width: 35, height: 35, bottom: 0, left: 45, backgroundColor: '#2d5a27' }]} />
          </View>
        ))}
        {theme === 'sea' && bushes.map((b, i) => (
          <View key={`seaweed-${i}`} style={[styles.bushWrapper, { left: b.x, transform: [{ scale: b.scale||1 }] }]}>
            <DrawSeaweed />
          </View>
        ))}
        {theme === 'night' && bushes.map((b, i) => (
          <View key={`deadtree-${i}`} style={[styles.bushWrapper, { left: b.x, transform: [{ scale: b.scale||1 }] }]}>
            <DrawDeadTree />
          </View>
        ))}
        {theme === 'mountain' && bushes.map((b, i) => (
          <View key={`pine-${i}`} style={[styles.bushWrapper, { left: b.x, transform: [{ scale: b.scale||1 }] }]}>
            <DrawPineTree />
          </View>
        ))}

        <View style={[styles.groundGrass, { backgroundColor: THEME_COLORS[theme].grass }]} />
        {animals.map((a, i) => (
          <View key={`animal-${i}`} style={[styles.animalContainer, { left: a.x, bottom: 88 + (a.yOffset||0) }]}>
            {theme === 'sea' ? <DrawFish /> : theme === 'night' ? <DrawOwl /> : theme === 'mountain' ? <DrawEagle /> : <DrawRabbit />}
          </View>
        ))}
        <Text style={styles.graffiti}>{THEME_COLORS[theme].graffiti}</Text>
      </View>

      {/* Opponent mini-panel during multiplayer */}
      {(gameState === 'MULTI_PLAYING' || gameState === 'MULTI_COUNTDOWN') && opponent && (
        <View style={styles.opponentPanel}>
          <View style={styles.opponentHeader}>
            <Text style={styles.opponentName} numberOfLines={1}>{opponent.name}</Text>
            <Text style={styles.opponentScore}>{opponent.score}</Text>
          </View>
          <View style={styles.opponentGameArea}>
            {/* Simplified opponent bird */}
            <View style={[
              styles.opponentBird,
              {
                top: Math.max(0, Math.min((SCREEN_HEIGHT - GROUND_HEIGHT - 20) * 0.4, opponent.birdY * 0.4)),
                backgroundColor: SKIN_STYLES[opponent.skin]?.fill || '#f1c40f',
                borderColor: SKIN_STYLES[opponent.skin]?.border || '#d35400',
                transform: [{ rotate: `${Math.min(Math.max(opponent.birdVel * 3, -25), 90)}deg` }],
              }
            ]} />
            {!opponent.alive && (
              <View style={styles.opponentEliminated}>
                <Text style={styles.opponentEliminatedText}>ELIMINATED</Text>
              </View>
            )}
            {opponentIsStale && opponent.alive && (
              <View style={styles.opponentDisconnected}>
                <Text style={styles.opponentDisconnectedText}>DISCONNECTED?</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {gameState === 'START' && (
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.overlayScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>FLIPPY BARD</Text>

            <View style={styles.simpleStore}>
              <Text style={styles.storeText}>Extra Life: 100 🪙</Text>
              <TouchableOpacity style={[styles.buyBtn, totalCoins < 100 && {backgroundColor: '#95a5a6'}]} onPress={buyExtraLife}>
                <Text style={styles.buyText}>BUY ❤️</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputArea}>
              <TextInput
                style={styles.nameInput}
                value={playerName}
                onChangeText={(t) => setPlayerName(t)}
                onEndEditing={() => {
                  const nextName = sanitizeName(playerName);
                  setPlayerName(nextName);
                  playerNameRef.current = nextName;
                  void AsyncStorage.setItem(PLAYER_NAME_KEY, nextName);
                }}
                placeholder="Name"
                maxLength={12}
              />
              <View style={styles.skinSelector}>
                {(['gold', 'blue', 'pink', 'green', 'rainbow'] as Skin[]).map(s => (
                  <TouchableOpacity key={s} onPress={() => setSkin(s)} style={[styles.skinOption, skin === s && styles.skinActive]}>
                    {s === 'rainbow' ? <LinearGradient colors={RAINBOW_COLORS} style={styles.rainbowOption} /> : <View style={{ flex: 1, backgroundColor: SKIN_STYLES[s].fill, borderColor: SKIN_STYLES[s].border, borderWidth: 2, borderRadius: 20 }} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.btn} onPress={handleStartGame}><Text style={styles.btnText}>START GAME</Text></TouchableOpacity>

            {ABLY_ENABLED && (
              <TouchableOpacity
                style={styles.multiBtn}
                onPress={() => { setGameState('LOBBY'); gameStateRef.current = 'LOBBY'; setLobbyMode('menu'); setLobbyError(''); }}
              >
                <Text style={styles.btnText}>PLAY WITH FRIENDS</Text>
              </TouchableOpacity>
            )}

            <View style={styles.leaderboard}>
              <Text style={styles.boardTitle}>HALL OF FAME</Text>

              {/* Podium Stage */}
              {leaderboard.length >= 3 && (
                <View style={styles.podiumContainer}>
                  <View style={[styles.podiumStep, styles.podiumRank2]}>
                    <Text style={styles.podiumName} numberOfLines={1}>{leaderboard[1].name}</Text>
                    <View style={[styles.podiumBox, {height: 60, backgroundColor: '#bdc3c7'}]}>
                      <Text style={styles.podiumRankText}>2</Text>
                    </View>
                    <Text style={styles.podiumScore}>{leaderboard[1].score}</Text>
                  </View>

                  <View style={[styles.podiumStep, styles.podiumRank1]}>
                    <Text style={styles.podiumName} numberOfLines={1}>{leaderboard[0].name}</Text>
                    <View style={[styles.podiumBox, {height: 90, backgroundColor: '#f1c40f'}]}>
                      <Text style={styles.podiumRankText}>1</Text>
                    </View>
                    <Text style={styles.podiumScore}>{leaderboard[0].score}</Text>
                  </View>

                  <View style={[styles.podiumStep, styles.podiumRank3]}>
                    <Text style={styles.podiumName} numberOfLines={1}>{leaderboard[2].name}</Text>
                    <View style={[styles.podiumBox, {height: 40, backgroundColor: '#cd7f32'}]}>
                      <Text style={styles.podiumRankText}>3</Text>
                    </View>
                    <Text style={styles.podiumScore}>{leaderboard[2].score}</Text>
                  </View>
                </View>
              )}

              {leaderboard.slice(3).map((item, i) => (
                <View key={i+3} style={styles.boardItem}>
                  <Text style={styles.boardText}>{i + 4}. {item.name}</Text>
                  <Text style={styles.boardScore}>{item.score}</Text>
                </View>
              ))}

              {leaderboard.length < 3 && leaderboard.map((item, i) => (
                <View key={i} style={styles.boardItem}>
                  <Text style={styles.boardText}>{i + 1}. {item.name}</Text>
                  <Text style={styles.boardScore}>{item.score}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {gameState === 'GAMEOVER' && (
        <View style={[styles.overlay, styles.overlayCenter]}>
          <Text style={styles.title}>GAME OVER</Text>
          <Text style={styles.finalScore}>SCORE: {score}</Text>

          {extraLives > 0 && (
            <TouchableOpacity style={[styles.btn, {backgroundColor: '#e74c3c', borderColor: '#c0392b', marginBottom: 20}]} onPress={handleRevive}>
              <Text style={styles.btnText}>USE ❤️ ({extraLives} LEFT)</Text>
            </TouchableOpacity>
          )}

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnHome]} onPress={() => setGameState('START')}><Text style={styles.btnText}>HOME</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleTryAgain}><Text style={styles.btnText}>TRY AGAIN</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {gameState === 'PAUSED' && (
        <View style={[styles.overlay, styles.overlayCenter]}>
          <Text style={styles.title}>PAUSED</Text>
          <TouchableOpacity style={styles.btn} onPress={togglePause}><Text style={styles.btnText}>RESUME</Text></TouchableOpacity>
        </View>
      )}

      {gameState === 'COUNTDOWN' && (
        <View style={[styles.overlay, styles.overlayCenter, {backgroundColor: 'rgba(0,0,0,0.3)'}]}>
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      )}

      {/* LOBBY screen */}
      {gameState === 'LOBBY' && (
        <View style={[styles.overlay, styles.overlayCenter]}>
          <Text style={styles.title}>MULTIPLAYER</Text>

          {lobbyMode === 'menu' && (
            <>
              <TouchableOpacity style={styles.multiBtn} onPress={handleCreateRoom}>
                <Text style={styles.btnText}>CREATE ROOM</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.multiBtn, { marginTop: 15 }]} onPress={() => { setLobbyMode('join_input'); setLobbyError(''); }}>
                <Text style={styles.btnText}>JOIN ROOM</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnHome, { marginTop: 15 }]}
                onPress={() => { setGameState('START'); gameStateRef.current = 'START'; }}
              >
                <Text style={styles.btnText}>BACK</Text>
              </TouchableOpacity>
            </>
          )}

          {lobbyMode === 'create_waiting' && (
            <>
              <Text style={styles.lobbyLabel}>ROOM CODE</Text>
              <Text style={styles.roomCodeDisplay}>{roomCode}</Text>
              <Text style={styles.lobbySubtext}>
                {opponent ? `${opponent.name} joined!` : 'Waiting for opponent...'}
              </Text>
              {opponent && (
                <TouchableOpacity style={[styles.btn, { marginTop: 20, backgroundColor: '#2ecc71', borderBottomColor: '#27ae60' }]} onPress={handleHostStart}>
                  <Text style={styles.btnText}>START MATCH</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.btn, styles.btnHome, { marginTop: 15 }]}
                onPress={() => { disconnectFromRoom(); setGameState('LOBBY'); gameStateRef.current = 'LOBBY'; setLobbyMode('menu'); }}
              >
                <Text style={styles.btnText}>CANCEL</Text>
              </TouchableOpacity>
            </>
          )}

          {lobbyMode === 'join_input' && (
            <>
              <Text style={styles.lobbyLabel}>ENTER ROOM CODE</Text>
              <TextInput
                style={styles.roomCodeInputField}
                value={roomCodeInput}
                onChangeText={(t) => setRoomCodeInput(t.toUpperCase().slice(0, ROOM_CODE_LENGTH))}
                placeholder="ABC123"
                placeholderTextColor="rgba(255,255,255,0.3)"
                maxLength={ROOM_CODE_LENGTH}
                autoCapitalize="characters"
              />
              <TouchableOpacity style={[styles.multiBtn, { marginTop: 15 }]} onPress={handleJoinRoom}>
                <Text style={styles.btnText}>JOIN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnHome, { marginTop: 15 }]}
                onPress={() => { setLobbyMode('menu'); setLobbyError(''); setRoomCodeInput(''); }}
              >
                <Text style={styles.btnText}>BACK</Text>
              </TouchableOpacity>
            </>
          )}

          {lobbyMode === 'join_waiting' && (
            <>
              <Text style={styles.lobbyLabel}>ROOM CODE</Text>
              <Text style={styles.roomCodeDisplay}>{roomCode}</Text>
              <Text style={styles.lobbySubtext}>
                {opponent ? `Connected! Waiting for ${opponent.name} to start...` : 'Connecting...'}
              </Text>
              <TouchableOpacity
                style={[styles.btn, styles.btnHome, { marginTop: 15 }]}
                onPress={() => { disconnectFromRoom(); setGameState('LOBBY'); gameStateRef.current = 'LOBBY'; setLobbyMode('menu'); }}
              >
                <Text style={styles.btnText}>LEAVE</Text>
              </TouchableOpacity>
            </>
          )}

          {lobbyError ? <Text style={styles.lobbyError}>{lobbyError}</Text> : null}
        </View>
      )}

      {/* MULTI_COUNTDOWN screen */}
      {gameState === 'MULTI_COUNTDOWN' && (
        <View style={[styles.overlay, styles.overlayCenter, {backgroundColor: 'rgba(0,0,0,0.3)'}]}>
          <Text style={styles.countdownText}>{countdown}</Text>
          {opponent && <Text style={styles.lobbySubtext}>VS {opponent.name}</Text>}
        </View>
      )}

      {/* MULTI_GAMEOVER results screen */}
      {gameState === 'MULTI_GAMEOVER' && (
        <View style={[styles.overlay, styles.overlayCenter]}>
          <Text style={[
            styles.title,
            multiplayerWinner === 'me' && { color: '#2ecc71' },
            multiplayerWinner === 'them' && { color: '#e74c3c' },
            multiplayerWinner === 'draw' && { color: '#f1c40f' },
          ]}>
            {multiplayerWinner === 'me' ? 'YOU WIN!' : multiplayerWinner === 'them' ? 'YOU LOSE!' : 'DRAW!'}
          </Text>

          <View style={styles.vsScoreContainer}>
            <View style={styles.vsScoreColumn}>
              <Text style={styles.vsLabel}>YOU</Text>
              <Text style={styles.vsPlayerName} numberOfLines={1}>{playerName}</Text>
              <Text style={styles.vsScoreValue}>{score}</Text>
            </View>
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.vsScoreColumn}>
              <Text style={styles.vsLabel}>OPP</Text>
              <Text style={styles.vsPlayerName} numberOfLines={1}>{opponent?.name || '???'}</Text>
              <Text style={styles.vsScoreValue}>{opponent?.score ?? 0}</Text>
            </View>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnHome]} onPress={handleMultiplayerHome}>
              <Text style={styles.btnText}>HOME</Text>
            </TouchableOpacity>
            {roomRole === 'host' && (
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#9b59b6', borderBottomColor: '#8e44ad' }]} onPress={handleRematch}>
                <Text style={styles.btnText}>REMATCH</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', height: '100%', overflow: 'hidden' },
  header: { position: 'absolute', top: 10, width: '100%', paddingHorizontal: 20, zIndex: 50, height: 100 },
  headerLeft: { position: 'absolute', left: 20, top: 0, flexDirection: 'row', gap: 10 },
  coinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  coinIcon: { fontSize: 16, marginRight: 4 },
  coinCount: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  scoreArea: { position: 'absolute', width: '100%', alignItems: 'center', top: 0 },
  scoreText: { fontSize: 60, fontWeight: 'bold', color: 'white', ...Platform.select({ ios: { textShadowColor: 'black', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 2 }, android: { textShadowColor: 'black', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 2 }, default: { textShadow: '2px 2px 2px black' } }) },
  levelBadge: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 10, borderRadius: 15, marginTop: -5 },
  levelText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  pauseBtn: { position: 'absolute', right: 20, top: 0, width: 44, height: 44, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 22, justifyContent: 'center', alignItems: 'center' },

  // Podium Styles
  podiumContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginVertical: 20, gap: 10 },
  podiumStep: { alignItems: 'center', width: 80 },
  podiumBox: { width: '100%', justifyContent: 'center', alignItems: 'center', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  podiumRankText: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  podiumName: { color: '#ccc', fontSize: 12, marginBottom: 5, textAlign: 'center', width: '100%' },
  podiumScore: { color: '#2ecc71', fontWeight: 'bold', marginTop: 5 },
  podiumRank1: { zIndex: 2 },
  podiumRank2: { zIndex: 1 },
  podiumRank3: { zIndex: 1 },
  bird: { position: 'absolute', borderWidth: 2, zIndex: 10 },
  immunityBadge: { position: 'absolute', top: -15, right: -15, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 5 },
  birdBigEye: { position: 'absolute', borderRadius: 10, borderWidth: 1, borderColor: 'black', justifyContent: 'center', alignItems: 'center', zIndex: 12 },
  birdPupil: { backgroundColor: 'black', borderRadius: 5 },
  birdBeakUpper: { position: 'absolute', borderWidth: 1, borderTopLeftRadius: 10, borderTopRightRadius: 10, zIndex: 11 },
  birdBeakLower: { position: 'absolute', borderWidth: 1, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, zIndex: 10 },
  birdWing: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.2)', borderRadius: 15, zIndex: 11 },
  birdTail: { position: 'absolute', width: 0, height: 0, borderStyle: 'solid', borderLeftWidth: 15, borderBottomWidth: 10, borderTopWidth: 10, borderBottomColor: 'transparent', borderTopColor: 'transparent', zIndex: 9 },
  pipe: { position: 'absolute', width: PIPE_WIDTH, backgroundColor: '#5D2906', borderWidth: 2, borderColor: '#3E1C04', overflow: 'hidden' },
  pipeTop: { justifyContent: 'flex-end' as const },
  pipeBottom: { justifyContent: 'flex-start' as const },
  coral: { position: 'absolute', width: PIPE_WIDTH, backgroundColor: '#e74c3c', borderWidth: 3, borderColor: '#c0392b', borderRadius: 15 },
  logBark: { position: 'absolute', left: 10, top: 0, bottom: 0, width: 4, backgroundColor: 'rgba(0,0,0,0.2)' },
  logBarkAlt: { position: 'absolute', right: 15, top: 0, bottom: 0, width: 6, backgroundColor: 'rgba(0,0,0,0.15)' },
  logEnd: { position: 'absolute', bottom: 0, width: '100%', height: 15, backgroundColor: '#D2B48C', borderTopWidth: 2, borderColor: '#3E1C04' },
  ground: { position: 'absolute', bottom: 0, left: 0, right: 0, height: GROUND_HEIGHT },
  groundGrass: { position: 'absolute', top: 0, width: '100%', height: 12 },
  cloud: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 0 },
  bubble: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', zIndex: 0 },
  nightCloud: { position: 'absolute', backgroundColor: 'rgba(40,40,60,0.6)', zIndex: 0 },

  // Stone pipe (night theme)
  stonePipe: { position: 'absolute', width: PIPE_WIDTH, backgroundColor: '#3a3a4a', borderWidth: 2, borderColor: '#2a2a3a', overflow: 'hidden' },
  stoneCrack: { position: 'absolute', width: 2, backgroundColor: 'rgba(150,150,160,0.5)' },
  stoneMoss: { position: 'absolute', left: 0, right: 0, height: 8, backgroundColor: '#2d5a27', borderRadius: 2 },

  // Tree pipe leaf cluster (mountain theme)
  treePipeLeafCluster: { position: 'absolute', bottom: 0, left: -5, right: -5, height: 20, flexDirection: 'row', justifyContent: 'center', overflow: 'visible' },
  treePipeLeaf: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#3a7d32' },

  // Coral polyps (sea theme)
  coralPolyp: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#f5b7b1' },

  // Wave (sea ground top)
  waveContainer: { position: 'absolute', top: -8, left: 0, right: 0, height: 12, flexDirection: 'row', overflow: 'hidden', zIndex: 1 },
  wave: { position: 'absolute', width: 40, height: 16, borderRadius: 20, backgroundColor: '#2980b9', top: 4 },

  // Moon & stars (night theme)
  moon: { position: 'absolute', top: 60, right: 40, width: 50, height: 50, borderRadius: 25, backgroundColor: '#f5f5c6', zIndex: 1, overflow: 'hidden' },
  moonCrater: { position: 'absolute', borderRadius: 10, backgroundColor: 'rgba(200,200,150,0.5)' },
  star: { position: 'absolute', backgroundColor: '#ffffcc', zIndex: 1 },

  // Mountain peaks (mountain ground)
  mountainPeak: { position: 'absolute', top: -40, width: 0, height: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#6b6b6b', borderStyle: 'solid', zIndex: 0 },
  snowCap: { position: 'absolute', top: -2, alignSelf: 'center', width: 0, height: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: 'white', borderStyle: 'solid' },

  // Seaweed
  seaweedContainer: { width: 20, height: 50, alignItems: 'center' },
  seaweedStalk: { width: 4, height: 45, backgroundColor: '#27ae60', borderRadius: 2 },
  seaweedLeaf: { position: 'absolute', width: 10, height: 6, backgroundColor: '#2ecc71', borderRadius: 3 },

  // Owl (night theme)
  owlBody: { width: 22, height: 26, backgroundColor: '#8B6914', borderRadius: 11 },
  owlEarLeft: { position: 'absolute', top: -6, left: 2, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#8B6914', borderStyle: 'solid' },
  owlEarRight: { position: 'absolute', top: -6, right: 2, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#8B6914', borderStyle: 'solid' },
  owlEyeLeft: { position: 'absolute', top: 4, left: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: '#f1c40f', justifyContent: 'center', alignItems: 'center' },
  owlEyeRight: { position: 'absolute', top: 4, right: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: '#f1c40f', justifyContent: 'center', alignItems: 'center' },
  owlPupil: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#111' },
  owlBeak: { position: 'absolute', top: 13, left: 8, width: 6, height: 5, backgroundColor: '#e67e22', borderRadius: 3 },

  // Eagle (mountain theme)
  eagleBody: { width: 28, height: 20, backgroundColor: '#5D2906', borderRadius: 10 },
  eagleHead: { position: 'absolute', top: -4, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: 'white' },
  eagleWing: { position: 'absolute', top: -6, left: -4, width: 16, height: 10, backgroundColor: '#3E1C04', borderRadius: 5, transform: [{ rotate: '-15deg' }] },
  eagleBeak: { position: 'absolute', top: 0, right: -6, width: 8, height: 5, backgroundColor: '#f1c40f', borderRadius: 2 },
  eagleEye: { position: 'absolute', top: -1, right: 4, width: 3, height: 3, borderRadius: 2, backgroundColor: '#111' },

  // Pine tree (mountain theme)
  pineContainer: { width: 40, height: 55, alignItems: 'center' },
  pineTriangle: { position: 'absolute', width: 0, height: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#2d5a27', borderStyle: 'solid', alignSelf: 'center' },
  pineTrunk: { position: 'absolute', bottom: 0, width: 6, height: 10, backgroundColor: '#5D2906' },

  // Dead tree (night theme)
  deadTreeContainer: { width: 30, height: 50, alignItems: 'center' },
  deadTreeTrunk: { position: 'absolute', bottom: 0, width: 5, height: 40, backgroundColor: '#1a1a2e', borderRadius: 1 },
  deadTreeBranchLeft: { position: 'absolute', bottom: 28, left: 4, width: 12, height: 3, backgroundColor: '#1a1a2e', transform: [{ rotate: '-30deg' }] },
  deadTreeBranchRight: { position: 'absolute', bottom: 22, right: 2, width: 10, height: 3, backgroundColor: '#1a1a2e', transform: [{ rotate: '25deg' }] },
  deadTreeBranchSmall: { position: 'absolute', bottom: 34, right: 6, width: 8, height: 2, backgroundColor: '#1a1a2e', transform: [{ rotate: '35deg' }] },

  animalContainer: { position: 'absolute', zIndex: 5 },
  rabbitBody: { width: 20, height: 25, backgroundColor: '#eee', borderRadius: 10 },
  rabbitEarLeft: { position: 'absolute', top: -10, left: 2, width: 6, height: 15, backgroundColor: '#eee', borderRadius: 5 },
  rabbitEarRight: { position: 'absolute', top: -10, right: 2, width: 6, height: 15, backgroundColor: '#eee', borderRadius: 5 },
  rabbitTail: { position: 'absolute', bottom: 2, right: -4, width: 8, height: 8, backgroundColor: '#eee', borderRadius: 4 },
  rabbitEye: { position: 'absolute', top: 5, right: 4, width: 3, height: 3, backgroundColor: '#333', borderRadius: 2 },
  fishBody: { width: 30, height: 20, backgroundColor: '#f39c12', borderRadius: 15 },
  fishTailFin: { position: 'absolute', left: -10, top: 2, width: 0, height: 0, borderLeftWidth: 12, borderTopWidth: 8, borderBottomWidth: 8, borderLeftColor: '#e67e22', borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  fishEyeSmall: { position: 'absolute', top: 4, right: 6, width: 4, height: 4, backgroundColor: 'white', borderRadius: 2 },
  bushWrapper: { position: 'absolute', bottom: 85, zIndex: 2, width: 80, height: 50 },
  bushCircle: { position: 'absolute', borderRadius: 30 },
  graffiti: { position: 'absolute', bottom: 8, width: '100%', textAlign: 'center', fontSize: 11, fontWeight: 'bold', color: 'rgba(255,255,255,0.2)', letterSpacing: 2 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 100 },
  overlayScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  overlayCenter: { justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 48, fontWeight: 'bold', color: 'white', marginBottom: 20 },
  inputArea: { width: '100%', alignItems: 'center' },
  nameInput: { backgroundColor: 'white', width: '80%', padding: 15, borderRadius: 10, fontSize: 18, textAlign: 'center', marginBottom: 20 },
  skinSelector: { flexDirection: 'row', gap: 15, marginBottom: 30 },
  skinOption: { width: 40, height: 40, borderRadius: 20 },
  rainbowOption: { flex: 1, borderRadius: 20, borderWidth: 2, borderColor: 'white' },
  skinActive: { transform: [{ scale: 1.2 }] },
  simpleStore: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, marginBottom: 20, width: '80%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  storeText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  buyBtn: { backgroundColor: '#2ecc71', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 10 },
  buyText: { color: 'white', fontWeight: 'bold' },
  btnRow: { flexDirection: 'row', gap: 20 },
  btn: { backgroundColor: '#e67e22', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 10, borderBottomWidth: 5, borderBottomColor: '#d35400' },
  btnHome: { backgroundColor: '#3498db', borderBottomColor: '#2980b9' },
  btnText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  finalScore: { fontSize: 32, color: '#f1c40f', fontWeight: 'bold', marginBottom: 20 },
  leaderboard: { marginTop: 30, width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 15 },
  boardTitle: { color: 'white', fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  boardItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  boardText: { color: '#ccc' },
  boardScore: { color: '#2ecc71', fontWeight: 'bold' },
  collectible: { position: 'absolute', zIndex: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
  eggContainer: { width: 24, height: 30, alignItems: 'center' },
  eggBody: { width: 22, height: 28, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', overflow: 'hidden' },
  eggHighlight: { position: 'absolute', top: 4, left: 4, width: 6, height: 10, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 5 },
  shellContainer: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  shellMain: { width: 26, height: 22, borderTopLeftRadius: 15, borderTopRightRadius: 15, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  shellGroove: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(0,0,0,0.1)' },
  countdownText: { fontSize: 120, fontWeight: 'bold', color: 'white' },

  // Multiplayer styles
  multiBtn: { backgroundColor: '#9b59b6', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 10, borderBottomWidth: 5, borderBottomColor: '#8e44ad', marginTop: 10 },
  lobbyLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 16, fontWeight: 'bold', marginTop: 20, marginBottom: 5 },
  roomCodeDisplay: { fontSize: 48, fontWeight: 'bold', color: '#f1c40f', letterSpacing: 8, marginBottom: 10 },
  roomCodeInputField: { backgroundColor: 'rgba(255,255,255,0.15)', width: 220, padding: 15, borderRadius: 10, fontSize: 28, fontWeight: 'bold', textAlign: 'center', color: 'white', letterSpacing: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  lobbySubtext: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginTop: 10, textAlign: 'center' },
  lobbyError: { color: '#e74c3c', fontSize: 14, fontWeight: 'bold', marginTop: 15, textAlign: 'center' },
  opponentPanel: { position: 'absolute', right: 0, top: 110, width: '38%', height: '55%', backgroundColor: 'rgba(0,0,0,0.35)', borderTopLeftRadius: 15, borderBottomLeftRadius: 15, zIndex: 60, overflow: 'hidden' },
  opponentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.3)' },
  opponentName: { color: 'white', fontSize: 12, fontWeight: 'bold', flex: 1 },
  opponentScore: { color: '#f1c40f', fontSize: 16, fontWeight: 'bold' },
  opponentGameArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  opponentBird: { position: 'absolute', left: '40%', width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  opponentEliminated: { position: 'absolute', backgroundColor: 'rgba(231,76,60,0.8)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5 },
  opponentEliminatedText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
  opponentDisconnected: { position: 'absolute', bottom: 10, backgroundColor: 'rgba(243,156,18,0.8)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  opponentDisconnectedText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  vsScoreContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 30, gap: 20 },
  vsScoreColumn: { alignItems: 'center', width: 100 },
  vsLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 'bold' },
  vsPlayerName: { color: 'white', fontSize: 14, fontWeight: 'bold', marginTop: 2 },
  vsScoreValue: { color: '#f1c40f', fontSize: 36, fontWeight: 'bold', marginTop: 5 },
  vsText: { color: 'rgba(255,255,255,0.5)', fontSize: 24, fontWeight: 'bold' },
});
