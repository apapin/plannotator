// Vite globals injected at build time
declare const __APP_VERSION__: string;

// Asset imports — declared as side-effect-safe so bundler-resolved
// imports don't fail typecheck. Value imports are typed as `string`
// (Vite resolves them to public URLs).

declare module "*.webp" {
  const content: string;
  export default content;
}

declare module "*.png" {
  const content: string;
  export default content;
}

// CSS side-effect imports (e.g. `import 'highlight.js/styles/github-dark.css'`).
// Viewer and several components rely on these at runtime via Vite; the
// type declaration is just so typecheck stops complaining.
declare module "*.css" {}
