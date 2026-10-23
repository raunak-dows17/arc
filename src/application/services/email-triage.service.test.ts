import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  DecisionAnswer,
  DecisionModelPort,
  DecisionRequest,
} from "../../domain/ports/decision-model.port.js";
import type { IncomingEmail } from "../../domain/entities/incoming-email.js";
import { EmailTriageService } from "./email-triage.service.js";

const email: IncomingEmail = {
  uid: 7,
  from: "Billing <billing@example.com>",
  subject: "Your payment failed",
  receivedAt: "2026-10-23T12:00:00.000Z",
  snippet: "We could not charge your card. Please update your payment method.",
};

function model(
  answers: Record<string, DecisionAnswer>,
  onAsk?: (request: DecisionRequest) => void,
): DecisionModelPort {
  return {
    async ask(request) {
      onAsk?.(request);
      return {
        model: "tev1:0.8b",
        answers,
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
}

function answers(
  noul: number,
  choice: string,
  score = 5,
): Record<string, DecisionAnswer> {
  return {
    needs_attention: { type: "noul", noul },
    category: {
      type: "choice",
      choice,
      probabilities: { [choice]: 0.9 },
      confidence: 0.9,
    },
    importance: { type: "score", score, confidence: 0.8 },
  };
}

describe("EmailTriageService", () => {
  it("asks Tev1 about a compact email state and returns a normalized result", async () => {
    let captured: DecisionRequest | undefined;
    const triage = new EmailTriageService(
      model(answers(0.82, "action", 5), (request) => {
        captured = request;
      }),
    );

    const result = await triage.triage(email);

    assert.equal(result.needsAttention, true);
    assert.equal(result.category, "action");
    assert.equal(result.importance, 7.5);
    assert.equal(result.fallback, false);
    assert.match(JSON.stringify(captured?.state), /payment failed/i);
    assert.ok(captured?.questions.needs_attention);
    assert.ok(captured?.questions.category);
    assert.ok(captured?.questions.importance);
  });

  it("does not notify for newsletters even when the yes/no score is high", async () => {
    const triage = new EmailTriageService(model(answers(0.99, "newsletter")));
    const result = await triage.triage(email);
    assert.equal(result.needsAttention, false);
    assert.equal(result.category, "newsletter");
  });

  it("always escalates urgent and action categories", async () => {
    const triage = new EmailTriageService(model(answers(0.1, "urgent")));
    const result = await triage.triage(email);
    assert.equal(result.needsAttention, true);
  });

  it("rejects an unknown category or a malformed answer", async () => {
    const unknown = new EmailTriageService(model(answers(0.8, "promotion")));
    await assert.rejects(unknown.triage(email), /unknown email category/i);

    const malformed = new EmailTriageService(
      model({
        needs_attention: { type: "noul", noul: 0.8 },
        category: { type: "noul", noul: 0.2 },
        importance: { type: "score", score: 2 },
      }),
    );
    await assert.rejects(malformed.triage(email), /no choice answer/i);
  });
});
