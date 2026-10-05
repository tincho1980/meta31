import { documentCorrection, documentDiscard, documentListQuery, documentProposal } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import {
  confirmDocument,
  correctDocument,
  discardDocument,
  getDocument,
  listDocuments,
  proposeDocument,
} from '../services/source-documents.js';
import { idParam, validate } from './validate.js';

/** Documents loaded by Claude and their review (RF-35, D3, rule 12). Mounted under /api/documents. */
export const documents = new Hono<AppEnv>()
  .get('/', validate('query', documentListQuery), async (c) => c.json(await listDocuments(c.var.db, c.req.valid('query').status)))
  .get('/:id', validate('param', idParam), async (c) => c.json(await getDocument(c.var.db, c.req.valid('param').id)))
  .post('/', validate('json', documentProposal), async (c) => c.json(await proposeDocument(c.var.db, c.req.valid('json'), c.var.user.id), 201))
  .put('/:id', validate('param', idParam), validate('json', documentCorrection), async (c) =>
    c.json(await correctDocument(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id)),
  )
  .post('/:id/confirm', validate('param', idParam), async (c) => c.json(await confirmDocument(c.var.db, c.req.valid('param').id, c.var.user.id)))
  .post('/:id/discard', validate('param', idParam), validate('json', documentDiscard), async (c) =>
    c.json(await discardDocument(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id)),
  );
