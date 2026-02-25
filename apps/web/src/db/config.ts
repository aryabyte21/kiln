export const DEFAULT_DATABASE_URL = 'postgresql://openswarm:openswarm@localhost:5432/openswarm';

export const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
