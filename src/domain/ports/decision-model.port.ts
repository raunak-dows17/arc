export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: {
    true: string;
    false: string;
  };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** 2–26 named options. A null description lets the option name stand alone. */
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** 2–10 ordered levels, lowest first. */
  criteria: readonly string[];
}

export type DecisionQuestion =
  | NoulQuestion
  | ChoiceQuestion
  | ScoreQuestion;

export interface DecisionRequest {
  /** Text or structured JSON. Keep this small; Tev1 is trained around 2K tokens. */
  state: string | Record<string, unknown> | readonly unknown[];
  questions: Record<string, DecisionQuestion>;
  signal?: AbortSignal;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability that the answer is true, 0–1. */
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend?: readonly string[];
  probabilities?: Record<string, number>;
  confidence?: number;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface DecisionResult {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: DecisionUsage;
}

/**
 * Fast local classification only. This is intentionally separate from the
 * tool-calling LLM port because decision models do not generate tool JSON.
 */
export interface DecisionModelPort {
  ask(request: DecisionRequest): Promise<DecisionResult>;
}
