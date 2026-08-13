import type { ReactNode } from "react";

import { ThemeControl } from "../theme/index.ts";
import styles from "./GamePage.module.css";

export type GamePageProps = Readonly<{
  eyebrow: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}>;

/** Shared page frame for each game mode. */
export function GamePage({
  eyebrow,
  title,
  description,
  children,
}: GamePageProps) {
  return (
    <main className={styles.page}>
      <div className={styles.themeControl}>
        <ThemeControl />
      </div>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
      </header>
      {children}
    </main>
  );
}
