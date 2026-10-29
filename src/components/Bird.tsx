import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Skin, CollectibleType } from '../game/types';
import { SKIN_PALETTES, BIRD_SIZE } from '../game/constants';

interface BirdProps {
  x: number;
  y: number;
  vel: number;
  skin: Skin;
  sizeMultiplier?: number;
  activePowerup?: CollectibleType | null;
  shieldCount?: number;
}

export const Bird: React.FC<BirdProps> = ({
  x,
  y,
  vel,
  skin,
  sizeMultiplier = 1,
  activePowerup,
  shieldCount = 0,
}) => {
  const size = BIRD_SIZE * sizeMultiplier;
  // Calculate dynamic rotation angle from velocity (-25deg to +65deg)
  const rotation = Math.max(-25, Math.min(65, vel * 4.5));
  const palette = SKIN_PALETTES[skin] || SKIN_PALETTES.aviator;

  return (
    <View
      style={[
        styles.container,
        {
          left: x,
          top: y,
          width: size,
          height: size,
          transform: [{ rotate: `${rotation}deg` }],
        },
      ]}
    >
      {/* Shield aura */}
      {(shieldCount > 0 || activePowerup === 'RAINBOW_EGG') && (
        <View style={[styles.shieldAura, { width: size + 20, height: size + 20 }]} />
      )}

      {/* Chrono / Speed aura */}
      {activePowerup === 'CHRONO' && (
        <View style={[styles.chronoAura, { width: size + 14, height: size + 14 }]} />
      )}

      {/* Bird Sprite or Skin Container */}
      <View
        style={[
          styles.spriteFrame,
          {
            width: size,
            height: size,
            borderColor: palette.secondary,
            shadowColor: palette.glow,
          },
        ]}
      >
        <Image
          source={require('../../assets/sprites/bird_hero.jpg')}
          style={[styles.spriteImage, { width: size, height: size }]}
          resizeMode="cover"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  spriteFrame: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  spriteImage: {
    borderRadius: 18,
  },
  shieldAura: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    shadowColor: '#38bdf8',
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 12,
  },
  chronoAura: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#c084fc',
    backgroundColor: 'rgba(192, 132, 252, 0.2)',
  },
});
