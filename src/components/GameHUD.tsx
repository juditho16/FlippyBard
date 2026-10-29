import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CollectibleType } from '../game/types';

interface GameHUDProps {
  score: number;
  combo: number;
  level: number;
  totalCoins: number;
  activePowerup: CollectibleType | null;
  aiPilotActive: boolean;
  onToggleAiPilot: () => void;
  onTogglePause: () => void;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  score,
  combo,
  level,
  totalCoins,
  activePowerup,
  aiPilotActive,
  onToggleAiPilot,
  onTogglePause,
}) => {
  return (
    <View style={styles.hudContainer} pointerEvents="box-none">
      {/* Top Row */}
      <View style={styles.topRow} pointerEvents="box-none">
        {/* Left: Level & Coins */}
        <View style={styles.statsCard}>
          <Text style={styles.levelLabel}>LVL {level}</Text>
          <View style={styles.coinBadge}>
            <Text style={styles.coinIcon}>⭐</Text>
            <Text style={styles.coinText}>{totalCoins}</Text>
          </View>
        </View>

        {/* Center: Main Score & Combo */}
        <View style={styles.scoreContainer}>
          <Text style={styles.mainScore}>{score}</Text>
          {combo > 1 && (
            <View style={styles.comboBadge}>
              <Text style={styles.comboText}>COMBO x{combo} 🔥</Text>
            </View>
          )}
        </View>

        {/* Right: AI Pilot & Pause Controls */}
        <View style={styles.controlsCard}>
          <TouchableOpacity
            style={[styles.aiButton, aiPilotActive && styles.aiButtonActive]}
            onPress={onToggleAiPilot}
            activeOpacity={0.8}
          >
            <Text style={styles.aiButtonText}>
              {aiPilotActive ? '🤖 AI ON' : '🤖 AI'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.pauseButton} onPress={onTogglePause} activeOpacity={0.7}>
            <Text style={styles.pauseText}>⏸️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active Powerup Banner */}
      {activePowerup && (
        <View style={styles.powerupBanner}>
          <Text style={styles.powerupText}>
            ⚡ {activePowerup.replace('_', ' ')} ACTIVE!
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  hudContainer: {
    position: 'absolute',
    top: 45,
    left: 16,
    right: 16,
    zIndex: 30,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statsCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  levelLabel: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  coinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  coinIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  coinText: {
    color: '#facc15',
    fontWeight: '900',
    fontSize: 14,
  },
  scoreContainer: {
    alignItems: 'center',
  },
  mainScore: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '900',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  comboBadge: {
    backgroundColor: '#ec4899',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: -4,
  },
  comboText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  controlsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  aiButtonActive: {
    backgroundColor: '#10b981',
    borderColor: '#34d399',
    shadowColor: '#10b981',
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  aiButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 11,
  },
  pauseButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  pauseText: {
    fontSize: 14,
  },
  powerupBanner: {
    alignSelf: 'center',
    marginTop: 10,
    backgroundColor: 'rgba(14, 165, 233, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#7dd3fc',
  },
  powerupText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
  },
});
