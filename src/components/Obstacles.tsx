import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { PipeData, Collectible, ThemeColors } from '../game/types';
import { PIPE_WIDTH, GROUND_HEIGHT } from '../game/constants';

interface ObstaclesProps {
  pipes: PipeData[];
  collectibles: Collectible[];
  theme: ThemeColors;
  screenHeight: number;
}

export const Obstacles: React.FC<ObstaclesProps> = ({
  pipes,
  collectibles,
  theme,
  screenHeight,
}) => {
  return (
    <>
      {/* Pipes / Obstacles */}
      {pipes.map(pipe => {
        const isLaser = pipe.type === 'LASER_GATE';
        const isMoving = pipe.type === 'MOVING_PIPE';

        return (
          <React.Fragment key={pipe.id}>
            {/* Top Pipe */}
            <View
              style={[
                styles.pipeBody,
                {
                  left: pipe.x,
                  top: 0,
                  width: PIPE_WIDTH,
                  height: pipe.topHeight,
                  backgroundColor: isLaser ? '#1e1b4b' : theme.pipeFill,
                  borderColor: isLaser ? '#ec4899' : theme.pipeBorder,
                },
              ]}
            >
              {/* Highlight stripe */}
              <View style={[styles.pipeShine, { backgroundColor: isLaser ? '#f472b6' : theme.pipeCap }]} />
              {/* Bottom cap */}
              <View
                style={[
                  styles.pipeCap,
                  {
                    bottom: 0,
                    backgroundColor: isLaser ? '#be185d' : theme.pipeCap,
                    borderColor: isLaser ? '#f472b6' : theme.pipeBorder,
                  },
                ]}
              />
              {isMoving && <View style={[styles.movingIndicator, { backgroundColor: theme.pipeCap }]} />}
            </View>

            {/* Bottom Pipe */}
            <View
              style={[
                styles.pipeBody,
                {
                  left: pipe.x,
                  bottom: GROUND_HEIGHT,
                  width: PIPE_WIDTH,
                  height: pipe.bottomHeight,
                  backgroundColor: isLaser ? '#1e1b4b' : theme.pipeFill,
                  borderColor: isLaser ? '#ec4899' : theme.pipeBorder,
                },
              ]}
            >
              <View style={[styles.pipeShine, { backgroundColor: isLaser ? '#f472b6' : theme.pipeCap }]} />
              {/* Top cap */}
              <View
                style={[
                  styles.pipeCap,
                  {
                    top: 0,
                    backgroundColor: isLaser ? '#be185d' : theme.pipeCap,
                    borderColor: isLaser ? '#f472b6' : theme.pipeBorder,
                  },
                ]}
              />
              {isMoving && <View style={[styles.movingIndicator, { backgroundColor: theme.pipeCap }]} />}
            </View>
          </React.Fragment>
        );
      })}

      {/* Collectibles */}
      {collectibles.map(item => {
        let imageSource = require('../../assets/sprites/golden_coin.jpg');
        if (item.type === 'RAINBOW_EGG') {
          imageSource = require('../../assets/sprites/shield_powerup.jpg');
        } else if (item.type === 'CHRONO' || item.type === 'MAGNET') {
          imageSource = require('../../assets/sprites/feather_powerup.jpg');
        }

        const size = item.size || 28;

        return (
          <View
            key={item.id}
            style={[
              styles.collectibleContainer,
              {
                left: item.x,
                top: item.y,
                width: size,
                height: size,
              },
            ]}
          >
            <Image source={imageSource} style={[styles.collectibleImage, { width: size, height: size }]} />
          </View>
        );
      })}
    </>
  );
};

const styles = StyleSheet.create({
  pipeBody: {
    position: 'absolute',
    borderWidth: 2.5,
    overflow: 'hidden',
    zIndex: 5,
  },
  pipeShine: {
    position: 'absolute',
    left: 8,
    top: 0,
    bottom: 0,
    width: 6,
    opacity: 0.6,
  },
  pipeCap: {
    position: 'absolute',
    left: -4,
    right: -4,
    height: 24,
    borderWidth: 2.5,
    borderRadius: 4,
    zIndex: 6,
  },
  movingIndicator: {
    position: 'absolute',
    right: 6,
    top: '45%',
    width: 6,
    height: 18,
    borderRadius: 3,
    opacity: 0.8,
  },
  collectibleContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
    shadowColor: '#fbbf24',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  collectibleImage: {
    borderRadius: 14,
  },
});
