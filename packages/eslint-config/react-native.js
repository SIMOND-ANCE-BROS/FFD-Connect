const base = require('./base');

/**
 * Shared React Native rules — to be spread into app-level ESLint configs.
 */
module.exports = {
  rules: {
    ...base.rules,

    // react-native/* rules removed: eslint-plugin-react-native is incompatible with ESLint 9
    'no-undef': 'off', // TypeScript handles this
  },
};
