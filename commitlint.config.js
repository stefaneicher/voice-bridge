// Conventional Commits (based on the Angular convention): feat, fix, docs, test, refactor, chore, ci, build, perf, style, revert.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
  },
};
