export const DEFAULT_DATABASE_URL = 'postgresql://cs5224:cs5224@localhost:5432/cs5224';

export const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
