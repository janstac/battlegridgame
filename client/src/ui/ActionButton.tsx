import type { ButtonHTMLAttributes } from "react";

import styles from "./ActionButton.module.css";

export type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{
    variant?: "primary" | "secondary";
  }>;

/** A consistently styled application action. */
export function ActionButton({
  className,
  variant = "primary",
  ...props
}: ActionButtonProps) {
  const classes = [
    styles.button,
    variant === "secondary" ? styles.secondary : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...props} />;
}
