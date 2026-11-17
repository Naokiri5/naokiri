import { quarantined } from '../server/dist/workers/runtime.js';
import { WORKERS } from '../server/dist/workers/registry.js';

quarantined.add(WORKERS[0].id);
