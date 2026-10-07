import { loadRuntimeConfig } from './runtime-config';

export const PROCESS_RUNTIME_CONFIG = loadRuntimeConfig(process.env);
