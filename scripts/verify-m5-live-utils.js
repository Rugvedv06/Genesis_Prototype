export function tier2SampleStatus(proposal) {
  return proposal?.failure ? 'failed' : 'passed';
}
