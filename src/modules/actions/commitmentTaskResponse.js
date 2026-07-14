import { makeActionCandidate } from './actionCandidates.js';
import { evaluateCommitmentPolicy } from './commitmentPolicy.js';
import { readActiveRuntimeCommitments, scoreCommitmentUtility } from './commitmentUtility.js';

function runtimePopulation() {
  try {
    const peopleSystem = globalThis.shengling?.peopleSystem;
    const people = peopleSystem?.getAliveRuntime?.() ?? peopleSystem?.getAlive?.() ?? [];
    return Math.max(1, Array.isArray(people) ? people.length : 1);
  } catch {
    return 1;
  }
}

function compactUtility(utility) {
  return Object.freeze({
    score: utility.score,
    matches: utility.matches,
    blocked: utility.blocked,
    effects: utility.effects,
  });
}

export function evaluateTaskCommitmentResponse({
  task,
  person,
  source,
  target = {},
  commitments = null,
  population = null,
  actionCounts = {},
  capacityByAction = {},
} = {}) {
  if (!task || !person) return null;
  const activeCommitments = Array.isArray(commitments) ? commitments : readActiveRuntimeCommitments();
  const candidate = makeActionCandidate({ task, person, source, target });
  if (!candidate) return null;
  const policy = evaluateCommitmentPolicy({ candidate, commitments: activeCommitments });
  const utility = scoreCommitmentUtility({
    candidate,
    commitments: activeCommitments,
    population: population ?? runtimePopulation(),
    actionCounts,
    availableActions: [task.type],
    capacityByAction,
  });
  return Object.freeze({
    allowed: !policy.blocked,
    candidate,
    policy,
    utility: compactUtility(utility),
  });
}

export function attachTaskCommitmentResponse(context = {}) {
  const response = evaluateTaskCommitmentResponse(context);
  if (!response) return context.task ?? null;
  if (!response.allowed) return null;
  const relevant = response.utility.score > 0
    || response.utility.matches.length > 0
    || response.utility.blocked.length > 0
    || response.policy.matches.length > 0;
  if (!relevant) return context.task;
  return {
    ...context.task,
    data: {
      ...(context.task.data ?? {}),
      commitmentResponse: {
        score: response.utility.score,
        matches: response.utility.matches,
        blocked: response.utility.blocked,
        policy: response.policy,
      },
    },
  };
}
