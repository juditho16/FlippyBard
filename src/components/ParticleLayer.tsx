import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Particle } from '../game/types';

interface ParticleLayerProps {
  particles: Particle[];
}

export const ParticleLayer: React.FC<ParticleLayerProps> = ({ particles }) => {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map(p => {
        const opacity = Math.max(0, p.life / p.maxLife);

        if (p.type === 'text' && p.text) {
          return (
            <Text
              key={p.id}
              style={[
                styles.floatingText,
                {
                  left: p.x - 30,
                  top: p.y,
                  color: p.color,
                  opacity,
                },
              ]}
            >
              {p.text}
            </Text>
          );
        }

        return (
          <View
            key={p.id}
            style={[
              styles.particle,
              {
                left: p.x,
                top: p.y,
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.color,
                opacity,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    zIndex: 20,
  },
  floatingText: {
    position: 'absolute',
    fontWeight: '900',
    fontSize: 14,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    zIndex: 25,
  },
});
