// Headless automated test harness to verify level curves and AI Pilot beatability

const GRAVITY = 0.44;
const JUMP_VELOCITY = -7.6;
const GROUND_HEIGHT = 90;
const PIPE_WIDTH = 68;
const BIRD_SIZE = 40;
const HITBOX_PADDING = 6;
const REFERENCE_FRAME_MS = 1000 / 60;

const getDifficultyForLevel = (level) => {
  const speed = 3.0 + Math.min(level - 1, 25) * 0.12;
  const gap = Math.max(154, 195 - Math.min(level - 1, 20) * 2.0);
  const spawnDistance = 270;
  const spawnRateMs = (spawnDistance / speed) * REFERENCE_FRAME_MS;
  return { speed, gap, spawnRateMs };
};

console.log('====================================================');
console.log('🤖 FLIPPYBARD LEVEL BEATABILITY & AI PILOT TEST HARNESS');
console.log('====================================================\n');

const SCREEN_WIDTH = 400;
const SCREEN_HEIGHT = 800;

// Verify difficulty parameters for levels 1 to 25
console.log('Checking level progression curves (Levels 1 to 25)...');
for (let lvl = 1; lvl <= 25; lvl++) {
  const diff = getDifficultyForLevel(lvl);
  if (diff.gap < 140) {
    throw new Error(`Level ${lvl} gap too small: ${diff.gap}`);
  }
  if (diff.speed <= 0 || isNaN(diff.speed)) {
    throw new Error(`Level ${lvl} speed invalid: ${diff.speed}`);
  }
}
console.log('✅ Level curves validated: All gaps >= 154px (comfortably exceed bird size 40px).\n');

// Simulate real-time game loop with AI Pilot
let birdY = (SCREEN_HEIGHT - GROUND_HEIGHT) * 0.5;
let birdVel = 0;
let score = 0;
let pipes = [];
let lastSpawnTime = 0;
let frameCount = 0;
let passedPipes = 0;
const targetPipesToBeat = 120; // 120 pipes = 24 levels!

console.log(`Simulating AI Pilot flying through ${targetPipesToBeat} consecutive pipes...`);

let lastPipeTopH = SCREEN_HEIGHT / 2 - 90;

for (let t = 0; passedPipes < targetPipesToBeat; t += 16.67) {
  frameCount++;
  const curLevel = Math.floor(score / 5) + 1;
  const diff = getDifficultyForLevel(curLevel);

  // 1. Spawn pipes
  if (t - lastSpawnTime > diff.spawnRateMs) {
    const gap = diff.gap;
    const minPipeH = 70;
    const maxPipeH = SCREEN_HEIGHT - GROUND_HEIGHT - gap - minPipeH;
    const variance = Math.min(180, 110 + curLevel * 3);
    let topH = Math.floor(lastPipeTopH + (Math.random() * variance - variance / 2));
    topH = Math.max(minPipeH, Math.min(maxPipeH, topH));
    lastPipeTopH = topH;

    pipes.push({
      x: SCREEN_WIDTH + 10,
      topHeight: topH,
      bottomHeight: SCREEN_HEIGHT - GROUND_HEIGHT - topH - gap,
      passed: false,
    });
    lastSpawnTime = t;
  }

  // 2. AI Pilot decision
  const birdX = SCREEN_WIDTH / 2 - BIRD_SIZE / 2;
  const nextPipe = pipes.find(p => p.x + PIPE_WIDTH > birdX - 5);
  let targetY = (SCREEN_HEIGHT - GROUND_HEIGHT) * 0.48;
  if (nextPipe) {
    const gapTop = nextPipe.topHeight;
    const gapBottom = SCREEN_HEIGHT - GROUND_HEIGHT - nextPipe.bottomHeight;
    // Anticipate gap entry: align with center of gap
    targetY = (gapTop + gapBottom) / 2;
  }

  const lookahead = 8;
  let simY = birdY;
  let simVel = birdVel;
  for (let i = 0; i < lookahead; i++) {
    simVel += GRAVITY;
    simY += simVel;
  }

  const dangerFloor = SCREEN_HEIGHT - GROUND_HEIGHT - BIRD_SIZE - 25;
  let shouldFlap = false;
  if (simY > dangerFloor || (birdY > dangerFloor - 30 && birdVel > 0)) {
    shouldFlap = true;
  } else if (birdY > targetY + 8 && birdVel >= -1.0) {
    shouldFlap = true;
  }

  const dangerCeiling = nextPipe && nextPipe.x - birdX < 110 ? nextPipe.topHeight + 15 : 40;
  if (birdY < dangerCeiling) {
    shouldFlap = false;
  }

  if (shouldFlap) {
    birdVel = JUMP_VELOCITY;
  }

  // 3. Physics step
  birdVel = Math.min(11.5, birdVel + GRAVITY);
  birdY += birdVel;

  // Ground collision check
  if (birdY >= SCREEN_HEIGHT - GROUND_HEIGHT - BIRD_SIZE || birdY <= 0) {
    console.error(`💥 Crashed into boundary at Y: ${birdY.toFixed(1)}, Level: ${curLevel}`);
    process.exit(1);
  }

  // Move pipes
  const curSpeed = diff.speed;
  pipes = pipes.map(p => ({ ...p, x: p.x - curSpeed })).filter(p => p.x + PIPE_WIDTH + 20 > 0);

  // Check collision & score
  const bL = birdX + HITBOX_PADDING;
  const bR = birdX + BIRD_SIZE - HITBOX_PADDING;
  const bT = birdY + HITBOX_PADDING;
  const bB = birdY + BIRD_SIZE - HITBOX_PADDING;

  for (const p of pipes) {
    const pipeL = p.x;
    const pipeR = p.x + PIPE_WIDTH;
    const gapT = p.topHeight;
    const gapB = SCREEN_HEIGHT - GROUND_HEIGHT - p.bottomHeight;

    if (bR > pipeL && bL < pipeR) {
      if (bT < gapT || bB > gapB) {
        console.error(`💥 Collision with pipe at X: ${p.x.toFixed(1)}, Level: ${curLevel}, Score: ${score}`);
        console.error(`Bird: [${bT.toFixed(1)} to ${bB.toFixed(1)}], Gap: [${gapT} to ${gapB}]`);
        process.exit(1);
      }
    }

    if (!p.passed && bL > pipeR) {
      p.passed = true;
      score++;
      passedPipes++;
      if (passedPipes % 20 === 0) {
        console.log(`🚩 Passed ${passedPipes} pipes! (Current Level: ${curLevel}, Score: ${score})`);
      }
    }
  }
}

console.log('\n====================================================');
console.log(`🎉 SUCCESS! AI Pilot completed ${passedPipes} pipes across 24 levels without a single collision!`);
console.log(`Total Simulated Frames: ${frameCount}`);
console.log('====================================================');
