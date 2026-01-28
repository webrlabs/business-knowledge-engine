const { log } = require('../utils/logger');

const CHALLENGE_TEMPLATES = [
  {
    id: 'upload_1',
    title: 'Document Contributor',
    description: 'Upload a document today',
    action: 'upload',
    target: 1,
    points: 15,
    icon: 'upload',
  },
  {
    id: 'review_2',
    title: 'Quality Check',
    description: 'Review 2 pending documents',
    action: 'review',
    target: 2,
    points: 25,
    icon: 'clipboard-check',
  },
  {
    id: 'upload_3',
    title: 'Knowledge Boost',
    description: 'Upload 3 documents today',
    action: 'upload',
    target: 3,
    points: 40,
    icon: 'zap',
  },
  {
    id: 'review_5',
    title: 'Review Sprint',
    description: 'Complete 5 reviews today',
    action: 'review',
    target: 5,
    points: 50,
    icon: 'trophy',
  },
  {
    id: 'verify_3',
    title: 'Verification Round',
    description: 'Verify 3 entities today',
    action: 'verify',
    target: 3,
    points: 20,
    icon: 'check-circle',
  },
];

class DailyChallengeService {
  getDailyChallenge() {
    // Deterministic challenge based on day of year
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const index = dayOfYear % CHALLENGE_TEMPLATES.length;
    const template = CHALLENGE_TEMPLATES[index];

    // Calculate time remaining in the day
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const timeRemainingMs = endOfDay - now;
    const hoursRemaining = Math.floor(timeRemainingMs / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      ...template,
      date: now.toISOString().split('T')[0],
      expiresAt: endOfDay.toISOString(),
      timeRemaining: `${hoursRemaining}h ${minutesRemaining}m`,
    };
  }

  getChallengeProgress(userTransactions) {
    const challenge = this.getDailyChallenge();
    const today = new Date().toISOString().split('T')[0];

    const todayActions = (userTransactions || []).filter(tx => {
      const txDate = tx.timestamp?.split('T')[0];
      return txDate === today && this._matchesAction(tx.action, challenge.action);
    });

    const current = todayActions.length;
    const completed = current >= challenge.target;

    return {
      ...challenge,
      current,
      completed,
      progress: Math.min(100, (current / challenge.target) * 100),
    };
  }

  _matchesAction(txAction, challengeAction) {
    if (challengeAction === 'review') {
      return txAction.startsWith('review') || txAction === 'approval';
    }
    return txAction === challengeAction;
  }
}

let instance = null;

function getDailyChallengeService() {
  if (!instance) {
    instance = new DailyChallengeService();
  }
  return instance;
}

module.exports = {
  DailyChallengeService,
  getDailyChallengeService,
  CHALLENGE_TEMPLATES,
};
