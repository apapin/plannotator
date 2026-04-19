/**
 * Bun-test happy-dom bootstrap for DOM-dependent tests in @plannotator/ui and
 * @plannotator/editor.
 *
 * Registered via `preload = ["./test-setup.ts"]` in `packages/ui/bunfig.toml`
 * (scoped to this package) so other packages' tests don't pay the DOM cost.
 *
 * Installing the DOM globally means `document`, `window`, `Node`, etc. are
 * available in every test in this scope, matching how React Testing Library
 * expects to run.
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({
    url: 'http://localhost/',
    width: 1024,
    height: 768,
  });
}

// Tell React that we're in an act-aware test environment so warnings don't
// appear for every state update wrapped in renderHook/act.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
