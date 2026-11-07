import type { PayoutSnapshot } from "../../src/domain/payout.js";
import type {
  ExecutionProviderAdapter,
  ExecutionQuote,
  ExecutionRequest,
  PreparedExecution,
  ProviderEvidenceClaims,
  ProviderStatus,
  ProviderSubmissionResult
} from "../../src/providers/adapter.js";
import type {
  SettlementVerifier,
  VerificationResult
} from "../../src/verification/verifier.js";

export class MockExecutionProvider implements ExecutionProviderAdapter {
  readonly providerId = "mock-provider";
  readonly capabilities = {
    idempotency: "unknown" as const,
    lookupByExecutionReference: true
  };
  submission: ProviderSubmissionResult = { kind: "unknown", reasonCode: "mock-timeout" };
  status: ProviderStatus = { kind: "unknown", reasonCode: "mock-unavailable" };
  evidence: ProviderEvidenceClaims = {
    reference: {
      providerId: this.providerId,
      providerExecutionReference: "mock-execution-1",
      destinationChainId: "chain:test",
      transactionReference: "tx:mock-1",
      eventIdentifier: "event:1"
    },
    destinationChainId: "chain:test",
    recipientAddress: "recipient:test",
    outputTokenId: "token:test",
    outputAtomicAmount: "100",
    transactionSucceeded: true,
    eventIdentifier: "event:1",
    evidenceReference: "mock-evidence:1",
    contentHash: "a".repeat(64)
  };

  async validate(_request: ExecutionRequest): Promise<void> {}

  async quote(request: ExecutionRequest): Promise<ExecutionQuote> {
    return {
      providerId: this.providerId,
      expectedOutput: request.payout.expectedOutput,
      expiresAt: "2030-01-01T00:00:00.000Z",
      quoteReference: "mock-quote-1"
    };
  }

  async prepare(_request: ExecutionRequest, _quote: ExecutionQuote): Promise<PreparedExecution> {
    return {
      providerId: this.providerId,
      preparationReference: "mock-prepare-1",
      opaqueProviderData: "mock-only"
    };
  }

  async submit(
    _request: ExecutionRequest,
    _prepared: PreparedExecution
  ): Promise<ProviderSubmissionResult> {
    return this.submission;
  }

  async getStatus(_executionReference: string): Promise<ProviderStatus> {
    return this.status;
  }

  async getEvidence(_executionReference: string): Promise<ProviderEvidenceClaims> {
    return this.evidence;
  }
}

export class MockSettlementVerifier implements SettlementVerifier {
  result: VerificationResult = { kind: "insufficient", reason: "mock evidence unavailable" };

  async verify(_payout: PayoutSnapshot, _claims: ProviderEvidenceClaims): Promise<VerificationResult> {
    return this.result;
  }
}
