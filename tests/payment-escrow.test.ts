// PaymentEscrow.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface EscrowRecord {
  driver: string;
  station: string;
  amount: number;
  status: string;
  createTime: number;
  timeoutTime: number;
  metadata: string;
  disputeReason: string | null;
}

interface DisputeEvidence {
  evidence: string;
  timestamp: number;
}

interface ContractState {
  admin: string;
  paused: boolean;
  oracle: string;
  resolver: string;
  escrowCounter: number;
  escrows: Map<number, EscrowRecord>;
  escrowBalances: Map<number, { lockedAmount: number }>;
  disputeEvidence: Map<string, DisputeEvidence>; // Key: `${escrowId}-${submitter}`
  tokenBalances: Map<string, number>; // Mock token balances for users and contract
  blockHeight: number; // Mock block height
}

// Mock contract implementation
class PaymentEscrowMock {
  private state: ContractState = {
    admin: "deployer",
    paused: false,
    oracle: "deployer",
    resolver: "deployer",
    escrowCounter: 0,
    escrows: new Map(),
    escrowBalances: new Map(),
    disputeEvidence: new Map(),
    tokenBalances: new Map([
      ["deployer", 0],
      ["driver", 10000],
      ["station", 0],
      ["contract", 0], // Represents the escrow contract's balance
    ]),
    blockHeight: 1000,
  };

  private MAX_METADATA_LEN = 500;
  private DEFAULT_TIMEOUT_BLOCKS = 144;
  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_INVALID_STATUS = 102;
  private ERR_ESCROW_NOT_FOUND = 103;
  private ERR_PAUSED = 104;
  private ERR_INVALID_ORACLE = 105;
  private ERR_TIMEOUT_NOT_REACHED = 106;
  private ERR_ALREADY_DISPUTED = 107;
  private ERR_INVALID_RESOLVER = 108;
  private ERR_METADATA_TOO_LONG = 109;
  private ERR_INVALID_PARAM = 110;
  private ERR_TRANSFER_FAILED = 111;
  private ERR_INSUFFICIENT_BALANCE = 112;

  // Mock block height control
  setBlockHeight(height: number) {
    this.state.blockHeight = height;
  }

  // Mock token transfer simulation
  private transferToken(from: string, to: string, amount: number): boolean {
    const fromBalance = this.state.tokenBalances.get(from) ?? 0;
    if (fromBalance < amount) return false;
    this.state.tokenBalances.set(from, fromBalance - amount);
    const toBalance = this.state.tokenBalances.get(to) ?? 0;
    this.state.tokenBalances.set(to, toBalance + amount);
    return true;
  }

  setTokenContract(): ClarityResponse<boolean> {
    // Mock, assumes always set
    return { ok: true, value: true };
  }

  setOracle(caller: string, newOracle: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.oracle = newOracle;
    return { ok: true, value: true };
  }

  setResolver(caller: string, newResolver: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.resolver = newResolver;
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  transferAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  createEscrow(caller: string, station: string, amount: number, timeout: number, metadata: string): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0 || metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    const driverBalance = this.state.tokenBalances.get(caller) ?? 0;
    if (driverBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    if (!this.transferToken(caller, "contract", amount)) {
      return { ok: false, value: this.ERR_TRANSFER_FAILED };
    }
    const escrowId = this.state.escrowCounter + 1;
    const createTime = this.state.blockHeight;
    const timeoutTime = createTime + (timeout > 0 ? timeout : this.DEFAULT_TIMEOUT_BLOCKS);
    this.state.escrows.set(escrowId, {
      driver: caller,
      station,
      amount,
      status: "locked",
      createTime,
      timeoutTime,
      metadata,
      disputeReason: null,
    });
    this.state.escrowBalances.set(escrowId, { lockedAmount: amount });
    this.state.escrowCounter = escrowId;
    return { ok: true, value: escrowId };
  }

  confirmCompletion(caller: string, escrowId: number, deliveredAmount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== this.state.oracle) {
      return { ok: false, value: this.ERR_INVALID_ORACLE };
    }
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    }
    if (escrow.status !== "locked") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (deliveredAmount > escrow.amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const refundAmount = escrow.amount - deliveredAmount;
    if (deliveredAmount > 0) {
      this.transferToken("contract", escrow.station, deliveredAmount);
    }
    if (refundAmount > 0) {
      this.transferToken("contract", escrow.driver, refundAmount);
    }
    escrow.status = "completed";
    this.state.escrows.set(escrowId, escrow);
    return { ok: true, value: true };
  }

  cancelEscrow(caller: string, escrowId: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    }
    if (caller !== escrow.driver && caller !== escrow.station) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (escrow.status !== "locked") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (this.state.blockHeight < escrow.timeoutTime) {
      return { ok: false, value: this.ERR_TIMEOUT_NOT_REACHED };
    }
    this.transferToken("contract", escrow.driver, escrow.amount);
    escrow.status = "cancelled";
    this.state.escrows.set(escrowId, escrow);
    return { ok: true, value: true };
  }

  disputeEscrow(caller: string, escrowId: number, reason: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    }
    if (caller !== escrow.driver && caller !== escrow.station) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (escrow.status !== "locked") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (escrow.disputeReason !== null) {
      return { ok: false, value: this.ERR_ALREADY_DISPUTED };
    }
    escrow.disputeReason = reason;
    escrow.status = "disputed";
    this.state.escrows.set(escrowId, escrow);
    return { ok: true, value: true };
  }

  submitEvidence(caller: string, escrowId: number, evidence: string): ClarityResponse<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    }
    if (escrow.status !== "disputed") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (caller !== escrow.driver && caller !== escrow.station) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (evidence.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const key = `${escrowId}-${caller}`;
    this.state.disputeEvidence.set(key, { evidence, timestamp: this.state.blockHeight });
    return { ok: true, value: true };
  }

  resolveDispute(caller: string, escrowId: number, releaseToStation: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== this.state.resolver) {
      return { ok: false, value: this.ERR_INVALID_RESOLVER };
    }
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) {
      return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    }
    if (escrow.status !== "disputed") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (releaseToStation > escrow.amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const refundToDriver = escrow.amount - releaseToStation;
    this.transferToken("contract", escrow.station, releaseToStation);
    this.transferToken("contract", escrow.driver, refundToDriver);
    escrow.status = "resolved";
    this.state.escrows.set(escrowId, escrow);
    return { ok: true, value: true };
  }

  getEscrowDetails(escrowId: number): ClarityResponse<EscrowRecord | null> {
    return { ok: true, value: this.state.escrows.get(escrowId) ?? null };
  }

  getEscrowBalance(escrowId: number): ClarityResponse<{ lockedAmount: number } | null> {
    return { ok: true, value: this.state.escrowBalances.get(escrowId) ?? null };
  }

  getDisputeEvidence(escrowId: number, submitter: string): ClarityResponse<DisputeEvidence | null> {
    const key = `${escrowId}-${submitter}`;
    return { ok: true, value: this.state.disputeEvidence.get(key) ?? null };
  }

  getContractStatus(): ClarityResponse<{
    admin: string;
    paused: boolean;
    oracle: string;
    resolver: string;
    escrowCount: number;
  }> {
    return {
      ok: true,
      value: {
        admin: this.state.admin,
        paused: this.state.paused,
        oracle: this.state.oracle,
        resolver: this.state.resolver,
        escrowCount: this.state.escrowCounter,
      },
    };
  }

  getTokenBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.state.tokenBalances.get(account) ?? 0 };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  driver: "driver",
  station: "station",
  oracle: "oracle",
  resolver: "resolver",
  unauthorized: "unauthorized",
};

describe("PaymentEscrow Contract", () => {
  let contract: PaymentEscrowMock;

  beforeEach(() => {
    contract = new PaymentEscrowMock();
    contract.setOracle(accounts.deployer, accounts.oracle);
    contract.setResolver(accounts.deployer, accounts.resolver);
    vi.resetAllMocks();
  });

  it("should initialize with correct contract status", () => {
    const status = contract.getContractStatus();
    expect(status).toEqual({
      ok: true,
      value: {
        admin: accounts.deployer,
        paused: false,
        oracle: accounts.oracle,
        resolver: accounts.resolver,
        escrowCount: 0,
      },
    });
  });

  it("should allow admin to set oracle", () => {
    const setOracle = contract.setOracle(accounts.deployer, accounts.unauthorized);
    expect(setOracle).toEqual({ ok: true, value: true });
    const status = contract.getContractStatus();
    expect(status.value.oracle).toBe(accounts.unauthorized);
  });

  it("should prevent non-admin from setting oracle", () => {
    const setOracle = contract.setOracle(accounts.unauthorized, accounts.unauthorized);
    expect(setOracle).toEqual({ ok: false, value: 100 });
  });

  it("should allow driver to create escrow", () => {
    const createResult = contract.createEscrow(
      accounts.driver,
      accounts.station,
      500,
      0,
      "Charging session at location X"
    );
    expect(createResult).toEqual({ ok: true, value: 1 });
    const details = contract.getEscrowDetails(1);
    expect(details.value).toEqual(expect.objectContaining({
      driver: accounts.driver,
      station: accounts.station,
      amount: 500,
      status: "locked",
      metadata: "Charging session at location X",
    }));
    expect(contract.getTokenBalance("contract").value).toBe(500);
    expect(contract.getTokenBalance(accounts.driver).value).toBe(10000 - 500);
  });

  it("should prevent creation with invalid amount", () => {
    const createResult = contract.createEscrow(
      accounts.driver,
      accounts.station,
      0,
      0,
      "Invalid"
    );
    expect(createResult).toEqual({ ok: false, value: 110 });
  });

  it("should prevent creation when paused", () => {
    contract.pauseContract(accounts.deployer);
    const createResult = contract.createEscrow(
      accounts.driver,
      accounts.station,
      500,
      0,
      "Paused"
    );
    expect(createResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow oracle to confirm completion with partial delivery", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    const confirmResult = contract.confirmCompletion(accounts.oracle, 1, 300);
    expect(confirmResult).toEqual({ ok: true, value: true });
    const details = contract.getEscrowDetails(1);
    expect(details.value.status).toBe("completed");
    expect(contract.getTokenBalance(accounts.station).value).toBe(300);
    expect(contract.getTokenBalance(accounts.driver).value).toBe(10000 - 500 + 200);
    expect(contract.getTokenBalance("contract").value).toBe(0);
  });

  it("should prevent non-oracle from confirming completion", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    const confirmResult = contract.confirmCompletion(accounts.unauthorized, 1, 500);
    expect(confirmResult).toEqual({ ok: false, value: 105 });
  });

  it("should allow cancellation after timeout", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    contract.setBlockHeight(1000 + 144 + 1); // Past timeout
    const cancelResult = contract.cancelEscrow(accounts.driver, 1);
    expect(cancelResult).toEqual({ ok: true, value: true });
    const details = contract.getEscrowDetails(1);
    expect(details.value.status).toBe("cancelled");
    expect(contract.getTokenBalance(accounts.driver).value).toBe(10000);
    expect(contract.getTokenBalance("contract").value).toBe(0);
  });

  it("should prevent cancellation before timeout", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    const cancelResult = contract.cancelEscrow(accounts.driver, 1);
    expect(cancelResult).toEqual({ ok: false, value: 106 });
  });

  it("should allow driver to dispute escrow", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    const disputeResult = contract.disputeEscrow(accounts.driver, 1, "Charging failed");
    expect(disputeResult).toEqual({ ok: true, value: true });
    const details = contract.getEscrowDetails(1);
    expect(details.value.status).toBe("disputed");
    expect(details.value.disputeReason).toBe("Charging failed");
  });

  it("should allow submission of evidence in dispute", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    contract.disputeEscrow(accounts.driver, 1, "Charging failed");
    const submitResult = contract.submitEvidence(accounts.station, 1, "Evidence of completion");
    expect(submitResult).toEqual({ ok: true, value: true });
    const evidence = contract.getDisputeEvidence(1, accounts.station);
    expect(evidence.value).toEqual(expect.objectContaining({
      evidence: "Evidence of completion",
    }));
  });

  it("should allow resolver to resolve dispute", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    contract.disputeEscrow(accounts.driver, 1, "Charging failed");
    const resolveResult = contract.resolveDispute(accounts.resolver, 1, 200);
    expect(resolveResult).toEqual({ ok: true, value: true });
    const details = contract.getEscrowDetails(1);
    expect(details.value.status).toBe("resolved");
    expect(contract.getTokenBalance(accounts.station).value).toBe(200);
    expect(contract.getTokenBalance(accounts.driver).value).toBe(10000 - 500 + 300);
    expect(contract.getTokenBalance("contract").value).toBe(0);
  });

  it("should prevent non-resolver from resolving dispute", () => {
    contract.createEscrow(accounts.driver, accounts.station, 500, 0, "Test");
    contract.disputeEscrow(accounts.driver, 1, "Charging failed");
    const resolveResult = contract.resolveDispute(accounts.unauthorized, 1, 500);
    expect(resolveResult).toEqual({ ok: false, value: 108 });
  });

  it("should prevent metadata exceeding max length in create", () => {
    const longMetadata = "a".repeat(501);
    const createResult = contract.createEscrow(
      accounts.driver,
      accounts.station,
      500,
      0,
      longMetadata
    );
    expect(createResult).toEqual({ ok: false, value: 110 });
  });
});