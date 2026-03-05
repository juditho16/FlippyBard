import React, { useState, useEffect, useRef, useCallback } from 'react';

// Game Constants
const GRAVITY = 0.5;
const JUMP = -8;
const INITIAL_PIPE_SPEED = 3;
const PIPE_WIDTH = 60;
const BIRD_SIZE = 34;
const GAME_HEIGHT = 600;
const GAME_WIDTH = 400;
const GAP_SIZE = 170;
const GROUND_HEIGHT = 80;

type GameState = 'START' | 'PLAYING' | 'GAMEOVER';
type Skin = 'gold' | 'blue' | 'pink' | 'green';

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

// Synthesized Audio Utility
const playSound = (type: 'flap' | 'score' | 'hit') => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (type === 'flap') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'score') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'hit') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.linearRampToValueAtTime(40, now + 0.3);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) { /* Audio might be blocked */ }
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>('START');
  const [birdPos, setBirdPos] = useState(GAME_HEIGHT / 2);
  const [birdVel, setBirdVel] = useState(0);
  const [pipes, setPipes] = useState<PipeData[]>([]);
  const [score, setScore] = useState(0);
  const [playerName, setPlayerName] = useState(localStorage.getItem('flappyPlayerName') || 'Player 1');
  const [skin, setSkin] = useState<Skin>('gold');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => {
    return JSON.parse(localStorage.getItem('flappyLeaderboard') || '[]');
  });
  
  const requestRef = useRef<number>();
  const lastPipeSpawnRef = useRef<number>(0);

  const level = Math.floor(score / 5) + 1;
  const currentPipeSpeed = INITIAL_PIPE_SPEED + (level - 1) * 0.5;

  const flap = useCallback(() => {
    if (gameState === 'START') {
      setGameState('PLAYING');
      setBirdVel(JUMP);
      playSound('flap');
    } else if (gameState === 'PLAYING') {
      setBirdVel(JUMP);
      playSound('flap');
    } else if (gameState === 'GAMEOVER') {
      resetGame();
    }
  }, [gameState]);

  const resetGame = () => {
    setBirdPos(GAME_HEIGHT / 2);
    setBirdVel(0);
    setPipes([]);
    setScore(0);
    setGameState('START');
    lastPipeSpawnRef.current = 0;
  };

  const updateLeaderboard = useCallback((finalScore: number) => {
    const name = (playerName.trim() || 'Anonymous').slice(0, 12);
    let newLeaderboard = [...leaderboard];
    
    // Check if player already exists (case-insensitive)
    const existingIndex = newLeaderboard.findIndex(
      entry => entry.name.toLowerCase() === name.toLowerCase()
    );

    if (existingIndex !== -1) {
      // Only update if the new score is higher
      if (finalScore > newLeaderboard[existingIndex].score) {
        newLeaderboard[existingIndex].score = finalScore;
        newLeaderboard[existingIndex].name = name; // Update display name casing if changed
      } else {
        // If the new score is not higher, don't change anything
        return;
      }
    } else {
      // New player, add them to the list
      newLeaderboard.push({ name, score: finalScore });
    }

    // Sort by score descending and keep top 10
    const sortedLeaderboard = newLeaderboard
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    setLeaderboard(sortedLeaderboard);
    localStorage.setItem('flappyLeaderboard', JSON.stringify(sortedLeaderboard));
  }, [leaderboard, playerName]);

  const spawnPipe = (timestamp: number) => {
    const spawnRate = Math.max(800, 1500 - (level * 50));
    if (timestamp - lastPipeSpawnRef.current > spawnRate) {
      const minPipeHeight = 50;
      const maxPipeHeight = GAME_HEIGHT - GROUND_HEIGHT - GAP_SIZE - minPipeHeight;
      const topHeight = Math.floor(Math.random() * (maxPipeHeight - minPipeHeight + 1) + minPipeHeight);
      
      setPipes((prev) => [
        ...prev,
        {
          x: GAME_WIDTH,
          topHeight,
          bottomHeight: GAME_HEIGHT - GROUND_HEIGHT - topHeight - GAP_SIZE,
          passed: false,
        },
      ]);
      lastPipeSpawnRef.current = timestamp;
    }
  };

  const gameLoop = useCallback((timestamp: number) => {
    if (gameState !== 'PLAYING') return;

    setBirdPos((pos) => {
      const newPos = pos + birdVel;
      if (newPos >= GAME_HEIGHT - GROUND_HEIGHT - BIRD_SIZE || newPos <= 0) {
        setGameState('GAMEOVER');
        playSound('hit');
        updateLeaderboard(score);
        return pos;
      }
      return newPos;
    });

    setBirdVel((vel) => vel + GRAVITY);
    spawnPipe(timestamp);

    setPipes((prevPipes) => {
      let nextPipes = prevPipes
        .map((pipe) => ({ ...pipe, x: pipe.x - currentPipeSpeed }))
        .filter((pipe) => pipe.x + PIPE_WIDTH > 0);

      nextPipes = nextPipes.map((pipe) => {
        const birdLeft = 50;
        const birdRight = 50 + BIRD_SIZE;
        const birdTop = birdPos;
        const birdBottom = birdPos + BIRD_SIZE;

        if (
          birdRight > pipe.x &&
          birdLeft < pipe.x + PIPE_WIDTH &&
          (birdTop < pipe.topHeight || birdBottom > GAME_HEIGHT - GROUND_HEIGHT - pipe.bottomHeight)
        ) {
          setGameState('GAMEOVER');
          playSound('hit');
          updateLeaderboard(score);
        }

        if (!pipe.passed && birdLeft > pipe.x + PIPE_WIDTH) {
          playSound('score');
          setScore((s) => s + 1);
          return { ...pipe, passed: true };
        }
        return pipe;
      });
      return nextPipes;
    });

    requestRef.current = requestAnimationFrame(gameLoop);
  }, [birdPos, birdVel, gameState, currentPipeSpeed, score, updateLeaderboard]);

  useEffect(() => {
    if (gameState === 'PLAYING') {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameLoop, gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flap]);

  const skins: Skin[] = ['gold', 'blue', 'pink', 'green'];

  return (
    <div className="game-layout">
      <div 
        className="game-container" 
        style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}
        onMouseDown={(e) => {
          // Prevent starting if clicking on UI elements
          if (gameState === 'START' && (e.target as HTMLElement).closest('.skin-selector, .name-input')) return;
          flap();
        }}
      >
        <div className="score-display">
          <div className="current-score">{score}</div>
        </div>

        <div className="level-badge">LVL {level}</div>

        <div 
          className={`bird ${skin}`}
          style={{
            width: BIRD_SIZE,
            height: BIRD_SIZE,
            left: 50,
            top: birdPos,
            transform: `rotate(${Math.min(Math.max(birdVel * 3, -25), 90)}deg)`
          }}
        />

        {pipes.map((pipe, i) => (
          <React.Fragment key={i}>
            <div className="pipe top" style={{ left: pipe.x, top: 0, width: PIPE_WIDTH, height: pipe.topHeight }} />
            <div className="pipe bottom" style={{ left: pipe.x, bottom: GROUND_HEIGHT, width: PIPE_WIDTH, height: pipe.bottomHeight }} />
          </React.Fragment>
        ))}

        <div className="ground" style={{ height: GROUND_HEIGHT }} />

        {gameState === 'START' && (
          <div className="ui-overlay">
            <div className="title">Flappy Bird</div>
            
            <div className="name-input-container">
              <input 
                type="text" 
                className="name-input" 
                placeholder="Enter Name"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  localStorage.setItem('flappyPlayerName', e.target.value);
                }}
                maxLength={12}
              />
            </div>

            <div className="skin-selector">
              {skins.map(s => (
                <div 
                  key={s}
                  className={`skin-option bird ${s} ${skin === s ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setSkin(s); }}
                />
              ))}
            </div>

            <button className="start-btn" onClick={(e) => { e.stopPropagation(); flap(); }}>
              Start Game
            </button>
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="ui-overlay">
            <div className="title">Game Over</div>
            <div style={{ marginBottom: '20px', color: '#f1c40f', fontWeight: 'bold', fontSize: '24px' }}>
              SCORE: {score}
            </div>
            <button className="start-btn" onClick={(e) => { e.stopPropagation(); flap(); }}>
              Try Again
            </button>
          </div>
        )}
      </div>

      <div className="leaderboard">
        <h2>Ranking</h2>
        <div className="ranking-list">
          {leaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#95a5a6' }}>No records yet</div>
          ) : (
            leaderboard.map((entry, i) => (
              <div key={i} className="ranking-item">
                <span className="rank">#{i + 1}</span>
                <span className="name">{entry.name}</span>
                <span className="score">{entry.score}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}