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

// Game constants
const GRAVITY = 0.55; // Slightly increased for snappier feel
const JUMP = -8.5;    // Slightly stronger jump
const PIPE_WIDTH = 65;
const BIRD_SIZE = 34; 
const HITBOX_PADDING = 5; // More forgiving hitbox
const GROUND_HEIGHT = 100;
const BASE_PIPE_SPAWN_INTERVAL = 1800; 
const REFERENCE_FRAME_MS = 1000 / 60;
const POWERUP_DURATION_MS = 6000;

const PLAYER_NAME_KEY = 'flappyPlayerName';
const LEADERBOARD_KEY = 'flappyLeaderboard';
const COINS_KEY = 'flappyCoins';
const STORE_KEY = 'flappyStore';

const RAW_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL = RAW_SUPABASE_URL ? RAW_SUPABASE_URL.replace(/\/+$/, '') : '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_TABLE = process.env.EXPO_PUBLIC_SUPABASE_TABLE || 'flappy_leaderboard';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

type GameState = 'START' | 'PLAYING' | 'GAMEOVER' | 'STORE';
type Skin = 'gold' | 'blue' | 'pink' | 'green' | 'rainbow';
type CollectibleType = 'GROW_EGG' | 'SHRINK_EGG' | 'COIN' | 'RAINBOW_EGG';

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

const SKIN_STYLES: Record<Skin, { fill: string; border: string }> = {
  gold: { fill: '#f1c40f', border: '#d35400' },
  blue: { fill: '#3498db', border: '#2980b9' },
  pink: { fill: '#e84393', border: '#c0392b' },
  green: { fill: '#2ecc71', border: '#27ae60' },
  rainbow: { fill: 'transparent', border: '#6c5ce7' },
};

const RAINBOW_COLORS: readonly [string, string, ...string[]] = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#8b00ff'];

const sanitizeName = (rawName: string) => (rawName.trim() || 'Anonymous').slice(0, 12);

const normalizeLeaderboard = (entries: LeaderboardEntry[]) => {
  const deduped = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const name = sanitizeName(entry.name);
    const score = Math.max(0, Math.floor(entry.score));
    const key = name.toLowerCase();
    const existing = deduped.get(key);
    if (!existing || score > existing.score) deduped.set(key, { name, score });
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score).slice(0, 10);
};

const supabaseHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
});

const supabaseEndpoint = (query = '') => `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}${query}`;

const saveRemoteBestScore = async (name: string, score: number): Promise<void> => {
  if (!SUPABASE_ENABLED) return;
  const encodedName = encodeURIComponent(name);
  const lookupResponse = await fetch(supabaseEndpoint(`?select=name,score&name=eq.${encodedName}`), { headers: supabaseHeaders() });
  if (!lookupResponse.ok) return;
  const existingRows = (await lookupResponse.json()) as any[];
  const bestExisting = existingRows.reduce((max, item) => Math.max(max, item.score), -1);
  if (bestExisting >= score) return;
  if (existingRows.length > 0) {
    await fetch(supabaseEndpoint(`?name=eq.${encodedName}`), { method: 'PATCH', headers: { ...supabaseHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ score }) });
  } else {
    await fetch(supabaseEndpoint(), { method: 'POST', headers: { ...supabaseHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ name, score }), });
  }
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
  const [sizeMultiplier, setSizeMultiplier] = useState(1);
  const [activePowerup, setActivePowerup] = useState<CollectibleType | null>(null);
  const [wallImmunityCount, setWallImmunityCount] = useState(0);
  
  const [clouds, setClouds] = useState<MovingObject[]>([]);
  const [animals, setAnimals] = useState<MovingObject[]>([]);
  const [bushes, setBushes] = useState<MovingObject[]>([]);
  const [collectibles, setCollectibles] = useState<MovingObject[]>([]);
  
  const [immuneToBig, setImmuneToBig] = useState(false);
  const [immuneToSmall, setImmuneToSmall] = useState(false);

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

  const level = Math.floor(score / 5) + 1;
  const isSeaTheme = level >= 12;

  const requestRef = useRef<number>();
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastPipeSpawnRef = useRef<number>(0);
  const gameOverHandledRef = useRef(false);
  const powerupTimerRef = useRef<NodeJS.Timeout | null>(null);

  const persistLeaderboard = useCallback(async (nextBoard: LeaderboardEntry[]) => {
    leaderboardRef.current = nextBoard;
    setLeaderboard(nextBoard);
    await AsyncStorage.setItem(LEADERBOARD_KEY, JSON.stringify(nextBoard));
  }, []);

  const updateLeaderboard = useCallback(async (finalScore: number) => {
    const safeScore = Math.max(0, Math.floor(finalScore));
    const name = sanitizeName(playerNameRef.current);
    const nextLocalBoard = normalizeLeaderboard([...leaderboardRef.current, { name, score: safeScore }]);
    await persistLeaderboard(nextLocalBoard);
    if (SUPABASE_ENABLED) { try { await saveRemoteBestScore(name, safeScore); } catch (e) {} }
  }, [persistLeaderboard]);

  const handleGameOver = useCallback(async () => {
    if (gameOverHandledRef.current) return;
    gameOverHandledRef.current = true;
    setGameState('GAMEOVER'); gameStateRef.current = 'GAMEOVER';
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = undefined; }
    await updateLeaderboard(scoreRef.current);
    await AsyncStorage.setItem(COINS_KEY, totalCoinsRef.current.toString());
  }, [updateLeaderboard]);

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
    setCollectibles([]);
  }, [SCREEN_HEIGHT]);

  const applyPowerupEffect = useCallback((type: CollectibleType) => {
    if (type === 'RAINBOW_EGG') {
      wallImmunityRef.current = 4;
      setWallImmunityCount(4);
      setActivePowerup(type);
      return;
    }
    if (powerupTimerRef.current) clearTimeout(powerupTimerRef.current);
    setActivePowerup(type);
    
    // Always clear existing effect before applying new one
    setSizeMultiplier(1); sizeMultiplierRef.current = 1;

    if (type === 'GROW_EGG') {
      if (!immuneToBig) { setSizeMultiplier(1.7); sizeMultiplierRef.current = 1.7; }
    }
    else if (type === 'SHRINK_EGG') {
      // Small is always a buff, so we apply it regardless of immunity.
      // If they bought the store item, we give them an extra boost.
      const multiplier = immuneToSmall ? 0.45 : 0.6;
      setSizeMultiplier(multiplier); sizeMultiplierRef.current = multiplier;
    }

    powerupTimerRef.current = setTimeout(() => {
      setSizeMultiplier(1); sizeMultiplierRef.current = 1; setActivePowerup(null);
    }, POWERUP_DURATION_MS);
  }, [immuneToBig, immuneToSmall]);

  const spawnPipe = useCallback((timestamp: number) => {
    const curLevel = Math.floor(scoreRef.current / 5) + 1;
    // Calculate spawn interval based on current speed to maintain consistent horizontal distance (~320 units)
    const curSpeedBase = (curLevel >= 12 ? 3.7 : 3.0) + Math.min((curLevel - 1) * 0.35, 3.0);
    const spawnRate = Math.max(650, (320 / curSpeedBase) * REFERENCE_FRAME_MS);

    if (timestamp - lastPipeSpawnRef.current > spawnRate) {
      const currentGap = curLevel >= 12 ? 145 : 165; 
      const minPipeH = 60;
      const maxPipeH = SCREEN_HEIGHT - GROUND_HEIGHT - currentGap - minPipeH;
      
      // Smooth vertical gap transition: bias next gap position near the previous one
      const lastPipe = pipesRef.current[pipesRef.current.length - 1];
      const lastTopH = lastPipe ? lastPipe.topHeight : SCREEN_HEIGHT / 2 - currentGap / 2;
      const moveRange = 250; // Max vertical shift between consecutive pipes
      let topH = Math.floor(lastTopH + (Math.random() * moveRange - moveRange / 2));
      topH = Math.max(minPipeH, Math.min(maxPipeH, topH));

      pipesRef.current = [...pipesRef.current, { x: SCREEN_WIDTH, topHeight: topH, bottomHeight: SCREEN_HEIGHT - GROUND_HEIGHT - topH - currentGap, passed: false }];
      setPipes([...pipesRef.current]);
      lastPipeSpawnRef.current = timestamp;

      // Collectibles now appear ~30% of the time (was 75%)
      if (Math.random() > 0.7) {
        const rand = Math.random();
        let type: CollectibleType = 'COIN';
        if (curLevel >= 5 && rand > 0.88) type = 'GROW_EGG';
        else if (rand > 0.75) type = 'SHRINK_EGG';
        else if (rand > 0.7) type = 'RAINBOW_EGG';
        setCollectibles(prev => [...prev, { id: timestamp, x: SCREEN_WIDTH + 15, y: topH + (currentGap/2) - 15, type, collected: false }]);
      }
    }
  }, [SCREEN_HEIGHT, SCREEN_WIDTH]);

  const gameLoop = useCallback((timestamp: number) => {
    if (gameStateRef.current !== 'PLAYING') return;
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

    setClouds(prev => prev.map(c => ({ ...c, x: c.x - (curSpeed * (curLevel >= 12 ? 0.1 : 0.3)), y: curLevel >= 12 ? c.y - 0.5 : c.y })).map(c => (c.x + (c.size||0) < -100 || c.y < -100) ? { ...c, x: SCREEN_WIDTH + 100, y: curLevel >= 12 ? SCREEN_HEIGHT : Math.random() * 200 + 50 } : c));
    setAnimals(prev => prev.map(a => ({ ...a, x: a.x - (curSpeed + (a.speed||0)), yOffset: Math.abs(Math.sin((timestamp + (a.x * 10)) / 200)) * 12 })).map(a => a.x < -100 ? { ...a, x: SCREEN_WIDTH + 100 } : a));
    setBushes(prev => prev.map(b => ({ ...b, x: b.x - curSpeed })).map(b => b.x < -150 ? { ...b, x: SCREEN_WIDTH + 150 } : b));

    const bL = 50 + HITBOX_PADDING; const bR = 50 + curSize - HITBOX_PADDING;
    const bT = nextBirdPos + HITBOX_PADDING; const bB = nextBirdPos + curSize - HITBOX_PADDING;

    let powerupToApply: CollectibleType | null = null;
    setCollectibles(prev => {
      const next = prev.map(c => {
        if (c.collected) return c;
        const mx = c.x - curSpeed;
        if (bR > mx && bL < mx + 30 && bB > c.y && bT < c.y + 30) {
          if (c.type !== 'COIN') powerupToApply = c.type as CollectibleType;
          else { totalCoinsRef.current += 1; setTotalCoins(totalCoinsRef.current); AsyncStorage.setItem(COINS_KEY, totalCoinsRef.current.toString()); }
          return { ...c, x: mx, collected: true };
        }
        return { ...c, x: mx };
      }).filter(c => c.x + 100 > 0);
      return next;
    });
    if (powerupToApply) applyPowerupEffect(powerupToApply);

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
    if (scoredCount > 0) setScore(s => { const n = s + scoredCount; scoreRef.current = n; return n; });
    if (pipeCollided) { handleGameOver(); return; }
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [handleGameOver, spawnPipe, applyPowerupEffect, SCREEN_HEIGHT, SCREEN_WIDTH]);

  const flap = useCallback(() => {
    if (gameStateRef.current === 'START' || gameStateRef.current === 'GAMEOVER') { 
      resetGame(); 
      setGameState('PLAYING'); 
      gameStateRef.current = 'PLAYING'; 
      setBirdVel(JUMP); 
      birdVelRef.current = JUMP; 
    }
    else if (gameStateRef.current === 'PLAYING') { setBirdVel(JUMP); birdVelRef.current = JUMP; }
  }, [resetGame]);

  const buyItem = async (type: 'big' | 'small') => {
    if (totalCoinsRef.current < 50) return;
    totalCoinsRef.current -= 50; setTotalCoins(totalCoinsRef.current);
    const newState = type === 'big' ? { big: true, small: immuneToSmall } : { big: immuneToBig, small: true };
    if (type === 'big') setImmuneToBig(true); else setImmuneToSmall(true);
    await AsyncStorage.setItem(COINS_KEY, totalCoinsRef.current.toString());
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(newState));
  };

  useEffect(() => {
    const loadData = async () => {
      const [sc, sn, sb, st] = await Promise.all([AsyncStorage.getItem(COINS_KEY), AsyncStorage.getItem(PLAYER_NAME_KEY), AsyncStorage.getItem(LEADERBOARD_KEY), AsyncStorage.getItem(STORE_KEY)]);
      if (sc) { totalCoinsRef.current = parseInt(sc, 10); setTotalCoins(totalCoinsRef.current); }
      if (sn) setPlayerName(sn);
      if (st) { const s = JSON.parse(st); setImmuneToBig(s.big); setImmuneToSmall(s.small); }
      const lb = normalizeLeaderboard(toLeaderboardEntries(sb ? JSON.parse(sb) : []));
      setLeaderboard(lb); leaderboardRef.current = lb;
      setAnimals(isSeaTheme ? [{ id:1, x: 100, y:0, speed: 1.2, collected: false }, { id:2, x: 350, y:0, speed: 0.5, collected: false }] : [{ id:1, x: 100, y:0, speed: 1.2, collected: false }, { id:2, x: 350, y:0, speed: 0.8, collected: false }]);
      setBushes(isSeaTheme ? [] : [{ id:1, x: 50, y:0, scale: 1, collected: false }, { id:2, x: 250, y:0, scale: 0.8, collected: false }, { id:3, x: 450, y:0, scale: 1.1, collected: false }]);
      setClouds(Array.from({ length: 6 }).map((_, i) => ({ id:i, x: (i * SCREEN_WIDTH / 2), y: Math.random() * 200 + 50, size: Math.random() * 60 + 50, collected: false })));
    };
    loadData();
  }, [isSeaTheme, SCREEN_WIDTH]);

  useEffect(() => {
    birdPosRef.current = birdPos; birdVelRef.current = birdVel; scoreRef.current = score; gameStateRef.current = gameState;
    playerNameRef.current = playerName; sizeMultiplierRef.current = sizeMultiplier;
  }, [birdPos, birdVel, score, gameState, playerName, sizeMultiplier]);

  useEffect(() => { if (gameState === 'PLAYING') { requestRef.current = requestAnimationFrame(gameLoop); } return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); }; }, [gameLoop, gameState]);

  const BirdCharacter = () => {
    const size = BIRD_SIZE * sizeMultiplier;
    let bodyColor = skin === 'rainbow' ? 'transparent' : SKIN_STYLES[skin].fill;
    if (activePowerup === 'GROW_EGG') bodyColor = '#2ecc71'; 
    if (activePowerup === 'SHRINK_EGG') bodyColor = '#3498db'; 
    return (
      <View style={[styles.bird, { top: birdPos, width: size, height: size, borderRadius: size/2, backgroundColor: bodyColor, borderColor: SKIN_STYLES[skin].border, transform: [{ rotate: `${Math.min(Math.max(birdVel * 3, -25), 90)}deg` }] }]}>
        {(skin === 'rainbow' || activePowerup === 'RAINBOW_EGG') && <LinearGradient colors={RAINBOW_COLORS} style={[StyleSheet.absoluteFill, { borderRadius: size/2 }]} />}
        {activePowerup === 'RAINBOW_EGG' && <View style={styles.immunityBadge}><Text style={{fontSize: 10, color: 'white'}}>{wallImmunityCount}</Text></View>}
        <View style={[styles.birdTail, { borderLeftColor: SKIN_STYLES[skin].border, left: -size/3, top: size/3 }]} />
        <View style={[styles.birdWing, { width: size/1.5, height: size/2, left: size/10, top: size/3 }]} />
        <View style={[styles.birdBigEye, { width: size/2.5, height: size/2.5, right: size/10, top: size/10 }]}><View style={[styles.birdPupil, { width: size/8, height: size/8 }]} /></View>
        <View style={[styles.birdBeakUpper, { width: size/2, height: size/3.5, right: -size/3, top: size/2.5 }]} /><View style={[styles.birdBeakLower, { width: size/2.5, height: size/4, right: -size/4, top: size/1.6 }]} />
      </View>
    );
  };

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

  return (
    <View 
      style={[styles.container, { backgroundColor: isSeaTheme ? '#1a5276' : '#70c5ce' }]} 
      onStartShouldSetResponder={() => true} 
      onResponderGrant={() => { if (gameState === 'PLAYING' || gameState === 'START') flap(); }}
    >
      <StatusBar hidden />
      {clouds.map((c, i) => ( <View key={`cloud-${i}`} style={[isSeaTheme ? styles.bubble : styles.cloud, { left: c.x, top: c.y, width: c.size, height: (c.size||0) * (isSeaTheme ? 1 : 0.6), borderRadius: (c.size||0) / 2 }]} /> ))}
      <View style={styles.header}>
        <TouchableOpacity style={styles.coinBadge} onPress={() => setGameState('STORE')}><Text style={styles.coinIcon}>🪙</Text><Text style={styles.coinCount}>{totalCoins}</Text></TouchableOpacity>
        <View style={styles.scoreArea}><Text style={styles.scoreText}>{score}</Text><View style={styles.levelBadge}><Text style={styles.levelText}>LVL {level}</Text></View></View>
      </View>
      <BirdCharacter />
      {collectibles.map((c) => !c.collected && (
        <View key={c.id} style={[styles.collectible, { left: c.x, top: c.y }]}>
          {c.type === 'COIN' ? <Text style={{fontSize: 24}}>🪙</Text> : 
           isSeaTheme ? <DrawShell type={c.type as CollectibleType} colors={c.type === 'RAINBOW_EGG' ? RAINBOW_COLORS : undefined} /> : 
           <DrawEgg type={c.type as CollectibleType} colors={c.type === 'RAINBOW_EGG' ? RAINBOW_COLORS : undefined} />}
        </View>
      ))}
      {pipes.map((pipe, i) => (
        <React.Fragment key={i}>
          <View style={[isSeaTheme ? styles.coral : styles.pipe, styles.pipeTop, { left: pipe.x, top: 0, height: pipe.topHeight }]}>{!isSeaTheme && <><View style={styles.logBark} /><View style={styles.logBarkAlt} /><View style={styles.logEnd} /></>}</View>
          <View style={[isSeaTheme ? styles.coral : styles.pipe, styles.pipeBottom, { left: pipe.x, bottom: GROUND_HEIGHT, height: pipe.bottomHeight }]}>{!isSeaTheme && <><View style={styles.logBark} /><View style={styles.logBarkAlt} /><View style={[styles.logEnd, { top: 0, bottom: undefined }]} /></>}</View>
        </React.Fragment>
      ))}
      <View style={[styles.ground, { backgroundColor: isSeaTheme ? '#2e86c1' : '#ded895' }]}>
        {!isSeaTheme && bushes.map((b, i) => ( 
          <View key={`bush-${i}`} style={[styles.bushWrapper, { left: b.x, transform: [{ scale: b.scale||1 }] }]}>
            <View style={[styles.bushCircle, { width: 40, height: 40, bottom: 0, left: 0, backgroundColor: '#2d5a27' }]} />
            <View style={[styles.bushCircle, { width: 50, height: 50, bottom: 10, left: 15, backgroundColor: '#3a7d32' }]} />
            <View style={[styles.bushCircle, { width: 35, height: 35, bottom: 0, left: 45, backgroundColor: '#2d5a27' }]} />
          </View> 
        ))}
        <View style={[styles.groundGrass, { backgroundColor: isSeaTheme ? '#154360' : '#73bf2e' }]} />
        {animals.map((a, i) => ( 
          <View key={`animal-${i}`} style={[styles.animalContainer, { left: a.x, bottom: 88 + (a.yOffset||0) }]}>
            {isSeaTheme ? <DrawFish /> : <DrawRabbit />}
          </View> 
        ))}
        <Text style={styles.graffiti}>{isSeaTheme ? 'DEEP SEA VIBES' : 'FLIPPY BARD 2026'}</Text>
      </View>

      {(gameState === 'START' || gameState === 'STORE') && (
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.overlayScroll} showsVerticalScrollIndicator={false}>
          {gameState === 'START' ? (
            <>
              <Text style={styles.title}>FLIPPY BARD</Text>
              <TouchableOpacity style={styles.storeShortcut} onPress={() => setGameState('STORE')}><Text style={{fontSize: 20}}>🛒 STORE</Text></TouchableOpacity>
              <View style={styles.inputArea}>
                <TextInput 
                  style={styles.nameInput} 
                  value={playerName} 
                  onChangeText={(t) => setPlayerName(t)} 
                  onEndEditing={() => AsyncStorage.setItem(PLAYER_NAME_KEY, playerName)} 
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
              <TouchableOpacity style={styles.btn} onPress={flap}><Text style={styles.btnText}>START GAME</Text></TouchableOpacity>
              <View style={styles.leaderboard}><Text style={styles.boardTitle}>HALL OF FAME</Text>{leaderboard.map((item, i) => ( <View key={i} style={styles.boardItem}><Text style={styles.boardText}>{i + 1}. {item.name}</Text><Text style={styles.boardScore}>{item.score}</Text></View> ))}</View>
            </>
          ) : (
            <>
              <Text style={styles.title}>POWERUP STORE</Text>
              <View style={styles.storeCard}>
                <Text style={styles.boardTitle}>Your Coins: 🪙 {totalCoins}</Text>
                <View style={styles.storeItem}>
                  <Text style={styles.boardText}>🧪 Big Egg Immunity</Text>
                  {immuneToBig ? <Text style={styles.ownedText}>PURCHASED</Text> : <TouchableOpacity style={styles.buyBtn} onPress={() => buyItem('big')}><Text style={styles.buyText}>50 🪙</Text></TouchableOpacity>}
                </View>
                <View style={styles.storeItem}>
                  <Text style={styles.boardText}>🧪 Small Jewel Boost</Text>
                  {immuneToSmall ? <Text style={styles.ownedText}>PURCHASED</Text> : <TouchableOpacity style={styles.buyBtn} onPress={() => buyItem('small')}><Text style={styles.buyText}>50 🪙</Text></TouchableOpacity>}
                </View>
                <TouchableOpacity style={[styles.btn, {marginTop: 20}]} onPress={() => setGameState('START')}><Text style={styles.btnText}>BACK</Text></TouchableOpacity>
              </View>
            </>
          )}
          </ScrollView>
        </View>
      )}

      {gameState === 'GAMEOVER' && (
        <View style={[styles.overlay, styles.overlayCenter]}>
          <Text style={styles.title}>GAME OVER</Text>
          <Text style={styles.finalScore}>SCORE: {score}</Text>
          <View style={styles.btnRow}><TouchableOpacity style={[styles.btn, styles.btnHome]} onPress={() => setGameState('START')}><Text style={styles.btnText}>HOME</Text></TouchableOpacity><TouchableOpacity style={styles.btn} onPress={flap}><Text style={styles.btnText}>TRY AGAIN</Text></TouchableOpacity></View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', height: '100%', overflow: 'hidden' },
  header: { position: 'absolute', top: 40, width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 50 },
  coinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  coinIcon: { fontSize: 16, marginRight: 4 },
  coinCount: { color: '#f1c40f', fontWeight: 'bold', fontSize: 16 },
  scoreArea: { alignItems: 'center' },
  scoreText: { fontSize: 60, fontWeight: 'bold', color: 'white', ...Platform.select({ ios: { textShadowColor: 'black', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 2 }, android: { textShadowColor: 'black', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 2 }, default: { textShadow: '2px 2px 2px black' } }) },
  levelBadge: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 10, borderRadius: 15 },
  levelText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  bird: { position: 'absolute', left: 50, borderWidth: 2, zIndex: 10 },
  immunityBadge: { position: 'absolute', top: -15, right: -15, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 5 },
  birdBigEye: { position: 'absolute', backgroundColor: 'white', borderRadius: 10, borderWidth: 1, borderColor: 'black', justifyContent: 'center', alignItems: 'center', zIndex: 12 },
  birdPupil: { backgroundColor: 'black', borderRadius: 5 },
  birdBeakUpper: { position: 'absolute', backgroundColor: '#e67e22', borderWidth: 1, borderColor: '#d35400', borderTopLeftRadius: 10, borderTopRightRadius: 10, zIndex: 11 },
  birdBeakLower: { position: 'absolute', backgroundColor: '#e67e22', borderWidth: 1, borderColor: '#d35400', borderBottomLeftRadius: 10, borderBottomRightRadius: 10, zIndex: 10 },
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
  storeShortcut: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 15, marginBottom: 20 },
  storeCard: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 20, borderRadius: 20, width: '90%', alignItems: 'center' },
  storeItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  buyBtn: { backgroundColor: '#2ecc71', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 10 },
  buyText: { color: 'white', fontWeight: 'bold' },
  ownedText: { color: '#95a5a6', fontWeight: 'bold', fontSize: 12 },
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
});
