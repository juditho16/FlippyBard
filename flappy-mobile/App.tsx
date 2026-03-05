import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Dimensions, 
  TouchableOpacity, 
  TextInput, 
  ScrollView,
  StatusBar,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

// Screen Dimensions
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Game Constants
const GRAVITY = 0.6;
const JUMP = -8;
const INITIAL_PIPE_SPEED = 3.5;
const PIPE_WIDTH = 60;
const BIRD_SIZE = 40;
const GAP_SIZE = 180;
const GROUND_HEIGHT = 100;
const PIPE_SPAWN_INTERVAL = 1500;

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

export default function App() {
  const [gameState, setGameState] = useState<GameState>('START');
  const [birdPos, setBirdPos] = useState(SCREEN_HEIGHT / 2);
  const [birdVel, setBirdVel] = useState(0);
  const [pipes, setPipes] = useState<PipeData[]>([]);
  const [score, setScore] = useState(0);
  const [playerName, setPlayerName] = useState('Player 1');
  const [skin, setSkin] = useState<Skin>('gold');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  
  const requestRef = useRef<number>();
  const lastPipeSpawnRef = useRef<number>(0);

  const level = Math.floor(score / 5) + 1;
  const currentPipeSpeed = INITIAL_PIPE_SPEED + (level - 1) * 0.4;

  // Sound Engine
  const playSound = async (type: 'flap' | 'score' | 'hit') => {
    // Note: On mobile, you would typically load assets. 
    // For this prototype, sound is placeholder as loading assets 
    // requires physical files in the project.
  };

  // Load Leaderboard and Name on Start
  useEffect(() => {
    const loadData = async () => {
      const savedName = await AsyncStorage.getItem('flappyPlayerName');
      if (savedName) setPlayerName(savedName);
      
      const savedBoard = await AsyncStorage.getItem('flappyLeaderboard');
      if (savedBoard) setLeaderboard(JSON.parse(savedBoard));
    };
    loadData();
  }, []);

  const updateLeaderboard = useCallback(async (finalScore: number) => {
    const name = (playerName.trim() || 'Anonymous').slice(0, 12);
    let newLeaderboard = [...leaderboard];
    
    const existingIndex = newLeaderboard.findIndex(
      entry => entry.name.toLowerCase() === name.toLowerCase()
    );

    if (existingIndex !== -1) {
      if (finalScore > newLeaderboard[existingIndex].score) {
        newLeaderboard[existingIndex].score = finalScore;
        newLeaderboard[existingIndex].name = name;
      } else {
        return;
      }
    } else {
      newLeaderboard.push({ name, score: finalScore });
    }

    const sortedLeaderboard = newLeaderboard
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    setLeaderboard(sortedLeaderboard);
    await AsyncStorage.setItem('flappyLeaderboard', JSON.stringify(sortedLeaderboard));
  }, [leaderboard, playerName]);

  const resetGame = () => {
    setBirdPos(SCREEN_HEIGHT / 2);
    setBirdVel(0);
    setPipes([]);
    setScore(0);
    setGameState('START');
    lastPipeSpawnRef.current = 0;
  };

  const flap = useCallback(() => {
    if (gameState === 'START') {
      setGameState('PLAYING');
      setBirdVel(JUMP);
    } else if (gameState === 'PLAYING') {
      setBirdVel(JUMP);
    } else if (gameState === 'GAMEOVER') {
      resetGame();
    }
  }, [gameState]);

  const spawnPipe = (timestamp: number) => {
    const spawnRate = Math.max(900, PIPE_SPAWN_INTERVAL - (level * 60));
    if (timestamp - lastPipeSpawnRef.current > spawnRate) {
      const minPipeHeight = 80;
      const maxPipeHeight = SCREEN_HEIGHT - GROUND_HEIGHT - GAP_SIZE - minPipeHeight;
      const topHeight = Math.floor(Math.random() * (maxPipeHeight - minPipeHeight + 1) + minPipeHeight);
      
      setPipes((prev) => [
        ...prev,
        {
          x: SCREEN_WIDTH,
          topHeight,
          bottomHeight: SCREEN_HEIGHT - GROUND_HEIGHT - topHeight - GAP_SIZE,
          passed: false,
        },
      ]);
      lastPipeSpawnRef.current = timestamp;
    }
  };

  const gameLoop = (timestamp: number) => {
    if (gameState !== 'PLAYING') return;

    setBirdPos((pos) => {
      const newPos = pos + birdVel;
      if (newPos >= SCREEN_HEIGHT - GROUND_HEIGHT - BIRD_SIZE || newPos <= 0) {
        setGameState('GAMEOVER');
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
          (birdTop < pipe.topHeight || birdBottom > SCREEN_HEIGHT - GROUND_HEIGHT - pipe.bottomHeight)
        ) {
          setGameState('GAMEOVER');
          updateLeaderboard(score);
        }

        if (!pipe.passed && birdLeft > pipe.x + PIPE_WIDTH) {
          setScore((s) => s + 1);
          return { ...pipe, passed: true };
        }
        return pipe;
      });
      return nextPipes;
    });

    requestRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    if (gameState === 'PLAYING') {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, birdPos, birdVel]);

  const getSkinColor = (s: Skin) => {
    const colors = { gold: '#f1c40f', blue: '#3498db', pink: '#e84393', green: '#2ecc71' };
    return colors[s];
  };

  return (
    <View style={styles.container} onStartShouldSetResponder={() => true} onResponderRelease={flap}>
      <StatusBar hidden />
      
      {/* Game Background */}
      <View style={styles.sky}>
        <Text style={styles.scoreText}>{score}</Text>
        <View style={styles.levelBadge}><Text style={styles.levelText}>LVL {level}</Text></View>
      </View>

      {/* Bird */}
      <View 
        style={[
          styles.bird, 
          { 
            top: birdPos, 
            backgroundColor: getSkinColor(skin),
            transform: [{ rotate: `${Math.min(Math.max(birdVel * 4, -25), 90)}deg` }] 
          }
        ]} 
      />

      {/* Pipes */}
      {pipes.map((pipe, i) => (
        <React.Fragment key={i}>
          <View style={[styles.pipe, { left: pipe.x, top: 0, height: pipe.topHeight }]} />
          <View style={[styles.pipe, { left: pipe.x, bottom: GROUND_HEIGHT, height: pipe.bottomHeight }]} />
        </React.Fragment>
      ))}

      {/* Ground */}
      <View style={styles.ground} />

      {/* UI Overlays */}
      {gameState === 'START' && (
        <View style={styles.overlay}>
          <Text style={styles.title}>FLAPPY BIRD</Text>
          
          <TextInput 
            style={styles.nameInput}
            value={playerName}
            onChangeText={(t) => {
              setPlayerName(t);
              AsyncStorage.setItem('flappyPlayerName', t);
            }}
            placeholder="Enter Name"
            placeholderTextColor="#999"
          />

          <View style={styles.skinSelector}>
            {(['gold', 'blue', 'pink', 'green'] as Skin[]).map(s => (
              <TouchableOpacity 
                key={s} 
                onPress={() => setSkin(s)}
                style={[
                  styles.skinOption, 
                  { backgroundColor: getSkinColor(s) },
                  skin === s && styles.skinActive
                ]}
              />
            ))}
          </View>

          <TouchableOpacity style={styles.btn} onPress={flap}>
            <Text style={styles.btnText}>START GAME</Text>
          </TouchableOpacity>

          <View style={styles.leaderboard}>
            <Text style={styles.boardTitle}>TOP SCORES</Text>
            {leaderboard.map((item, i) => (
              <View key={i} style={styles.boardItem}>
                <Text style={styles.boardText}>{i+1}. {item.name}</Text>
                <Text style={styles.boardScore}>{item.score}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {gameState === 'GAMEOVER' && (
        <View style={styles.overlay}>
          <Text style={styles.title}>GAME OVER</Text>
          <Text style={styles.finalScore}>SCORE: {score}</Text>
          <TouchableOpacity style={styles.btn} onPress={flap}>
            <Text style={styles.btnText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#70c5ce',
  },
  sky: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 50,
  },
  scoreText: {
    fontSize: 80,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'black',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },
  levelBadge: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderRadius: 20,
  },
  levelText: {
    color: 'white',
    fontWeight: 'bold',
  },
  bird: {
    position: 'absolute',
    left: 50,
    width: BIRD_SIZE,
    height: BIRD_SIZE,
    borderRadius: BIRD_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  pipe: {
    position: 'absolute',
    width: PIPE_WIDTH,
    backgroundColor: '#2ecc71',
    borderWidth: 3,
    borderColor: '#27ae60',
    borderRadius: 5,
  },
  ground: {
    position: 'absolute',
    bottom: 0,
    width: SCREEN_WIDTH,
    height: GROUND_HEIGHT,
    backgroundColor: '#ded895',
    borderTopWidth: 5,
    borderTopColor: '#73bf2e',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
    textShadowColor: 'black',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 5,
  },
  nameInput: {
    backgroundColor: 'white',
    width: '80%',
    padding: 15,
    borderRadius: 10,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  skinSelector: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 30,
  },
  skinOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: 'white',
  },
  skinActive: {
    borderColor: '#f1c40f',
    transform: [{ scale: 1.2 }],
  },
  btn: {
    backgroundColor: '#e67e22',
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 10,
    borderBottomWidth: 5,
    borderBottomColor: '#d35400',
  },
  btnText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  finalScore: {
    fontSize: 32,
    color: '#f1c40f',
    fontWeight: 'bold',
    marginBottom: 20,
  },
  leaderboard: {
    marginTop: 40,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: 15,
  },
  boardTitle: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  boardItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  boardText: { color: '#ccc' },
  boardScore: { color: '#2ecc71', fontWeight: 'bold' },
});