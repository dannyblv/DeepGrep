'use strict';
module.exports = {
  require: ['ts-node/register/transpile-only'],
  spec: 'src/__tests__/**/*.test.ts',
  timeout: 20000, // WASM grammar loading takes a few seconds on first run
};
