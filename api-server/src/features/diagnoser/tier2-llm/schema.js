export const tier2OutputSchema = {
  type: 'object', additionalProperties: false, required: ['ops', 'confidence', 'evidence'],
  properties: {
    ops: { type: 'array', maxItems: 8, items: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['op', 'from', 'to'], properties: { op: { enum: ['rename_field'] }, path: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'from', 'to'], properties: { op: { enum: ['move_field'] }, from: { type: 'string' }, to: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'path', 'from', 'to'], properties: { op: { enum: ['coerce_type'] }, path: { type: 'string' }, from: { enum: ['string', 'integer'] }, to: { enum: ['string', 'integer'] } } },
      { type: 'object', additionalProperties: false, required: ['op', 'path', 'map'], properties: { op: { enum: ['set_enum_map'] }, path: { type: 'string' }, map: { type: 'object', minProperties: 1, additionalProperties: { type: 'string' } } } },
    ] } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['source', 'quote'], properties: { source: { enum: ['error', 'spec'] }, quote: { type: 'string', minLength: 1, maxLength: 500 } } } },
  },
};
