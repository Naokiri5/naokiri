import { openDb, closeDb } from '../server/src/db/db.js';
import { seedStrategies } from '../server/src/lab/lab.js';
import { seedBacktestFixture } from '../server/test/helpers.js';

openDb(); seedStrategies(); seedBacktestFixture(); closeDb();
