import { FactorScores, mapScoreToCard, EstimationTrack, TRACK_FACTORS, DeckStyle } from './estimation';

export interface AIEstimateResult {
  factors: FactorScores;
  reasoning: string;
  card: string;
}

const SYSTEM_PROMPT = `You are an elite agile estimation assistant named CogPoker AI.
Your task is to analyze a ticket (Title and Description) and score it based on the selected estimation track.

There are 3 tracks, each evaluating 5 specific factors:

1. "HUMAN" Track (for pure human engineering):
   - "cognitiveLoad": Brain-burner depth (1 = simple; 5 = extreme logic load)
   - "contextSwitching": Overhead/disruption (1 = none; 5 = heavy switching)
   - "localSetupFriction": Build friction (1 = none; 5 = complex config/docker setup)
   - "testingComplexity": Mocking difficulty (1 = simple unit test; 5 = complex integration testing)
   - "manualEffort": Time of manual tasks (1 = minutes; 5 = hours of execution)

2. "HYBRID" Track (for humans leveraging generative AI tools):
   - "verificationOverhead": Post-generation validation time (1 = instant review; 5 = hours of validation)
   - "architectureReview": Constraints validation friction (1 = simple; 5 = highly strict/complex)
   - "promptEngineering": Complexity of instructions (1 = simple request; 5 = deep prompt engineering)
   - "vulnerabilityRisks": Security/edge hazards (1 = safe; 5 = high security vulnerability risks)
   - "regressionDebugging": Regression trace depth (1 = easy logs; 5 = deep multi-file debugging)

3. "AUTONOMOUS" Track (for tasks run entirely by autonomous pipelines):
   - "contextSaturation": LLM token size constraints (1 = fits in 8k; 5 = requires 128k+)
   - "structuralDependency": Structural depth (1 = single file; 5 = complex multi-repo dependencies)
   - "hallucinationRisks": Code correctness boundaries (1 = deterministic; 5 = complex logic/heavy API hazards)
   - "securityParameters": Sandbox writes hazards (1 = safe sandbox; 5 = dangerous write-access hazards)
   - "tokenBudget": API cost consumption (1 = cheap cents; 5 = high budget burn risk)

You must return your output strictly in JSON format. Do not wrap in markdown blocks, just return raw JSON.
The JSON keys for factors must match EXACTLY the keys defined above for the selected track.

Example JSON output structure:
{
  "factor1": 3,
  "factor2": 2,
  "factor3": 4,
  "factor4": 1,
  "factor5": 2,
  "reasoning": "A concise explanation of why these scores were assigned."
}`;

// Fast local backup estimator (zero network dependency)
function generateLocalHeuristicEstimate(
  title: string,
  description: string,
  track: EstimationTrack,
  deckStyle: DeckStyle = 'scrum'
): AIEstimateResult {
  console.log('Generating fallback local heuristic estimate...');
  const combined = `${title} ${description}`.toLowerCase();
  
  // Deterministic local scoring heuristic
  let multiplier = 3;
  if (combined.includes('bug') || combined.includes('fix') || combined.includes('refactor')) multiplier = 4;
  if (combined.includes('setup') || combined.includes('docker') || combined.includes('deploy')) multiplier = 5;
  if (combined.length < 50) multiplier = 2;

  const factors: FactorScores = {};
  const factorDefinitions = TRACK_FACTORS[track];
  
  factorDefinitions.forEach((f, idx) => {
    // Generate pseudorandom factor scores based on text patterns
    const weight = (combined.charCodeAt(idx % combined.length) % 3) + 1; // 1-3
    const finalScore = Math.max(1, Math.min(5, Math.round((weight + multiplier) / 2)));
    factors[f.key] = finalScore;
  });

  return {
    factors,
    reasoning: "Local Heuristic Mode: Computed instant calibration based on ticket size and complexity markers.",
    card: mapScoreToCard(deckStyle, factors, track),
  };
}

// Single call helper with strict timeout
async function fetchOpenRouter(
  model: string,
  openrouterKey: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number = 3500
): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://anandmuraleedharan.com",
        "X-Title": "CogPoker",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    clearTimeout(id);

    if (response.ok) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        return JSON.parse(text.trim());
      }
    }
    throw new Error(`OpenRouter responded with status ${response.status}`);
  } catch (err: any) {
    clearTimeout(id);
    throw err;
  }
}

export async function generateAIEstimate(
  title: string,
  description: string,
  track: EstimationTrack,
  deckStyle: DeckStyle = 'scrum'
): Promise<AIEstimateResult> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (!openrouterKey) {
    console.warn("No OPENROUTER_API_KEY set. Falling back to local heuristic estimation.");
    return generateLocalHeuristicEstimate(title, description, track, deckStyle);
  }

  const factorDefinitions = TRACK_FACTORS[track];
  const userPrompt = `Ticket Title: ${title}\nTicket Description: ${description || "No description provided."}\nScoring Track: ${track.toUpperCase()}\n\nPlease score the ticket on the 5 factors for this track: ${factorDefinitions.map(f => f.key).join(', ')}.`;

  // Models to poll in parallel
  const targetModels = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-2-9b-it:free',
    'mistralai/mistral-7b-instruct:free'
  ];

  try {
    // Run all models concurrently; the fastest successful promise wins!
    const result = await Promise.any(
      targetModels.map(model => 
        fetchOpenRouter(model, openrouterKey, SYSTEM_PROMPT, userPrompt, 3500)
      )
    );

    const factors: FactorScores = {};
    factorDefinitions.forEach(f => {
      factors[f.key] = Number(result[f.key]) || 3;
    });

    return {
      factors,
      reasoning: result.reasoning || "Estimate generated by OpenRouter consensus model.",
      card: mapScoreToCard(deckStyle, factors, track),
    };
  } catch (err) {
    console.error("All concurrent OpenRouter calls failed or timed out. Using local fallback.");
    return generateLocalHeuristicEstimate(title, description, track, deckStyle);
  }
}
