// validate({ params, query, body }) -> parsed & coerced values on req.valid.
// Schemas are z.strictObject(...), so unknown keys (e.g. a smuggled `role`) are rejected, not ignored.
// Because every field must be a string/number/array per schema, operator objects such as
// {"$gt": ""} can never reach a Mongo query (NoSQL-injection defence).
const validate = (schemas) => (req, res, next) => {
  const valid = {};
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(key === 'body' ? (req.body ?? {}) : req[key]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    valid[key] = result.data;
  }
  req.valid = valid;
  next();
};

module.exports = validate;
