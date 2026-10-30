import { loadRuntimeConfig } from './runtime-config.config';

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

export const PROCESS_RUNTIME_CONFIG = loadRuntimeConfig(process.env);
