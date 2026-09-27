export type AuthContext = {
  readonly sessionId: string;
  readonly userId: string;
  readonly institutionId: string;
  readonly teacherId: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
};
