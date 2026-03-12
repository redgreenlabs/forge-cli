import { describe, it, expect } from 'vitest';
import { greet } from '../../src/greeting.js';

describe('greet', () => {
  it('returns a personalized greeting with the given name', () => {
    expect(greet('Alice')).toBe('Hello, Alice!');
  });

  it('returns a greeting for a different name', () => {
    expect(greet('Bob')).toBe('Hello, Bob!');
  });

  it('handles empty string name', () => {
    expect(greet('')).toBe('Hello, !');
  });

  it('handles name with spaces', () => {
    expect(greet('Mary Jane')).toBe('Hello, Mary Jane!');
  });

  it('handles name with special characters', () => {
    expect(greet("O'Brien")).toBe("Hello, O'Brien!");
  });

  it('accepts name parameter as a string type', () => {
    const result = greet('Test');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Hello, .+!$/);
  });

  // Edge cases
  it('handles very long names', () => {
    const longName = 'A'.repeat(1000);
    expect(greet(longName)).toBe(`Hello, ${longName}!`);
  });

  it('handles unicode names', () => {
    expect(greet('José')).toBe('Hello, José!');
    expect(greet('田中太郎')).toBe('Hello, 田中太郎!');
  });

  it('handles whitespace-only name', () => {
    expect(greet('   ')).toBe('Hello,    !');
  });

  it('preserves leading/trailing spaces in name', () => {
    expect(greet(' Alice ')).toBe('Hello,  Alice !');
  });

  it('handles name with newline characters', () => {
    expect(greet('Line\nBreak')).toBe('Hello, Line\nBreak!');
  });
});
