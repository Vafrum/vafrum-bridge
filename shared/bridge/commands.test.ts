import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBambuCommandPayloads } from './commands';

const fixturePath = join(__dirname, '__fixtures__', 'command-payloads.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  vectors: Array<{
    id: string;
    input: unknown;
    model: string | null;
    expected_payloads?: Record<string, unknown>[];
    expected_error?: string;
  }>;
};

for (const vector of fixture.vectors) {
  test(`vector ${vector.id}`, () => {
    const result = buildBambuCommandPayloads(vector.input, vector.model);

    if (vector.expected_error) {
      assert.equal(result.ok, false, `expected error for ${vector.id}, got ok`);
      return;
    }

    assert.equal(result.ok, true, `expected ok for ${vector.id}`);
    if (result.ok) {
      assert.deepEqual(
        result.payloads,
        vector.expected_payloads,
        `Vector ${vector.id} payload mismatch`,
      );
    }
  });
}
