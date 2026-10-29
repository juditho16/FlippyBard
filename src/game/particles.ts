import { Particle } from './types';

let nextParticleId = 1;

export const createFlapFeathers = (x: number, y: number, color = '#fef08a'): Particle[] => {
  const particles: Particle[] = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    particles.push({
      id: nextParticleId++,
      x: x + (Math.random() * 12 - 6),
      y: y + (Math.random() * 10 - 5),
      vx: -(Math.random() * 2 + 1),
      vy: Math.random() * 2 - 1,
      life: 20 + Math.random() * 10,
      maxLife: 30,
      size: 6 + Math.random() * 6,
      color,
      type: 'feather',
    });
  }
  return particles;
};

export const createCoinSparkles = (x: number, y: number): Particle[] => {
  const particles: Particle[] = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 2.5 + Math.random() * 2;
    particles.push({
      id: nextParticleId++,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 24,
      maxLife: 24,
      size: 5 + Math.random() * 4,
      color: Math.random() > 0.3 ? '#facc15' : '#ffffff',
      type: 'sparkle',
    });
  }
  return particles;
};

export const createPowerupBurst = (x: number, y: number, color = '#38bdf8'): Particle[] => {
  const particles: Particle[] = [];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const speed = 3.5 + Math.random() * 2.5;
    particles.push({
      id: nextParticleId++,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 28,
      maxLife: 28,
      size: 6 + Math.random() * 5,
      color,
      type: 'sparkle',
    });
  }
  return particles;
};

export const createFloatingText = (x: number, y: number, text: string, color = '#fef08a'): Particle => ({
  id: nextParticleId++,
  x,
  y,
  vx: 0,
  vy: -1.2,
  life: 35,
  maxLife: 35,
  size: 14,
  color,
  type: 'text',
  text,
});

export const stepParticles = (particles: Particle[], frameScale = 1): Particle[] => {
  return particles
    .map(p => {
      let vx = p.vx;
      let vy = p.vy;
      if (p.type === 'feather') {
        vy += 0.08 * frameScale;
        vx *= 0.95;
      } else if (p.type === 'sparkle') {
        vx *= 0.92;
        vy *= 0.92;
      }
      return {
        ...p,
        x: p.x + vx * frameScale,
        y: p.y + vy * frameScale,
        vx,
        vy,
        life: p.life - frameScale,
      };
    })
    .filter(p => p.life > 0)
    .slice(-60); // Cap at 60 particles for buttery 60fps performance
};
