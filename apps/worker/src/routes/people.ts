import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { listPeople } from '../services/people.js';

/** People, to pick a holder. Read-only: they are loaded by the seed. */
export const people = new Hono<AppEnv>().get('/', async (c) => c.json(await listPeople(c.var.db)));
