import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StatusBar,
  TouchableWithoutFeedback,
  ScrollView,
  useWindowDimensions,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ably from 'ably';

import {
  GameState,
  Skin,
  CollectibleType,
  PipeData,
  Collectible,
  Particle,
  MovingObject,
  LeaderboardEntry,
  RemotePlayerRow,
  PlayerProgress,
  OpponentState,
  RoomRole,
  LobbyMode,
} from './src/game/types';
import {
  BIRD_SIZE,
  GROUND_HEIGHT,
  PIPE_WIDTH,
  REFERENCE_FRAME_MS,
  POWERUP_DURATION_MS,
  THEMES,
  SKIN_PALETTES,
  getThemeForLevel,
  getDifficultyForLevel,
  JUMP_VELOCITY,
} from './src/game/constants';
import {
  getBirdBounds,
  stepBirdPhysics,
  spawnObstacle,
  stepObstacles,
  checkObstacleInteractions,
  stepCollectibles,
} from './src/game/physics';
import {
  createFlapFeathers,
  createCoinSparkles,
  createPowerupBurst,
  createFloatingText,
  stepParticles,
} from './src/game/particles';
import { computePilotAction } from './src/game/aiPilot';

import { Bird } from './src/components/Bird';
import { Obstacles } from './src/components/Obstacles';
import { ParallaxBackground } from './src/components/ParallaxBackground';
import { ParticleLayer } from './src/components/ParticleLayer';
import { GameHUD } from './src/components/GameHUD';
import { GameOverModal } from './src/components/GameOverModal';

// Storage & Backend Config
const ABLY_API_KEY = process.env.EXPO_PUBLIC_ABLY_API_KEY || '';
const ABLY_ENABLED = Boolean(ABLY_API_KEY);
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OPPONENT_UPDATE_INTERVAL = 50;

const PLAYER_NAME_KEY = 'flappyPlayerName';
const LEADERBOARD_KEY = 'flappyLeaderboard';
const COINS_KEY = 'flappyCoins';
const EXTRA_LIVES_KEY = 'flappyExtraLives';

const RAW_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL = RAW_SUPABASE_URL ? RAW_SUPABASE_URL.replace(/\/+$/, '') : '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_TABLE = process.env.EXPO_PUBLIC_SUPABASE_TABLE || 'flappy_leaderboard';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const sanitizeName = (raw: string) => (raw.trim() || 'Pilot').slice(0, 12);
const clampInt = (v: number) => Math.max(0, Math.floor(v));

export default function App() {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();

  // Core Game State
  const [gameState, setGameState] = useState<GameState>('START');
  const [birdPos, setBirdPos] = useState(SCREEN_HEIGHT / 2);
  const [birdVel, setBirdVel] = useState(0);
  const [pipes, setPipes] = useState<PipeData[]>([]);
  const [collectibles, setCollectibles] = useState<Collectible[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [maxCombo, setMaxCombo] = useState(1);
  const [coinsEarnedThisRun, setCoinsEarnedThisRun] = useState(0);

  // Player Profile & Inventory
  const [playerName, setPlayerName] = useState('Ace Aviator');
  const [skin, setSkin] = useState<Skin>('aviator');
  const [totalCoins, setTotalCoins] = useState(0);
  const [extraLives, setExtraLives] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  // Power-Ups & Status
  const [sizeMultiplier, setSizeMultiplier] = useState(1);
  const [activePowerup, setActivePowerup] = useState<CollectibleType | null>(null);
  const [shieldCount, setShieldCount] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [aiPilotActive, setAiPilotActive] = useState(false);

  // Background Ambience
  const [clouds, setClouds] = useState<MovingObject[]>([]);

  // Multiplayer State
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [lobbyMode, setLobbyMode] = useState<LobbyMode>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomRole, setRoomRole] = useState<RoomRole>('host');
  const [lobbyError, setLobbyError] = useState('');
  const [opponent, setOpponent] = useState<OpponentState | null>(null);
  const [multiplayerWinner, setMultiplayerWinner] = useState<'me' | 'them' | 'draw' | null>(null);

  // Synchronization & Animation Refs
  const birdPosRef = useRef(birdPos);
  const birdVelRef = useRef(birdVel);
  const pipesRef = useRef<PipeData[]>(pipes);
  const collectiblesRef = useRef<Collectible[]>(collectibles);
  const particlesRef = useRef<Particle[]>(particles);
  const scoreRef = useRef(score);
  const comboRef = useRef(combo);
  const gameStateRef = useRef<GameState>(gameState);
  const playerNameRef = useRef(playerName);
  const leaderboardRef = useRef<LeaderboardEntry[]>(leaderboard);
  const totalCoinsRef = useRef(0);
  const extraLivesRef = useRef(0);
  const sizeMultiplierRef = useRef(1);
  const shieldCountRef = useRef(0);
  const aiPilotRef = useRef(false);

  // Multiplayer Refs
  const ablyRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<any>(null);
  const isMultiplayerRef = useRef(false);
  const opponentRef = useRef<OpponentState | null>(null);
  const lastPositionBroadcastRef = useRef(0);
  const skinRef = useRef<Skin>(skin);

  const requestRef = useRef<number | undefined>(undefined);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastPipeSpawnRef = useRef<number>(0);
  const gameOverHandledRef = useRef(false);
  const powerupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const level = Math.floor(score / 5) + 1;
  const theme = THEMES[getThemeForLevel(level)];
  const birdX = SCREEN_WIDTH / 2 - (BIRD_SIZE * sizeMultiplier) / 2;

  // Sync state with refs
  useEffect(() => {
    birdPosRef.current = birdPos;
    birdVelRef.current = birdVel;
    pipesRef.current = pipes;
    collectiblesRef.current = collectibles;
    particlesRef.current = particles;
    scoreRef.current = score;
    comboRef.current = combo;
    gameStateRef.current = gameState;
    playerNameRef.current = playerName;
    leaderboardRef.current = leaderboard;
    totalCoinsRef.current = totalCoins;
    extraLivesRef.current = extraLives;
    sizeMultiplierRef.current = sizeMultiplier;
    shieldCountRef.current = shieldCount;
    aiPilotRef.current = aiPilotActive;
    skinRef.current = skin;
    isMultiplayerRef.current = isMultiplayer;
  });

  // Initialize Clouds
  useEffect(() => {
    const initialClouds: MovingObject[] = [
      { id: 1, x: SCREEN_WIDTH * 0.1, y: 70, size: 90 },
      { id: 2, x: SCREEN_WIDTH * 0.55, y: 130, size: 120 },
      { id: 3, x: SCREEN_WIDTH * 0.85, y: 85, size: 75 },
    ];
    setClouds(initialClouds);
  }, [SCREEN_WIDTH]);

  // Load Inventory & Leaderboard on Start
  useEffect(() => {
    (async () => {
      try {
        const [storedName, storedBoard, storedCoins, storedLives] = await Promise.all([
          AsyncStorage.getItem(PLAYER_NAME_KEY),
          AsyncStorage.getItem(LEADERBOARD_KEY),
          AsyncStorage.getItem(COINS_KEY),
          AsyncStorage.getItem(EXTRA_LIVES_KEY),
        ]);
        if (storedName) setPlayerName(storedName);
        if (storedBoard) setLeaderboard(JSON.parse(storedBoard));
        if (storedCoins) setTotalCoins(parseInt(storedCoins, 10) || 0);
        if (storedLives) setExtraLives(parseInt(storedLives, 10) || 0);
      } catch (e) {}
    })();
  }, []);

  const persistLeaderboard = useCallback(async (nextBoard: LeaderboardEntry[]) => {
    setLeaderboard(nextBoard);
    leaderboardRef.current = nextBoard;
    await AsyncStorage.setItem(LEADERBOARD_KEY, JSON.stringify(nextBoard));
  }, []);

  const persistInventory = useCallback(async (coins: number, lives: number) => {
    await Promise.all([
      AsyncStorage.setItem(COINS_KEY, clampInt(coins).toString()),
      AsyncStorage.setItem(EXTRA_LIVES_KEY, clampInt(lives).toString()),
    ]);
  }, []);

  // Flap action
  const flap = useCallback(() => {
    if (gameStateRef.current === 'START') {
      resetGame();
      startCountdown(3);
    } else if (gameStateRef.current === 'PLAYING') {
      birdVelRef.current = JUMP_VELOCITY;
      setBirdVel(JUMP_VELOCITY);

      // Emit feather particles
      const newFeathers = createFlapFeathers(birdX, birdPosRef.current);
      particlesRef.current = [...particlesRef.current, ...newFeathers];
      setParticles(particlesRef.current);
    } else if (gameStateRef.current === 'MULTI_PLAYING') {
      birdVelRef.current = JUMP_VELOCITY;
      setBirdVel(JUMP_VELOCITY);
      if (channelRef.current) {
        try {
          channelRef.current.publish('tap', {
            birdY: birdPosRef.current,
            birdVel: JUMP_VELOCITY,
          });
        } catch (e) {}
      }
    }
  }, [birdX]);

  const applyPowerup = useCallback((type: CollectibleType) => {
    if (powerupTimerRef.current) clearTimeout(powerupTimerRef.current);
    setActivePowerup(type);

    // Particle burst
    const burst = createPowerupBurst(birdX, birdPosRef.current);
    const label = createFloatingText(birdX, birdPosRef.current - 20, `+ ${type.replace('_', ' ')}!`, '#38bdf8');
    particlesRef.current = [...particlesRef.current, ...burst, label];

    if (type === 'RAINBOW_EGG') {
      shieldCountRef.current = 2;
      setShieldCount(2);
    } else if (type === 'SHRINK_EGG') {
      sizeMultiplierRef.current = 0.65;
      setSizeMultiplier(0.65);
    } else if (type === 'GROW_EGG') {
      sizeMultiplierRef.current = 1.4;
      setSizeMultiplier(1.4);
    }

    powerupTimerRef.current = setTimeout(() => {
      setActivePowerup(null);
      sizeMultiplierRef.current = 1;
      setSizeMultiplier(1);
    }, POWERUP_DURATION_MS);
  }, [birdX]);

  const handleGameOver = useCallback(async () => {
    if (gameOverHandledRef.current) return;
    gameOverHandledRef.current = true;

    if (isMultiplayerRef.current) {
      try {
        channelRef.current?.publish('gameover', { score: scoreRef.current });
      } catch (e) {}
      const opp = opponentRef.current;
      if (opp && !opp.alive) {
        const winner = scoreRef.current > opp.score ? 'me' : scoreRef.current < opp.score ? 'them' : 'draw';
        setMultiplayerWinner(winner);
        setGameState('MULTI_GAMEOVER');
        gameStateRef.current = 'MULTI_GAMEOVER';
      } else {
        setGameState('MULTI_PLAYING');
      }
      return;
    }

    setGameState('GAMEOVER');
    gameStateRef.current = 'GAMEOVER';

    // Update Local Leaderboard
    const nextBoard = [...leaderboardRef.current, { name: playerNameRef.current, score: scoreRef.current }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    await persistLeaderboard(nextBoard);
    await persistInventory(totalCoinsRef.current, extraLivesRef.current);
  }, [persistInventory, persistLeaderboard]);

  const resetGame = useCallback(() => {
    if (powerupTimerRef.current) clearTimeout(powerupTimerRef.current);
    gameOverHandledRef.current = false;
    setBirdPos(SCREEN_HEIGHT / 2);
    birdPosRef.current = SCREEN_HEIGHT / 2;
    setBirdVel(0);
    birdVelRef.current = 0;
    setPipes([]);
    pipesRef.current = [];
    setCollectibles([]);
    collectiblesRef.current = [];
    setScore(0);
    scoreRef.current = 0;
    setCombo(1);
    comboRef.current = 1;
    setMaxCombo(1);
    setCoinsEarnedThisRun(0);
    setActivePowerup(null);
    setShieldCount(0);
    shieldCountRef.current = 0;
    setSizeMultiplier(1);
    sizeMultiplierRef.current = 1;
    lastFrameTimeRef.current = null;
    lastPipeSpawnRef.current = 0;
  }, [SCREEN_HEIGHT]);

  const startCountdown = useCallback((count = 3) => {
    setGameState('COUNTDOWN');
    gameStateRef.current = 'COUNTDOWN';
    setCountdown(count);
    let cur = count;
    const timer = setInterval(() => {
      cur -= 1;
      setCountdown(cur);
      if (cur === 0) {
        clearInterval(timer);
        setGameState('PLAYING');
        gameStateRef.current = 'PLAYING';
        birdVelRef.current = JUMP_VELOCITY;
        setBirdVel(JUMP_VELOCITY);
        lastFrameTimeRef.current = null;
      }
    }, 1000);
  }, []);

  const handleRevive = useCallback(() => {
    if (extraLives > 0) {
      const nextLives = extraLives - 1;
      setExtraLives(nextLives);
      extraLivesRef.current = nextLives;
      persistInventory(totalCoinsRef.current, nextLives);

      // Clear immediate pipes near bird
      pipesRef.current = pipesRef.current.filter(p => Math.abs(p.x - birdX) > 90);
      setPipes([...pipesRef.current]);

      setBirdPos(SCREEN_HEIGHT / 2);
      birdPosRef.current = SCREEN_HEIGHT / 2;
      setBirdVel(0);
      birdVelRef.current = 0;
      gameOverHandledRef.current = false;
      startCountdown(2);
    }
  }, [extraLives, birdX, SCREEN_HEIGHT, persistInventory, startCountdown]);

  // Main 60 FPS Game Loop
  const gameLoop = useCallback((timestamp: number) => {
    if (gameStateRef.current !== 'PLAYING' && gameStateRef.current !== 'MULTI_PLAYING') return;
    if (gameStateRef.current === 'MULTI_PLAYING' && gameOverHandledRef.current) return;

    if (lastFrameTimeRef.current === null) {
      lastFrameTimeRef.current = timestamp;
      requestRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    const frameScale = Math.min((timestamp - lastFrameTimeRef.current) / REFERENCE_FRAME_MS, 2.0);
    lastFrameTimeRef.current = timestamp;

    const curLevel = Math.floor(scoreRef.current / 5) + 1;
    const diff = getDifficultyForLevel(curLevel);
    const slowMoActive = activePowerup === 'CHRONO';

    // 1. AI Pilot Autonomous Control
    if (aiPilotRef.current) {
      const decision = computePilotAction(
        birdPosRef.current,
        birdVelRef.current,
        birdX,
        pipesRef.current,
        SCREEN_HEIGHT,
        slowMoActive
      );
      if (decision.shouldFlap) {
        birdVelRef.current = JUMP_VELOCITY;
        setBirdVel(JUMP_VELOCITY);
      }
    }

    // 2. Physics & Bird bounds
    const nextBird = stepBirdPhysics(birdPosRef.current, birdVelRef.current, frameScale, slowMoActive);
    const curSize = BIRD_SIZE * sizeMultiplierRef.current;

    // Floor & Ceiling checks
    if (nextBird.y >= SCREEN_HEIGHT - GROUND_HEIGHT - curSize || nextBird.y <= 0) {
      handleGameOver();
      return;
    }

    setBirdPos(nextBird.y);
    setBirdVel(nextBird.vel);
    birdPosRef.current = nextBird.y;
    birdVelRef.current = nextBird.vel;

    const birdBounds = getBirdBounds(birdX, nextBird.y, sizeMultiplierRef.current);

    // 3. Obstacle Spawning
    const spawnResult = spawnObstacle(
      timestamp,
      lastPipeSpawnRef.current,
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
      curLevel,
      pipesRef.current[pipesRef.current.length - 1]
    );

    if (spawnResult) {
      lastPipeSpawnRef.current = timestamp;
      pipesRef.current = [...pipesRef.current, spawnResult.pipe];
      if (spawnResult.collectible) {
        collectiblesRef.current = [...collectiblesRef.current, spawnResult.collectible];
      }
    }

    // 4. Obstacle Movement & Interactions
    const speedScale = slowMoActive ? 0.65 : 1.0;
    const curSpeed = diff.speed * speedScale * frameScale;

    pipesRef.current = stepObstacles(pipesRef.current, curSpeed, timestamp, SCREEN_HEIGHT, diff.gap);

    const collision = checkObstacleInteractions(
      birdBounds,
      pipesRef.current,
      SCREEN_HEIGHT,
      shieldCountRef.current > 0
    );
    pipesRef.current = collision.updatedPipes;
    setPipes([...pipesRef.current]);

    // Shield absorption
    if (collision.shieldUsed) {
      shieldCountRef.current = Math.max(0, shieldCountRef.current - 1);
      setShieldCount(shieldCountRef.current);
      const textParticle = createFloatingText(birdX, birdBounds.y, 'SHIELD CRUSH! 🛡️', '#38bdf8');
      particlesRef.current = [...particlesRef.current, textParticle];
    }

    // Collision crash
    if (collision.hasCollision) {
      handleGameOver();
      return;
    }

    // Near Miss combo bonus
    if (collision.nearMiss) {
      const nextCombo = comboRef.current + 1;
      comboRef.current = nextCombo;
      setCombo(nextCombo);
      setMaxCombo(prev => Math.max(prev, nextCombo));
      const textParticle = createFloatingText(birdX, birdBounds.y - 25, `CLOSE CALL! x${nextCombo} 🔥`, '#ec4899');
      particlesRef.current = [...particlesRef.current, textParticle];
    }

    // Scoring passed pipes
    if (collision.passedCount > 0) {
      const points = collision.passedCount * comboRef.current;
      scoreRef.current += points;
      setScore(scoreRef.current);
    }

    // 5. Collectibles & Magnet
    const magnetActive = activePowerup === 'MAGNET';
    const collResult = stepCollectibles(collectiblesRef.current, curSpeed, birdBounds, magnetActive);
    collectiblesRef.current = collResult.updated;
    setCollectibles([...collectiblesRef.current]);

    for (const item of collResult.collectedItems) {
      if (item === 'COIN') {
        totalCoinsRef.current += 1;
        setTotalCoins(totalCoinsRef.current);
        setCoinsEarnedThisRun(c => c + 1);
        particlesRef.current = [
          ...particlesRef.current,
          ...createCoinSparkles(birdX, birdBounds.y),
          createFloatingText(birdX, birdBounds.y - 15, '+10 ⭐', '#facc15'),
        ];
      } else {
        applyPowerup(item);
      }
    }

    // 6. Particles step
    particlesRef.current = stepParticles(particlesRef.current, frameScale);
    setParticles([...particlesRef.current]);

    // 7. Ambient Clouds drift
    setClouds(prev =>
      prev.map(c => ({
        ...c,
        x: c.x - curSpeed * 0.25 < -120 ? SCREEN_WIDTH + 80 : c.x - curSpeed * 0.25,
      }))
    );

    requestRef.current = requestAnimationFrame(gameLoop);
  }, [activePowerup, applyPowerup, birdX, handleGameOver, SCREEN_HEIGHT, SCREEN_WIDTH]);

  // Start / Stop Game Loop
  useEffect(() => {
    if (gameState === 'PLAYING' || gameState === 'MULTI_PLAYING') {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, gameLoop]);

  return (
    <TouchableWithoutFeedback onPress={flap}>
      <View style={styles.root}>
        <StatusBar hidden />

        {/* Dynamic Parallax Scenery */}
        <ParallaxBackground
          theme={theme}
          clouds={clouds}
          screenWidth={SCREEN_WIDTH}
          screenHeight={SCREEN_HEIGHT}
          level={level}
        />

        {/* Dynamic Obstacles & Collectibles */}
        <Obstacles
          pipes={pipes}
          collectibles={collectibles}
          theme={theme}
          screenHeight={SCREEN_HEIGHT}
        />

        {/* High-Fidelity Hero Bird */}
        <Bird
          x={birdX}
          y={birdPos}
          vel={birdVel}
          skin={skin}
          sizeMultiplier={sizeMultiplier}
          activePowerup={activePowerup}
          shieldCount={shieldCount}
        />

        {/* Dynamic Particle Burst Layer */}
        <ParticleLayer particles={particles} />

        {/* In-Game HUD */}
        {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
          <GameHUD
            score={score}
            combo={combo}
            level={level}
            totalCoins={totalCoins}
            activePowerup={activePowerup}
            aiPilotActive={aiPilotActive}
            onToggleAiPilot={() => setAiPilotActive(prev => !prev)}
            onTogglePause={() => {
              if (gameState === 'PLAYING') setGameState('PAUSED');
              else if (gameState === 'PAUSED') startCountdown(2);
            }}
          />
        )}

        {/* Countdown Overlay */}
        {gameState === 'COUNTDOWN' && (
          <View style={styles.countdownOverlay}>
            <Text style={styles.countdownNumber}>{countdown}</Text>
            <Text style={styles.countdownSubtitle}>GET READY TO FLAP!</Text>
          </View>
        )}

        {/* Game Over Modal */}
        {gameState === 'GAMEOVER' && (
          <GameOverModal
            score={score}
            bestScore={leaderboard[0]?.score || score}
            coinsEarned={coinsEarnedThisRun}
            maxCombo={maxCombo}
            extraLives={extraLives}
            onRevive={handleRevive}
            onTryAgain={() => {
              resetGame();
              startCountdown(3);
            }}
            onHome={() => setGameState('START')}
          />
        )}

        {/* Start / Menu Screen */}
        {gameState === 'START' && (
          <View style={styles.menuContainer}>
            <View style={styles.logoCard}>
              <Text style={styles.gameTitle}>FLIPPY BARD</Text>
              <Text style={styles.gameSubtitle}>SUPERCHARGED ARCADE EDITION</Text>
            </View>

            {/* Quick Hero Preview */}
            <View style={styles.previewHeroWrapper}>
              <Image
                source={require('./assets/sprites/bird_hero.jpg')}
                style={styles.previewHeroImage}
              />
            </View>

            {/* Tap to Play Button */}
            <TouchableOpacity
              style={styles.playButton}
              onPress={() => {
                resetGame();
                startCountdown(3);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.playButtonText}>TAP TO FLY 🚀</Text>
            </TouchableOpacity>

            {/* Dev / AI Pilot Toggle */}
            <TouchableOpacity
              style={[styles.aiToggleMenu, aiPilotActive && styles.aiToggleMenuActive]}
              onPress={() => setAiPilotActive(prev => !prev)}
              activeOpacity={0.8}
            >
              <Text style={styles.aiToggleText}>
                {aiPilotActive ? '🤖 AI PILOT AUTOPLAY: ACTIVE' : '🤖 TOGGLE AI PILOT TEST MODE'}
              </Text>
            </TouchableOpacity>

            {/* Leaderboard preview */}
            {leaderboard.length > 0 && (
              <View style={styles.miniLeaderboard}>
                <Text style={styles.leaderboardTitle}>🏆 TOP PILOTS</Text>
                {leaderboard.slice(0, 3).map((entry, idx) => (
                  <View key={idx} style={styles.leaderboardRow}>
                    <Text style={styles.leaderboardRank}>#{idx + 1} {entry.name}</Text>
                    <Text style={styles.leaderboardScore}>{entry.score} pts</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  menuContainer: {
    ...StyleSheet.absoluteFill as any,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  logoCard: {
    alignItems: 'center',
    marginBottom: 24,
  },
  gameTitle: {
    fontSize: 42,
    fontWeight: '900',
    color: '#fbbf24',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  gameSubtitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 2,
    marginTop: 4,
  },
  previewHeroWrapper: {
    width: 110,
    height: 110,
    borderRadius: 55,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#f59e0b',
    marginBottom: 30,
    shadowColor: '#f59e0b',
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 12,
  },
  previewHeroImage: {
    width: 110,
    height: 110,
  },
  playButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 36,
    paddingVertical: 18,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#60a5fa',
    shadowColor: '#2563eb',
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 10,
    marginBottom: 16,
  },
  playButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  aiToggleMenu: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 24,
  },
  aiToggleMenuActive: {
    backgroundColor: '#059669',
    borderColor: '#34d399',
  },
  aiToggleText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  miniLeaderboard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  leaderboardTitle: {
    color: '#facc15',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  leaderboardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  leaderboardRank: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  leaderboardScore: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '800',
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFill as any,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 45,
  },
  countdownNumber: {
    fontSize: 90,
    fontWeight: '900',
    color: '#facc15',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  countdownSubtitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 10,
  },
});
