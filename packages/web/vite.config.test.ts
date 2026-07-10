import { describe, expect, it } from 'vitest';
import { resolveAllowedHosts } from './vite.config';

describe('resolveAllowedHosts (B-12: dev server Host-header allow-list)', () => {
  it("defaults to Vite's built-in localhost-only allow-list when the env var is unset", () => {
    expect(resolveAllowedHosts(undefined)).toBeUndefined();
  });

  it('stays localhost-only for any value other than the exact string "true"', () => {
    expect(resolveAllowedHosts('1')).toBeUndefined();
    expect(resolveAllowedHosts('TRUE')).toBeUndefined();
    expect(resolveAllowedHosts('yes')).toBeUndefined();
  });

  it('opts into accepting any Host header only when AEMR_VITE_ALLOW_PUBLIC_HOSTS=true', () => {
    expect(resolveAllowedHosts('true')).toBe(true);
  });
});
