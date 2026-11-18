const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
  description: 'MongoDB ObjectId',
};

const pageParameter = {
  name: 'page',
  in: 'query',
  schema: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
  description: 'Page number (defaults to 1)',
};

const limitParameter = {
  name: 'limit',
  in: 'query',
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  description: 'Items per page (defaults to 20; maximum 100)',
};

const errorResponse = {
  description: 'Request failed',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

const apiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Secure Notes API',
    version: '1.0.0',
    description:
      'REST API for secure notes, users, and posts. Authenticated endpoints accept a JWT bearer token. ' +
      'Register or log in to receive a token, then use Authorize to try protected endpoints.',
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'System' },
    { name: 'Authentication' },
    { name: 'Notes' },
    { name: 'Users' },
    { name: 'Posts' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Check API health',
        responses: {
          200: {
            description: 'API is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status: { type: 'string', enum: ['ok'] } },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a user account',
        description: 'Public registration always creates a user with the user role; a role cannot be supplied.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
          },
        },
        responses: {
          201: {
            description: 'Account created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: errorResponse,
          409: errorResponse,
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Authenticated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get the current user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } },
          },
          401: errorResponse,
        },
      },
      put: {
        tags: ['Authentication'],
        summary: 'Update the current user profile',
        description: 'Only name and interests can be changed through this endpoint.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateProfileRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Profile updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
        },
      },
    },
    '/api/notes': {
      post: {
        tags: ['Notes'],
        summary: 'Create a note',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateNoteRequest' } },
          },
        },
        responses: {
          201: {
            description: 'Note created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
        },
      },
      get: {
        tags: ['Notes'],
        summary: 'List notes',
        description: 'Users see their own notes. Admins see all notes and may filter by owner.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
          {
            name: 'owner',
            in: 'query',
            schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            description: 'Optional owner ObjectId; admins may use this to filter notes.',
          },
        ],
        responses: {
          200: {
            description: 'Page of notes',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteListResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
        },
      },
    },
    '/api/notes/{id}': {
      parameters: [{ $ref: '#/components/parameters/Id' }],
      get: {
        tags: ['Notes'],
        summary: 'Get a note',
        description: 'Available to the owner or an admin.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Note',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
        },
      },
      put: {
        tags: ['Notes'],
        summary: 'Update a note',
        description: 'Only the note owner can update it, including when the owner is an admin.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateNoteRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Note updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
        },
      },
      delete: {
        tags: ['Notes'],
        summary: 'Delete a note',
        description: 'Only the note owner can delete it.',
        security: [{ bearerAuth: [] }],
        responses: {
          204: { description: 'Note deleted' },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/users': {
      post: {
        tags: ['Users'],
        summary: 'Create a user (admin)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateUserRequest' } },
          },
        },
        responses: {
          201: {
            description: 'User created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
        },
      },
      get: {
        tags: ['Users'],
        summary: 'List users (admin)',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/Limit' }],
        responses: {
          200: {
            description: 'Page of users',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserListResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
        },
      },
    },
    '/api/users/interests': {
      get: {
        tags: ['Users'],
        summary: 'Group users by interest (admin)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
          {
            name: 'interest',
            in: 'query',
            schema: { type: 'string', minLength: 1, maxLength: 30 },
            description: 'Optional interest filter (case-insensitive)',
          },
        ],
        responses: {
          200: {
            description: 'Page of interest groups',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InterestListResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
        },
      },
    },
    '/api/users/{id}': {
      parameters: [{ $ref: '#/components/parameters/Id' }],
      get: {
        tags: ['Users'],
        summary: 'Get a user',
        description: 'Available to admins or the user themself.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'User',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
      put: {
        tags: ['Users'],
        summary: 'Update a user (admin)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateUserRequest' } },
          },
        },
        responses: {
          200: {
            description: 'User updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
      delete: {
        tags: ['Users'],
        summary: 'Delete a user (admin)',
        description: 'Also deletes the user’s notes and posts. An admin cannot delete their own account.',
        security: [{ bearerAuth: [] }],
        responses: {
          204: { description: 'User and their notes and posts deleted' },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/users/{id}/posts': {
      parameters: [{ $ref: '#/components/parameters/Id' }],
      get: {
        tags: ['Posts'],
        summary: 'List a user’s public posts',
        parameters: [{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/Limit' }],
        responses: {
          200: {
            description: 'User summary and a page of posts',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPostsResponse' } } },
          },
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/posts': {
      post: {
        tags: ['Posts'],
        summary: 'Create a post',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePostRequest' } },
          },
        },
        responses: {
          201: {
            description: 'Post created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PostResponse' } } },
          },
          400: errorResponse,
          401: errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Use the token returned by register or login.',
      },
    },
    parameters: {
      Id: idParameter,
      Page: pageParameter,
      Limit: limitParameter,
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string' },
          details: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              ],
            },
          },
        },
      },
      User: {
        type: 'object',
        required: ['id', 'name', 'email', 'role', 'interests', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['user', 'admin'] },
          interests: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Note: {
        type: 'object',
        required: ['id', 'owner', 'title', 'content', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          owner: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          title: { type: 'string' },
          content: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Post: {
        type: 'object',
        required: ['id', 'author', 'title', 'body', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          author: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          title: { type: 'string' },
          body: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RegisterRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 72,
            description: 'Must be 8–72 UTF-8 bytes (bcrypt limit).',
          },
          interests: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 30 },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 1024 },
        },
      },
      UpdateProfileRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          interests: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 30 },
          },
        },
      },
      CreateNoteRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          content: { type: 'string', maxLength: 20000, default: '' },
        },
      },
      UpdateNoteRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          content: { type: 'string', maxLength: 20000 },
        },
      },
      CreateUserRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 72,
            description: 'Must be 8–72 UTF-8 bytes (bcrypt limit).',
          },
          role: { type: 'string', enum: ['user', 'admin'], default: 'user' },
          interests: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 30 },
          },
        },
      },
      UpdateUserRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 72,
            description: 'Must be 8–72 UTF-8 bytes (bcrypt limit).',
          },
          role: { type: 'string', enum: ['user', 'admin'] },
          interests: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 30 },
          },
        },
      },
      CreatePostRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          body: { type: 'string', maxLength: 20000, default: '' },
        },
      },
      AuthResponse: {
        type: 'object',
        required: ['user', 'token'],
        properties: {
          user: { $ref: '#/components/schemas/User' },
          token: { type: 'string', description: 'JWT bearer token' },
        },
      },
      UserResponse: {
        type: 'object',
        required: ['user'],
        properties: { user: { $ref: '#/components/schemas/User' } },
      },
      NoteResponse: {
        type: 'object',
        required: ['note'],
        properties: { note: { $ref: '#/components/schemas/Note' } },
      },
      PostResponse: {
        type: 'object',
        required: ['post'],
        properties: { post: { $ref: '#/components/schemas/Post' } },
      },
      Pagination: {
        type: 'object',
        required: ['page', 'limit', 'total', 'totalPages'],
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      NoteListResponse: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      UserListResponse: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/User' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      InterestGroup: {
        type: 'object',
        required: ['interest', 'count', 'users'],
        properties: {
          interest: { type: 'string' },
          count: { type: 'integer' },
          users: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
      InterestListResponse: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/InterestGroup' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      UserPostsResponse: {
        type: 'object',
        required: ['user', 'posts', 'pagination'],
        properties: {
          user: {
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
              name: { type: 'string' },
            },
          },
          posts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'title', 'body', 'createdAt'],
              properties: {
                id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
                title: { type: 'string' },
                body: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          pagination: {
            type: 'object',
            required: ['page', 'limit', 'hasMore'],
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              hasMore: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
};

module.exports = apiSpec;
