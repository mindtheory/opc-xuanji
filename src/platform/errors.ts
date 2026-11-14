/**
 * 统一错误码与异常。口径：HTTP 层返回 code=0 成功，失败返回字符串 errorCode（ERR-<域>-<000>），
 * 便于审计与 API 消费者按码分流；错误码集合与 spec/opc-xuanji/api.yaml 的 errorCodes 一一对应。
 */
export const ERR = {
  AUTHZ_DENIED: "ERR-AUTHZ-001",
  TOKEN_INVALID: "ERR-TOKEN-001",
  CONFLICT_INVALID: "ERR-CONFLICT-001",
  WF_GUARD_FAILED: "ERR-WF-001",
  WF_CONFLICT: "ERR-WF-002",
  WF_NOT_FOUND: "ERR-WF-003",
  WF_IDEMPOTENCY: "ERR-WF-004",
  AUDIT_FAILED: "ERR-AUDIT-001",
  EMP_INVALID: "ERR-EMP-001",
  TASK_INVALID: "ERR-TASK-001",
  TASK_NOT_FOUND: "ERR-TASK-002",
  WEB_INVALID: "ERR-WEB-001",
  PRJ_INVALID: "ERR-PRJ-001",
  PRJ_RELEASE_STATE: "ERR-PRJ-002",
  PRJ_AUTH_REF: "ERR-PRJ-003",
  INT_INVALID: "ERR-INT-001",
  INT_NOT_FOUND: "ERR-INT-002",
  RES_INVALID: "ERR-RES-001",
  RES_CRED: "ERR-RES-002",
  RES_NOT_FOUND: "ERR-RES-003",
  RES_IN_USE: "ERR-RES-004",
  AUTO_INVALID: "ERR-AUTO-001",
  AUTO_CHECKOUT: "ERR-AUTO-002",
  AUTO_CRED: "ERR-AUTO-003",
  AUTO_DECISION: "ERR-AUTO-004",
  AUTO_EXEC: "ERR-AUTO-005",
  OPS_INVALID: "ERR-OPS-001",
  OPS_GITHUB: "ERR-OPS-002",
  VIEW_UNKNOWN: "ERR-VIEW-001",
  AGENT_UNAVAILABLE: "ERR-AGENT-001",
  HINDSIGHT_UNAVAILABLE: "ERR-HINDSIGHT-001",
  SYS: "ERR-SYS-001",
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];

export class OpcError extends Error {
  readonly errorCode: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(errorCode: ErrorCode, message: string, status = 400, details: unknown = undefined) {
    super(message);
    this.name = "OpcError";
    this.errorCode = errorCode;
    this.status = status;
    this.details = details;
  }
}

export function asOpcError(error: unknown): OpcError {
  if (error instanceof OpcError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new OpcError(ERR.SYS, message, 500);
}
