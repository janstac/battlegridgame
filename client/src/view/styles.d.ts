/** Allows Vite-managed CSS side-effect imports in TypeScript entry points. */
declare module "*.css";

/** Provides typed class-name maps for Vite-managed CSS Modules. */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
