import { createRailsConfig } from './eslint-rules/rails-config.mjs';

export default await createRailsConfig(import.meta.dirname);
