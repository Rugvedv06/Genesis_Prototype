// PostgreSQL owns candidate state. Redis is maintained by the repository
// service as a bounded mirror and is never sufficient to authorize a hit.
import { getPool } from '../../db/pool.js';
import { listPatchCandidates, getPatchCandidate } from '../../db/patch-candidate-repository.js';
import {
  findVerifiedPatchCandidate,
  invalidateVerifiedPatchCandidate,
  invalidateAllVerifiedPatchCandidates,
  saveVerifiedPatchCandidate,
} from '../../db/registry-service.js';

export function learn(candidate) {
  return saveVerifiedPatchCandidate(candidate);
}

export function find(input) {
  return findVerifiedPatchCandidate(input);
}

export function invalidate(cacheKey) {
  return invalidateVerifiedPatchCandidate(cacheKey);
}

export function invalidateAll() {
  return invalidateAllVerifiedPatchCandidates();
}

export function candidates(options) {
  return listPatchCandidates(getPool(), options);
}

export function candidate(id) {
  return getPatchCandidate(getPool(), id);
}
