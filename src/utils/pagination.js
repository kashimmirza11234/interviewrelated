const { z } = require('zod');

// Query-string schema shared by every list endpoint.
const paginationQuery = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const toSkip = (page, limit) => (page - 1) * limit;

const pageMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

module.exports = { paginationQuery, toSkip, pageMeta };
