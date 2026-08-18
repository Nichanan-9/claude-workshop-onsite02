import { defineConfig } from 'vitest/config';

// No jsdom / @vitejs/plugin-react here on purpose: everything under test is a
// pure module (booking helpers, the wizard reducer, restaurant availability),
// so the default node environment is both correct and faster. Add an
// environment only if React components ever get tested.
export default defineConfig({
  // Picks up the `@/*` alias straight from tsconfig.json, so tests import
  // modules by the same specifier the app does.
  resolve: {
    tsconfigPaths: true,
  },
});
