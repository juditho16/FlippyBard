import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface GameOverModalProps {
  score: number;
  bestScore: number;
  coinsEarned: number;
  maxCombo: number;
  extraLives: number;
  onRevive: () => void;
  onTryAgain: () => void;
  onHome: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  score,
  bestScore,
  coinsEarned,
  maxCombo,
  extraLives,
  onRevive,
  onTryAgain,
  onHome,
}) => {
  return (
    <View style={styles.overlay}>
      <View style={styles.modalCard}>
        <Text style={styles.title}>GAME OVER</Text>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>SCORE</Text>
            <Text style={styles.statValue}>{score}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>BEST</Text>
            <Text style={styles.statValue}>{bestScore}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>MAX COMBO</Text>
            <Text style={[styles.statValue, { color: '#ec4899' }]}>x{maxCombo}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>COINS</Text>
            <Text style={[styles.statValue, { color: '#facc15' }]}>+{coinsEarned}</Text>
          </View>
        </View>

        {/* Revive Button */}
        {extraLives > 0 && (
          <TouchableOpacity style={styles.reviveButton} onPress={onRevive} activeOpacity={0.85}>
            <Text style={styles.reviveText}>❤️ REVIVE ({extraLives} REMAINING)</Text>
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.homeButton} onPress={onHome} activeOpacity={0.85}>
            <Text style={styles.buttonText}>🏠 HOME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.retryButton} onPress={onTryAgain} activeOpacity={0.85}>
            <Text style={styles.buttonText}>🔄 PLAY AGAIN</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill as any,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 360,
    backgroundColor: '#0f172a',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  title: {
    color: '#f43f5e',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 18,
    textShadowColor: 'rgba(244, 63, 94, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  statsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    width: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    padding: 12,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  reviveButton: {
    width: '100%',
    backgroundColor: '#e11d48',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#fb7185',
  },
  reviveText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  buttonRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeButton: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#64748b',
  },
  retryButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#60a5fa',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
