import { PipeData } from './types';
import { JUMP_VELOCITY, GRAVITY, GROUND_HEIGHT, BIRD_SIZE, PIPE_WIDTH } from './constants';

export interface PilotDecision {
  shouldFlap: boolean;
  targetY: number;
  confidence: number;
}

/**
 * Intelligent AI Pilot that calculates parabolic flight trajectories
 * to navigate through upcoming obstacle gaps and collect coins cleanly.
 */
export const computePilotAction = (
  birdY: number,
  birdVel: number,
  birdX: number,
  pipes: PipeData[],
  screenHeight: number,
  slowMo = false
): PilotDecision => {
  const g = slowMo ? GRAVITY * 0.65 : GRAVITY;

  // Find the first upcoming pipe ahead of the bird
  const nextPipe = pipes.find(p => p.x + PIPE_WIDTH > birdX - 5);

  let targetY: number;

  if (!nextPipe) {
    // Default cruise altitude (middle of screen)
    targetY = (screenHeight - GROUND_HEIGHT) * 0.48;
  } else {
    const gapTop = nextPipe.topHeight;
    const gapBottom = screenHeight - GROUND_HEIGHT - nextPipe.bottomHeight;
    // Align with center of gap
    targetY = (gapTop + gapBottom) / 2;
  }

  // Trajectory prediction
  const lookaheadFrames = 8;
  let predictedY = birdY;
  let simVel = birdVel;
  for (let i = 0; i < lookaheadFrames; i++) {
    simVel += g;
    predictedY += simVel;
  }

  // Flap decision logic
  let shouldFlap = false;

  // 1. Avoid crashing into ground
  const dangerFloor = screenHeight - GROUND_HEIGHT - BIRD_SIZE - 25;
  if (predictedY > dangerFloor || (birdY > dangerFloor - 30 && birdVel > 0)) {
    shouldFlap = true;
  }
  // 2. Head toward gap target if falling below it
  else if (birdY > targetY + 8 && birdVel >= -1.0) {
    shouldFlap = true;
  }
  // 3. Prevent rising too high into top ceiling/pipe
  const dangerCeiling = nextPipe && nextPipe.x - birdX < 110 ? nextPipe.topHeight + 15 : 40;
  if (birdY < dangerCeiling) {
    shouldFlap = false;
  }

  return {
    shouldFlap,
    targetY,
    confidence: 0.98,
  };
};
