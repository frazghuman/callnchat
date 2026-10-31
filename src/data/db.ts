export type SqlValue = string | number | null;

/** Minimal async SQL surface so app code and tests share one contract. */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  transaction(task: () => Promise<void>): Promise<void>;
  /** Closes the connection and deletes the database file. */
  destroy(): Promise<void>;
}
