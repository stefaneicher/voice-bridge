export default {
  '*.{ts,js,svelte}': ['eslint --fix', 'prettier --write'],
  '*.{json,css,html,yml,yaml}': ['prettier --write'],
};
