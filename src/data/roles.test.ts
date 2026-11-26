import { expect, it } from 'vitest';
import { appCredentials } from './roles.js';

it('reads the role and password from a connection string, decoding escapes', () => {
  expect(appCredentials('postgres://morgan_app:p%40ss@db:5432/morgan')).toEqual({
    user: 'morgan_app',
    password: 'p@ss',
  });
});

it('refuses a connection string without a password, without echoing it', () => {
  expect(() => appCredentials('postgres://morgan_app@db:5432/morgan')).toThrow(
    'DATABASE_URL must name the app role and its password',
  );
});
