import type {
  EmailCategory,
  EmailTriageResult,
  IncomingEmail,
} from "../../domain/entities/incoming-email.js";
import { DecisionModelError } from "../../domain/errors/agent.errors.js";
import type {
  DecisionAnswer,
  DecisionModelPort,
} from "../../domain/ports/decision-model.port.js";
import type { EmailTriagePort } from "../../domain/ports/email.port.js";
import { truncateText } from "../../shared/text.js";

const CATEGORIES: readonly EmailCategory[] = [
  "urgent",
  "action",
  "informational",
  "newsletter",
  "spam",
];

const CATEGORY_CRITERIA: Record<string, string> = {
  urgent:
    "Security alerts, account compromise, payment failures, outages, or a message that clearly needs attention today.",
  action:
    "A real person or service is waiting for a reply, decision, signature, payment, or other action, but it is not an emergency.",
  informational:
    "A useful update, receipt, confirmation, or notification that does not require action and is not marketing.",
  newsletter:
    "Marketing, newsletters, product announcements, promotions, digests, or social notifications.",
  spam:
    "Unsolicited bulk mail, scams, phishing, or obvious junk.",
};

export interface EmailTriageOptions {
  /** Minimum probability for the "needs attention" answer. */
  threshold?: number;
}

/**
 * Provider-neutral pre-classifier for incoming email. It never generates tool
 * calls and only sees a short, normalized snippet. Any malformed or failed
 * answer is surfaced to the watcher, which can choose a conservative fallback.
 */
export class EmailTriageService implements EmailTriagePort {
  private readonly threshold: number;

  constructor(
    private readonly decisionModel: DecisionModelPort,
    options: EmailTriageOptions = {},
  ) {
    this.threshold = options.threshold ?? 0.65;
  }

  async triage(
    email: IncomingEmail,
    signal?: AbortSignal,
  ): Promise<EmailTriageResult> {
    const result = await this.decisionModel.ask({
      state: {
        from: truncateText(email.from, 300),
        subject: truncateText(email.subject, 300),
        received_at: email.receivedAt,
        snippet: truncateText(email.snippet, 900),
      },
      questions: {
        needs_attention: {
          type: "noul",
          instructions:
            "Does this email deserve a notification today? Ignore routine marketing, newsletters, automated receipts, and low-value notifications. Personal, work, billing, security, scheduling, and time-sensitive messages usually deserve attention.",
          criteria: {
            true: "A human should see this soon; it may need a reply, decision, payment, or security response.",
            false: "This can wait, is routine, is bulk marketing, or does not need a human today.",
          },
        },
        category: {
          type: "choice",
          instructions:
            "Choose the single best category for this email based on the sender, subject, and snippet.",
          criteria: CATEGORY_CRITERIA,
        },
        importance: {
          type: "score",
          instructions:
            "How important is this email relative to everything else in the inbox? Use the ordered levels from lowest to highest.",
          criteria: [
            "no importance: junk or bulk mail",
            "very low: routine automated notice",
            "low: newsletter or optional reading",
            "normal: useful informational update",
            "moderate: worth reading when convenient",
            "high: should be handled soon",
            "very high: time-sensitive action",
            "critical: security, payment failure, or emergency",
          ],
        },
      },
      ...(signal ? { signal } : {}),
    });

    const attention = readNoul(result.answers.needs_attention, "needs_attention");
    const categoryAnswer = readChoice(result.answers.category, "category");
    const category = categoryAnswer.choice.trim().toLowerCase() as EmailCategory;
    if (!CATEGORIES.includes(category)) {
      throw new DecisionModelError(
        `Decision model returned unknown email category "${categoryAnswer.choice}".`,
      );
    }
    const importanceAnswer = readScore(
      result.answers.importance,
      "importance",
    );
    const importance = clamp(importanceAnswer.score * 1.5, 0, 10);

    const needsAttention =
      category === "urgent" ||
      category === "action" ||
      (attention.noul >= this.threshold &&
        category !== "newsletter" &&
        category !== "spam");

    return {
      needsAttention,
      category,
      importance,
      confidence: categoryAnswer.confidence,
      fallback: false,
    };
  }
}

function readNoul(answer: DecisionAnswer | undefined, name: string) {
  if (!answer || answer.type !== "noul") {
    throw new DecisionModelError(
      `Decision model returned no noul answer for "${name}".`,
    );
  }
  return answer;
}

function readChoice(answer: DecisionAnswer | undefined, name: string) {
  if (!answer || answer.type !== "choice") {
    throw new DecisionModelError(
      `Decision model returned no choice answer for "${name}".`,
    );
  }
  return answer;
}

function readScore(answer: DecisionAnswer | undefined, name: string) {
  if (!answer || answer.type !== "score") {
    throw new DecisionModelError(
      `Decision model returned no score answer for "${name}".`,
    );
  }
  return answer;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
