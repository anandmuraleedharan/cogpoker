export type EstimationTrack = 'human' | 'hybrid' | 'autonomous';

export interface FactorItem {
  key: string;
  label: string;
  descMin: string;
  descMax: string;
}

export const TRACK_FACTORS: Record<EstimationTrack, FactorItem[]> = {
  human: [
    { key: 'cognitiveLoad', label: 'Cognitive Load', descMin: 'Simple', descMax: 'Brain Burner' },
    { key: 'contextSwitching', label: 'Context-Switching', descMin: 'None', descMax: 'Heavy Overhead' },
    { key: 'localSetupFriction', label: 'Setup Friction', descMin: 'Zero friction', descMax: 'Complex Docker/Config' },
    { key: 'testingComplexity', label: 'Testing Complexity', descMin: 'Single test', descMax: 'Complex Mocking' },
    { key: 'manualEffort', label: 'Manual Effort', descMin: 'Minutes', descMax: 'Hours of execution' }
  ],
  hybrid: [
    { key: 'verificationOverhead', label: 'Verification Overhead', descMin: 'Immediate review', descMax: 'Hours of verification' },
    { key: 'architectureReview', label: 'Architecture Review', descMin: 'Straightforward', descMax: 'Strict constraints' },
    { key: 'promptEngineering', label: 'Prompt Depth', descMin: 'Simple prompt', descMax: 'Complex context engineering' },
    { key: 'vulnerabilityRisks', label: 'Vulnerability Risks', descMin: 'Low risk', descMax: 'High security risk' },
    { key: 'regressionDebugging', label: 'Regression Debugging', descMin: 'Easy logs', descMax: 'Deep tracing needed' }
  ],
  autonomous: [
    { key: 'contextSaturation', label: 'Context Saturation', descMin: 'Fits 8k', descMax: 'Requires 128k+' },
    { key: 'structuralDependency', label: 'Dependency Depth', descMin: 'Single file', descMax: 'Multi-repo refactor' },
    { key: 'hallucinationRisks', label: 'Hallucination Risks', descMin: 'Deterministic code', descMax: 'Complex logic/API' },
    { key: 'securityParameters', label: 'Security Boundaries', descMin: 'Safe sandbox', descMax: 'Write-access hazards' },
    { key: 'tokenBudget', label: 'Token/API Budget', descMin: 'Few cents', descMax: 'High API charge risk' }
  ]
};

export type DeckStyle = 'scrum' | 'fibonacci' | 'sequential' | 'hourly' | 'tshirt' | 'hybrid' | 'autonomous';

export const DECKS: Record<DeckStyle, string[]> = {
  scrum: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?'],
  fibonacci: ['0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'],
  sequential: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?'],
  hourly: ['0', '4', '8', '16', '24', '32', '40', '60', '80', '?'],
  tshirt: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '?'],
  hybrid: ['0.5', '1', '1.5', '2', '3', '5', '8', '12', '20', '?'],
  autonomous: ['8k', '16k', '32k', '64k', '128k', '256k', '512k', '1M', '?']
};

// Factors rating input is a dictionary key-value
export type FactorScores = Record<string, number>;

/**
 * Calculates a composite score between 1.0 and 5.0 based on factor ratings for a specific track.
 * Each of the 5 factors has an equal weight of 0.20.
 */
export function calculateCompositeScore(track: EstimationTrack, factors: FactorScores): number {
  const definitions = TRACK_FACTORS[track];
  let sum = 0;
  definitions.forEach(f => {
    sum += factors[f.key] !== undefined ? factors[f.key] : 3; // Default to mid-value 3 if missing
  });
  return sum / 5;
}

/**
 * Maps the composite score (1 to 5) to the appropriate track estimation card.
 */
export function mapScoreToCard(deckStyle: DeckStyle, factors: FactorScores, track: EstimationTrack): string {
  const score = calculateCompositeScore(track, factors);
  const deck = DECKS[deckStyle].filter(c => c !== '?');

  // Scale score (1 to 5) to match the index space of the deck
  const normalizedIndex = ((score - 1) / 4) * (deck.length - 1);
  const targetIndex = Math.min(Math.max(Math.round(normalizedIndex), 0), deck.length - 1);

  return deck[targetIndex];
}

/**
 * Initialize default factor scores for a specific track.
 */
export function getInitialFactors(track: EstimationTrack): FactorScores {
  const scores: FactorScores = {};
  TRACK_FACTORS[track].forEach(f => {
    scores[f.key] = 3;
  });
  return scores;
}
