import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeColors, MovingObject } from '../game/types';
import { GROUND_HEIGHT } from '../game/constants';

interface ParallaxBackgroundProps {
  theme: ThemeColors;
  clouds: MovingObject[];
  screenWidth: number;
  screenHeight: number;
  level: number;
}

export const ParallaxBackground: React.FC<ParallaxBackgroundProps> = ({
  theme,
  clouds,
  screenWidth,
  screenHeight,
  level,
}) => {
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Sky Gradient */}
      <LinearGradient colors={theme.bg as [string, string, ...string[]]} style={StyleSheet.absoluteFill} />

      {/* Distant Hills / Horizon Silhouette */}
      <View
        style={[
          styles.distantHills,
          {
            bottom: GROUND_HEIGHT + 20,
            width: screenWidth * 1.5,
            borderColor: theme.accentGlow,
          },
        ]}
      />

      {/* Floating Clouds / Drifting Atmosphere */}
      {clouds.map(cloud => (
        <View
          key={cloud.id}
          style={[
            styles.cloud,
            {
              left: cloud.x,
              top: cloud.y,
              width: cloud.size || 80,
              height: (cloud.size || 80) * 0.45,
              borderRadius: 30,
            },
          ]}
        >
          <View
            style={[
              styles.cloudPuff,
              {
                left: 15,
                top: -12,
                width: (cloud.size || 80) * 0.45,
                height: (cloud.size || 80) * 0.45,
                borderRadius: 20,
              },
            ]}
          />
        </View>
      ))}

      {/* Ground & Grass */}
      <View
        style={[
          styles.groundContainer,
          {
            height: GROUND_HEIGHT,
            backgroundColor: theme.ground,
          },
        ]}
      >
        {/* Grass Top Stripe */}
        <View style={[styles.grassStripe, { backgroundColor: theme.grass }]}>
          <View style={styles.grassDetailDots} />
        </View>

        {/* Level / Theme Badge on Ground */}
        <View style={styles.groundBadge}>
          <Text style={styles.groundText}>
            LVL {level} • {theme.graffiti}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  distantHills: {
    position: 'absolute',
    left: -40,
    height: 120,
    borderTopLeftRadius: 300,
    borderTopRightRadius: 300,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    borderTopWidth: 1,
  },
  cloud: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    zIndex: 1,
  },
  cloudPuff: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  groundContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 15,
    borderTopWidth: 3,
    borderTopColor: '#00000030',
  },
  grassStripe: {
    height: 14,
    width: '100%',
    borderBottomWidth: 2,
    borderBottomColor: '#00000020',
  },
  grassDetailDots: {
    height: 3,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  groundBadge: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  groundText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.5,
  },
});
