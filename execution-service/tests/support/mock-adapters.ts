import type { PayoutSnapshot } from "../../src/domain/payout.ts";
import type {
  ExecutionProviderAdapter,
  ExecutionQuote,
  ExecutionRequest,
  PreparedExecution,
  ProviderEvidenceClaims,
  ProviderStatus,
  ProviderSubmissionResult,
} from "../../src/providers/adapter.ts";
import type {
  SettlementVerifier,
  VerificationResult,
} from "../../src/verification/verifier.ts";

export class MockExecutionProvider implements ExecutionProviderAdapter {
  readonly providerId = "mock-provider";
  readonly capabilities = {
    idempotency: "unknown" as const,
    lookupByExecutionReference: true,
  };
  submission: ProviderSubmissionResult = {
    kind: "unknown",
    reasonCode: "mock-timeout",
  };
  status: ProviderStatus = { kind: "unknown", reasonCode: "mock-unavailable" };
  evidence: ProviderEvidenceClaims = {
    reference: {
      providerId: this.providerId,
      providerExecutionReference: "mock-execution-1",
      destinationChainId: "chain:test",
      transactionReference: "tx:mock-1",
      eventIdentifier: "event:1",
    },
    destinationChainId: "chain:test",
    recipientAddress: "recipient:test",
    outputTokenId: "token:test",
    outputAtomicAmount: "100",
    transactionSucceeded: true,
    eventIdentifier: "event:1",
    evidenceReference: "mock-evidence:1",
    contentHash: "a".repeat(64),
  };

  async validate(request: ExecutionRequest): Promise<void> {
    void request;
  }

  async quote(request: ExecutionRequest): Promise<ExecutionQuote> {
    return {
      providerId: this.providerId,
      expectedOutput: request.payout.expectedOutput,
      expiresAt: "2030-01-01T00:00:00.000Z",
      quoteReference: "mock-quote-1",
    };
  }

  async prepare(
    request: ExecutionRequest,
    quote: ExecutionQuote,
  ): Promise<PreparedExecution> {
    void request;
    void quote;
    return {
      providerId: this.providerId,
      preparationReference: "mock-prepare-1",
      opaqueProviderData: "mock-only",
    };
  }

  async submit(
    request: ExecutionRequest,
    prepared: PreparedExecution,
  ): Promise<ProviderSubmissionResult> {
    void request;
    void prepared;
    return this.submission;
  }

  async getStatus(executionReference: string): Promise<ProviderStatus> {
    void executionReference;
    return this.status;
  }

  async getEvidence(
    executionReference: string,
  ): Promise<ProviderEvidenceClaims> {
    void executionReference;
    return this.evidence;
  }
}

export class MockSettlementVerifier implements SettlementVerifier {
  result: VerificationResult = {
    kind: "insufficient",
    reason: "mock evidence unavailable",
  };

  async verify(
    payout: PayoutSnapshot,
    claims: ProviderEvidenceClaims,
  ): Promise<VerificationResult> {
    void payout;
    void claims;
    return this.result;
  }
}
