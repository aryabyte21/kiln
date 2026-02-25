import base from './packages/eslint-config/base.js';

export default [
  ...base,
  {
    ignores: [
      'apps/controlplane/**',
      'apps/py-api/**',
      'infra/**',
      'dist/**',
      '.next/**',
      'drizzle/**',
    ],
  },
];
