import { PipeData, Collectible, CollectibleType, ObstacleType } from './types';
import {
  GRAVITY,
  MAX_FALL_VELOCITY,
  GROUND_HEIGHT,
  PIPE_WIDTH,
  BIRD_SIZE,
  HITBOX_PADDING,
  NEAR_MISS_DISTANCE,
  getDifficultyForLevel,
} from './constants';

export interface BirdBounds {
  x: number;
  y: number;
  size: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const getBirdBounds = (x: number, y: number, sizeMultiplier = 1): BirdBounds => {
  const size = BIRD_SIZE * sizeMultiplier;
  return {
    x,
    y,
    size,
    left: x + HITBOX_PADDING,
    right: x + size - HITBOX_PADDING,
    top: y + HITBOX_PADDING,
    bottom: y + size - HITBOX_PADDING,
  };
};

export const stepBirdPhysics = (
  currentY: number,
  currentVel: number,
  frameScale: number,
  slowMo = false
) => {
  const gravityScale = slowMo ? 0.65 : 1.0;
  const nextVel = Math.min(
    MAX_FALL_VELOCITY,
    currentVel + GRAVITY * gravityScale * frameScale
  );
  const nextY = currentY + currentVel * frameScale;
  return { y: nextY, vel: nextVel };
};

export const spawnObstacle = (
  timestamp: number,
  lastSpawnTime: number,
  screenWidth: number,
  screenHeight: number,
  level: number,
  lastPipe?: PipeData
): { pipe: PipeData; collectible?: Collectible } | null => {
  const diff = getDifficultyForLevel(level);

  if (timestamp - lastSpawnTime < diff.spawnRateMs) {
    return null;
  }

  const gap = diff.gap;
  const minPipeH = 70;
  const maxPipeH = screenHeight - GROUND_HEIGHT - gap - minPipeH;

  const lastTopH = lastPipe ? lastPipe.topHeight : screenHeight / 2 - gap / 2;
  const variance = Math.min(180, 110 + level * 3);
  let topH = Math.floor(lastTopH + (Math.random() * variance - variance / 2));
  topH = Math.max(minPipeH, Math.min(maxPipeH, topH));

  const isDynamic = Math.random() < diff.dynamicObstacleChance;
  let type: ObstacleType = 'PIPE';
  if (isDynamic) {
    type = Math.random() > 0.4 ? 'MOVING_PIPE' : 'LASER_GATE';
  }

  const pipe: PipeData = {
    id: timestamp,
    x: screenWidth + 10,
    topHeight: topH,
    bottomHeight: screenHeight - GROUND_HEIGHT - topH - gap,
    passed: false,
    type,
    baseTopHeight: topH,
    oscillationSpeed: 0.0025 + Math.random() * 0.002,
    oscillationRange: Math.min(50, 20 + level * 1.5),
    nearMissAwarded: false,
  };

  let collectible: Collectible | undefined;
  // 45% chance to spawn a collectible in the gap
  if (Math.random() < 0.45) {
    const roll = Math.random();
    let cType: CollectibleType = 'COIN';
    if (roll > 0.88) cType = 'RAINBOW_EGG'; // Shield
    else if (roll > 0.76) cType = 'CHRONO'; // Slow-mo
    else if (roll > 0.64) cType = 'MAGNET';
    else if (roll > 0.52) cType = 'SHRINK_EGG';
    else if (roll > 0.45) cType = 'GROW_EGG';

    collectible = {
      id: timestamp + 1,
      x: screenWidth + PIPE_WIDTH / 2 - 14,
      y: topH + gap / 2 - 14,
      type: cType,
      collected: false,
      size: 28,
    };
  }

  return { pipe, collectible };
};

export const stepObstacles = (
  pipes: PipeData[],
  curSpeed: number,
  timestamp: number,
  screenHeight: number,
  gap: number
): PipeData[] => {
  return pipes
    .map(pipe => {
      let topH = pipe.topHeight;
      if (pipe.type === 'MOVING_PIPE' && pipe.baseTopHeight !== undefined) {
        const offset = Math.sin(timestamp * (pipe.oscillationSpeed || 0.003)) * (pipe.oscillationRange || 30);
        const minPipeH = 60;
        const maxPipeH = screenHeight - GROUND_HEIGHT - gap - minPipeH;
        topH = Math.max(minPipeH, Math.min(maxPipeH, pipe.baseTopHeight + offset));
      }
      return {
        ...pipe,
        x: pipe.x - curSpeed,
        topHeight: topH,
        bottomHeight: screenHeight - GROUND_HEIGHT - topH - gap,
      };
    })
    .filter(pipe => pipe.x + PIPE_WIDTH + 20 > 0);
};

export interface CollisionResult {
  hasCollision: boolean;
  nearMiss: boolean;
  passedCount: number;
  updatedPipes: PipeData[];
  shieldUsed: boolean;
}

export const checkObstacleInteractions = (
  bird: BirdBounds,
  pipes: PipeData[],
  screenHeight: number,
  hasShield: boolean
): CollisionResult => {
  let hasCollision = false;
  let nearMiss = false;
  let passedCount = 0;
  let shieldUsed = false;

  const updatedPipes = pipes.map(pipe => {
    const pipeLeft = pipe.x;
    const pipeRight = pipe.x + PIPE_WIDTH;
    const gapTop = pipe.topHeight;
    const gapBottom = screenHeight - GROUND_HEIGHT - pipe.bottomHeight;

    const horizontallyOverlapping = bird.right > pipeLeft && bird.left < pipeRight;

    // Pipe collision check
    if (horizontallyOverlapping && (bird.top < gapTop || bird.bottom > gapBottom)) {
      if (hasShield && !shieldUsed) {
        shieldUsed = true;
        return { ...pipe, passed: true }; // Shield absorbs the obstacle
      }
      hasCollision = true;
    }

    // Near miss detection (threading close to top or bottom edge)
    if (
      horizontallyOverlapping &&
      !pipe.nearMissAwarded &&
      !hasCollision &&
      (Math.abs(bird.top - gapTop) < NEAR_MISS_DISTANCE ||
        Math.abs(bird.bottom - gapBottom) < NEAR_MISS_DISTANCE)
    ) {
      nearMiss = true;
      return { ...pipe, nearMissAwarded: true };
    }

    // Score passing check
    if (!pipe.passed && bird.left > pipeRight) {
      passedCount += 1;
      return { ...pipe, passed: true };
    }

    return pipe;
  });

  return {
    hasCollision,
    nearMiss,
    passedCount,
    updatedPipes,
    shieldUsed,
  };
};

export const stepCollectibles = (
  collectibles: Collectible[],
  curSpeed: number,
  bird: BirdBounds,
  magnetActive: boolean
): { updated: Collectible[]; collectedItems: CollectibleType[] } => {
  const collectedItems: CollectibleType[] = [];

  const updated = collectibles
    .map(c => {
      if (c.collected) return { ...c, x: c.x - curSpeed };

      let cx = c.x - curSpeed;
      let cy = c.y;

      // Magnet effect: pull items towards bird if within 180px
      if (magnetActive) {
        const dx = (bird.left + bird.right) / 2 - cx;
        const dy = (bird.top + bird.bottom) / 2 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200 && dist > 1) {
          cx += (dx / dist) * 7.5;
          cy += (dy / dist) * 7.5;
        }
      }

      const cSize = c.size || 28;
      const overlaps =
        bird.right > cx &&
        bird.left < cx + cSize &&
        bird.bottom > cy &&
        bird.top < cy + cSize;

      if (overlaps) {
        collectedItems.push(c.type);
        return { ...c, x: cx, y: cy, collected: true };
      }

      return { ...c, x: cx, y: cy };
    })
    .filter(c => c.x + 80 > 0 && !c.collected);

  return { updated, collectedItems };
};
