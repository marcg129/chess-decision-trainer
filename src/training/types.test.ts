import { createId } from './types';

test('creates RFC 4122 version-4 UUID entity ids', () => {
  expect(createId()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
