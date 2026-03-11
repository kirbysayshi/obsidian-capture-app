import { describe, expect, it } from 'vitest';
import {
  buildNoteContent,
  makeHumanTimestamp,
  makeReadableSlug,
} from './obsidian.js';

// Fixed UTC date so tests are timezone-independent
const DATE = new Date('2024-03-07T14:05:00.000Z');

describe('buildNoteContent — frontmatter escaping', () => {
  it('preserves newlines as \\n in YAML double-quoted strings', () => {
    const content = buildNoteContent({
      what: 'Title',
      who: 'Alice\nBob',
      why: 'Reason one\nReason two\nReason three',
      date: DATE,
    });
    expect(content).toContain('who: "Alice\\nBob"');
    expect(content).toContain('why: "Reason one\\nReason two\\nReason three"');
    // No literal newlines inside quoted YAML values
    expect(content).not.toMatch(/who: "[^"]*\n/);
    expect(content).not.toMatch(/why: "[^"]*\n/);
  });

  it('escapes double quotes', () => {
    const content = buildNoteContent({
      what: 'A "quoted" title',
      who: '',
      why: 'Because "reasons"',
      date: DATE,
    });
    expect(content).toContain('what: "A \\"quoted\\" title"');
    expect(content).toContain('why: "Because \\"reasons\\""');
  });

  it('escapes backslashes', () => {
    const content = buildNoteContent({
      what: 'C:\\Users\\foo',
      who: '',
      why: 'path\\to\\thing',
      date: DATE,
    });
    expect(content).toContain('what: "C:\\\\Users\\\\foo"');
    expect(content).toContain('why: "path\\\\to\\\\thing"');
  });

  it('handles a mix of newlines, quotes, and backslashes', () => {
    const why = 'See:\nhttps://example.com\n"quoted" & \\backslash';
    const content = buildNoteContent({ what: 'x', who: '', why, date: DATE });
    const whyLine = content.split('\n').find((l) => l.startsWith('why:'));
    expect(whyLine).toBe(
      'why: "See:\\nhttps://example.com\\n\\"quoted\\" & \\\\backslash"',
    );
  });
});

describe('buildNoteContent — structure', () => {
  it('produces valid frontmatter block', () => {
    const content = buildNoteContent({
      what: 'Test',
      who: '',
      why: '',
      date: DATE,
    });
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('\n---\n');
    expect(content).toContain('created: 2024-03-07T14:05:00');
    expect(content).toContain('what: "Test"');
  });

  it('omits who and why when empty', () => {
    const content = buildNoteContent({ what: 'x', who: '', why: '' });
    expect(content).not.toContain('who:');
    expect(content).not.toContain('why:');
  });

  it('includes body text and source URL after frontmatter', () => {
    const content = buildNoteContent({
      what: 'x',
      who: '',
      why: '',
      bodyText: 'Article content.',
      url: 'https://example.com/article',
    });
    const afterFrontmatter = content.split('---\n').slice(2).join('---\n');
    expect(afterFrontmatter).toContain('Article content.');
    expect(afterFrontmatter).toContain('Source: https://example.com/article');
  });

  it('includes custom props, skipping reserved keys', () => {
    const content = buildNoteContent({
      what: 'x',
      who: '',
      why: '',
      props: [
        { k: 'rating', v: '5', type: 'text' },
        { k: 'read', v: 'true', type: 'boolean' },
        { k: 'what', v: 'should be ignored', type: 'text' },
      ],
    });
    expect(content).toContain('rating: "5"');
    expect(content).toContain('read: true');
    expect(content).not.toContain('should be ignored');
  });
});

describe('makeReadableSlug', () => {
  it('strips invalid filename characters and collapses resulting spaces', () => {
    expect(makeReadableSlug('Hello / World: Test?')).toBe('Hello World Test');
  });

  it('collapses multiple spaces', () => {
    expect(makeReadableSlug('a   b')).toBe('a b');
  });

  it('trims and limits to 60 characters', () => {
    expect(makeReadableSlug('  ' + 'A'.repeat(100) + '  ')).toHaveLength(60);
  });
});

describe('makeHumanTimestamp', () => {
  it('matches YYYY-MM-DD HH.mm format', () => {
    expect(makeHumanTimestamp(new Date())).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/,
    );
  });

  it('pads single-digit values', () => {
    // Use a fixed local-time date to avoid timezone flakiness
    const d = new Date(2024, 0, 5, 9, 3); // Jan 5, 09:03 local
    expect(makeHumanTimestamp(d)).toBe('2024-01-05 09.03');
  });
});
