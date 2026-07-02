import { HtmlParserService } from '../src/services/HtmlParserService';

describe('HtmlParserService', () => {
  it('should convert HTML to plain text correctly', () => {
    const html = '<p>Hello <strong>World</strong></p>';
    const text = HtmlParserService.parseHtml(html);
    expect(text).toBe('Hello World');
  });

  it('should handle empty strings', () => {
    expect(HtmlParserService.parseHtml('')).toBe('');
  });

  it('should preserve links appropriately', () => {
    const html = '<a href="https://example.com">Click Here</a>';
    const text = HtmlParserService.parseHtml(html);
    expect(text).toContain('Click Here [https://example.com]');
  });
});
