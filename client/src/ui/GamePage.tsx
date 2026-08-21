import type { ReactNode } from "react";

import { ThemeControl } from "../theme/index.ts";
import styles from "./GamePage.module.css";

type GamePageSharedProps = {
  children: ReactNode;
  leadingAction?: ReactNode;
  wide?: boolean;
  fullWidth?: boolean;
};

type GamePageHeaderProps =
  | {
      header?: true;
      eyebrow: string;
      title: string;
      description: ReactNode;
    }
  | {
      header: false;
      eyebrow?: never;
      title?: never;
      description?: never;
    };

export type GamePageProps = Readonly<GamePageSharedProps & GamePageHeaderProps>;

/** Shared page frame for each game mode. */
export function GamePage(props: GamePageProps) {
  const pageClassName = [
    styles.page,
    props.wide ? styles.wide : undefined,
    props.fullWidth ? styles.fullWidth : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <main className={pageClassName}>
      <div className={styles.toolbar}>
        {props.leadingAction !== undefined && (
          <div className={styles.leadingAction}>{props.leadingAction}</div>
        )}
        <div className={styles.themeControl}>
          <ThemeControl />
        </div>
      </div>
      {props.header !== false && (
        <header className={styles.header}>
          <p className={styles.eyebrow}>{props.eyebrow}</p>
          <h1>{props.title}</h1>
          <p className={styles.description}>{props.description}</p>
        </header>
      )}
      {props.children}
    </main>
  );
}
