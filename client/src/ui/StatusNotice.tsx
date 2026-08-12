import type { ReactNode } from "react";

import styles from "./StatusNotice.module.css";

export type StatusNoticeProps = Readonly<{
  kind: "progress" | "error";
  children: ReactNode;
}>;

/** Announces generic progress and recoverable failures. */
export function StatusNotice({ kind, children }: StatusNoticeProps) {
  return (
    <p
      className={`${styles.notice} ${styles[kind]}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
